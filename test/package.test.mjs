import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("the package is self-contained", () => {
  for (const name of ["roboparty-docs-mcp", "roboparty-control-mcp", "roboparty-system1-mcp"]) {
    assert.equal(pkg.dependencies[name], undefined, `${name} must not be a dependency`);
  }
  assert.ok(pkg.files.includes("dist") || pkg.files.includes("dist/"));
  assert.ok(pkg.dependencies["@modelcontextprotocol/sdk"]);
});

test("vendored child entry points exist", () => {
  for (const file of [
    "dist/docs/index.js",
    "dist/system1/index.js",
    "src/control/bin/roboparty-control-mcp.mjs",
  ]) {
    assert.ok(existsSync(new URL(`../${file}`, import.meta.url)), file);
  }
});
