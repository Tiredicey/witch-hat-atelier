// fetch-feed.js
//
// Polite feed fetch:
//   - Identifies as CODA with a contact URL (set via Worker var UA).
//   - Honours ETag / Last-Modified via stored conditional headers.
//   - Aborts at 15s (configurable) so a slow server cannot stall the cron.
//   - Returns { status, body, contentType, etag, lastModified }.
//
// Returns { status: 304 } when the feed hasn't changed; the caller should
// skip writing in that case but still update the last-checked timestamp.

export const DEFAULT_TIMEOUT_MS = 15_000;
export const DEFAULT_UA = "CODA/0.1 (+https://github.com/Tiredicey/witch-hat-atelier)";

export async function fetchFeed(url, { etag, lastModified, ua = DEFAULT_UA, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const headers = {
    "User-Agent": ua,
    "Accept": "application/atom+xml, application/rss+xml, application/json;q=0.9, text/xml;q=0.8, */*;q=0.5",
  };
  if (etag)         headers["If-None-Match"]     = etag;
  if (lastModified) headers["If-Modified-Since"] = lastModified;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers, signal: controller.signal, redirect: "follow" });
    if (r.status === 304) return { status: 304 };
    if (!r.ok) return { status: r.status, error: `upstream ${r.status}` };
    const body = await r.text();
    return {
      status: r.status,
      body,
      contentType: r.headers.get("content-type") || "",
      etag:        r.headers.get("etag") || "",
      lastModified:r.headers.get("last-modified") || "",
    };
  } catch (e) {
    if (e.name === "AbortError") return { status: 0, error: `timeout after ${timeoutMs}ms` };
    return { status: 0, error: e.message || "fetch failed" };
  } finally {
    clearTimeout(timer);
  }
}
