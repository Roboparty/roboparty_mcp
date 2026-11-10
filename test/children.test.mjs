import assert from "node:assert/strict";
import test from "node:test";

import {
  ALL_PROFILES, childEnv, parseProfiles, resolveChildScript, selectedChildren,
} from "../src/children.mjs";

test("profiles select children and expand all", () => {
  assert.deepEqual(selectedChildren(parseProfiles("docs, system1")).map((child) => child.name),
    ["docs", "system1"]);
  assert.deepEqual(selectedChildren(parseProfiles("all")).map((child) => child.name), ALL_PROFILES);
  assert.throws(() => parseProfiles("docs,nope"), /unknown profile/);
});

test("control credentials are isolated to the control child", () => {
  const base = {
    RP_SERVICE_TOKEN: "secret", RP_TLS_CERT: "/cert", MCP_CONFIG: "/mcp.yaml",
    RP_ALLOW_PLAINTEXT: "1", LAYA_CACHE: "/models", PATH: "/bin",
  };
  const control = childEnv(base, { name: "control" });
  assert.equal(control.RP_SERVICE_TOKEN, "secret");
  assert.equal(control.MCP_CONFIG, "/mcp.yaml");
  for (const name of ["docs", "system1"]) {
    const env = childEnv(base, { name });
    assert.equal(env.RP_SERVICE_TOKEN, undefined);
    assert.equal(env.RP_TLS_CERT, undefined);
    assert.equal(env.MCP_CONFIG, undefined);
    assert.equal(env.RP_ALLOW_PLAINTEXT, undefined);
    assert.equal(env.LAYA_CACHE, "/models");
  }
  assert.equal(base.RP_SERVICE_TOKEN, "secret");
});

test("child scripts resolve under the package root", () => {
  for (const child of selectedChildren(parseProfiles("all"))) {
    const script = resolveChildScript("/pkg", child);
    assert.ok(script.startsWith("/pkg/dist/") || script.startsWith("/pkg/src/control/"));
  }
});
