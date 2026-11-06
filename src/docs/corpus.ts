import type { DocRecord, GithubDoc, Lang, SourceKind } from "./types.js";
import { tokenize } from "./lexical.js";
import { splitSections } from "./sections.js";
import { fetchDocs } from "./discovery.js";
import { fetchGithubDocs } from "./github.js";
import { fetchOk } from "./http.js";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type IndexUnit = {
  id: string;
  kind: SourceKind;
  lang: Lang;
  category: string;
  title: string;
  url: string;
  path: string;
  section: string | null;
  anchor: string | null;
  text: string;
  tokens: string[];
};

export type Corpus = {
  revision: string;
  builtAt: number;
  docs: DocRecord[];
  github: GithubDoc[];
  warnings: string[];
  units: IndexUnit[];
};

function cacheDir(): string {
  return process.env.ROBOPARTY_DOCS_CACHE_DIR || join(homedir(), ".cache", "roboparty-docs-mcp");
}

function cacheTtlMs(): number {
  const v = Number(process.env.ROBOPARTY_DOCS_CACHE_TTL_MS);
  return Number.isFinite(v) ? v : 24 * 60 * 60 * 1000;
}

const SNAPSHOT = "corpus-snapshot-v3.json";

function buildUnits(docs: DocRecord[], github: GithubDoc[]): IndexUnit[] {
  const units: IndexUnit[] = [];
  for (const d of docs) {
    const body = d.body ?? "";
    const sections = splitSections(body, d.title);
    if (sections.length === 0) continue;
    for (const s of sections) {
      if (!s.text) continue;
      units.push({
        id: `${d.path}#${s.anchor}`,
        kind: "knowledge",
        lang: d.lang,
        category: d.category,
        title: d.title,
        url: d.url,
        path: d.path,
        section: s.heading,
        anchor: s.anchor,
        text: s.text,
        tokens: tokenize(`${d.title} ${s.heading} ${s.text}`),
      });
    }
  }
  for (const g of github) {
    const sections = splitSections(g.body, g.title);
    if (sections.length === 0) continue;
    for (const s of sections) {
      if (!s.text) continue;
      units.push({
        id: `github:${g.repo}/${g.path}#${s.anchor}`,
        kind: "github",
        lang: g.lang,
        category: g.category,
        title: `${g.repo} · ${g.title}`,
        url: g.url,
        path: `${g.repo}/${g.path}`,
        section: s.heading,
        anchor: s.anchor,
        text: s.text,
        tokens: tokenize(`${g.repo} ${g.skill} ${g.title} ${s.heading} ${s.text}`),
      });
    }
  }
  return units;
}

export async function buildCorpus(): Promise<Corpus> {
  const { docs, revision, warnings: docWarnings } = await fetchDocs((u) => fetchOk(u, 30000));

  // RP1 GitHub source is best-effort: never let it break the docs-center corpus.
  let github: GithubDoc[] = [];
  const warnings: string[] = [...docWarnings];
  try {
    const gh = await fetchGithubDocs();
    github = gh.docs;
    warnings.push(...gh.warnings);
  } catch (e) {
    warnings.push(`RP1 GitHub 数据源不可用：${e instanceof Error ? e.message : String(e)}`);
  }

  const units = buildUnits(docs, github);
  const corpus: Corpus = {
    revision,
    builtAt: Date.now(),
    docs,
    github,
    warnings,
    units,
  };
  saveSnapshot(corpus);
  return corpus;
}

function saveSnapshot(c: Corpus): void {
  try {
    const dir = cacheDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, SNAPSHOT), JSON.stringify(c), "utf8");
  } catch {
    /* caching is best-effort */
  }
}

export function loadSnapshot(): Corpus | null {
  try {
    const file = join(cacheDir(), SNAPSHOT);
    if (!existsSync(file)) return null;
    const c = JSON.parse(readFileSync(file, "utf8")) as Corpus;
    if (Date.now() - c.builtAt > cacheTtlMs()) return null;
    // Backfill fields for older snapshots.
    c.github = c.github ?? [];
    c.warnings = c.warnings ?? [];
    c.docs = c.docs ?? [];
    c.units = c.units ?? [];
    return c;
  } catch {
    return null;
  }
}
