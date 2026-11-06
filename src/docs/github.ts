// RP1 GitHub source: index README/docs markdown from RoboParty repositories so the
// RP1 skills can ground answers in real repository text (not just the docs-center site).
//
// Auth strategy:
//   - If `gh` is authenticated (or GH_TOKEN is set) we use `gh api`, which raises the
//     rate limit and can read repositories the account has access to.
//   - Otherwise we fall back to anonymous api.github.com for the tree and
//     raw.githubusercontent.com for file bodies (public repos; ~60 API calls/hr).
//
// This source is best-effort: any network/auth failure is returned as a warning and
// must never break the docs-center corpus.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fetchOk } from "./http.js";
import type { GithubDoc, Lang } from "./types.js";

const execFileP = promisify(execFile);
const OWNER = "Roboparty";
const MAX_FILES_PER_REPO = 12;
const MAX_BODY_CHARS = 24000;

export type { GithubDoc };

export type RepoEntry = {
  repo: string;
  category: string;
  skill: string;
  /** Force a file-manifest page when the repo has no markdown (asset-only repos). */
  manifest?: boolean;
  priv?: boolean;
};

/** Curated RP1 repositories, mapped to the skill that should ground in them. */
export const RP1_REPOS: RepoEntry[] = [
  { repo: "rp1_description", category: "RP1 模型部署", skill: "rp1-description", manifest: true },
  { repo: "roboparty_deploy", category: "RP1 模型部署", skill: "rp1-deploy" },
  { repo: "roboparty_all", category: "RP1 模型部署", skill: "rp1-deploy" },
  { repo: "roboparty_repo", category: "RP1 模型部署", skill: "rp1-deploy" },
  { repo: "roboparty_train", category: "RP1 算法训练", skill: "rp1-rl-training" },
  { repo: "roboparty_dexhand", category: "RP1 模型部署", skill: "rp1-dexhand" },
  { repo: "roboparty_motors", category: "RP1 硬件电气", skill: "rp1-motor", manifest: true },
  { repo: "roboparty_navigation", category: "RP1 模型部署", skill: "rp1-navigation" },
  { repo: "roboparty_build", category: "RP1 嵌入式固件", skill: "rp1-bsp-firmware" },
  { repo: "roboparty_xr_teleop", category: "RP1 模型部署", skill: "rp1-joystick-teleop" },
  { repo: "roboparty_stm32_usbcan", category: "RP1 硬件电气", skill: "rp1-canfd-bus" },
  { repo: "MimicLite", category: "RP1 算法训练", skill: "rp1-mimic-dance" },
  { repo: "UFO", category: "RP1 算法训练", skill: "rp1-bfm" },
  { repo: "P-BFM", category: "RP1 算法训练", skill: "rp1-bfm" },
  { repo: "I-BFM-Code", category: "RP1 算法训练", skill: "rp1-bfm" },
  { repo: "PredActor", category: "RP1 算法训练", skill: "rp1-bfm" },
  { repo: "GMR", category: "RP1 算法训练", skill: "rp1-bfm" },
  { repo: "roboparty_EtherCANFD", category: "RP1 硬件电气", skill: "rp1-canfd-bus" },
  { repo: "rp1_hardware", category: "RP1 测试开源", skill: "rp1-hardware-open" },
  { repo: "rp1_test", category: "RP1 测试开源", skill: "rp1-test" },
];

const NOISE = /(^|\/)\.github\//i;
const SKIP_FILE =
  /^(license(s)?|third_party_notices|code_of_conduct|contributing|security|support|changelog|notice)(\b|[-_.])/i;

let ghAuthCache: boolean | null = null;

async function ghAuthenticated(): Promise<boolean> {
  if (ghAuthCache !== null) return ghAuthCache;
  if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) {
    ghAuthCache = true;
    return true;
  }
  try {
    const { stdout } = await execFileP("gh", ["auth", "token"], { timeout: 8000 });
    ghAuthCache = Boolean(stdout.trim());
  } catch {
    ghAuthCache = false;
  }
  return ghAuthCache;
}

