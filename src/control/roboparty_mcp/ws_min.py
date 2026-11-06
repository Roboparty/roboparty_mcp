# SPDX-License-Identifier: GPL-3.0
# Copyright (C) 2026 RoboParty

"""Minimal stdlib-only WebSocket client (text/binary frames, RFC 6455).

rp_server speaks protobuf over binary WebSocket frames, so this client must
support both text and binary opcodes. It avoids depending on the system
python3-websockets package, whose older versions are incompatible with
Python 3.10 (removed loop= parameter).
"""

from __future__ import annotations

import asyncio
import base64
import os
import ssl
import struct
from urllib.parse import urlparse


class WsError(Exception):
    pass


class MinWebSocket:
    def __init__(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        self._r = reader
        self._w = writer

    @classmethod
    async def connect(cls, url: str, timeout: float = 8.0,
                      token: str | None = None,
                      ca_file: str | None = None) -> "MinWebSocket":
        if token and any(c in token for c in "\r\n"):
            raise WsError("invalid bearer token")
        u = urlparse(url)
        if u.scheme not in ("ws", "wss"):
            raise WsError(f"unsupported scheme: {u.scheme}")
        host = u.hostname
        port = u.port or (443 if u.scheme == "wss" else 80)
        path = u.path or "/"
        if u.query:
            path = f"{path}?{u.query}"
        ssl_context = None
        if u.scheme == "wss":
            cert = ca_file or os.environ.get("RP_TLS_CERT", "/etc/rp-server/auth/tls.crt")
            if not cert or not os.path.isfile(cert):
                raise WsError(f"wss requires a trusted server certificate: {cert}")
            ssl_context = ssl.create_default_context(cafile=cert)
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port, ssl=ssl_context,
                                    server_hostname=host if ssl_context else None),
            timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        req = (
            f"GET {path} HTTP/1.1\r\n"
            f"Host: {host}:{port}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n"
            "Sec-WebSocket-Protocol: roboparty.v2.proto\r\n"
            + (f"Authorization: Bearer {token}\r\n" if token else "")
            + "\r\n"
        )
        writer.write(req.encode())
        await writer.drain()
        status = await asyncio.wait_for(reader.readline(), timeout)
        if b"101" not in status:
            writer.close()
            raise WsError(f"handshake failed: {status.decode(errors='replace').strip()}")
        while True:  # drain response headers
            line = await asyncio.wait_for(reader.readline(), timeout)
            if line in (b"\r\n", b"\n", b""):
                break
        return cls(reader, writer)

    async def send(self, data: str | bytes):
        """Send a text (str) or binary (bytes) message."""
        payload = data.encode() if isinstance(data, str) else bytes(data)
        opcode = 0x1 if isinstance(data, str) else 0x2
        mask = os.urandom(4)
        header = bytearray([0x80 | opcode])  # FIN + opcode
        n = len(payload)
        if n < 126:
            header.append(0x80 | n)
        elif n < 65536:
            header.append(0x80 | 126)
            header += struct.pack(">H", n)
        else:
            header.append(0x80 | 127)
            header += struct.pack(">Q", n)
        header += mask
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self._w.write(bytes(header) + masked)
        await self._w.drain()

    async def recv(self) -> str | bytes:
        """Receive text as str and binary as bytes, including fragments."""
        buf = bytearray()
        message_started = False
        text_message = False
        while True:
            b1, b2 = await self._r.readexactly(2)
            fin = bool(b1 & 0x80)
            opcode = b1 & 0x0F
            masked = b2 & 0x80
            n = b2 & 0x7F
            if n == 126:
                n = struct.unpack(">H", await self._r.readexactly(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", await self._r.readexactly(8))[0]
            mask = await self._r.readexactly(4) if masked else b""
            payload = await self._r.readexactly(n) if n else b""
            if mask:
                payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))

            if opcode == 0x8:  # close
                await self.close()
                raise WsError("connection closed by server")
            if opcode == 0x9:  # ping -> pong (echo payload)
                await self._pong(payload)
                continue
            if opcode == 0xA:  # pong
                continue

            if opcode in (0x1, 0x2):  # text / binary, possibly fragmented
                text_message = opcode == 0x1
                message_started = True
                buf.extend(payload)
            elif opcode == 0x0 and message_started:  # continuation
                buf.extend(payload)
            else:
                continue

            if fin:
                return buf.decode("utf-8") if text_message else bytes(buf)

    async def _pong(self, payload: bytes):
        mask = os.urandom(4)
        n = len(payload)
        header = bytearray([0x8A])
        if n < 126:
            header.append(0x80 | n)
        else:
            header.append(0x80 | 126)
            header += struct.pack(">H", n)
        header += mask
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self._w.write(bytes(header) + masked)
        await self._w.drain()

    async def close(self):
        try:
            self._w.write(b"\x88\x80" + os.urandom(4))
            await self._w.drain()
        except Exception:
            pass
        self._w.close()
