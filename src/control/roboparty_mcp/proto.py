# SPDX-License-Identifier: GPL-3.0
# Copyright (C) 2026 RoboParty

"""Convenience accessors for the bundled ``roboparty.v1`` protobuf bindings.

The generated bindings are shipped in ``src/control/generated`` and are put
on ``PYTHONPATH`` by the control MCP launcher.
"""

from __future__ import annotations

try:
    from roboparty.v1 import auth_pb2, commands_pb2, envelope_pb2, responses_pb2, telemetry_pb2
except ImportError as exc:  # pragma: no cover - depends on the deployment
    raise ImportError(
        "roboparty.v1 bindings are missing from the control MCP runtime. "
        "Run the launcher from the roboparty-mcp package so that "
        "src/control/generated is on PYTHONPATH.\n"
        f"({exc})"
    ) from exc

Envelope = envelope_pb2.Envelope
Axis = commands_pb2.Axis
Button = commands_pb2.Button
ButtonState = commands_pb2.ButtonState
PolicyCommand = commands_pb2.PolicyCommand
Query = commands_pb2.Query
PolicyState = responses_pb2.PolicyResponse.State
ResponseStatus = responses_pb2.ResponseStatus
StopAckState = auth_pb2.StopAck.State

AXIS_BY_NAME = {
    "lx": Axis.AXIS_LX,
    "ly": Axis.AXIS_LY,
    "rx": Axis.AXIS_RX,
    "ry": Axis.AXIS_RY,
    "lt": Axis.AXIS_LT,
    "rt": Axis.AXIS_RT,
}


def axis_value(name: str) -> int:
    return AXIS_BY_NAME.get(str(name).lower(), Axis.AXIS_UNSPECIFIED)


def policy_state_name(value: int) -> str:
    name = PolicyState.Name(value)  # STATE_RUNNING
    return name[len("STATE_"):] if name.startswith("STATE_") else name
