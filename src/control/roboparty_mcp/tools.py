# SPDX-License-Identifier: GPL-3.0
# Copyright (C) 2026 RoboParty

"""MCP tools: high-level robot commands mapped onto ``roboparty.v1``.

Motion tools stream virtual-gamepad ``joystick`` Envelopes for a computed
duration; telemetry tools read cached ``imu``/``battery`` pushes, and query
tools await the matching protobuf response body.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from .proto import (
    Envelope,
    PolicyCommand,
    PolicyState,
    Query,
    ResponseStatus,
    StopAckState,
    axis_value,
    policy_state_name,
)
from .rp_client import RpClient

logger = logging.getLogger("roboparty_mcp.tools")

DEFAULTS = {
    "speed_mps": 0.5,        # linear speed at full stick
    "turn_dps": 45.0,        # yaw rate at full stick, deg/s
    # rp_server/inference mapping: RY -> vx, RX -> vy, LT/RT -> yaw.
    "forward_axis": "ry",
    "forward_sign": -1.0,    # gamepad Y: up (forward) is negative
    "turn_left_axis": "lt",  # inference: yaw = -axes[LT]
    "turn_right_axis": "rt", # inference: yaw = axes[RT] (negative)
    "turn_left_value": -1.0,
    "turn_right_value": -1.0,
    "max_move_s": 10.0,
    "max_turn_s": 10.0,
}

TOOLS_SPEC = [
    {
        "name": "move_forward",
        "description": "Move the robot forward by a distance in meters (default 1.0)",
        "inputSchema": {
            "type": "object",
            "properties": {"distance_m": {"type": "number", "default": 1.0, "minimum": 0}},
        },
    },
    {
        "name": "move_backward",
        "description": "Move the robot backward by a distance in meters (default 1.0)",
        "inputSchema": {
            "type": "object",
            "properties": {"distance_m": {"type": "number", "default": 1.0, "minimum": 0}},
        },
    },
    {
        "name": "turn_left",
        "description": "Turn the robot left by an angle in degrees (default 90)",
        "inputSchema": {
            "type": "object",
            "properties": {"angle_deg": {"type": "number", "default": 90, "minimum": 0}},
        },
    },
    {
        "name": "turn_right",
        "description": "Turn the robot right by an angle in degrees (default 90)",
        "inputSchema": {
            "type": "object",
            "properties": {"angle_deg": {"type": "number", "default": 90, "minimum": 0}},
        },
    },
    {
        "name": "get_battery",
        "description": "Get battery voltage, current, state-of-charge and temperature",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "get_imu",
        "description": "Get IMU orientation quaternion, gyro, accel and temperature",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "check_motor_errors",
        "description": "Query motor error codes (query WHAT_ERRORS)",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "stop",
        "description": "Software stop: zero joystick, stop policy, and latch control until clear_stop",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "clear_stop",
        "description": "Clear the latched software stop so control can be acquired again",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "reset",
        "description": "Reset the robot: clear motor errors, zero gamepad axes, stop running policy",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "policy_status",
        "description": "Query current inference policy name and state",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "policy_start",
        "description": "Start an inference policy by name",
        "inputSchema": {
            "type": "object",
            "properties": {"name": {"type": "string"}},
            "required": ["name"],
        },
    },
    {
        "name": "policy_stop",
        "description": "Stop the running inference policy",
        "inputSchema": {
            "type": "object",
            "properties": {"name": {"type": "string", "default": "none"}},
        },
    },
]


class ToolRunner:
    def __init__(self, client: RpClient, cfg: dict[str, Any] | None = None):
        self.client = client
        cfg = cfg or {}
        # Accept either the full mcp.yaml config (sections motion/readonly)
        # or a legacy flat motion-only dict.
        if any(k in cfg for k in ("motion", "readonly", "rp_server")):
            motion = cfg.get("motion", {})
            readonly = cfg.get("readonly", True)
        else:
            motion = cfg
            readonly = cfg.get("readonly", True)
        self.cfg = {**DEFAULTS, **motion}
        # Backward compatibility with the old single turn_axis/left_sign keys.
        if "turn_axis" in motion and "turn_left_axis" not in motion:
            legacy_sign = float(motion.get("left_sign", -1.0))
            self.cfg["turn_left_axis"] = motion["turn_axis"]
            self.cfg["turn_right_axis"] = motion["turn_axis"]
            self.cfg["turn_left_value"] = legacy_sign
            self.cfg["turn_right_value"] = -legacy_sign
        self._motion_lock = asyncio.Lock()
        self.readonly = bool(readonly)

    def _check_writable(self, tool_name: str) -> None:
        if self.readonly:
            raise PermissionError(
                f"Tool '{tool_name}' is disabled in readonly mode. "
                f"Set readonly: false in mcp.yaml to enable."
            )

    @staticmethod
    def _new_envelope() -> Envelope:
        env = Envelope()
        env.header.timestamp_ms = time.time_ns() // 1_000_000
        return env

    @staticmethod
    def _stop_result(ack) -> dict[str, Any]:
        return {
            "ok": bool(ack.confirmed),
            "status": ack.status,
            "state": StopAckState.Name(ack.state),
            "confirmed": bool(ack.confirmed),
            "software_stopped": bool(ack.software_stopped),
            "motor_state": ack.motor_state or "unknown",
            "estop_state": ack.estop_state or "unknown",
            "reason": ack.reason,
            "request_id": ack.request_id,
        }

    async def _drive_axis(self, axis: str, value: float, duration_s: float):
        axis_id = axis_value(axis)
        async with self._motion_lock:
            await self.client.acquire_control()
            session = self.client.control_session
            env = self._new_envelope()
            env.joystick.axis = axis_id
            env.joystick.value = float(value)
            try:
                deadline = asyncio.get_running_loop().time() + duration_s
                while asyncio.get_running_loop().time() < deadline:
                    await self.client.send(env, session=session)
                    await asyncio.sleep(min(0.02, max(0, deadline - asyncio.get_running_loop().time())))
            finally:
                stop = self._new_envelope()
                stop.joystick.axis = axis_id
                stop.joystick.value = 0.0
                try:
                    await self.client.send(stop, session=session)
                except Exception as exc:  # never mask the original failure
                    logger.warning("failed to release axis %s: %s", axis, exc)

    async def _move(self, distance_m: float, direction: int) -> dict:
        speed = float(self.cfg["speed_mps"])
        duration = min(abs(distance_m) / speed, float(self.cfg["max_move_s"]))
        value = float(self.cfg["forward_sign"]) * direction
        await self._drive_axis(self.cfg["forward_axis"], value, duration)
        return {"ok": True, "distance_m": distance_m, "duration_s": round(duration, 2),
                "direction": "forward" if direction > 0 else "backward"}

    async def _turn(self, angle_deg: float, left: bool) -> dict:
        rate = float(self.cfg["turn_dps"])
        duration = min(abs(angle_deg) / rate, float(self.cfg["max_turn_s"]))
        axis = self.cfg["turn_left_axis"] if left else self.cfg["turn_right_axis"]
        value = float(self.cfg["turn_left_value"] if left else self.cfg["turn_right_value"])
        await self._drive_axis(axis, value, duration)
        return {"ok": True, "angle_deg": angle_deg, "duration_s": round(duration, 2),
                "direction": "left" if left else "right"}

    async def call(self, name: str, args: dict[str, Any]) -> Any:
        if name == "move_forward":
            self._check_writable(name)
            return await self._move(float(args.get("distance_m", 1.0)), +1)
        if name == "move_backward":
            self._check_writable(name)
            return await self._move(float(args.get("distance_m", 1.0)), -1)
        if name == "turn_left":
            self._check_writable(name)
            return await self._turn(float(args.get("angle_deg", 90)), True)
        if name == "turn_right":
            self._check_writable(name)
            return await self._turn(float(args.get("angle_deg", 90)), False)

        if name == "get_battery":
            if self.client.last_bat is None:
                await self.client._ensure()
                await asyncio.sleep(0.2)  # telemetry pushes at 50 Hz
            return self.client.last_bat or {"ok": False, "error": "no battery telemetry (BMS offline?)"}
        if name == "get_imu":
            if self.client.last_imu is None:
                await self.client._ensure()
                await asyncio.sleep(0.2)
            return self.client.last_imu or {"ok": False, "error": "no IMU telemetry (IMU offline?)"}

        if name == "check_motor_errors":
            env = self._new_envelope()
            env.query.what = Query.WHAT_ERRORS
            resp = await self.client.request(env, "motor_errors")
            errors = [
                {"motor_id": e.motor_id, "code": e.code, "name": e.name, "type": e.type}
                for e in resp.motor_errors.errors
            ]
            return {"ok": True, "count": len(errors), "errors": errors}
        if name == "stop":
            env = self._new_envelope()
            env.stop.status = "request"
            env.stop.request_id = f"mcp-{int(time.time() * 1000)}"
            resp = await self.client.request(env, "stop_ack")
            return self._stop_result(resp.stop_ack)
        if name == "clear_stop":
            self._check_writable(name)
            env = self._new_envelope()
            env.stop.status = "clear"
            env.stop.request_id = f"mcp-{int(time.time() * 1000)}"
            resp = await self.client.request(env, "stop_ack")
            return self._stop_result(resp.stop_ack)
        if name == "reset":
            self._check_writable(name)
            await self.client.acquire_control()
            env = self._new_envelope()
            env.reset.SetInParent()
            resp = await self.client.request(env, "reset_response")
            status = resp.reset_response.status
            return {"ok": status == ResponseStatus.RESPONSE_STATUS_OK,
                    "status": ResponseStatus.Name(status)}
        if name == "policy_status":
            env = self._new_envelope()
            env.query.what = Query.WHAT_POLICY
            resp = await self.client.request(env, "policy_response")
            pr = resp.policy_response
            return {"ok": True, "name": pr.name,
                    "state": policy_state_name(pr.state),
                    "running": pr.state == PolicyState.STATE_RUNNING,
                    "ready": bool(pr.ready), "pid": pr.pid,
                    "exit_code": pr.exit_code, "message": pr.message,
                    "updated_at_ms": pr.updated_at_ms}
        if name == "policy_start":
            self._check_writable(name)
            await self.client.acquire_control()
            pname = args["name"]
            env = self._new_envelope()
            env.policy_command.name = pname
            env.policy_command.action = PolicyCommand.ACTION_START
            resp = await self.client.request(env, "policy_response", timeout=15.0)
            pr = resp.policy_response
            return {"ok": pr.state == PolicyState.STATE_RUNNING,
                    "name": pr.name, "state": policy_state_name(pr.state),
                    "ready": bool(pr.ready), "pid": pr.pid,
                    "exit_code": pr.exit_code, "message": pr.message}
        if name == "policy_stop":
            self._check_writable(name)
            pname = args.get("name", "none")
            env = self._new_envelope()
            env.policy_command.name = pname
            env.policy_command.action = PolicyCommand.ACTION_STOP
            resp = await self.client.request(env, "policy_response", timeout=15.0)
            pr = resp.policy_response
            return {"ok": pr.state == PolicyState.STATE_STOPPED,
                    "name": pr.name, "state": policy_state_name(pr.state),
                    "pid": pr.pid, "exit_code": pr.exit_code,
                    "message": pr.message}
        raise KeyError(f"unknown tool: {name}")