async function ghApiJson(path: string): Promise<any> {
  const { stdout } = await execFileP("gh", ["api", path], { timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  return JSON.parse(stdout);
}

async function ghApiRaw(repo: string, filePath: string, ref: string): Promise<string> {
  const p = `repos/${OWNER}/${repo}/contents/${filePath.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`;
  const { stdout } = await execFileP("gh", ["api", p, "-H", "Accept: application/vnd.github.raw"], {
    timeout: 30000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

type TreeBlob = { path: string; type: string; size: number };

async function fetchTree(repo: string, authed: boolean): Promise<{ blobs: TreeBlob[] }> {
  const path = `repos/${OWNER}/${repo}/git/trees/HEAD?recursive=1`;
  if (authed) {
    const t = await ghApiJson(path);
    return { blobs: (t.tree ?? []).filter((x: any) => x.type === "blob") };
  }
  const j = JSON.parse(await fetchOk(`https://api.github.com/${path}`, 30000));
  return { blobs: (j.tree ?? []).filter((x: any) => x.type === "blob") };
}

async function fetchRaw(repo: string, filePath: string, branch: string, authed: boolean): Promise<string> {
  if (authed) return ghApiRaw(repo, filePath, branch);
  const url = `https://raw.githubusercontent.com/${OWNER}/${repo}/${encodeURIComponent(branch)}/${filePath
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
  return fetchOk(url, 30000);
}

function detectLang(path: string, body: string): "zh" | "en" {
  if (/_cn|_zh|中文/i.test(path)) return "zh";
  const cjk = (body.match(/[㐀-䶿一-鿿]/g) ?? []).length;
  const letters = (body.match(/[A-Za-z]/g) ?? []).length;
  return cjk > letters * 0.15 ? "zh" : "en";
}

function titleFromMarkdown(body: string, fallback: string): string {
  const h1 = body.split(/\r?\n/).find((l) => /^#\s+/.test(l));
  if (h1) return h1.replace(/^#\s+/, "").trim().slice(0, 120);
  return fallback;
}

/** Rank markdown files so root READMEs and docs/ come first. */
function filePriority(p: string): number {
  const lower = p.toLowerCase();
  const base = lower.split("/").pop() ?? lower;
  let score = 50;
  if (base.startsWith("readme")) score -= 30;
  if (/_cn|_zh/.test(base)) score -= 5; // prefer English README first, CN still included
  if (lower.startsWith("docs/")) score -= 10;
  if (/\/readme/.test(lower)) score -= 6; // sub-package READMEs
  if (SKIP_FILE.test(base)) score += 100;
  return score;
}

function selectMarkdown(blobs: TreeBlob[]): string[] {
  return blobs
    .filter((b) => /\.md$/i.test(b.path))
    .filter((b) => !NOISE.test(b.path))
    .filter((b) => !SKIP_FILE.test(b.path.split("/").pop() ?? b.path))
    .filter((b) => b.size < 200_000)
    .sort((a, b) => filePriority(a.path) - filePriority(b.path) || a.path.localeCompare(b.path))
    .slice(0, MAX_FILES_PER_REPO)
    .map((b) => b.path);
}

const MANIFEST_EXT = /\.(urdf|xacro|mjcf|xml|launch\.py|launch|yaml|yml|sdf|step|stl|dae)$/i;

function buildManifest(repo: string, branch: string, blobs: TreeBlob[], entry: RepoEntry): GithubDoc {
  const interesting = blobs
    .map((b) => b.path)
    .filter((p) => MANIFEST_EXT.test(p) || /(^|\/)readme/i.test(p))
    .filter((p) => !/node_modules|\.github\//.test(p))
    .slice(0, 300);
  const body =
    `# ${repo} 文件清单\n\n` +
    `仓库 \`${OWNER}/${repo}\`（分支 ${branch}）不包含根级说明文档，以下为关键模型/配置/启动文件清单，` +
    `具体用法请打开对应文件或仓库页面查看。\n\n` +
    interesting.map((p) => `- \`${p}\``).join("\n");
  return {
    repo,
    branch,
    path: "(manifest)",
    title: `${repo} 文件清单`,
    url: `https://github.com/${OWNER}/${repo}`,
    category: entry.category,
    skill: entry.skill,
    lang: "zh",
    body,
    private: Boolean(entry.priv),
  };
}

async function fetchRepoDocs(entry: RepoEntry, authed: boolean): Promise<GithubDoc[]> {
  const { blobs } = await fetchTree(entry.repo, authed);
  if (blobs.length === 0) return [];
  // Anonymous access to a private repo yields 404 at fetchTree (throws); handled by caller.
  const mdPaths = selectMarkdown(blobs);
  if (mdPaths.length === 0) {
    return entry.manifest ? [buildManifest(entry.repo, "HEAD", blobs, entry)] : [];
  }
  const docs: GithubDoc[] = [];
  for (const path of mdPaths) {
    try {
      const body = (await fetchRaw(entry.repo, path, "HEAD", authed)).slice(0, MAX_BODY_CHARS);
      if (!body.trim()) continue;
      docs.push({
        repo: entry.repo,
        branch: "HEAD",
        path,
        title: titleFromMarkdown(body, `${entry.repo}/${path}`),
        url: `https://github.com/${OWNER}/${entry.repo}/blob/HEAD/${path}`,
        category: entry.category,
        skill: entry.skill,
        lang: detectLang(path, body),
        body,
        private: Boolean(entry.priv),
      });
    } catch {
      /* skip individual file failures */
    }
  }
  return docs;
}

export type GithubCorpus = { docs: GithubDoc[]; warnings: string[]; authed: boolean };

export async function fetchGithubDocs(): Promise<GithubCorpus> {
  const warnings: string[] = [];
  const authed = await ghAuthenticated();
  const docs: GithubDoc[] = [];
  for (const entry of RP1_REPOS) {
    try {
      const got = await fetchRepoDocs(entry, authed);
      docs.push(...got);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (entry.priv && !authed) {
        warnings.push(`${entry.repo}: 私有仓库，需先 gh auth login 并获得组织授权后才能索引`);
      } else {
        warnings.push(`${entry.repo}: 抓取失败（${msg.slice(0, 80)}）`);
      }
    }
  }
  return { docs, warnings, authed };
}
