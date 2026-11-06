import type { Lang, SearchHit, SearchResult } from "./types.js";
import { BM25 } from "./bm25.js";
import { tokenize } from "./lexical.js";
import { splitSections, toSnippet } from "./sections.js";
import { buildCorpus, loadSnapshot, type Corpus, type IndexUnit } from "./corpus.js";

let corpusPromise: Promise<Corpus> | null = null;

export function warmSearchIndex(): Promise<Corpus> {
  if (!corpusPromise) {
    const snap = loadSnapshot();
    corpusPromise = snap ? Promise.resolve(snap) : buildCorpus();
  }
  return corpusPromise;
}

function hasCJK(s: string): boolean {
  return /[㐀-䶿一-鿿]/.test(s);
}

type Ranked = { unit: IndexUnit; score: number };

function rank(corpus: Corpus, query: string, lang: Lang | undefined, limit: number): Ranked[] {
  const qTokens = tokenize(query);
  const preferred: Lang = lang ?? (hasCJK(query) ? "zh" : "en");
  const out: Ranked[] = [];
  for (const l of ["zh", "en"] as Lang[]) {
    const units = corpus.units.filter((u) => u.lang === l);
    const bm = new BM25(units.map((u) => u.tokens));
    const scores = bm.score(qTokens);
    const boost = l === preferred ? 1.0 : 0.6;
    for (const [idx, sc] of scores) out.push({ unit: units[idx], score: sc * boost });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

export type SearchArgs = {
  query: string;
  lang?: Lang;
  category?: string;
  limit?: number;
};

export async function searchDocs(args: SearchArgs): Promise<SearchResult> {
  const corpus = await warmSearchIndex();
  const warnings: string[] = [];
  let ranked = rank(corpus, args.query, args.lang, args.limit ?? 8);
  if (args.category) {
    const c = args.category.toLowerCase();
    ranked = ranked.filter((r) => r.unit.category.toLowerCase().includes(c));
  }
  const hits: SearchHit[] = ranked.map((r) => ({
    id: r.unit.id,
    kind: r.unit.kind,
    title: r.unit.title,
    url: r.unit.url,
    product: r.unit.kind === "knowledge" ? r.unit.path.split("/")[0] : undefined,
    category: r.unit.category,
    lang: r.unit.lang,
    score: Number(r.score.toFixed(4)),
    section: r.unit.section,
    snippet: toSnippet(r.unit.text, 200),
    path: r.unit.path,
  }));
  if (hits.length === 0) warnings.push("noGoodMatch: 未在已索引文档中找到匹配内容");
  return { query: args.query, hits, total: hits.length, warnings };
}

export type PageArgs = {
  url: string;
  section?: string;
  full?: boolean;
  maxChars?: number;
};

function findDoc(corpus: Corpus, url: string) {
  try {
    const parsed = new URL(url);
    const docId = parsed.searchParams.get("doc");
    const lang = parsed.searchParams.get("lang") as Lang | null;
    const product = parsed.pathname.match(/^\/documents\/([^/]+)/)?.[1];
    if (docId) {
      return (
        corpus.docs.find(
          (d) =>
            d.slug === docId &&
            (!lang || d.lang === lang) &&
            (!product || d.product === product),
        ) ?? corpus.docs.find((d) => d.slug === docId && (!lang || d.lang === lang))
      );
    }
  } catch {
    // Fall through to exact URL / slug matching.
  }
  return corpus.docs.find((d) => d.url === url) ?? corpus.docs.find((d) => url.includes(d.slug));
}

function findGithub(corpus: Corpus, url: string) {
  const m = url.match(/github\.com\/[^/]+\/([^/#?]+)(?:\/blob\/[^/]+\/(.+?))?(?:[#?].*)?$/);
  if (!m) return undefined;
  const repo = m[1];
  const path = m[2] ? decodeURIComponent(m[2]) : null;
  return (
    corpus.github.find((g) => g.repo === repo && (path === null || g.path === path)) ??
    corpus.github.find((g) => g.repo === repo)
  );
}

export async function getPage(args: PageArgs): Promise<unknown> {
  const corpus = await warmSearchIndex();

  if (/github\.com\//.test(args.url)) {
    const g = findGithub(corpus, args.url);
    if (!g)
      return {
        error: "未索引该 GitHub 文档（可能是私有仓库，需 gh auth login 并获得组织授权）",
        url: args.url,
      };
    const sections = splitSections(g.body, g.title);
    const cap = args.maxChars ?? (args.full ? 20000 : 6000);
    if (!args.full && args.section) {
      const match = sections.find((s) => s.anchor.includes(args.section!) || s.heading.includes(args.section!));
      if (match)
        return {
          kind: "github",
          repo: g.repo,
          title: g.title,
          lang: g.lang,
          category: g.category,
          skill: g.skill,
          private: g.private,
          sourceUrl: g.url,
          section: match.heading,
          markdown: match.text.slice(0, cap),
          truncated: match.text.length > cap,
        };
    }
    return {
      kind: "github",
      repo: g.repo,
      title: g.title,
      lang: g.lang,
      category: g.category,
      skill: g.skill,
      private: g.private,
      sourceUrl: g.url,
      markdown: g.body.slice(0, args.full ? Math.max(cap, 20000) : cap),
      truncated: g.body.length > (args.full ? Math.max(cap, 20000) : cap),
      sections: sections.map((s) => s.heading),
    };
  }

  const doc = findDoc(corpus, args.url);
  if (!doc || doc.body == null) return { error: "未找到对应文档", url: args.url };

  const sections = splitSections(doc.body, doc.title);
  const cap = args.maxChars ?? (args.full ? 16000 : 6000);

  if (!args.full && args.section) {
    const anchor = args.section;
    const match = sections.find((s) => s.anchor.includes(anchor) || s.heading.includes(args.section!));
    if (match) {
      return {
        kind: "knowledge",
        title: doc.title,
        lang: doc.lang,
        category: doc.category,
        url: doc.url,
        section: match.heading,
        markdown: match.text.slice(0, cap),
        truncated: match.text.length > cap,
      };
    }
  }

  const body = doc.body;
  return {
    kind: "knowledge",
    title: doc.title,
    lang: doc.lang,
    category: doc.category,
    url: doc.url,
    markdown: args.full ? body.slice(0, Math.max(cap, 16000)) : body.slice(0, cap),
    truncated: body.length > (args.full ? Math.max(cap, 16000) : cap),
    sections: sections.map((s) => s.heading),
  };
}

export type TocArgs = { manual: string; lang?: Lang; query?: string };

export async function listToc(args: TocArgs): Promise<unknown> {
  const corpus = await warmSearchIndex();
  const key = args.manual.toLowerCase();
  const lang: Lang = args.lang ?? "zh";

  if (/^(rp1|github|repo|repos|仓库|开源)$/.test(key)) {
    const byRepo = new Map<string, { repo: string; category: string; skill: string; private: boolean; docs: number }>();
    for (const g of corpus.github) {
      const e = byRepo.get(g.repo) ?? { repo: g.repo, category: g.category, skill: g.skill, private: g.private, docs: 0 };
      e.docs += 1;
      byRepo.set(g.repo, e);
    }
    const items = [...byRepo.values()]
      .filter((e) => !args.query || e.repo.toLowerCase().includes(args.query.toLowerCase()) || e.skill.includes(args.query))
      .map((e) => ({
        repo: e.repo,
        category: e.category,
        skill: e.skill,
        private: e.private,
        indexedPages: e.docs,
        url: `https://github.com/Roboparty/${e.repo}`,
      }));
    return { kind: "github", count: items.length, authedNote: "私有仓库需 gh auth login", items };
  }

  const docs = corpus.docs
    .filter((d) => d.lang === lang)
    .filter(
      (d) =>
        d.product.toLowerCase() === key ||
        d.category.toLowerCase().includes(key) ||
        d.slug.toLowerCase().includes(key),
    )
    .filter((d) => !args.query || d.title.includes(args.query))
    .map((d) => ({
      category: d.category,
      product: d.product,
      title: d.title,
      slug: d.slug,
      url: d.url,
    }));
  return { kind: "knowledge", lang, count: docs.length, items: docs };
}

/** Top-level catalog overview (used by list_manuals). */
export function listManuals(corpus: Corpus): unknown {
  const counts = new Map<string, { zh: number; en: number }>();
  for (const doc of corpus.docs) {
    const entry = counts.get(doc.category) ?? { zh: 0, en: 0 };
    entry[doc.lang] += 1;
    counts.set(doc.category, entry);
  }
  const categories = [...counts.entries()]
    .map(([title, entry]) => ({ title, zh: entry.zh, en: entry.en }))
    .sort((a, b) => a.title.localeCompare(b.title, "zh"));
  const ghRepos = new Set(corpus.github.map((g) => g.repo)).size;
  return {
    docsCenter: "https://roboparty.com/documents/roboto-origin",
    products: [...new Set(corpus.docs.map((d) => d.product))],
    categories,
    rp1Github: {
      repositoriesIndexed: ghRepos,
      pagesIndexed: corpus.github.length,
      note: "RP1 资料来自 github.com/Roboparty 各公开仓库的 README/docs。",
    },
    warnings: corpus.warnings,
  };
}
