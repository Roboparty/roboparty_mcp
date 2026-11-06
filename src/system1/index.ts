#!/usr/bin/env node
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadConfig, UsageError, usage, type Config } from "./config.js";
import { LayaAnalyzer } from "./laya.js";
import { analyzeRequestSchema, createServer, runAnalysis } from "./server.js";

const MAX_BODY_BYTES = 1024 * 1024;

function log(...args: unknown[]): void {
  console.error("[roboparty-system1-mcp]", ...args);
}

function json(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "access-control-allow-origin": "*",
  });
  res.end(body);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error(`request body exceeds ${MAX_BODY_BYTES} bytes`);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function runStdio(config: Config): Promise<void> {
  const analyzer = new LayaAnalyzer(config);
  if (config.preload) analyzer.preload();
  const server = createServer(analyzer, config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("stdio ready");
  const shutdown = async () => {
    await server.close();
    await analyzer.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function runHttp(config: Config): Promise<void> {
  const analyzer = new LayaAnalyzer(config);
  if (config.preload) analyzer.preload();

  const http = createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
          "access-control-allow-headers": "content-type,authorization,mcp-session-id,mcp-protocol-version",
        });
        res.end();
        return;
      }
      if (req.method === "GET" && url.pathname === "/health") {
        json(res, 200, { ok: true, ...analyzer.health() });
        return;
      }
      if (req.method === "GET" && url.pathname === "/v1/info") {
        json(res, 200, { ok: true, ...analyzer.info() });
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/system_one") {
        const body = await readBody(req);
        let raw: unknown;
        try {
          raw = JSON.parse(body);
        } catch {
          json(res, 400, { ok: false, error: "invalid JSON" });
          return;
        }
        const parsed = analyzeRequestSchema.safeParse(raw);
        if (!parsed.success) {
          json(res, 400, { ok: false, error: "invalid request", details: parsed.error.flatten() });
          return;
        }
        const payload = await runAnalysis(
          analyzer,
          config,
          parsed.data.state,
          parsed.data.questions,
        );
        json(res, 200, payload);
        return;
      }
      if (url.pathname === "/mcp") {
        if (req.method !== "POST") {
          res.writeHead(405, { "content-type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null }));
          return;
        }
        // Stateless Streamable HTTP: one server + transport per request.
        const server = createServer(analyzer, config);
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        try {
          await server.connect(transport);
          await transport.handleRequest(req, res);
          res.on("close", () => {
            void transport.close();
            void server.close();
          });
        } catch (error) {
          void transport.close();
          void server.close();
          throw error;
        }
        return;
      }
      json(res, 404, { ok: false, error: "not found" });
    } catch (error) {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      log(message);
      if (!res.headersSent) json(res, 500, { ok: false, error: message });
      else res.end();
    }
  });

  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(config.port, config.host, () => resolve());
  });
  log(`http ready http://${config.host}:${config.port} (MCP /mcp, REST /v1/system_one)`);

  const shutdown = async () => {
    await new Promise<void>((resolve) => http.close(() => resolve()));
    await analyzer.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function main(): Promise<void> {
  let config: Config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof UsageError) {
      process.stdout.write(usage());
      process.exit(0);
    }
    throw error;
  }
  if (config.transport === "http") await runHttp(config);
  else await runStdio(config);
}

main().catch((error) => {
  log(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
