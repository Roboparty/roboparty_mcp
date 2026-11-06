import type { DocRecord, Lang } from "./types.js";
import { fetchOk } from "./http.js";

/**
 * Public documentation sources.
 *
 * The site was migrated from a Vite SPA (`/roboto_origin/doc`) to a Next.js
 * app with one route per product. Each route ships the complete doc catalog
 * inside its React Server Component (RSC) payload, so no extra API call or
 * chunk crawling is needed.
 */
export const SITE_ORIGIN = "https://roboparty.com";

export const DOCS_PRODUCTS = {
  "roboto-origin": "ROBOTO ORIGIN",
  "roboto-01": "ROBOTO 01 (RP1)",
} as const;

export type DocsProduct = keyof typeof DOCS_PRODUCTS;

export function docUrl(product: DocsProduct, docId: string, lang: Lang): string {
  return `${SITE_ORIGIN}/documents/${product}?doc=${encodeURIComponent(docId)}&lang=${lang}`;
}

/** One `self.__next_f.push([1,"..."])` payload inside the SSR HTML. */
const PUSH_RE = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;

/** RSC text rows look like `29:T67d,<text>` (length is hex). */
const ROW_RE = /(?:^|\n)(\d+):T([0-9a-fA-F]+),/g;

type CatalogDoc = {
  id: string;
  group?: string;
  title?: string;
  shortTitle?: string;
  summary?: string;
  sections?: CatalogSection[];
};

type CatalogSection = {
  id?: string;
  title?: string;
  blocks?: CatalogBlock[];
};

type CatalogBlock = {
  type?: string;
  text?: string;
  html?: string;
  code?: string;
  language?: string;
  items?: unknown[];
  headers?: unknown[];
  rows?: unknown[][];
  title?: string;
  tone?: string;
  alt?: string;
  src?: string;
  fileType?: string;
  downloadUrl?: string;
  attachmentUrl?: string;
  sourceUrl?: string;
};

type Catalog = Record<Lang, CatalogDoc[]>;

function decodePushPayloads(html: string): string {
  let rsc = "";
  for (const match of html.matchAll(PUSH_RE)) {
    try {
      rsc += JSON.parse(match[1]) as string;
    } catch {
      // Ignore malformed chunks; a later chunk may still carry the catalog.
    }
  }
  return rsc;
}

/** Extract RSC `Tn:<hex length>,<text>` rows so `$N` references can be resolved. */
function textRows(rsc: string): Map<number, string> {
  const rows = new Map<number, string>();
  for (const match of rsc.matchAll(ROW_RE)) {
    const id = Number(match[1]);
    const length = Number.parseInt(match[2], 16);
    const start = (match.index ?? 0) + match[0].length;
    rows.set(id, rsc.slice(start, start + length));
  }
  return rows;
}

function sliceObject(source: string, start: number): string {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error("Unterminated catalog object in RSC payload");
}

