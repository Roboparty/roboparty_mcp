#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const home =
  process.env.ROBOPARTY_MCP_HOME ||
  path.join(os.homedir(), ".cache", "roboparty-control-mcp");
const venvDir = path.join(home, "venv");
const isWin = process.platform === "win32";
const venvPython = path.join(venvDir, isWin ? "Scripts/python.exe" : "bin/python");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const argv = process.argv.slice(2);

const pythonPath = [root, path.join(root, "generated"), process.env.PYTHONPATH]
  .filter(Boolean)
  .join(path.delimiter);

function env() {
  return { ...process.env, PYTHONPATH: pythonPath };
}

function run(command, args, opts = {}) {
  return spawnSync(command, args, { env: env(), ...opts });
}

function importable(command) {
  const probe = run(
    command,
    ["-c", "import roboparty_mcp, roboparty.v1, yaml, google.protobuf"],
    { stdio: "ignore" },
  );
  return probe.status === 0;
}

function candidates() {
  const list = [];
  if (process.env.ROBOPARTY_PYTHON) list.push(process.env.ROBOPARTY_PYTHON);
  if (existsSync(venvPython)) list.push(venvPython);
  list.push("python3", "python");
  return [...new Set(list)];
}

function findPython() {
  return candidates().find(importable) || null;
}

function usage() {
  console.log(`roboparty-control-mcp ${pkg.version}

Usage:
  roboparty-control-mcp --stdio [--config <mcp.yaml>]   start the MCP server
  roboparty-control-mcp --setup                        provision Python dependencies
  roboparty-control-mcp --check                        verify the Python runtime
  roboparty-control-mcp --version

Environment:
  ROBOPARTY_MCP_HOME   runtime cache dir (default ~/.cache/roboparty-control-mcp)
  ROBOPARTY_PYTHON     Python used to create the venv (default python3)`);
}

function setup() {
  const system = candidates()
    .filter((name) => name !== venvPython)
    .find(importable);
  if (system) {
    console.error(`[setup] runtime already available: ${system}`);
    return 0;
  }

  mkdirSync(home, { recursive: true });
  const base = process.env.ROBOPARTY_PYTHON || (isWin ? "python" : "python3");

  if (!existsSync(venvPython)) {
    console.error(`[setup] creating venv: ${venvDir}`);
    if (run(base, ["-m", "venv", venvDir], { stdio: "inherit" }).status !== 0) {
      console.error("[setup] failed to create venv; set ROBOPARTY_PYTHON to a Python >=3.10");
      return 1;
    }
  }

  console.error("[setup] installing pyyaml + protobuf");
  const install = run(
    venvPython,
    ["-m", "pip", "install", "pyyaml>=6", "protobuf>=4.21,<5"],
    { stdio: "inherit" },
  );
  if (install.status !== 0) {
    console.error("[setup] pip install failed (offline or proxy?); retry with network access");
    return 1;
  }

  if (!importable(venvPython)) {
    console.error("[setup] verification failed: roboparty_mcp / roboparty.v1 not importable");
    return 1;
  }
  console.error(`[setup] ready: ${venvPython}`);
  return 0;
}

function check() {
  const python = findPython();
  if (!python) {
    console.error("roboparty-control-mcp: runtime not ready");
    console.error("  run: npx -y roboparty-control-mcp --setup");
    return 1;
  }
  console.log(`python: ${python}`);
  console.log("roboparty_mcp + roboparty.v1 + pyyaml + protobuf: ok");
  return 0;
}

const first = argv[0];

if (first === "--version" || first === "-v") {
  console.log(pkg.version);
  process.exit(0);
}
if (first === "--help" || first === "-h") {
  usage();
  process.exit(0);
}
if (first === "--check") {
  process.exit(check());
}
if (first === "--setup") {
  process.exit(setup());
}

const python = findPython();
if (!python) {
  console.error("roboparty-control-mcp: python runtime not ready");
  console.error("  run: npx -y roboparty-control-mcp --setup");
  console.error("  or set ROBOPARTY_PYTHON");
  process.exit(1);
}

const result = run(python, ["-m", "roboparty_mcp", ...argv], { stdio: "inherit" });
process.exit(result.status ?? 1);
