// gma.js
//
// GMA Network lifestyle sections (/lifestyle/<section>) are a client-rendered
// SPA: the raw HTML ships only chrome, and the article list is injected from a
// JSON listing API on data.igma.tv (observed live in the page's network
// traffic). When /discover or /scrape is pointed at one of those section URLs
// we fetch that API directly, which returns titles, article links, lead text,
// thumbnails, and publish dates with real pagination, so no headless renderer
// (and no Browser Rendering token) is needed for this publisher.
//
// Pure helpers; index.js owns the network call via proxyFetch and the gate.
//   gmaListingApi(pageUrl, page) -> the data.igma.tv listing URL, or "".
//   gmaListingItems(jsonText, opts) -> [{ title, link, published, image, excerpt }]
//     in the exact shape scrape.js#buildAtom consumes.

const LISTING_HOST = "data.igma.tv";
const IMG_BASE = "https://aphrodite.gmanetwork.com/entertainment/articles/900_675_";
const SITE = "https://www.gmanetwork.com/";

export function gmaListingApi(pageUrl, page = 1) {
  let u;
  try { u = new URL(pageUrl); } catch { return ""; }
  if (!/(^|\.)gmanetwork\.com$/i.test(u.hostname)) return "";
  const segs = u.pathname.split("/").filter(Boolean);
  if (segs.length < 2 || segs[0].toLowerCase() !== "lifestyle") return "";
  const section = segs[1].toLowerCase();
  if (!/^[a-z0-9-]+$/.test(section)) return "";
  const p = Number(page) > 0 ? Math.floor(Number(page)) : 1;
  return `https://${LISTING_HOST}/entertainment/lifestyle/listing/${section}/${p}.gz`;
}

export function gmaListingItems(jsonText, opts = {}) {
  let j;
  try { j = JSON.parse(jsonText); } catch { return []; }
  const rows = Array.isArray(j && j.data) ? j.data : [];
  const limit = Number(opts.limit) > 0 ? Number(opts.limit) : 50;
  const out = [];
  const seen = new Set();
  for (const r of rows) {
    if (!r || String(r.status) === "0") continue;
    const path = r.override_url || r.url;
    if (!path) continue;
    let link;
    try { link = new URL(path, SITE).toString(); } catch { continue; }
    if (seen.has(link)) continue;
    const title = String(r.title || "").trim();
    if (!title) continue;
    seen.add(link);
    const photoName = r.photo && r.photo.url ? String(r.photo.url).trim() : "";
    out.push({
      title,
      link,
      published: parseStamp(r.publish_timestamp || r.date_published),
      image: photoName ? IMG_BASE + photoName : "",
      excerpt: String(r.lead || "").trim(),
    });
    if (out.length >= limit) break;
  }
  return out;
}

function parseStamp(s) {
  if (!s) return 0;
  const t = Date.parse(String(s).trim().replace(" ", "T") + "+08:00");
  return Number.isFinite(t) ? t : 0;
}
