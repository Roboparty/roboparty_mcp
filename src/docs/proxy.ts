// Honor standard proxy environment variables for all global fetch() traffic.
// Node's built-in fetch does not automatically use HTTPS_PROXY/HTTP_PROXY, so on the
// corporate network (where GitHub may require a proxy) we wire undici's env-aware
// dispatcher once, before any request is made. NO_PROXY is respected as well.
import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

let initialized = false;

export function proxyFromEnv(): string | undefined {
  return (
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    undefined
  );
}

export function setupProxy(): void {
  if (initialized) return;
  const proxy = proxyFromEnv();
  if (proxy) {
    setGlobalDispatcher(new EnvHttpProxyAgent());
    console.error(`roboparty-docs using proxy: ${proxy} (NO_PROXY respected)`);
  }
  initialized = true;
}
