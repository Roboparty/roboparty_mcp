# SPDX-License-Identifier: GPL-3.0
# Copyright (C) 2026 RoboParty

"""MCP JSON-RPC core (protocol 2024-11-05, tools/list + tools/call).

Shared by the stdio transport (Cursor / Claude Desktop) and the HTTP
transport (systemd service, POST /mcp).
"""

from __future__ import annotations

import json
import logging

from . import __version__
from .tools import TOOLS_SPEC, ToolRunner

logger = logging.getLogger("roboparty_mcp.server")

PROTOCOL_VERSION = "2024-11-05"


async def handle_message(msg: dict, runner: ToolRunner) -> dict:
    mid = msg.get("id")
    method = msg.get("method")
    params = msg.get("params") or {}

    if method == "initialize":
        return {
            "jsonrpc": "2.0", "id": mid,
            "result": {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "roboparty-mcp", "version": __version__},
            },
        }
    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": mid, "result": {"tools": TOOLS_SPEC}}
    if method == "tools/call":
        name = params.get("name", "")
        args = params.get("arguments") or {}
        try:
            result = await runner.call(name, args)
            text = result if isinstance(result, str) else json.dumps(result, ensure_ascii=False)
            return {
                "jsonrpc": "2.0", "id": mid,
                "result": {"content": [{"type": "text", "text": text}]},
            }
        except KeyError as exc:
            return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": str(exc)}}
        except Exception as exc:
            logger.exception("tool %s failed", name)
            return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32001, "message": str(exc)}}
    if method == "notifications/initialized":
        return {}
    return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": f"unknown method {method}"}}
