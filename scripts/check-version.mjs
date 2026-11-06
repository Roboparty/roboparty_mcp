#!/usr/bin/env node
import { readFileSync } from "node:fs";

const tag = (process.argv[2] || (process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : "") || "").replace(/^v/, "");
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
console.log(`tag:     ${tag || "-"}`);
console.log(`package: ${pkg.version}`);
if (tag && tag !== pkg.version) {
  console.error(`version mismatch: tag=${tag} package=${pkg.version}`);
  process.exit(1);
}
