// parse.js
//
// Minimal feed parser for Atom 1.0, RSS 2.0, and JSON Feed 1.1.
// Pure ES module — runs in browsers, Workers, and node. No third-party deps.
//
// Scope: extract the fields the reader needs (id, title, source, link,
// published, summary, content). NOT a general XML parser; it walks the
// element tree by name only and ignores XML namespaces. Robust to:
//   - missing optional fields
//   - CDATA sections
//   - HTML-encoded text in titles/summaries
//   - attribute-or-element form for <link>
//
// Not robust to: deeply malformed XML, mid-element comments, or feeds that
// use namespaces beyond `atom:` / `rss:` for canonical elements. The §1
// quality heuristic in quality.js drops feeds that fail to parse entirely.

const NL = /\s+/g;

export function parseFeed(text, contentType = "") {
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("parseFeed: empty input");
  }
  const ct = contentType.toLowerCase();
  if (ct.includes("json") || text.trimStart().startsWith("{")) {
    return parseJsonFeed(text);
  }
  const root = sniffRoot(text);
  if (root === "feed") return parseAtom(text);
  if (root === "rss")  return parseRss2(text);
  throw new Error(`parseFeed: unrecognised root element "${root}"`);
}

export function normaliseEntry(raw, feedTitle) {
  const rawHtml = raw.content || raw.summary || "";
  const image     = raw.image     || firstImage(rawHtml);
  const enclosure = raw.enclosure || null;
  const link      = raw.link      || "";
  const videoId   = detectVideo(link) || detectVideo(rawHtml);
  return {
    id:        raw.id        || link || cryptoIshHash(raw.title + (raw.published || "")),
    source:    raw.source    || feedTitle || "unknown",
    title:     stripTags(raw.title || "(untitled)").trim() || "(untitled)",
    link,
    published: raw.published || 0,
    age:       formatAge(raw.published),
    excerpt:   stripTags(raw.summary || raw.content || "").slice(0, 240).trim(),
    body:      paragraphs(rawHtml),
    image:     image || "",
    enclosure: enclosure,
    video:     videoId || null,
    read:      false,
  };
}

// RSS-Bridge wraps scrape failures into valid Atom documents with entries
// whose titles follow the pattern "Bridge returned error N! (code)". These
// parse successfully but contain zero real posts. This function lets callers
// flag or filter them instead of treating the error as content.
const BRIDGE_ERROR_TITLE_RE = /^Bridge returned error \d+/i;

export function isBridgeErrorEntry(entry) {
  if (!entry || typeof entry.title !== "string") return false;
  return BRIDGE_ERROR_TITLE_RE.test(entry.title.trim());
}

function firstImage(html) {
  if (!html) return "";
  const stripped = unwrapCdata(decodeEntities(html));
  const m = stripped.match(/<img\b[^>]*?\bsrc=["']([^"']+)["']/i);
  return m ? m[1] : "";
}

function rssEnclosure(block) {
  const m = block.match(/<enclosure\b([^>]*?)\/?>/i);
  if (!m) return null;
  const a = parseAttrs(m[1]);
  if (!a.url) return null;
  return { url: a.url, type: a.type || "", length: a.length || "" };
}

function atomEnclosure(block) {
  const all = [...block.matchAll(/<link\b([^>]*?)\/?>/gi)];
  for (const m of all) {
    const a = parseAttrs(m[1]);
    if (a.rel === "enclosure" && a.href) {
      return { url: a.href, type: a.type || "", length: a.length || "" };
    }
  }
  return null;
}

function mediaThumb(block) {
  const m = block.match(/<media:(?:content|thumbnail)\b([^>]*?)\/?>/i);
  if (!m) return "";
  const a = parseAttrs(m[1]);
  return a.url || "";
}

function detectVideo(s) {
  if (!s) return null;
  const short = s.match(/youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/);
  if (short) return { provider: "youtube", id: short[1], short: true };
  const yt = s.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (yt) return { provider: "youtube", id: yt[1] };
  const vm = s.match(/(?:vimeo\.com\/(?:video\/)?)(\d{6,})/);
  if (vm) return { provider: "vimeo", id: vm[1] };
  const tt = s.match(/tiktok\.com\/@([\w.-]+)\/video\/(\d{6,})/i);
  if (tt) return { provider: "tiktok", id: tt[2], user: tt[1] };
  const tte = s.match(/tiktok\.com\/(?:player\/v1|embed(?:\/v2)?)\/(\d{6,})/i);
  if (tte) return { provider: "tiktok", id: tte[1] };
  const ttm = s.match(/m\.tiktok\.com\/v\/(\d{6,})/i);
  if (ttm) return { provider: "tiktok", id: ttm[1] };
  return null;
}

