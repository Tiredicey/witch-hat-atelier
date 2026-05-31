// feed-fetch.js
//
// Decide how to fetch a subscription/candidate feed URL. The /fetch proxy on
// the Worker exists only to add CORS headers to cross-origin publisher feeds.
// Our own endpoints (the synthetic /scrape feed built by /discover) live on the
// same origin as the proxy and already send CORS headers, so routing them back
// through /fetch needlessly re-applies the PROXY_ALLOW gate and 403s. Fetch
// same-origin feed URLs directly; proxy everything else.

export function feedRequestUrl(feedUrl, fetchBase = "") {
  const base = typeof location !== "undefined" && location.href ? location.href : "http://localhost/";
  try {
    const target = new URL(feedUrl, base);
    const proxyOrigin = new URL(`${fetchBase || ""}/fetch`, base).origin;
    if (target.origin === proxyOrigin) return target.href;
  } catch {}
  return `${fetchBase || ""}/fetch?url=${encodeURIComponent(feedUrl)}`;
}
