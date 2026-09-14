// feed-engine.js
//
// Browser-side feed pull. Reads the user's subscription list from the active
// adapter, fetches each feed via the same-origin /fetch CORS proxy (Pages
// Function in functions/fetch.js, identical handler to the Worker), parses
// with the shared parser in worker/src/parse.js, dedupes by entry id, and
// returns a sorted entries array shaped like the Worker's R2 snapshot.
//
// Why this module exists:
//   The §4 Worker writes coda/feeds/snapshot.json to R2. Users on the default
//   LocalAdapter (or WebDAV / Dropbox / GitHub / Telegram) have no Worker
//   writing for them, so imported OPML feeds previously sat in
//   coda/subs/subscriptions.json with nothing on the read side. This module
//   closes that loop using the same /fetch proxy the §4 Worker already
//   exposes, so OPML imports produce visible entries on every adapter.
//
// Inputs:
//   adapter      \u2014 active storage adapter (must expose async read(key))
//   fetchBase    \u2014 prefix for the proxy URL; "" means same-origin
//   signal       \u2014 optional AbortSignal from the caller (page-level abort)
//   timeoutMs    \u2014 per-feed fetch timeout (default 15 s, matches fetchFeed)
//   concurrency  \u2014 how many feeds to fetch in parallel (default 4)
//
// Output:
//   Array of normalised entries (same shape as worker/src/parse.js produces)
//   with a `shelf` field copied from the subscription. Empty / null on no
//   subs or hard failure \u2014 caller should fall back to SAMPLE.
//
// Quality filter:
//   The Worker drops feeds whose §1 quality score is below 0.5 because it
//   polls thousands of feeds from env.FEEDS. A browser engine fetching the
//   user's own OPML choices has no business second-guessing them, so this
//   module does NOT call passesQuality \u2014 every parseable feed contributes.

import { parseFeed, isBridgeErrorEntry } from "../worker/src/parse.js";
import { feedRequestUrl } from "./feed-fetch.js";

const SUBS_KEY = "coda/subs/subscriptions.json";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_CONCURRENCY = 4;

export async function loadFeedFromBrowserEngine({
  adapter,
  fetchBase = "",
  signal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  concurrency = DEFAULT_CONCURRENCY,
  onReport = () => {},
} = {}) {
  if (!adapter || typeof adapter.read !== "function") return null;

  let subsRaw;
  try {
    subsRaw = await adapter.read(SUBS_KEY);
  } catch (e) {
    onReport({ error: "Could not read subscriptions from storage. Check Settings." });
    console.warn("feed-engine: subscriptions read failed", e);
    return null;
  }
  if (!subsRaw) { onReport({}); return null; }

  let subs;
  try { subs = JSON.parse(subsRaw); } catch { onReport({ error: "Could not parse subscriptions. Reimport a valid OPML file." }); return null; }
  const feeds = Array.isArray(subs?.feeds)
    ? subs.feeds.filter(f => f && typeof f.url === "string" && f.url)
    : [];
  if (!feeds.length) { onReport({}); return null; }
  let failed = 0;
  const failures = [];

  const results = await runWithLimit(feeds, concurrency, async (sub) => {
    try {
      return await fetchAndParseOne(sub, { fetchBase, signal, timeoutMs });
    } catch (e) {
      failed++;
      failures.push({ message: e.message || "Feed request failed", code: e.code || "feed_failed" });
      console.warn(`feed-engine: ${sub.url} failed`, e);
      return [];
    }
  });

  // Dedupe across feeds by entry id; newest published wins on collision.
  const byId = new Map();
  for (const arr of results) {
    for (const e of arr) {
      const existing = byId.get(e.id);
      if (!existing || (e.published || 0) > (existing.published || 0)) {
        byId.set(e.id, e);
      }
    }
  }
  onReport({ total: feeds.length, failed, entries: byId.size, failures });
  return [...byId.values()].sort((a, b) => (b.published || 0) - (a.published || 0));
}

async function fetchAndParseOne(sub, { fetchBase, signal, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  try {
    const url = feedRequestUrl(sub.url, fetchBase);
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      if ((res.headers.get("content-type") || "").includes("application/json")) {
        const details = await res.json().catch(() => ({}));
        if (details.code === "google_news_blocked") throw Object.assign(new Error("Google News is blocking automated requests from this server. Open Google News directly or retry later."), { code: details.code });
      }
      throw new Error(`Feed request failed: HTTP ${res.status}`);
    }
    const ct = res.headers.get("content-type") || "";
    const text = await res.text();
    const parsed = parseFeed(text, ct);
    if (!parsed || !Array.isArray(parsed.entries)) return [];
    const shelf = sub.shelf || "all";
    return parsed.entries
      .filter(e => !isBridgeErrorEntry(e))
      .map(e => ({ ...e, shelf }));
  } finally {
    clearTimeout(timer);
  }
}

async function runWithLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const cap = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: cap }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}