function resolveRefs(value: unknown, rows: Map<number, string>, depth = 0): unknown {
  if (depth > 20) return value;
  if (typeof value === "string") {
    const ref = /^\$(\d+)$/.exec(value);
    if (ref) return resolveRefs(rows.get(Number(ref[1])) ?? value, rows, depth + 1);
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => resolveRefs(item, rows, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = resolveRefs(item, rows, depth + 1);
    return out;
  }
  return value;
}

function parseCatalog(html: string): Catalog {
  const rsc = decodePushPayloads(html);
  const marker = rsc.indexOf('"catalog"');
  if (marker < 0) throw new Error("RSC payload has no \"catalog\" field");
  const start = rsc.indexOf("{", marker);
  if (start < 0) throw new Error("RSC catalog has no object body");
  const raw = sliceObject(rsc, start);
  const catalog = JSON.parse(raw) as Catalog;
  return resolveRefs(catalog, textRows(rsc)) as Catalog;
}

function absoluteUrl(url: string | undefined): string {
  if (!url) return "";
  if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(url)) return url;
  return `${SITE_ORIGIN}${url.startsWith("/") ? "" : "/"}${url}`;
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function listToMarkdown(items: unknown[] | undefined, ordered: boolean): string {
  if (!items?.length) return "";
  return items
    .map((item, index) => `${ordered ? `${index + 1}.` : "-"} ${textOf(item)}`)
    .filter((line) => line.length > 2)
    .join("\n");
}

function tableToMarkdown(headers: unknown[] | undefined, rows: unknown[][] | undefined): string {
  if (!headers?.length) return "";
  const head = headers.map((h) => textOf(h).replace(/\|/g, "\\|") || " ");
  const lines = [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`];
  for (const row of rows ?? []) {
    lines.push(`| ${row.map((cell) => textOf(cell).replace(/\|/g, "\\|")).join(" | ")} |`);
  }
  return lines.join("\n");
}

function blockToMarkdown(block: CatalogBlock): string {
  const text = textOf(block.text) || htmlToText(textOf(block.html));
  switch (block.type) {
    case "paragraph":
    case "markdown":
      return text;
    case "code": {
      const language = textOf(block.language);
      const lang = language && !language.startsWith("$") ? language : "text";
      return `\`\`\`${lang}\n${textOf(block.code)}\n\`\`\``;
    }
    case "list":
      return listToMarkdown(block.items, false);
    case "ordered":
      return listToMarkdown(block.items, true);
    case "table":
      return tableToMarkdown(block.headers, block.rows);
    case "callout": {
      const title = textOf(block.title);
      const body = text;
      const lines = [title ? `> **${title}**` : ">", ...body.split(/\r?\n/).map((line) => `> ${line}`)];
      return lines.join("\n");
    }
    case "image":
      return `![${textOf(block.alt)}](${absoluteUrl(block.src)})`;
    case "resource": {
      const title = textOf(block.title) || textOf(block.fileType) || "资源";
      const url = absoluteUrl(block.downloadUrl || block.attachmentUrl || block.sourceUrl);
      return url ? `[${title}](${url})` : title;
    }
    default:
      return text;
  }
}

function docBody(doc: CatalogDoc): string {
  const parts: string[] = [];
  if (doc.summary) parts.push(doc.summary);

  for (const section of doc.sections ?? []) {
    const title = textOf(section.title);
    if (title) parts.push(`## ${title}`);
    for (const block of section.blocks ?? []) {
      const markdown = blockToMarkdown(block).trim();
      if (markdown) parts.push(markdown);
    }
  }
  return parts.join("\n\n").trim();
}

function toRecords(product: DocsProduct, catalog: Catalog): DocRecord[] {
  const records: DocRecord[] = [];
  for (const lang of ["zh", "en"] as Lang[]) {
    for (const doc of catalog[lang] ?? []) {
      if (!doc.id) continue;
      const slug = doc.id;
      records.push({
        product,
        url: docUrl(product, doc.id, lang),
        path: `${product}/${lang}/${slug}`,
        lang,
        category: textOf(doc.group) || "未分类",
        slug,
        title: textOf(doc.title) || textOf(doc.shortTitle) || slug,
        body: docBody(doc),
      });
    }
  }
  return records;
}

/** Fetch every public docs product and flatten it into indexable records. */
export async function fetchDocs(
  fetchFn: (url: string) => Promise<string> = (url) => fetchOk(url, 30000),
): Promise<{ docs: DocRecord[]; revision: string; warnings: string[] }> {
  const docs: DocRecord[] = [];
  const revisions: string[] = [];
  const warnings: string[] = [];

  for (const product of Object.keys(DOCS_PRODUCTS) as DocsProduct[]) {
    const page = `${SITE_ORIGIN}/documents/${product}`;
    try {
      const html = await fetchFn(page);
      const records = toRecords(product, parseCatalog(html));
      docs.push(...records);
      revisions.push(`${product}:${records.length}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      warnings.push(`${product} 文档源不可用：${message}`);
    }
  }

  if (docs.length === 0) {
    throw new Error(`no public docs could be loaded (${warnings.join("; ") || "empty catalog"})`);
  }
  return { docs, revision: `documents:${revisions.join(",")}`, warnings };
}
