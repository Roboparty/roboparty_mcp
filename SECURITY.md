# Security

Report vulnerabilities privately to the RoboParty maintainers; do not open a
public issue for a working exploit.

## Boundaries

- `roboparty-mcp` is a local MCP router. It does not implement robot
  authentication, leases or hardware safety.
- `RP_SERVICE_TOKEN`, TLS certificate paths and control MCP config are only
  passed to the `control` child process. `docs` and `system1` children do not
  receive them.
- Control MCP defaults to `readonly: true`; writable motion still requires the
  rp_server token/JWT, a control lease and explicit configuration.
- Do not expose control MCP or System-1 HTTP ports on untrusted networks.
- System-1 output is advisory, not authorization for hardware actions.
