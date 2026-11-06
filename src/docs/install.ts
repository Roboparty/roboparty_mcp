import { existsSync, mkdirSync, readFileSync, readdirSync, copyFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SERVER_ID = "roboparty-docs";

/** Paths that look like transient/sandboxed runtimes rather than a real system Node. */
const TRANSIENT_NODE = /sandbox_runtime|LarkShell[\\/]sandbox|\\Temp\\|\/tmp\//i;

function stable(p: string): boolean {
  return Boolean(p) && existsSync(p) && !TRANSIENT_NODE.test(p);
}

/** Resolve PATH entries for node (where on Windows, which-style on POSIX). */
function nodeOnPath(): string | null {
  const cmd = process.platform === "win32" ? "where" : "which";
  const arg = process.platform === "win32" ? "node" : "node";
  try {
    const out = execFileSync(cmd, [arg], { encoding: "utf8", timeout: 5000 });
    for (const line of out.split(/\r?\n/)) {
      const cand = line.trim();
      if (cand && stable(cand)) return cand;
    }
  } catch {
    /* no node on PATH */
  }
  return null;
}

/**
 * Pick a durable Node executable to launch the server. We avoid transient sandbox
 * runtimes (their hash-named dir can disappear) so the config survives outside the
 * agent environment. Override with ROBOPARTY_NODE_BIN if needed.
 */
function resolveNodeBin(): string {
  const override = process.env.ROBOPARTY_NODE_BIN;
  if (override && existsSync(override)) return override;
  if (stable(process.execPath)) return process.execPath;
  return nodeOnPath() ?? "node";
}

/**
 * Local (from-source) launch descriptor. This project is not published to npm, so
 * clients must run the cloned & built repository directly.
 * We pin the absolute path to dist/index.js (and a durable Node executable) so the
 * config does not depend on the current working directory.
 */
function localLaunch(): { command: string; args: string[] } {
  return { command: resolveNodeBin(), args: [join(here, "index.js")] };
}

/** Detect an existing entry that still uses the old npm/npx distribution. */
function isNpmEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") return false;
  const e = entry as { command?: string; args?: unknown };
  const cmd = String(e.command ?? "").toLowerCase();
  const args = Array.isArray(e.args) ? e.args.map((a) => String(a)) : [];
  const looksNpx = cmd === "npx" || cmd === "npm" || args.some((a) => a === "npx" || a === "npm");
  const mentionsPkg = args.some((a) => a.includes("roboparty-docs-mcp"));
  const pointsLocal = args.some((a) => a.replace(/\\/g, "/").endsWith("mcp/dist/index.js"));
  return !pointsLocal && (mentionsPkg || looksNpx);
}

/** True when the entry already launches this local build with a durable node. */
function isLocalEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") return false;
  const e = entry as { command?: string; args?: unknown[] };
  const args = Array.isArray(e.args) ? e.args.map((a) => String(a)) : [];
  const pointsLocal = args.some((a) => a.replace(/\\/g, "/").endsWith("mcp/dist/index.js"));
  const durableCommand = !e.command || !TRANSIENT_NODE.test(e.command);
  return pointsLocal && durableCommand;
}

function resolveBundledSkills(): string {
  const candidates = [join(here, "..", "skills"), join(here, "..", "..", "skills")];
  const found = candidates.find((c) => existsSync(join(c, "roboparty-docs", "SKILL.md")));
  if (!found) throw new Error("未找到打包的 skills 目录");
  return found;
}

function backup(file: string): string | null {
  if (!existsSync(file)) return null;
  let target = `${file}.bak`;
  if (existsSync(target)) target = `${file}.bak.${Date.now()}`;
  copyFileSync(file, target);
  return target;
}

