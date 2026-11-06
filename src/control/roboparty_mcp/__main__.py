# SPDX-License-Identifier: GPL-3.0
# Copyright (C) 2026 RoboParty

"""Entry point.

stdio mode (AI clients spawn it):
    python3 -m roboparty_mcp --stdio
HTTP mode (systemd service):
    python3 -m roboparty_mcp --host 0.0.0.0 --port 8766
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys

import yaml

try:
    from fastapi import FastAPI, Request
    from fastapi.responses import JSONResponse
except Exception:  # fastapi is an optional extra; stdio must work without it
    FastAPI = Request = JSONResponse = None

from . import __version__
from .mcp_server import handle_message
from .rp_client import RpClient
from .tools import ToolRunner

logger = logging.getLogger("roboparty_mcp")


def _load_config(path: str) -> dict:
    if not path:
        return {}
    try:
        with open(path, encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    except FileNotFoundError:
        logger.warning("config %s not found, using defaults", path)
        return {}


def _build_runner(config: dict) -> ToolRunner:
    ws_url = config.get("rp_server", {}).get("ws_url", "wss://127.0.0.1:9000/ws")
    return ToolRunner(RpClient(ws_url), config)


async def run_stdio(runner: ToolRunner):
    loop = asyncio.get_running_loop()
    while True:
        line = await loop.run_in_executor(None, sys.stdin.readline)
        if not line:
            break
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        resp = await handle_message(msg, runner)
        if resp:
            sys.stdout.write(json.dumps(resp, ensure_ascii=False) + "\n")
            sys.stdout.flush()


def create_app(runner: ToolRunner):
    if FastAPI is None:
        raise RuntimeError(
            "HTTP mode requires fastapi/uvicorn; install with "
            "`pip install 'roboparty-mcp[web]'` (stdio mode works without them)."
        )
    app = FastAPI(title="RoboParty MCP", version=__version__)

    @app.get("/health")
    async def health():
        connected = runner.client._ws is not None
        return {"status": "ok", "rp_server_connected": connected,
                "conn": runner.client.last_conn}

    @app.get("/mcp/tools")
    async def list_tools():
        from .tools import TOOLS_SPEC
        return {"ok": True, "tools": TOOLS_SPEC}

    @app.post("/mcp")
    async def mcp(request: Request):
        try:
            msg = await request.json()
        except Exception:
            return JSONResponse({"error": "invalid json"}, status_code=400)
        resp = await handle_message(msg, runner)
        return JSONResponse(resp)

    @app.on_event("startup")
    async def on_startup():
        try:
            await runner.client.connect()
        except Exception as exc:
            logger.warning("rp_server not reachable yet: %s (will retry on demand)", exc)

    @app.on_event("shutdown")
    async def on_shutdown():
        await runner.client.close()

    return app


def main():
    parser = argparse.ArgumentParser(description="RoboParty MCP server")
    parser.add_argument("--config", default=os.environ.get("MCP_CONFIG", ""))
    parser.add_argument("--stdio", action="store_true", help="run stdio JSON-RPC loop")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--log-level", default="info")
    args = parser.parse_args()

    logging.basicConfig(level=args.log_level.upper())
    config = _load_config(args.config)
    runner = _build_runner(config)

    if args.stdio:
        asyncio.run(run_stdio(runner))
        return

    import uvicorn
    uvicorn.run(create_app(runner), host=args.host, port=args.port,
                log_level=args.log_level)


if __name__ == "__main__":
    main()
