// Mixed Chinese/English tokenizer. Latin words are kept whole; CJK text is
// emitted as both unigrams and adjacent bigrams so short Chinese queries match.

const CJK = /[㐀-䶿一-鿿豈-﫿぀-ヿ가-힯]/;

function isCJK(ch: string): boolean {
  return CJK.test(ch);
}

function cjkTokens(run: string, out: string[]): void {
  for (const ch of run) out.push(ch);
  for (let i = 0; i < run.length - 1; i++) out.push(run.slice(i, i + 2));
}

/** Lowercase token stream for indexing/querying. */
export function tokenize(text: string): string[] {
  const s = text.toLowerCase();
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (isCJK(ch)) {
      let j = i;
      let run = "";
      while (j < s.length && isCJK(s[j])) {
        run += s[j];
        j++;
      }
      cjkTokens(run, out);
      i = j;
      continue;
    }
    if (/[a-z0-9_]/.test(ch)) {
      let j = i;
      let word = "";
      while (j < s.length && /[a-z0-9_.]/.test(s[j])) {
        word += s[j];
        j++;
      }
      if (word) out.push(word);
      i = j;
      continue;
    }
    i++;
  }
  return out;
}
