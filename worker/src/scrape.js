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

  if (selector) {
    const items = finalize(collectBySelector(cleaned, baseUrl, selector), baseUrl, limit);
    if (items.length < minItems) return empty;
    return { items, headingLevel: 0, selector, method: "selector", confidence: confidenceOf(items) };
  }

  const headingRaw = collectByHeadings(cleaned, baseUrl);
  const headingLevel = modalLevel(headingRaw);
  let items = finalize(headingRaw.filter((it) => !headingLevel || it.level === headingLevel), baseUrl, limit);
  let method = "headings";

  if (items.length < minItems) {
    const anchorItems = finalize(collectByAnchorPattern(cleaned, baseUrl), baseUrl, limit);
    if (anchorItems.length >= minItems) { items = anchorItems; method = "anchor-pattern"; }
  }

  if (items.length < minItems) {
    const embedded = finalize(collectFromEmbeddedJson(html, baseUrl), baseUrl, limit);
    if (embedded.length >= minItems) { items = embedded; method = "embedded-json"; }
  }

  if (items.length < minItems) return { ...empty, headingLevel };

  return {
    items,
    headingLevel: method === "headings" ? headingLevel : 0,
    selector,
    method,
    confidence: confidenceOf(items),
  };
}

function finalize(raw, baseUrl, limit) {
  const merged = mergeByLink(raw);
  const filtered = merged.filter((it) => acceptable(it, baseUrl));
  return filtered.slice(0, limit).map((it) => ({
    title: it.title,
    link: it.link,
    published: it.published || 0,
    image: it.image || "",
    excerpt: it.excerpt || "",
    enclosure: it.enclosure || null,
  }));
}

function confidenceOf(items) {
  return items.length >= 8 ? "high" : "medium";
}

function collectByAnchorPattern(html, baseUrl) {
  const out = [];
  const A = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = A.exec(html)) !== null) {
    const href = attrValue(m[1], "href");
    if (!href) continue;
    const link = resolveLink(href, baseUrl);
    if (!link || !articleLike(link, baseUrl)) continue;
    const title = clean(m[2]) || clean(attrValue(m[1], "aria-label")) || clean(attrValue(m[1], "title"));
    const image = firstImageIn(m[1] + " " + m[2], baseUrl);
    if (!title && !image) continue;
    out.push({ title, link, level: 0, pos: m.index, image, excerpt: excerptNear(html, A.lastIndex, title), enclosure: firstAudioIn(m[1] + " " + m[2], baseUrl) });
  }
  return out;
}

function articleLike(link, baseUrl) {
  let a, b;
  try { a = new URL(link); b = new URL(baseUrl); } catch { return false; }
  if (a.origin !== b.origin) return false;
  const path = a.pathname.replace(/\/+$/, "");
  if (/\/\d{3,}(?:\/|$)/.test(path)) return true;
  if (/\/story\b|\/article\b|\/news\/[^/]+\/[^/]+/.test(path)) return true;
  const segs = path.split("/").filter(Boolean);
  if (segs.length >= 2) {
    const last = segs[segs.length - 1];
    const hyphens = (last.match(/-/g) || []).length;
    if (last.length > 15 && hyphens >= 2) return true;
  }
  return false;
}

function collectFromEmbeddedJson(html, baseUrl) {
  const out = [];
  const seen = new Set();
  const scripts = String(html || "").match(/<script\b[^>]*>([\s\S]*?)<\/script>/gi);
  if (!scripts) return out;
  const STR = /"((?:[^"\\]|\\.)*)"/g;
  for (const block of scripts) {
    const body = block.replace(/^<script\b[^>]*>/i, "").replace(/<\/script\s*>$/i, "");
    const strings = [];
    let m;
    while ((m = STR.exec(body)) !== null) strings.push(decodeJsonText(m[1]));
    for (let i = 0; i < strings.length; i++) {
      const s = strings[i];
      if (!/^https?:\/\//i.test(s) && !s.startsWith("/")) continue;
      const link = resolveLink(s, baseUrl);
      if (!link || !articleLike(link, baseUrl)) continue;
      if (seen.has(link)) continue;
      seen.add(link);
      const title = titleFromSlug(link);
      if (!title) continue;
      out.push({ title, link, level: 0, pos: i, image: "", excerpt: excerptFromStrings(strings, i) });
    }
  }
  return out;
}

