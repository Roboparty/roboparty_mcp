#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { formatInstallReport, installRdkDocs, refreshInstalledSkillsOnStart } from "./install.js";
import { setupProxy } from "./proxy.js";
import { createServer } from "./server.js";
import { warmSearchIndex } from "./service.js";

async function main() {
  setupProxy();
  if (process.argv.includes("--install")) {
    const result = installRdkDocs();
    process.stdout.write(`${formatInstallReport(result)}\n`);
    process.exit(result.warnings.some((w) => w.includes("No MCP client")) ? 1 : 0);
  }

  const server = createServer();
  const transport = new StdioServerTransport();
  const started = Date.now();
  void warmSearchIndex().then(
    () => console.error(`roboparty-docs index warm ${Date.now() - started}ms`),
    (e: unknown) => console.error(`roboparty-docs index warm failed: ${e instanceof Error ? e.message : String(e)}`),
  );
  await server.connect(transport);
  setImmediate(() => refreshInstalledSkillsOnStart());
}

main().catch((e: unknown) => {
  console.error(`roboparty-docs-mcp failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
