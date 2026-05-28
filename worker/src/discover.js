// discover.js
//
// Pure helpers for the GET /discover route in index.js. No network here:
// the route fetches via proxy.js#proxyFetch (which reuses the same
// allowlist gate and byte/time caps as the universal /fetch endpoint),
// then hands the bytes to these functions.
//
// `extractFeedLinks(html, baseUrl)` scans the <head> of an HTML page for
// `<link rel="alternate" type="application/(rss|atom)+xml|json">` tags,
// resolves their href against baseUrl, and returns deduped
// { url, type, title } candidates. A `type="application/json"` link is
// only accepted when its href hints at a feed (json|feed|rss|atom) so we
// do not collect every `application/json` discovery link.
//
// `commonFeedPaths(pageUrl)` returns the static probe list used when a
// page has no alternate links at all. Both the host root and the
// containing directory are probed, in case the page lives under
// /blog/2026/post and the feed sits at /blog/2026/feed.xml.
//
// `looksLikeFeed(body, contentType)` is the post-fetch sniffer used to
// keep the probe path from returning 200-but-HTML soft errors as if
// they were feeds.

const FEED_TYPES = new Set([
  "application/rss+xml",
  "application/atom+xml",
  "application/feed+json",
  "application/json",
]);

const LINK_TAG = /<link\b[^>]*>/gi;
const ATTR = /([a-zA-Z][a-zA-Z0-9-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>=`]+))/g;
const FEED_HINT = /^\s*(?:<\?xml|<rss\b|<feed\b|<rdf\b|\{)/i;
const JSON_FEED_HINT = /"version"\s*:\s*"https:\/\/jsonfeed\.org\//;

const COMMON_PATHS = [
  "/feed",
  "/feed/",
  "/feed.xml",
  "/feed.json",
  "/rss",
  "/rss.xml",
  "/atom.xml",
  "/index.xml",
];

export function extractFeedLinks(html, baseUrl) {
  if (typeof html !== "string" || !html) return [];
  const headEnd = html.search(/<\/head\s*>/i);
  const scope = headEnd > 0 ? html.slice(0, headEnd) : html.slice(0, 65536);
  const out = [];
  const seen = new Set();
  let m;
  LINK_TAG.lastIndex = 0;
  while ((m = LINK_TAG.exec(scope)) !== null) {
    const attrs = parseAttrs(m[0]);
    const rels = (attrs.rel || "").toLowerCase().split(/\s+/).filter(Boolean);
    if (!rels.includes("alternate")) continue;
    const type = (attrs.type || "").toLowerCase();
    if (!FEED_TYPES.has(type)) continue;
    const href = attrs.href;
    if (!href) continue;
    if ((type === "application/json") && !/feed|rss|atom/i.test(href)) continue;
    let resolved;
    try { resolved = new URL(href, baseUrl).toString(); } catch { continue; }
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    out.push({
      url: resolved,
      type: classifyType(type),
      title: attrs.title || "",
    });
  }
  return out;
}

export function commonFeedPaths(pageUrl) {
  let base;
  try { base = new URL(pageUrl); } catch { return []; }
  const root = `${base.protocol}//${base.host}`;
  const dir = base.pathname.replace(/\/[^/]*$/, "/");
  const out = new Set();
  for (const p of COMMON_PATHS) {
    out.add(`${root}${p}`);
    if (dir && dir !== "/") {
      const trimmed = dir.replace(/\/$/, "");
      out.add(`${root}${trimmed}${p}`);
    }
  }
  return [...out];
}

export function looksLikeFeed(body, contentType) {
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("rss") || ct.includes("atom") || ct.includes("application/feed+json")) {
    return true;
  }
  if (!body) return false;
  let text;
  if (typeof body === "string") {
    text = body.slice(0, 512);
  } else {
    try {
      const view = body.byteLength !== undefined ? body : new Uint8Array(body);
      const slice = view.slice(0, 512);
      text = new TextDecoder("utf-8", { fatal: false }).decode(slice);
    } catch {
      return false;
    }
  }
  if (!FEED_HINT.test(text)) return false;
  if (text.trim().startsWith("{")) return JSON_FEED_HINT.test(text);
  return /<(rss|feed|rdf:RDF)\b/i.test(text);
}

export function classifyByBody(body, contentType) {
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("atom")) return "atom";
  if (ct.includes("rss"))  return "rss";
  if (ct.includes("feed+json") || ct.includes("application/json")) return "json";
  if (!body) return "unknown";
  let text;
  try {
    const view = body.byteLength !== undefined ? body : new Uint8Array(body);
    text = new TextDecoder("utf-8", { fatal: false }).decode(view.slice(0, 256));
  } catch {
    return "unknown";
  }
  if (/<feed\b/i.test(text)) return "atom";
  if (/<(rss|rdf:RDF)\b/i.test(text)) return "rss";
  if (text.trim().startsWith("{") && JSON_FEED_HINT.test(text)) return "json";
  return "unknown";
}

function parseAttrs(tag) {
  const out = {};
  let m;
  ATTR.lastIndex = 0;
  while ((m = ATTR.exec(tag)) !== null) {
    out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return out;
}

function classifyType(type) {
  if (type === "application/atom+xml")  return "atom";
  if (type === "application/rss+xml")   return "rss";
  return "json";
}
