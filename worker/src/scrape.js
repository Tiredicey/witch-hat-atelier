// scrape.js
//
// Synthetic-feed fallback for pages that publish no native RSS/Atom and
// expose no rel=alternate link (GMA Network, many regional newsrooms and
// CMS landing pages). The /discover route in index.js calls this only
// AFTER alternate-link extraction and common-path probing have both come
// back empty, so it never overrides a publisher's real feed.
//
// Dependency-free on purpose. A Cloudflare Worker cannot ship cheerio or
// linkedom cheaply (Node DOM libs, large bundles, not edge-first); the
// platform-native option is HTMLRewriter, which is streaming and has no
// innerHTML access, so it is awkward for "find the repeating headline
// cluster" logic. discover.js already extracts links with bounded regex
// scanning; this module follows the same approach so the two stay
// reviewable side by side.
//
// Heuristic: real listing pages render the same headline-link shape many
// times. Two shapes cover the overwhelming majority:
//   A. anchor wraps heading   <a href="..."><h3>Title</h3></a>
//   B. heading wraps anchor    <h3><a href="...">Title</a></h3>
// We collect both, keep the modal heading level (the one that repeats
// most), dedupe by resolved link, and require a minimum cluster size so a
// page with a single <h1> site title never produces a one-item feed.
//
// `scrapeFeedItems(html, baseUrl, opts)` returns
//   { items: [{ title, link, published }], headingLevel, selector, confidence }
// `buildAtom(items, meta)` serialises those items into a valid Atom 1.0
// document the existing parse.js pipeline can consume unchanged.

const DEFAULT_LIMIT = 40;
const DEFAULT_MIN_ITEMS = 3;
const MIN_TITLE_LEN = 10;

const NAV_WORDS = new Set([
  "home", "menu", "more", "next", "previous", "prev", "back", "top",
  "login", "log in", "sign in", "sign up", "register", "subscribe",
  "search", "share", "contact", "about", "privacy", "terms", "advertise",
  "newsletter", "read more", "see all", "view all", "load more",
]);

export function scrapeFeedItems(html, baseUrl, opts = {}) {
  const limit = Number(opts.limit) > 0 ? Number(opts.limit) : DEFAULT_LIMIT;
  const minItems = Number(opts.minItems) > 0 ? Number(opts.minItems) : DEFAULT_MIN_ITEMS;
  const selector = normaliseSelector(opts.selector);
  const empty = { items: [], headingLevel: 0, selector, confidence: "none" };
  if (typeof html !== "string" || !html) return empty;

  const cleaned = stripNoise(html);
  const raw = selector
    ? collectBySelector(cleaned, baseUrl, selector)
    : collectByHeadings(cleaned, baseUrl);

  if (!raw.length) return empty;

  const headingLevel = selector ? 0 : modalLevel(raw);
  const filtered = raw
    .filter((it) => (selector || !headingLevel || it.level === headingLevel))
    .filter((it) => acceptable(it, baseUrl));

  const items = dedupeByLink(filtered).slice(0, limit).map((it) => ({
    title: it.title,
    link: it.link,
    published: it.published || 0,
  }));

  if (items.length < minItems) return { ...empty, headingLevel };

  return {
    items,
    headingLevel,
    selector,
    confidence: items.length >= 8 ? "high" : "medium",
  };
}

