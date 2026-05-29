// inoreader-import.js
//
// Import starred items from an Inoreader export (Google Reader JSON shape)
// into the active adapter's event log as `item.star` events.
//
// Two file shapes are accepted:
//   1. Canonical Inoreader / Google-Reader export:
//        { items: [ { id, title, canonical:[{href}], alternate:[{href}],
//                     categories:[...], timestampUsec | crawlTimeMsec |
//                     published | updated }, ... ] }
//   2. A bare JSON array of those item objects (some third-party exporters
//      strip the wrapping object).
//
// One event per item:
//   { t: "item.star", itemId: <article URL>, on: true, at: <ms> }
//
// Why itemId === canonical URL?
//   worker/src/parse.js keys snapshot entries by `raw.id || raw.link` and the
//   majority of modern Atom / RSS feeds use the article URL as their <id>.
//   Items whose feed uses an opaque GUID (tag:blogger.com,1999:post-...) will
//   still bind on URL match. For URLs the user has no feed for, we attach
//   the parsed title and link to the `item.star` event so app.js can
//   surface an orphan row in the Starred shelf without a snapshot entry.
//
// Exports:
//   parseInoreaderStars(text)  -> { stars: [{itemId, title, at}], skipped }
//   StarsImport                -> Settings-page controller class

const STARRED_STATE_SUFFIX = "/state/com.google/starred";

export function parseInoreaderStars(text) {
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("parseInoreaderStars: empty input");
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error("parseInoreaderStars: not JSON");
  }
  const items = Array.isArray(data)
    ? data
    : Array.isArray(data && data.items)
    ? data.items
    : null;
  if (!items) {
    throw new Error("parseInoreaderStars: no items[] array");
  }

  const stars = [];
  const seen = new Set();
  let skipped = 0;

  for (const it of items) {
    if (!it || typeof it !== "object") { skipped++; continue; }

    // When categories[] is present, honour it: only keep entries that carry
    // the starred state. A user pasting a mixed export (read + starred in one
    // file) should not have unstarred items pulled in.
    if (Array.isArray(it.categories) && it.categories.length) {
      const isStarred = it.categories.some(
        c => typeof c === "string" && c.endsWith(STARRED_STATE_SUFFIX)
      );
      if (!isStarred) { skipped++; continue; }
    }

    const url = extractUrl(it);
    if (!url) { skipped++; continue; }
    if (seen.has(url)) { skipped++; continue; }
    seen.add(url);

    stars.push({
      itemId: url,
      title: typeof it.title === "string" ? it.title : "",
      at: extractTimestamp(it),
    });
  }

  return { stars, skipped };
}

function extractUrl(item) {
  const can = firstHref(item.canonical);
  if (can) return can;
  const alt = firstHref(item.alternate);
  if (alt) return alt;
  if (typeof item.url === "string" && item.url) return item.url;
  if (typeof item.link === "string" && item.link) return item.link;
  return null;
}

function firstHref(arr) {
  if (!Array.isArray(arr)) return null;
  for (const x of arr) {
    if (x && typeof x.href === "string" && x.href) return x.href;
  }
  return null;
}

function extractTimestamp(item) {
  // Google Reader convention: timestampUsec is microseconds.
  const us = numericOrNull(item.timestampUsec);
  if (us !== null) return Math.floor(us / 1000);

  // Inoreader also writes crawlTimeMsec (milliseconds, often as a string).
  const ms = numericOrNull(item.crawlTimeMsec);
  if (ms !== null) return Math.floor(ms);

  // Fall back to published / updated (seconds).
  if (typeof item.published === "number" && item.published > 0) {
    return Math.floor(item.published * 1000);
  }
  if (typeof item.updated === "number" && item.updated > 0) {
    return Math.floor(item.updated * 1000);
  }
  return Date.now();
}

function numericOrNull(v) {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ─── Controller ───────────────────────────────────────────────────────────

export class StarsImport {
  /**
   * @param {object} opts
   * @param {HTMLInputElement} opts.fileInput
   * @param {HTMLElement}      opts.statusEl
   * @param {object}           opts.store  — must expose isStarred(id) + bulkAppend(events)
   */
  constructor({ fileInput, statusEl, store, onAfter }) {
    this.fileInput = fileInput;
    this.statusEl  = statusEl;
    this.store     = store;
    this.onAfter   = typeof onAfter === "function" ? onAfter : null;
    if (fileInput) fileInput.addEventListener("change", () => this.#onPick());
  }

  async #onPick() {
    const file = this.fileInput.files && this.fileInput.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      await this.handleInoreaderText(text, file.name);
    } finally {
      this.fileInput.value = "";
    }
  }

  /**
   * Public: ingest Inoreader-export text directly. Used by the unified
   * import zone after the format sniffer identifies the payload.
   */
  async handleInoreaderText(text, fileName = "pasted JSON") {
    this.#setStatus(`Reading ${fileName}\u2026`, "pending");
    try {
      const { stars, skipped } = parseInoreaderStars(text);
      if (!stars.length) {
        this.#setStatus(`No starred items found in ${fileName}.`, "fail");
        return;
      }
      const fresh = stars.filter(s => !this.store.isStarred(s.itemId));
      const dupes = stars.length - fresh.length;
      if (!fresh.length) {
        this.#setStatus(
          `All ${stars.length} item(s) already starred \u2014 nothing to import.`,
          "ok"
        );
        return;
      }
      const events = fresh.map(s => ({
        t: "item.star",
        itemId: s.itemId,
        on: true,
        at: s.at,
        title: s.title || "",
        link: s.itemId,
      }));
      await this.store.bulkAppend(events);
      if (this.onAfter) {
        try { this.onAfter({ added: fresh.length }); }
        catch (e) { console.warn("StarsImport.onAfter threw", e); }
      }
      const parts = [`Imported ${fresh.length} star(s) from ${fileName}.`];
      if (dupes)   parts.push(`${dupes} already starred \u2014 skipped.`);
      if (skipped) parts.push(`${skipped} entr${skipped === 1 ? "y" : "ies"} skipped (no URL or wrong state).`);
      this.#setStatus(parts.join(" "), "ok");
    } catch (e) {
      this.#setStatus(`Import failed: ${e.message || e}`, "fail");
    }
  }

  #setStatus(msg, status = "pending") {
    if (!this.statusEl) return;
    this.statusEl.textContent = msg;
    this.statusEl.dataset.status = status;
  }
}
