#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { childEnv, parseProfiles, resolveChildScript, selectedChildren } from "./children.mjs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);

function option(name, fallback = "") {
  const index = argv.indexOf(name);
  if (index === -1 || index + 1 >= argv.length) return fallback;
  return argv[index + 1];
}

const profiles = parseProfiles(option("--profile", "docs,control,system1") || "docs,control,system1");
const checkOnly = argv.includes("--check");
const setupOnly = argv.includes("--setup");
const fetchModelOnly = argv.includes("--fetch-model");
const children = selectedChildren(profiles);

const clients = new Map();
const tools = [];
const routes = new Map();

async function startChild(child) {
  const script = resolveChildScript(root, child);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [script, ...child.args],
    env: childEnv(process.env, child),
    stderr: "inherit",
  });
  const client = new Client({ name: `roboparty-${child.name}`, version: pkg.version },
    { capabilities: {} });
  await client.connect(transport);
  const listed = await client.listTools();
  clients.set(child.name, client);
  for (const tool of listed.tools) {
    const name = `${child.name}_${tool.name}`;
    routes.set(name, { child: child.name, tool: tool.name });
    tools.push({
      ...tool,
      name,
      description: `[${child.name}] ${tool.description || ""}`.trim(),
    });
  }
  console.error(`roboparty-mcp: ${child.name} ready (${listed.tools.length} tools)`);
}

function closeChildren() {
  for (const client of clients.values()) {
    client.close().catch(() => {});
  }
  clients.clear();
}

async function main() {
  if (fetchModelOnly) {
    const result = spawnSync(process.execPath, [path.join(root, "scripts/fetch-model.mjs")], {
      env: process.env, stdio: "inherit",
    });
    process.exit(result.status ?? 1);
  }

  if (setupOnly) {
    const control = children.find((child) => child.name === "control");
    if (!control) {
      console.error("roboparty-mcp: control profile is not enabled");
      process.exit(2);
    }
    const result = spawnSync(process.execPath, [resolveChildScript(root, control), "--setup"], {
      env: childEnv(process.env, control), stdio: "inherit",
    });
    process.exit(result.status ?? 1);
  }

  for (const child of children) {
    try {
      await startChild(child);
    } catch (error) {
      console.error(`roboparty-mcp: ${child.name} unavailable: ${error.message}`);
      if (checkOnly) process.exitCode = 1;
    }
  }

  if (checkOnly) {
    console.log(JSON.stringify({ ok: clients.size === children.length,
      children: [...clients.keys()], tools: tools.map((tool) => tool.name) }, null, 2));
    closeChildren();
    return;
  }

  const server = new Server({ name: "roboparty-mcp", version: pkg.version },
    { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const route = routes.get(request.params.name);
    if (!route) throw new Error(`unknown tool: ${request.params.name}`);
    const client = clients.get(route.child);
    if (!client) throw new Error(`${route.child} MCP is unavailable`);
    return client.callTool({ name: route.tool, arguments: request.params.arguments || {} });
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`roboparty-mcp ready: ${tools.length} tools from ${clients.size} children`);

  const shutdown = async () => {
    closeChildren();
    await server.close().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error(`roboparty-mcp failed: ${error.stack || error.message}`);
  closeChildren();
  process.exit(1);
});
