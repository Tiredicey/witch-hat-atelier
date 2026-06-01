// index.js
//
// Cloudflare Worker entry. Two surfaces:
//   1. scheduled() — cron-triggered (every 30 min by default). Iterates the
//      FEEDS env var (JSON array of {id, url}), fetches each politely,
//      parses, scores, and writes the consolidated entries snapshot to R2.
//   2. fetch() — HTTP handler. Two routes:
//        GET /healthz       → "ok"
//        POST /parse        → { url, etag? } body; returns the parsed feed
//                              without persisting. Useful for the future
//                              /discover flow and for manual debugging.
//
// R2 layout (under the user's bucket, prefix `coda/feeds/`):
//   coda/feeds/snapshot.json   ← all entries from all subscribed feeds,
//                                merged + sorted desc by `published`.
//   coda/feeds/meta.json       ← per-feed { etag, lastModified, lastCheck,
//                                  lastError, score } — keeps conditional
//                                  fetch state across runs.
//
// No user-identifying data is written. The Worker has no notion of who its
// requests serve — it just fetches the URL list it was configured with.
//
// Bindings (see wrangler.toml):
//   env.R2     — R2Bucket binding to the user's storage bucket
//   env.FEEDS  — JSON string: [{ id: string, url: string, shelf?: string }]
//   env.UA     — optional User-Agent override
//   env.PREFIX — optional R2 key prefix (default "coda/feeds")

import { fetchFeed } from "./fetch-feed.js";
import { parseFeed } from "./parse.js";
import { scoreFeed, passesQuality } from "./quality.js";
import { allowProxy, proxyFetch, DEFAULT_MAX_BYTES } from "./proxy.js";
import { extractArticle, extractOgImage } from "./extract.js";
import { extractFeedLinks, commonFeedPaths, looksLikeFeed, classifyByBody } from "./discover.js";
import { scrapeFeedItems, buildAtom } from "./scrape.js";
import { handleFbLogin, handleFbCallback, handleFbFeed } from "./fbconnect.js";
import { gmaListingApi, gmaListingItems } from "./gma.js";
import { renderHtml, rendererConfigured } from "./render.js";
import { handleDmz } from "./dmz.js";

const DEFAULT_PREFIX = "coda/feeds";

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runPoll(env));
  },

  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/healthz") {
      return new Response("ok", { headers: corsHeaders() });
    }
    if (url.pathname.startsWith("/dmz/")) {
      try {
        const r = await handleDmz(req, url, env);
        if (r) return r;
      } catch (e) {
        return jsonResp({ ok: false, error: "dmz_error", detail: String((e && e.message) || e) }, 500);
      }
    }
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (req.method === "GET" && url.pathname === "/fetch") {
      return handleProxy(req, url, env);
    }
    if (req.method === "GET" && url.pathname === "/discover") {
      return handleDiscover(req, url, env);
    }
    if (req.method === "GET" && url.pathname === "/scrape") {
      return handleScrape(req, url, env);
    }
    if (req.method === "GET" && url.pathname === "/extract") {
      return handleExtract(req, url, env);
    }
    if (req.method === "GET" && url.pathname === "/ogimage") {
      return handleOgImage(req, url, env);
    }
    if (req.method === "GET" && url.pathname === "/fb/login") {
      return handleFbLogin(req, url, env);
    }
    if (req.method === "GET" && url.pathname === "/fb/callback") {
      return handleFbCallback(req, url, env);
    }
    if (req.method === "GET" && url.pathname === "/fb/feed") {
      return handleFbFeed(req, url, env);
    }
    if (req.method === "POST" && url.pathname === "/parse") {
      const { url: feedUrl, etag, lastModified } = await safeJson(req);
      if (!feedUrl) return jsonError(400, "missing url");
      const fetched = await fetchFeed(feedUrl, { etag, lastModified, ua: env.UA });
      if (fetched.status === 304) return jsonResp({ status: 304 });
      if (fetched.status !== 200)  return jsonResp({ status: fetched.status, error: fetched.error });
      try {
        const parsed = parseFeed(fetched.body, fetched.contentType);
        const scored = scoreFeed(parsed);
        return jsonResp({ status: 200, parsed, scored });
      } catch (e) {
        return jsonError(422, e.message || "parse failed");
      }
    }
    return jsonError(404, "not found");
  },
};