export function buildAtom(items, meta = {}) {
  const list = Array.isArray(items) ? items : [];
  const pageUrl = meta.pageUrl || "";
  const selfUrl = meta.selfUrl || "";
  const title = meta.title || hostLabel(pageUrl) || "CODA synthetic feed";
  const nowMs = Number.isFinite(meta.now) ? meta.now : Date.now();
  const updated = isoOf(latestStamp(list) || nowMs);
  const feedId = selfUrl || pageUrl || `urn:coda:synthetic:${hostLabel(pageUrl)}`;

  const entries = list.map((it, i) => {
    const stamp = it.published || (nowMs - i * 1000);
    const id = it.link || `${feedId}#${i}`;
    return [
      "  <entry>",
      `    <title>${xml(it.title || "(untitled)")}</title>`,
      `    <link rel="alternate" href="${xml(it.link || pageUrl)}"/>`,
      `    <id>${xml(id)}</id>`,
      `    <updated>${isoOf(stamp)}</updated>`,
      "  </entry>",
    ].join("\n");
  });

  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <title>${xml(title)}</title>`,
    `  <link rel="alternate" href="${xml(pageUrl)}"/>`,
    selfUrl ? `  <link rel="self" href="${xml(selfUrl)}"/>` : "",
    `  <id>${xml(feedId)}</id>`,
    `  <updated>${updated}</updated>`,
    "  <generator>CODA synthetic-feed fallback</generator>",
    ...entries,
    "</feed>",
    "",
  ].filter((l) => l !== "").join("\n");
}

function collectByHeadings(html, baseUrl) {
  const out = [];

  const A = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = A.exec(html)) !== null) {
    const href = attrValue(m[1], "href");
    if (!href) continue;
    const hh = /<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1>/i.exec(m[2]);
    if (!hh) continue;
    const link = resolveLink(href, baseUrl);
    if (!link) continue;
    out.push({ title: clean(hh[2]), link, level: Number(hh[1]), pos: m.index });
  }

  const H = /<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  while ((m = H.exec(html)) !== null) {
    const inner = m[2];
    const a = /<a\b([^>]*)>([\s\S]*?)<\/a>/i.exec(inner);
    if (!a) continue;
    const href = attrValue(a[1], "href");
    if (!href) continue;
    const link = resolveLink(href, baseUrl);
    if (!link) continue;
    const title = clean(a[2]) || clean(inner);
    out.push({ title, link, level: Number(m[1]), pos: m.index });
  }

  out.sort((x, y) => x.pos - y.pos);
  return out;
}

function collectBySelector(html, baseUrl, token) {
  const out = [];
  const open = new RegExp(
    `<([a-z][a-z0-9]*)\\b[^>]*class\\s*=\\s*("([^"]*)"|'([^']*)')[^>]*>`,
    "gi",
  );
  const matches = [];
  let m;
  while ((m = open.exec(html)) !== null) {
    const cls = (m[3] ?? m[4] ?? "").split(/\s+/);
    if (cls.includes(token)) matches.push({ start: open.lastIndex, idx: m.index });
  }
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].start;
    const next = i + 1 < matches.length ? matches[i + 1].idx : html.length;
    const window = html.slice(start, Math.min(next, start + 6000));
    const a = /<a\b([^>]*)>([\s\S]*?)<\/a>/i.exec(window);
    if (!a) continue;
    const href = attrValue(a[1], "href");
    if (!href) continue;
    const link = resolveLink(href, baseUrl);
    if (!link) continue;
    const hh = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/i.exec(window);
    const title = clean(hh ? hh[2] : a[2]);
    out.push({ title, link, level: 0, pos: matches[i].idx });
  }
  return out;
}

function acceptable(it, baseUrl) {
  if (!it.link) return false;
  if (sameLocation(it.link, baseUrl)) return false;
  const t = it.title;
  if (!t) return false;
  if (NAV_WORDS.has(t.toLowerCase())) return false;
  if (t.length < MIN_TITLE_LEN && !/\s/.test(t)) return false;
  return true;
}

function modalLevel(items) {
  const count = new Map();
  for (const it of items) count.set(it.level, (count.get(it.level) || 0) + 1);
  let best = 0;
  let bestN = -1;
  for (const [lvl, n] of count) {
    if (n > bestN || (n === bestN && lvl > best)) { best = lvl; bestN = n; }
  }
  return best;
}

function dedupeByLink(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    if (seen.has(it.link)) continue;
    seen.add(it.link);
    out.push(it);
  }
  return out;
}

function stripNoise(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<head\b[\s\S]*?<\/head>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
}

function attrValue(attrs, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const m = re.exec(attrs || "");
  if (!m) return "";
  return (m[2] ?? m[3] ?? m[4] ?? "").trim();
}

function resolveLink(href, baseUrl) {
  const h = String(href || "").trim();
  if (!h || h.startsWith("#")) return "";
  if (/^(javascript|mailto|tel):/i.test(h)) return "";
  let u;
  try { u = new URL(h, baseUrl); } catch { return ""; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "";
  u.hash = "";
  return u.toString();
}

function sameLocation(link, baseUrl) {
  try {
    const a = new URL(link);
    const b = new URL(baseUrl);
    return a.origin === b.origin && a.pathname.replace(/\/$/, "") === b.pathname.replace(/\/$/, "");
  } catch {
    return false;
  }
}

function normaliseSelector(sel) {
  const s = String(sel || "").trim();
  if (!s) return "";
  return s.replace(/^[.#]/, "").split(/[\s,]+/)[0] || "";
}

function clean(htmlFragment) {
  return decodeEntities(
    String(htmlFragment || "").replace(/<[^>]*>/g, " "),
  ).replace(/\s+/g, " ").trim();
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;|&#x0*27;/gi, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => safeChar(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => safeChar(parseInt(n, 16)));
}

function safeChar(code) {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
  try { return String.fromCodePoint(code); } catch { return ""; }
}

function xml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function latestStamp(items) {
  let max = 0;
  for (const it of items) if ((it.published || 0) > max) max = it.published;
  return max;
}

function isoOf(ms) {
  const n = Number(ms);
  const d = new Date(Number.isFinite(n) && n > 0 ? n : Date.now());
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function hostLabel(url) {
  try { return new URL(url).host; } catch { return ""; }
}
