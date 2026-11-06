import path from "node:path";

export const ALL_PROFILES = ["docs", "control", "system1"];

export const CHILDREN = [
  { name: "docs", script: "dist/docs/index.js", args: [] },
  { name: "control", script: "src/control/bin/roboparty-control-mcp.mjs", args: ["--stdio"] },
  { name: "system1", script: "dist/system1/index.js", args: ["--stdio"] },
];

const CONTROL_ONLY = [
  "RP_SERVICE_TOKEN",
  "RP_TLS_CERT",
  "RP_ALLOW_PLAINTEXT",
  "MCP_CONFIG",
];

export function parseProfiles(value = "") {
  const selected = new Set(
    String(value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
  if (selected.has("all")) return new Set(ALL_PROFILES);
  const unknown = [...selected].filter((name) => !ALL_PROFILES.includes(name));
  if (unknown.length) throw new Error(`unknown profile: ${unknown.join(",")}`);
  return selected;
}

export function selectedChildren(profiles) {
  const selected = profiles instanceof Set ? profiles : parseProfiles(profiles);
  return CHILDREN.filter((child) => selected.has(child.name));
}

export function resolveChildScript(root, child) {
  return path.join(root, child.script);
}

export function childEnv(baseEnv, child) {
  const env = { ...baseEnv };
  if (child.name !== "control") {
    for (const key of CONTROL_ONLY) delete env[key];
  }
  return env;
}
