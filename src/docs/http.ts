/**
 * Minimal HTTP helper. Uses the global fetch (Node 20+). Honors standard
 * proxy env vars when the global undici agent does not, by relying on Node's
 * built-in NODE_OPTIONS/undix ProxyAgent being configured by the environment.
 */

export type FetchResult = { url: string; text: string; status: number };

const UA = "roboparty-docs-mcp (+https://github.com/Roboparty/roboparty_docs_skill)";

export async function fetchText(url: string, timeoutMs = 30000): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": UA, Accept: "text/plain, text/html, application/json, */*" },
      redirect: "follow",
    });
    const text = await res.text();
    return { url: res.url || url, text, status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch that throws with a clear message on non-2xx. */
export async function fetchOk(url: string, timeoutMs = 30000): Promise<string> {
  const r = await fetchText(url, timeoutMs);
  if (r.status >= 400) {
    throw new Error(`GET ${url} -> HTTP ${r.status}`);
  }
  return r.text;
}