async function runPoll(env) {
  if (!env.R2) {
    console.warn("CODA Worker: no R2 binding; nothing persisted");
  }
  const prefix = (env.PREFIX || DEFAULT_PREFIX).replace(/\/+$/, "");
  const metaKey = `${prefix}/meta.json`;
  const snapKey = `${prefix}/snapshot.json`;

  // Subscriptions precedence: prefer the browser-managed list at
  // `coda/subs/subscriptions.json` (written by the Settings → Import OPML
  // flow). If absent, fall back to the static env.FEEDS in wrangler.toml.
  let feeds = await readSubscriptions(env.R2);
  if (!feeds.length) feeds = parseFeedList(env.FEEDS);
  if (!feeds.length) {
    console.warn("CODA Worker: no subscriptions in R2 and env.FEEDS empty; nothing to poll");
    return;
  }

  const meta = (await readJson(env.R2, metaKey)) || {};
  const allEntries = [];
  const newMeta = {};

  for (const { id, url, shelf } of feeds) {
    const prev = meta[id] || {};
    const result = await pollOne({ id, url, shelf, prev, ua: env.UA });
    newMeta[id] = result.meta;
    for (const e of result.entries) allEntries.push({ ...e, shelf: shelf || "all" });
  }

  // Dedupe across feeds by id, sort by published desc.
  const byId = new Map();
  for (const e of allEntries) {
    const existing = byId.get(e.id);
    if (!existing || (e.published || 0) > (existing.published || 0)) byId.set(e.id, e);
  }
  const sorted = [...byId.values()].sort((a, b) => (b.published || 0) - (a.published || 0));

  const snapshot = { generated: Date.now(), entries: sorted };
  if (env.R2) {
    await env.R2.put(snapKey, JSON.stringify(snapshot), {
      httpMetadata: { contentType: "application/json" },
    });
    await env.R2.put(metaKey, JSON.stringify(newMeta), {
      httpMetadata: { contentType: "application/json" },
    });
  }
  console.log(`CODA Worker: ${feeds.length} feed(s) polled, ${sorted.length} entries written`);
}

async function pollOne({ id, url, prev, ua }) {
  const fetched = await fetchFeed(url, {
    etag: prev.etag,
    lastModified: prev.lastModified,
    ua,
  });
  const now = Date.now();
  if (fetched.status === 304) {
    return {
      entries: prev.entries || [],
      meta: { ...prev, lastCheck: now, lastError: null },
    };
  }
  if (fetched.status !== 200) {
    return {
      entries: prev.entries || [],
      meta: { ...prev, lastCheck: now, lastError: fetched.error || `status ${fetched.status}` },
    };
  }
  try {
    const parsed = parseFeed(fetched.body, fetched.contentType);
    const scored = scoreFeed(parsed);
    const entries = passesQuality(scored) ? parsed.entries : [];
    return {
      entries,
      meta: {
        etag: fetched.etag || "",
        lastModified: fetched.lastModified || "",
        lastCheck: now,
        lastError: null,
        score: scored.score,
        feedTitle: parsed.feedTitle,
        // Cache the last-good entries so a future 304 still produces output.
        entries,
      },
    };
  } catch (e) {
    return {
      entries: prev.entries || [],
      meta: { ...prev, lastCheck: now, lastError: e.message || "parse failed" },
    };
  }
}

async function readSubscriptions(r2) {
  if (!r2) return [];
  const obj = await r2.get("coda/subs/subscriptions.json");
  if (!obj) return [];
  try {
    const j = await obj.json();
    if (!j || !Array.isArray(j.feeds)) return [];
    return j.feeds.filter(x => x && typeof x.url === "string" && typeof x.id === "string");
  } catch {
    return [];
  }
}

