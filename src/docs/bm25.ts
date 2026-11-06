// Standard BM25 over pre-tokenized documents.

export class BM25 {
  private k1: number;
  private b: number;
  private df: Map<string, number> = new Map();
  private docLen: number[] = [];
  private docTokens: string[][] = [];
  private avgdl = 0;
  private idfCache: Map<string, number> = new Map();

  constructor(docTokens: string[][], k1 = 1.5, b = 0.75) {
    this.k1 = k1;
    this.b = b;
    this.docTokens = docTokens;
    let total = 0;
    docTokens.forEach((tokens, idx) => {
      this.docLen[idx] = tokens.length;
      total += tokens.length;
      const seen = new Set(tokens);
      for (const t of seen) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    });
    this.avgdl = docTokens.length ? total / docTokens.length : 0;
  }

  get size(): number {
    return this.docTokens.length;
  }

  private idf(term: string): number {
    const cached = this.idfCache.get(term);
    if (cached !== undefined) return cached;
    const n = this.df.get(term) ?? 0;
    // BM25+ style idf, always non-negative.
    const v = Math.log(1 + (this.size - n + 0.5) / (n + 0.5));
    this.idfCache.set(term, v);
    return v;
  }

  /** Score every document for the given query tokens. Returns idx -> score. */
  score(queryTokens: string[]): Map<number, number> {
    const result = new Map<number, number>();
    const qTerms = [...new Set(queryTokens)];
    for (let idx = 0; idx < this.size; idx++) {
      const tf = new Map<string, number>();
      for (const t of this.docTokens[idx]) tf.set(t, (tf.get(t) ?? 0) + 1);
      let s = 0;
      const dl = this.docLen[idx] || 0;
      for (const term of qTerms) {
        const f = tf.get(term) ?? 0;
        if (f === 0) continue;
        const denom = f + this.k1 * (1 - this.b + (this.b * dl) / (this.avgdl || 1));
        s += this.idf(term) * ((f * (this.k1 + 1)) / denom);
      }
      if (s > 0) result.set(idx, s);
    }
    return result;
  }
}
