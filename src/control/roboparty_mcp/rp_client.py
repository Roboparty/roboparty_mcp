# SPDX-License-Identifier: GPL-3.0
# Copyright (C) 2026 RoboParty

"""Persistent WebSocket client to rp_server (``roboparty.v1`` protobuf).

rp_server exposes one ``Envelope`` per binary WebSocket frame at ``/ws``
(default ``wss://127.0.0.1:9000/ws``). This client keeps one connection,
caches telemetry pushes (``imu`` / ``battery`` / ``motors``), and lets
callers send an Envelope and await the matching response body.
"""

from __future__ import annotations

import asyncio
import logging
import json
import os
import time
from typing import Optional

from .proto import Envelope, PolicyCommand
from .ws_min import MinWebSocket, WsError

logger = logging.getLogger("roboparty_mcp.rp_client")

DEFAULT_WS_URL = "wss://127.0.0.1:9000/ws"


class RpClient:
    def __init__(self, ws_url: str = DEFAULT_WS_URL, token: str | None = None):
        if not ws_url.startswith("wss://") and os.environ.get("RP_ALLOW_PLAINTEXT") != "1":
            raise WsError("protocol v2 requires wss:// (set RP_ALLOW_PLAINTEXT=1 only for local debug)")
        self.ws_url = ws_url
        self.token = token if token is not None else os.environ.get("RP_SERVICE_TOKEN")
        self._lease = False
        self.control_session = 0
        self._lease_pending = None
        self._lease_lock = asyncio.Lock()
        self._heartbeat_task = None
        self._ws: Optional[MinWebSocket] = None
        self._lock = asyncio.Lock()
        self._recv_task: Optional[asyncio.Task] = None
        # response body name -> future for an in-flight request
        self._pending: dict[str, asyncio.Future] = {}
        self._req_lock = asyncio.Lock()
        self.last_imu: Optional[dict] = None
        self.last_bat: Optional[dict] = None
        self.last_motors: Optional[dict] = None
        self.last_sysinfo: Optional[dict] = None
        self.last_conn: Optional[dict] = None

    async def connect(self):
        async with self._lock:
            if self._ws is not None:
                return
            self._ws = await MinWebSocket.connect(
                self.ws_url, timeout=8, token=self.token,
                ca_file=os.environ.get("RP_TLS_CERT"))
            self._lease = False
            self._recv_task = asyncio.create_task(self._recv_loop())
            logger.info("connected to %s", self.ws_url)

    async def close(self):
        async with self._lock:
            self._lose_lease(WsError("connection closed"))
            for future in self._pending.values():
                if not future.done():
                    future.set_exception(WsError("connection closed"))
            if self._recv_task:
                self._recv_task.cancel()
                self._recv_task = None
            if self._ws:
                await self._ws.close()
                self._ws = None

    async def _ensure(self):
        if self._ws is None:
            await self.connect()

    async def _recv_loop(self):
        socket = self._ws
        try:
            while True:
                raw = await socket.recv()
                if isinstance(raw, str):
                    self._handle_text(json.loads(raw))
                    continue
                try:
                    env = Envelope()
                    env.ParseFromString(raw)
                except Exception:
                    logger.debug("dropping invalid protobuf frame (%d bytes)", len(raw))
                    continue
                self._handle(env)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("recv loop ended: %s", exc)
            if self._ws is socket:
                self._ws = None
                self._lose_lease(WsError("connection lost"))
            for fut in list(self._pending.values()):
                if not fut.done():
                    fut.set_exception(WsError("connection lost"))
            await socket.close()

    def _lose_lease(self, exc):
        self._lease = False
        self.control_session += 1
        if self._heartbeat_task:
            self._heartbeat_task.cancel()
            self._heartbeat_task = None
        if self._lease_pending and not self._lease_pending.done():
            self._lease_pending.set_exception(exc)

    def _handle_text(self, message):
        if message.get("type") == "error":
            exc = WsError(f"{message.get('code')}: {message.get('message')}")
            self._lose_lease(exc)
            for future in self._pending.values():
                if not future.done():
                    future.set_exception(exc)
        elif message.get("type") == "lease":
            if message.get("status") == "acquired":
                if self._lease_pending and not self._lease_pending.done():
                    self._lease = True
                    self.control_session += 1
                    self._lease_pending.set_result(message)
            elif message.get("status") not in ("renewed", "active"):
                self._lose_lease(WsError("control lease released"))

    async def acquire_control(self):
        """Explicit new operation: connect and acquire, never called by send."""
        async with self._lease_lock:
            await self._ensure()
            if self._lease:
                return
            self._lease_pending = asyncio.get_running_loop().create_future()
            try:
                await self._ws.send(json.dumps({"type": "lease.acquire"}))
                await asyncio.wait_for(self._lease_pending, 3)
            except BaseException:
                await self.close()
                raise
            finally:
                self._lease_pending = None
            self._heartbeat_task = asyncio.create_task(self._heartbeat())

    async def _heartbeat(self):
        try:
            while self._lease and self._ws:
                await asyncio.sleep(0.5)
                if self._lease and self._ws:
                    await self._ws.send(json.dumps({"type": "heartbeat"}))
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            self._lose_lease(exc)

    def _require_control(self):
        if self._ws is None or not self._lease:
            raise WsError("control lease lost; start a new explicit operation")

    def _handle(self, env: Envelope):
        body = env.WhichOneof("body")
        now = time.time()
        if body == "imu":
            m = env.imu
            self.last_imu = {
                "quat": {"w": m.w, "x": m.x, "y": m.y, "z": m.z},
                "gyro": {"x": m.gx, "y": m.gy, "z": m.gz},
                "accel": {"x": m.ax, "y": m.ay, "z": m.az},
                "temp_c": m.temperature,
                "ts": now,
            }
        elif body == "battery":
            b = env.battery
            self.last_bat = {
                "voltage_v": b.voltage,
                "current_a": b.current,
                "soc_pct": b.soc,
                "temp_c": b.temp,
                "capacity_ah": b.capacity,
                "soh_pct": b.soh,
                "cycles": b.cycles,
                "state": b.state,
                "power_on": b.power_on,
                "ts": now,
            }
        elif body == "motors":
            self.last_motors = {
                "motors": [
                    {
                        "id": m.id,
                        "position": m.position,
                        "speed": m.speed,
                        "torque": m.torque,
                        "temperature": m.temperature,
                        "error": m.error,
                        "mode": m.mode,
                        "response_count": m.response_count,
                    }
                    for m in env.motors.motors
                ],
                "ts": now,
            }
        elif body == "sysinfo":
            s = env.sysinfo
            self.last_sysinfo = {
                "cpu_percent": s.cpu_percent,
                "mem_percent": s.mem_percent,
                "load_avg": list(s.load_avg),
                "ts": now,
            }
        elif body == "conn":
            self.last_conn = {
                "connected": env.conn.connected,
                "hardware_ok": env.conn.hardware_ok,
                "protocol_version": env.conn.protocol_version,
                "features": list(env.conn.features),
                "ts": now,
            }
            if env.conn.protocol_version < 2:
                logger.error("rp_server protocol v%d is not supported; v2 required",
                             env.conn.protocol_version)
        elif body == "error":
            logger.warning("rp_server error: code=%s message=%s",
                           env.error.code, env.error.message)

        if body:
            fut = self._pending.get(body)
            if fut is not None and not fut.done():
                fut.set_result(env)

    async def send(self, env: Envelope, *, session: int | None = None):
        """Fire-and-forget command (e.g. joystick streaming)."""
        self._require_control()
        if session is not None and session != self.control_session:
            raise WsError("control session changed; operation aborted")
        await self._ws.send(env.SerializeToString())

    async def request(self, env: Envelope, expected: str,
                      timeout: float = 3.0) -> Envelope:
        """Send an Envelope and await a response whose body is ``expected``."""
        body = env.WhichOneof("body")
        if body in ("query", "stop") or (body == "policy_command" and
                                         env.policy_command.action == PolicyCommand.ACTION_STOP):
            await self._ensure()
        else:
            self._require_control()
        async with self._req_lock:
            loop = asyncio.get_running_loop()
            fut: asyncio.Future = loop.create_future()
            self._pending[expected] = fut
            try:
                await self._ws.send(env.SerializeToString())
                response = await asyncio.wait_for(fut, timeout)
                if body == "policy_command" and env.policy_command.action == PolicyCommand.ACTION_STOP:
                    self._lose_lease(WsError("policy stopped; acquire control for a new operation"))
                if body == "stop" and env.stop.status != "clear":
                    self._lose_lease(WsError("software stop latched; send clear_stop first"))
                return response
            finally:
                self._pending.pop(expected, None)