function parseFeedList(raw) {
  if (!raw) return [];
  try {
    const list = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(list)) return [];
    return list.filter(x => x && typeof x.url === "string" && typeof x.id === "string");
  } catch {
    return [];
  }
}

async function readJson(r2, key) {
  if (!r2) return null;
  const obj = await r2.get(key);
  if (!obj) return null;
  try { return await obj.json(); } catch { return null; }
}

async function safeJson(req) {
  try { return await req.json(); } catch { return {}; }
}

async function handleProxy(req, url, env) {
  const target = url.searchParams.get("url");
  if (!target) return jsonError(400, "missing url");
  const gate = allowProxy(target, env.PROXY_ALLOW);
  if (!gate.ok) return jsonError(403, gate.reason);
  const maxBytes = Number(env.MAX_BYTES) || DEFAULT_MAX_BYTES;
  const session = readSession(req);
  const fetched = await proxyFetch(target, {
    etag:         req.headers.get("if-none-match") || undefined,
    lastModified: req.headers.get("if-modified-since") || undefined,
    ua:           session.ua || env.UA,
    maxBytes,
    cookie:       session.cookie,
  });
  if (fetched.status === 304) {
    const h = { ...corsHeaders() };
    if (fetched.etag)         h["ETag"]          = fetched.etag;
    if (fetched.lastModified) h["Last-Modified"] = fetched.lastModified;
    return new Response(null, { status: 304, headers: h });
  }
  if (fetched.status === 0) {
    return jsonError(502, fetched.error || "upstream fetch failed");
  }
  const headers = {
    ...corsHeaders(),
    "Content-Type":  fetched.contentType || "application/octet-stream",
    "Cache-Control": "no-store",
  };
  if (fetched.etag)         headers["ETag"]          = fetched.etag;
  if (fetched.lastModified) headers["Last-Modified"] = fetched.lastModified;
  return new Response(fetched.body, { status: fetched.status, headers });
}

async function handleExtract(req, url, env) {
  const target = url.searchParams.get("url");
  if (!target) return jsonError(400, "missing url");
  const gate = allowProxy(target, env.PROXY_ALLOW);
  if (!gate.ok) return jsonError(403, gate.reason);
  const fetched = await proxyFetch(target, {
    ua: env.UA,
    maxBytes: Number(env.PROXY_MAX_BYTES || DEFAULT_MAX_BYTES),
  });
  if (fetched.status === 0 || !fetched.body) {
    return jsonError(502, fetched.error || "upstream fetch failed");
  }
  const ct = (fetched.contentType || "").toLowerCase();
  if (!ct.includes("html") && !ct.includes("xml")) {
    return jsonError(415, `unsupported content-type: ${fetched.contentType || "unknown"}`);
  }
  const raw = new TextDecoder("utf-8").decode(fetched.body);
  const cleaned = extractArticle(raw, target);
  return new Response(cleaned, {
    status: 200,
    headers: {
      ...corsHeaders(),
      "Content-Type":         "text/html; charset=utf-8",
      "Cache-Control":        "no-store",
      "Content-Security-Policy": "default-src 'none'; img-src * data:; style-src 'unsafe-inline' *; font-src * data:; base-uri 'self'",
      "X-CODA-Extract":       "scripts-stripped; print-promoted",
    },
  });
}

function readSession(req) {
  const cookie = req.headers.get("x-wha-cookie") || "";
  const ua = req.headers.get("x-wha-ua") || "";
  return { cookie, ua };
}

async function handleOgImage(req, url, env) {
  const target = url.searchParams.get("url");
  if (!target) return jsonError(400, "missing url");
  const gate = allowProxy(target, env.PROXY_ALLOW);
  if (!gate.ok) return jsonError(403, gate.reason);
  const fetched = await proxyFetch(target, { ua: env.UA, maxBytes: 300000 });
  if (fetched.status === 0 || !fetched.body) return jsonResp({ image: "" });
  const ct = (fetched.contentType || "").toLowerCase();
  if (!ct.includes("html") && !ct.includes("xml")) return jsonResp({ image: "" });
  const raw = new TextDecoder("utf-8").decode(fetched.body);
  return jsonResp({ image: extractOgImage(raw) });
}

