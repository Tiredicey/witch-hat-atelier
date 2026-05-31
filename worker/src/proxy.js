// proxy.js
//
// Universal CORS proxy primitives for the GET /fetch route in index.js.
//
// `allowProxy(url, allowExpr)` is the gatekeeper. It refuses non-http(s)
// schemes, private / loopback IPv4, the literal hostnames `localhost`,
// `127.0.0.1`, `::1`, `0.0.0.0`, and any URL that doesn't match the
// configured PROXY_ALLOW expression. An empty / unset PROXY_ALLOW is
// treated as "proxy disabled" (the route returns 403). `*` allows any
// remaining URL after the private-host filter. Otherwise PROXY_ALLOW is
// a comma-separated list of literal URL prefixes; the target must
// start with one of them.
//
// `proxyFetch(url, opts)` is a size-capped, timeout-bounded, conditional-
// header-aware fetch that returns the raw bytes plus content-type and
// validators (ETag, Last-Modified). The caller forwards those back to
// the browser so the standard HTTP cache machinery keeps working through
// the proxy hop. Default cap: 5 MB (matches ROADMAP §11 risk 8). Default
// timeout: 15 s (matches fetch-feed.js).

export const DEFAULT_UA = "CODA/0.1 (+https://github.com/Tiredicey/witch-hat-atelier)";
export const DEFAULT_MAX_BYTES = 5_000_000;
export const DEFAULT_TIMEOUT_MS = 15_000;

const BLOCKED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "0.0.0.0",
]);

export function allowProxy(target, allowExpr) {
  let u;
  try { u = new URL(target); } catch { return { ok: false, reason: "invalid url" }; }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, reason: "scheme not http(s)" };
  }
  const host = u.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host)) return { ok: false, reason: "private host blocked" };
  if (isPrivateIPv4(host))     return { ok: false, reason: "private host blocked" };
  if (!allowExpr) return { ok: false, reason: "proxy disabled" };
  const expr = String(allowExpr).trim();
  if (!expr)        return { ok: false, reason: "proxy disabled" };
  if (expr === "*") return { ok: true };
  const patterns = expr.split(",").map(s => s.trim()).filter(Boolean);
  for (const p of patterns) {
    if (target.startsWith(p)) return { ok: true };
  }
  return { ok: false, reason: "origin not in allowlist" };
}

export async function proxyFetch(target, opts = {}) {
  const {
    etag,
    lastModified,
    ua = DEFAULT_UA,
    maxBytes = DEFAULT_MAX_BYTES,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    cookie = "",
    extraHeaders = {},
  } = opts;
  const headers = {
    "User-Agent": ua,
    "Accept": "*/*",
  };
  for (const [k, v] of Object.entries(extraHeaders || {})) {
    if (v != null && String(v).trim()) headers[k] = String(v);
  }
  if (cookie)       headers["Cookie"]            = cookie;
  if (etag)         headers["If-None-Match"]     = etag;
  if (lastModified) headers["If-Modified-Since"] = lastModified;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(target, { headers, signal: controller.signal, redirect: "follow" });
    if (r.status === 304) {
      return {
        status: 304,
        etag:         r.headers.get("etag") || "",
        lastModified: r.headers.get("last-modified") || "",
      };
    }
    const declared = Number(r.headers.get("content-length") || 0);
    if (declared > maxBytes) {
      return { status: 0, error: `upstream too large: ${declared} > ${maxBytes}` };
    }
    const buf = await r.arrayBuffer();
    if (buf.byteLength > maxBytes) {
      return { status: 0, error: `upstream too large: ${buf.byteLength} > ${maxBytes}` };
    }
    return {
      status:       r.status,
      body:         buf,
      contentType:  r.headers.get("content-type")  || "",
      etag:         r.headers.get("etag")          || "",
      lastModified: r.headers.get("last-modified") || "",
    };
  } catch (e) {
    if (e.name === "AbortError") return { status: 0, error: `timeout after ${timeoutMs}ms` };
    return { status: 0, error: e.message || "fetch failed" };
  } finally {
    clearTimeout(timer);
  }
}

function isPrivateIPv4(host) {
  const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 127) return true;
  return false;
}
