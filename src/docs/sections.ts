// Split markdown into heading-based sections for indexing and page extraction.

export type Section = {
  heading: string;
  level: number;
  text: string;
  anchor: string;
};

/** GitHub/VitePress-ish anchor: keep CJK, lowercase latin, spaces to hyphens. */
export function slugifyHeading(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[`*_()（）\[\]{}.,，。:：;；!?！？'"“”‘’/\\]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

/**
 * Split a markdown body into sections keyed by ATX headings. Content before
 * the first heading is grouped under the document title as a lead section.
 */
export function splitSections(body: string, docTitle = ""): Section[] {
  const lines = body.split(/\r?\n/);
  const sections: Section[] = [];
  let current: { heading: string; level: number; lines: string[] } | null = null;

  const push = () => {
    if (!current) return;
    const text = current.lines.join("\n").trim();
    sections.push({
      heading: current.heading,
      level: current.level,
      text,
      anchor: slugifyHeading(current.heading),
    });
  };

  for (const line of lines) {
    const h = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (h) {
      push();
      current = { heading: h[2].trim(), level: h[1].length, lines: [] };
    } else {
      if (!current) current = { heading: docTitle || "概述", level: 1, lines: [] };
      current.lines.push(line);
    }
  }
  push();
  return sections;
}

/** Reduce a markdown fragment to a compact plain-text snippet. */
export function toSnippet(markdown: string, max = 220): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? text.slice(0, max) + "…" : text;
}