async function handleDiscover(req, url, env) {
  const target = url.searchParams.get("url");
  if (!target) return jsonError(400, "missing url");
  const gate = allowProxy(target, env.PROXY_ALLOW);
  if (!gate.ok) return jsonResp({ candidates: [], probed: false, gateBlocked: true, gateReason: gate.reason }, 200);
  const maxBytes = Number(env.MAX_BYTES) || DEFAULT_MAX_BYTES;
  const session = readSession(req);
  const page = await proxyFetch(target, { ua: session.ua || env.UA, maxBytes, cookie: session.cookie });
  const ok = page.status > 0 && page.status < 400;
  if (ok && looksLikeFeed(page.body, page.contentType)) {
    return jsonResp({
      candidates: [{ url: target, type: classifyByBody(page.body, page.contentType), title: "" }],
      probed: false,
      direct: true,
    });
  }
  let html = ok ? decodeText(page.body) : "";
  let pageRendered = false;
  const blocked = !ok;
  if ((blocked || !html.trim()) && rendererConfigured(env)) {
    const r = await renderHtml(target, env);
    if (r.ok && r.html) { html = r.html; pageRendered = true; }
  }
  if (html.trim()) {
    const fromHtml = extractFeedLinks(html, target);
    if (fromHtml.length) return jsonResp({ candidates: fromHtml, probed: false, pageRendered });
  }
  const found = [];
  const probes = commonFeedPaths(target).slice(0, 12);
  const seen = new Set();
  for (const p of probes) {
    const gate2 = allowProxy(p, env.PROXY_ALLOW);
    if (!gate2.ok) continue;
    const r = await proxyFetch(p, { ua: env.UA, maxBytes: 200_000 });
    if (r.status !== 200) continue;
    if (!looksLikeFeed(r.body, r.contentType)) continue;
    if (seen.has(p)) continue;
    seen.add(p);
    found.push({ url: p, type: classifyByBody(r.body, r.contentType), title: "" });
    if (found.length >= 5) break;
  }
  if (found.length) return jsonResp({ candidates: found, probed: true });
  const structured = await fetchStructuredItems(target, env);
  if (structured.length) {
    return jsonResp({
      candidates: [{
        url: `${url.origin}/scrape?url=${encodeURIComponent(target)}`,
        type: "atom",
        title: `${hostOf(target)} (synthesized)`,
        synthetic: true,
        rendered: false,
        structured: true,
        itemCount: structured.length,
        confidence: "high",
        preview: structured.slice(0, 5).map((it) => it.title),
      }],
      probed: true,
      synthetic: true,
    });
  }
  let scraped = { items: [], confidence: "none" };
  let rendered = pageRendered;
  if (html.trim()) scraped = scrapeFeedItems(html, target);
  if (!scraped.items.length && !pageRendered && rendererConfigured(env)) {
    const r = await renderHtml(target, env);
    if (r.ok && r.html) {
      const viaRender = scrapeFeedItems(r.html, target);
      if (viaRender.items.length) { scraped = viaRender; rendered = true; }
    }
  }
  if (scraped.items.length) {
    return jsonResp({
      candidates: [{
        url: `${url.origin}/scrape?url=${encodeURIComponent(target)}`,
        type: "atom",
        title: `${hostOf(target)} (synthesized)`,
        synthetic: true,
        rendered,
        itemCount: scraped.items.length,
        confidence: scraped.confidence,
        preview: scraped.items.slice(0, 5).map((it) => it.title),
      }],
      probed: true,
      synthetic: true,
    });
  }
  if (!html.trim()) {
    if (page.status === 0) return jsonResp({ candidates: [], probed: true, upstreamError: page.error || "upstream fetch failed" }, 200);
    return jsonResp({ candidates: [], probed: true, sourceStatus: page.status });
  }
  return jsonResp({ candidates: found, probed: true, pageRendered });
}