function mergeMcpJson(file: string): { wrote: boolean; migrated: boolean; backup: string | null } {
  let data: Record<string, unknown> = {};
  if (existsSync(file)) {
    try {
      data = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      throw new Error(`Invalid JSON configuration: ${file}`);
    }
  }
  const servers = ((data.mcpServers ?? {}) as Record<string, unknown>);
  const existing = servers[SERVER_ID];
  // Already pointing at this local build with a durable node: nothing to do (idempotent).
  if (isLocalEntry(existing)) return { wrote: false, migrated: false, backup: null };
  const prevCommand = (existing as { command?: string } | undefined)?.command;
  const migrated = isNpmEntry(existing) || Boolean(prevCommand && TRANSIENT_NODE.test(prevCommand));
  const b = backup(file);
  servers[SERVER_ID] = localLaunch();
  data.mcpServers = servers;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
  return { wrote: true, migrated, backup: b };
}

export type InstallReport = {
  mcp: string[];
  migrated: string[];
  skills: string[];
  backups: string[];
  warnings: string[];
};

export function installRdkDocs(): InstallReport {
  const home = homedir();
  const report: InstallReport = { mcp: [], migrated: [], skills: [], backups: [], warnings: [] };

  // MCP config targets (only for dirs that already exist).
  const mcpTargets = [
    join(home, ".cursor", "mcp.json"),
    join(home, ".claude.json"),
  ];
  for (const dirNeed of [join(home, ".cursor"), join(home, ".claude")]) {
    if (!existsSync(dirNeed)) continue;
    const target = dirNeed.endsWith(".cursor") ? mcpTargets[0] : mcpTargets[1];
    try {
      const r = mergeMcpJson(target);
      if (r.wrote) {
        report.mcp.push(target);
        if (r.migrated) report.migrated.push(target);
        if (r.backup) report.backups.push(r.backup);
      }
    } catch (e) {
      report.warnings.push(e instanceof Error ? e.message : String(e));
    }
  }

  // Skills: copy bundled skills into each existing client's skills directory.
  const skillsSrc = resolveBundledSkills();
  // Install the bundled generic docs skills. Product-doc and control-layer
  // skills are distributed separately.
  const skillNames = readdirSync(skillsSrc).filter((name) =>
    existsSync(join(skillsSrc, name, "SKILL.md")),
  );
  const skillsDirs = [
    join(home, ".cursor", "skills"),
    join(home, ".claude", "skills"),
    join(home, ".codex", "skills"),
  ];
  for (const dir of skillsDirs) {
    const clientRoot = dirname(dir);
    if (!existsSync(clientRoot)) continue;
    mkdirSync(dir, { recursive: true });
    for (const name of skillNames) {
      const src = join(skillsSrc, name, "SKILL.md");
      if (!existsSync(src)) continue;
      const destDir = join(dir, name);
      mkdirSync(destDir, { recursive: true });
      copyFileSync(src, join(destDir, "SKILL.md"));
      report.skills.push(join(destDir, "SKILL.md"));
    }
  }

  if (report.mcp.length === 0) {
    report.warnings.push("No MCP client configuration was written");
  }
  return report;
}

export function formatInstallReport(r: InstallReport): string {
  const launch = localLaunch();
  const lines = ["已安装 roboparty-docs（本地源码方式）："];
  lines.push(`- 启动方式：${launch.command} ${launch.args.join(" ")}`);
  lines.push(`- MCP：${r.mcp.length ? r.mcp.join(", ") : "未写入（可能已是本地配置或无受支持客户端）"}`);
  if (r.migrated.length) lines.push(`- 已从旧 npx 配置迁移为本地路径：${r.migrated.join(", ")}`);
  lines.push(`- Skills：${r.skills.length ? `${r.skills.length} 个文件` : "无"}`);
  lines.push(`- 备份：${r.backups.length ? r.backups.join(", ") : "无"}`);
  if (r.warnings.length) lines.push(`- 提示：${r.warnings.join("; ")}`);
  lines.push("注意：移动/重命名克隆目录后需重新运行 node mcp/dist/index.js --install。");
  lines.push("下一步：请重载窗口 / 重启 Agent。");
  return lines.join("\n");
}

/** Overwrite previously installed bundled skills on MCP start (best-effort). */
export function refreshInstalledSkillsOnStart(): void {
  try {
    installRdkDocs();
  } catch {
    /* non-fatal */
  }
}
