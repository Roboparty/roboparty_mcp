export type Lang = "zh" | "en";

/** Any indexable source kind: public docs or an RP1 GitHub repository. */
export type SourceKind = "knowledge" | "github";

/** A document from the public docs site (roboparty.com/documents/<product>). */
export type DocRecord = {
  /** Docs product route, e.g. roboto-origin or roboto-01. */
  product: string;
  /** Public page URL. */
  url: string;
  /** Stable logical path, e.g. roboto-01/zh/overview/introduction. */
  path: string;
  lang: Lang;
  /** Group shown in the docs sidebar, e.g. 概览. */
  category: string;
  /** Document id inside the product, e.g. overview/introduction. */
  slug: string;
  /** Document title. */
  title: string;
  /** Markdown body assembled from the RSC catalog. */
  body?: string;
};

/** An RP1 README/docs markdown page mirrored from a RoboParty GitHub repository. */
export type GithubDoc = {
  repo: string;
  branch: string;
  path: string;
  title: string;
  url: string;
  category: string;
  /** Skill this document should ground, e.g. rp1-deploy */
  skill: string;
  lang: Lang;
  body: string;
  private: boolean;
};

export type SearchHit = {
  /** Stable id: doc path or github repo/path */
  id: string;
  kind: SourceKind;
  title: string;
  url: string;
  /** Docs product for knowledge hits (roboto-origin / roboto-01). */
  product?: string;
  category: string;
  lang: Lang;
  score: number;
  section: string | null;
  snippet: string;
  path: string;
};

export type SearchResult = {
  query: string;
  hits: SearchHit[];
  total: number;
  warnings: string[];
};