async function handleScrape(req, url, env) {
  const target = url.searchParams.get("url");
  if (!target) return jsonError(400, "missing url");
  const gate = allowProxy(target, env.PROXY_ALLOW);
  if (!gate.ok) return jsonError(403, `proxy ${gate.reason}`);
  const session = readSession(req);
  const structured = await fetchStructuredItems(target, env, { page: url.searchParams.get("page"), pages: url.searchParams.get("pages") });
  if (structured.length) {
    const selfUrl = `${url.origin}${url.pathname}${url.search}`;
    const atom = buildAtom(structured, { pageUrl: target, selfUrl, title: hostOf(target) });
    return new Response(atom, {
      status: 200,
      headers: { "Content-Type": "application/atom+xml; charset=utf-8", ...corsHeaders() },
    });
  }
  const maxBytes = Number(env.MAX_BYTES) || DEFAULT_MAX_BYTES;
  const page = await proxyFetch(target, { ua: session.ua || env.UA, maxBytes, cookie: session.cookie });
  const ok = page.status > 0 && page.status < 400;
  const html = ok ? decodeText(page.body) : "";
  const selector = url.searchParams.get("sel") || url.searchParams.get("selector") || "";
  const limit = Number(url.searchParams.get("limit")) || undefined;
  let items = html ? scrapeFeedItems(html, target, { selector, limit }).items : [];
  if (!items.length && rendererConfigured(env)) {
    const r = await renderHtml(target, env, { waitForSelector: url.searchParams.get("wait") || "" });
    if (r.ok && r.html) {
      const viaRender = scrapeFeedItems(r.html, target, { selector, limit });
      if (viaRender.items.length) items = viaRender.items;
    }
  }
  if (!items.length) {
    if (page.status === 0)  return jsonError(502, page.error || "upstream fetch failed");
    if (page.status >= 400) return jsonError(page.status, `upstream ${page.status}`);
  }
  const selfUrl = `${url.origin}${url.pathname}${url.search}`;
  const atom = buildAtom(items, { pageUrl: target, selfUrl, title: hostOf(target) });
  return new Response(atom, {
    status: 200,
    headers: { "Content-Type": "application/atom+xml; charset=utf-8", ...corsHeaders() },
  });
}

async function fetchStructuredItems(target, env, opts = {}) {
  if (!gmaListingApi(target, 1)) return [];
  const hardMax = Math.min(Math.max(Number(env.GMA_MAX_PAGES) || 5, 1), 20);
  const startPage = Number(opts.page) > 0 ? Math.floor(Number(opts.page)) : 1;
  const want = Math.min(Math.max(Number(opts.pages) || 1, 1), hardMax);
  const perPage = Number(env.SCRAPE_LIMIT) || 50;
  const out = [];
  const seen = new Set();
  for (let i = 0; i < want; i++) {
    const api = gmaListingApi(target, startPage + i);
    if (!api) break;
    const gate = allowProxy(api, env.PROXY_ALLOW);
    if (!gate.ok) break;
    const r = await proxyFetch(api, { ua: env.UA, maxBytes: 2_000_000 });
    if (r.status !== 200) break;
    const items = gmaListingItems(decodeText(r.body), { limit: perPage });
    if (!items.length) break;
    let added = 0;
    for (const it of items) {
      if (seen.has(it.link)) continue;
      seen.add(it.link);
      out.push(it);
      added++;
    }
    if (added === 0) break;
  }
  return out;
}

function hostOf(u) {
  try { return new URL(u).host; } catch { return "feed"; }
}

function decodeText(buf) {
  if (!buf) return "";
  try {
    const view = buf.byteLength !== undefined ? buf : new Uint8Array(buf);
    return new TextDecoder("utf-8", { fatal: false }).decode(view);
  } catch {
    return "";
  }
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function jsonResp(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

function jsonError(status, message) {
  return jsonResp({ error: message }, status);
}