function excerptFromStrings(strings, i) {
  for (let j = i + 1; j < Math.min(strings.length, i + 4); j++) {
    const s = String(strings[j] || "").trim();
    if (s.length < 24 || s.length > 600) continue;
    if (/^https?:\/\//i.test(s) || s.startsWith("/")) continue;
    if (!/\s/.test(s) || !/[a-z]/i.test(s)) continue;
    return s.slice(0, 320);
  }
  return "";
}

function titleFromSlug(link) {
  let seg;
  try { seg = new URL(link).pathname.split("/").filter(Boolean).pop() || ""; } catch { return ""; }
  if (!seg) return "";
  seg = seg.replace(/\.(html?|php|aspx?)$/i, "");
  seg = seg.replace(/-[a-z]?\d{1,6}-\d{8}-[a-z]{2,6}$/i, "");
  seg = seg.replace(/-\d{8}$/i, "");
  seg = seg.replace(/-[a-z]\d{3,}$/i, "");
  seg = seg.replace(/-\d{5,}$/, "");
  const words = seg.split(/[-_]/).filter(Boolean);
  if (words.length < 2) return "";
  return words
    .map((w) => (w.length <= 3 && !/\d/.test(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeJsonText(s) {
  return String(s || "").replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, g) => {
    if (g[0] === "u") return safeChar(parseInt(g.slice(1), 16));
    if (g === "n" || g === "t" || g === "r") return " ";
    if (g === "/" || g === '"' || g === "\\") return g;
    return g;
  });
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
    const lines = [
      "  <entry>",
      `    <title>${xml(it.title || "(untitled)")}</title>`,
      `    <link rel="alternate" href="${xml(it.link || pageUrl)}"/>`,
      `    <id>${xml(id)}</id>`,
      `    <updated>${isoOf(stamp)}</updated>`,
    ];
    if (it.excerpt) lines.push(`    <summary>${xml(it.excerpt)}</summary>`);
    if (it.image) lines.push(`    <media:thumbnail url="${xml(it.image)}"/>`);
    if (it.enclosure && it.enclosure.url) lines.push(`    <link rel="enclosure" href="${xml(it.enclosure.url)}" type="${xml(it.enclosure.type || "")}"/>`);
    lines.push("  </entry>");
    return lines.join("\n");
  });

  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">',
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
    out.push({ title: clean(hh[2]), link, level: Number(hh[1]), pos: m.index, image: firstImageIn(m[2], baseUrl), excerpt: excerptNear(html, A.lastIndex, clean(hh[2])), enclosure: firstAudioIn(m[2], baseUrl) });
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
    out.push({ title, link, level: Number(m[1]), pos: m.index, image: firstImageIn(inner, baseUrl), excerpt: excerptNear(html, H.lastIndex, title), enclosure: firstAudioIn(inner, baseUrl) });
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
    out.push({ title, link, level: 0, pos: matches[i].idx, image: firstImageIn(window, baseUrl), excerpt: excerptNear(window, 0, title), enclosure: firstAudioIn(window, baseUrl) });
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

function mergeByLink(items) {
  const map = new Map();
  for (const it of items) {
    const cur = map.get(it.link);
    if (!cur) { map.set(it.link, { ...it }); continue; }
    if (!cur.image && it.image) cur.image = it.image;
    if (!cur.enclosure && it.enclosure) cur.enclosure = it.enclosure;
    if (!cur.published && it.published) cur.published = it.published;
    if ((it.title || "").length > (cur.title || "").length) {
      cur.title = it.title;
      cur.excerpt = it.excerpt || "";
    }
  }
  return [...map.values()];
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

const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|oga|wav|flac)(?:[?#]|$)/i;
const AUDIO_TYPE = { mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", oga: "audio/ogg", wav: "audio/wav", flac: "audio/flac" };

function firstAudioIn(fragment, baseUrl) {
  const s = String(fragment || "");
  let cand = "";
  const tag = /<(?:audio|source)\b[^>]*?\bsrc\s*=\s*("([^"]+)"|'([^']+)'|([^\s>]+))/i.exec(s);
  if (tag) cand = tag[2] ?? tag[3] ?? tag[4];
  if (!cand) {
    const hrefs = /href\s*=\s*("([^"]+)"|'([^']+)'|([^\s>]+))/gi;
    let h;
    while ((h = hrefs.exec(s)) !== null) {
      const v = h[2] ?? h[3] ?? h[4];
      if (AUDIO_EXT.test(v)) { cand = v; break; }
    }
  }
  cand = decodeEntities(String(cand || "")).trim();
  if (!cand) return null;
  let u;
  try { u = new URL(cand, baseUrl); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const ext = AUDIO_EXT.exec(u.pathname);
  if (!ext) return null;
  return { url: u.toString(), type: AUDIO_TYPE[ext[1].toLowerCase()] || "" };
}

const LEAD_KEYWORDS = "lead|excerpt|summary|dek|teaser|standfirst|description|desc|snippet|subtitle|subhead";

function firstImageIn(fragment, baseUrl) {
  const s = String(fragment || "");
  let m = /<img\b[^>]*?\b(?:data-src|src)\s*=\s*("([^"]+)"|'([^']+)'|([^\s>]+))/i.exec(s);
  let cand = m ? (m[2] ?? m[3] ?? m[4]) : "";
  if (!cand) {
    const ss = /\bsrcset\s*=\s*("([^"]+)"|'([^']+)')/i.exec(s);
    if (ss) cand = String(ss[2] ?? ss[3] ?? "").split(",")[0].trim().split(/\s+/)[0];
  }
  if (!cand) {
    const bg = /background-image\s*:\s*url\(\s*(?:&quot;|&#0*39;|["'])?([^"')&]+)/i.exec(s);
    if (bg) cand = bg[1];
  }
  cand = decodeEntities(String(cand || "")).trim();
  if (!cand || /^data:/i.test(cand)) return "";
  let u;
  try { u = new URL(cand, baseUrl); } catch { return ""; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "";
  return u.toString();
}

function excerptNear(html, fromPos, title) {
  const window = String(html).slice(fromPos, fromPos + 1400);
  let text = "";
  const tagRe = new RegExp(
    `<([a-z][a-z0-9]*)\\b[^>]*class\\s*=\\s*("[^"]*\\b(?:${LEAD_KEYWORDS})\\b[^"]*"|'[^']*\\b(?:${LEAD_KEYWORDS})\\b[^']*')[^>]*>([\\s\\S]*?)</\\1>`,
    "i",
  );
  const m = tagRe.exec(window);
  if (m) text = clean(m[3]);
  if (!text) {
    const p = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(window);
    if (p) text = clean(p[1]);
  }
  if (!text) return "";
  const t = (title || "").trim();
  if (t && text === t) return "";
  if (text.length < 16) return "";
  return text.slice(0, 320);
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
