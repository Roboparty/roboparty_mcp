#!/usr/bin/env node
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, "dist");
rmSync(dist, { recursive: true, force: true });
mkdirSync(path.join(dist, "docs"), { recursive: true });
mkdirSync(path.join(dist, "system1"), { recursive: true });

await build({
  entryPoints: [path.join(root, "src/docs/index.ts")],
  outfile: path.join(dist, "docs/index.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  logLevel: "info",
});

await build({
  entryPoints: [path.join(root, "src/system1/index.ts")],
  outfile: path.join(dist, "system1/index.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  external: ["@receptron/laya"],
  logLevel: "info",
});

const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
writeFileSync(path.join(dist, "package.json"),
  JSON.stringify({ name: pkg.name, version: pkg.version, type: "module" }, null, 2) + "\n");