function parseJsonFeed(text) {
  const j = JSON.parse(text);
  if (!j || typeof j !== "object") throw new Error("parseFeed: JSON Feed not an object");
  if (!Array.isArray(j.items)) throw new Error("parseFeed: JSON Feed missing items[]");
  const feedTitle = j.title || "";
  const entries = j.items.map(it => {
    const att = Array.isArray(it.attachments) && it.attachments[0];
    return normaliseEntry({
      id:        it.id || it.url,
      source:    feedTitle,
      title:     it.title || "",
      link:      it.url || it.external_url || "",
      published: tsOrZero(it.date_published),
      summary:   it.summary || "",
      content:   it.content_html || it.content_text || "",
      image:     it.image || it.banner_image || "",
      enclosure: att ? { url: att.url || "", type: att.mime_type || "", length: att.size_in_bytes ? String(att.size_in_bytes) : "" } : null,
    }, feedTitle);
  });
  return { format: "jsonfeed", feedTitle, entries };
}

function parseAtom(text) {
  const feed = extractElement(text, "feed");
  if (!feed) throw new Error("parseFeed: no <feed> root found");
  const feedTitle = stripTags(textOf(feed, "title") || "");
  const entries = [];
  for (const block of allBlocks(feed, "entry")) {
    const link = atomLink(block);
    entries.push(normaliseEntry({
      id:        textOf(block, "id") || link,
      source:    feedTitle,
      title:     textOf(block, "title") || "",
      link,
      published: tsOrZero(textOf(block, "published") || textOf(block, "updated")),
      summary:   textOf(block, "summary") || "",
      content:   textOf(block, "content") || "",
      image:     mediaThumb(block),
      enclosure: atomEnclosure(block),
    }, feedTitle));
  }
  return { format: "atom", feedTitle, entries };
}

function atomLink(block) {
  const all = [...block.matchAll(/<link\b([^>]*?)\/?>/gi)];
  if (!all.length) return "";
  for (const m of all) {
    const a = parseAttrs(m[1]);
    if (!a.rel || a.rel === "alternate") return a.href || "";
  }
  return parseAttrs(all[0][1]).href || "";
}

function parseRss2(text) {
  const channel = extractElement(text, "channel");
  if (!channel) throw new Error("parseFeed: no <channel> found");
  const feedTitle = stripTags(textOf(channel, "title") || "");
  const entries = [];
  for (const block of allBlocks(channel, "item")) {
    entries.push(normaliseEntry({
      id:        textOf(block, "guid") || textOf(block, "link"),
      source:    feedTitle,
      title:     textOf(block, "title") || "",
      link:      textOf(block, "link") || "",
      published: tsOrZero(textOf(block, "pubDate") || textOf(block, "dc:date")),
      summary:   textOf(block, "description") || "",
      content:   textOf(block, "content:encoded") || textOf(block, "description") || "",
      image:     mediaThumb(block),
      enclosure: rssEnclosure(block),
    }, feedTitle));
  }
  return { format: "rss2", feedTitle, entries };
}

function sniffRoot(text) {
  const m = text.match(/<\?xml[^?]*\?>\s*|^\s*/);
  const after = text.slice((m && m[0].length) || 0);
  const root = after.match(/<([a-zA-Z][\w:-]*)\b/);
  return root ? root[1].toLowerCase() : "";
}

function extractElement(text, name) {
  const re = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*)</${name}>`, "i");
  const m = text.match(re);
  return m ? m[1] : null;
}

function allBlocks(text, name) {
  const re = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "gi");
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  return out;
}

function textOf(block, name) {
  const safeName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`<${safeName}\\b[^>]*>([\\s\\S]*?)</${safeName}>`, "i");
  const m = block.match(re);
  if (!m) return "";
  return unwrapCdata(decodeEntities(m[1])).trim();
}

function parseAttrs(s) {
  const out = {};
  const re = /([a-zA-Z][\w:-]*)\s*=\s*"([^"]*)"|([a-zA-Z][\w:-]*)\s*=\s*'([^']*)'/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    out[(m[1] || m[3]).toLowerCase()] = m[2] != null ? m[2] : m[4];
  }
  return out;
}

function unwrapCdata(s) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function decodeEntities(s) {
  return s
    .replace(/&lt;/g,  "<")
    .replace(/&gt;/g,  ">")
    .replace(/&quot;/g,'"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g,"'")
    .replace(/&amp;/g, "&");
}

function stripTags(s) {
  return s.replace(/<[^>]*>/g, "").replace(NL, " ");
}

function paragraphs(html) {
  if (!html) return [];
  const stripped = unwrapCdata(decodeEntities(html));
  const chunks = stripped.split(/<\/p\s*>|\n\s*\n/i);
  return chunks
    .map(c => stripTags(c).replace(NL, " ").trim())
    .filter(Boolean);
}

function tsOrZero(s) {
  if (!s) return 0;
  if (typeof s === "number") return s;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

function formatAge(ts) {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d === 1) return "yesterday";
  if (d < 14) return `${d}d`;
  return new Date(ts).toISOString().slice(0, 10);
}

function cryptoIshHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return "a" + (h >>> 0).toString(36);
}
