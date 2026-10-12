import { ProviderError } from "../types";

const ENDPOINT = "https://serpapi.com/search.json";

export interface SerpOptions {
  apiKey: string;
  timeoutMs?: number;
  retries?: number;
  signal?: AbortSignal;
}

/** Returns the parsed JSON. "No results" responses resolve with `{ __noResults: message }`. */
export async function serpGet(
  params: Record<string, string | number>,
  { apiKey, timeoutMs = 25_000, retries = 2, signal }: SerpOptions,
): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
  qs.set("api_key", apiKey);
  qs.set("output", "json");
  const url = `${ENDPOINT}?${qs.toString()}`;

  let lastErr: ProviderError | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(600 * 2 ** (attempt - 1));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error("timeout")), timeoutMs);
    const onAbort = () => ctrl.abort(signal?.reason);
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const errMsg = typeof body.error === "string" ? body.error : null;
      if (res.ok && !errMsg) return body;
      if (errMsg && /hasn't returned any results|no results/i.test(errMsg)) return { ...body, __noResults: errMsg };
      const retryable = res.status === 429 || res.status >= 500;
      lastErr = new ProviderError(`SerpApi ${res.status}: ${errMsg ?? res.statusText}`, retryable, params);
      if (!retryable) throw lastErr;
    } catch (e) {
      if (e instanceof ProviderError && !e.retryable) throw e;
      if (signal?.aborted) throw new ProviderError("Request cancelled", false, params);
      lastErr =
        e instanceof ProviderError
          ? e
          : new ProviderError(ctrl.signal.aborted ? `SerpApi timed out after ${timeoutMs / 1000}s` : `Network error: ${(e as Error).message}`, true, params);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }
  throw lastErr ?? new ProviderError("SerpApi request failed", false, params);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
