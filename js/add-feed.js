// add-feed.js
//
// Paste-a-link → resolved feed → appended to subscriptions, in three
// states wired to a single Settings panel:
//
//   idle      → user types, clicks Resolve
//   resolving → either a deterministic resolver match (instant) or a
//               Worker /discover call (network)
//   candidates → render every candidate; user picks one; we optionally
//                Verify it via /fetch + parseFeed before commit
//   refused    → platform has no public RSS; render the honest message
//                and the bridge hint
//
// The controller does not own subscription state; it calls
// `subscriptions.appendFeed(feed)` so the same write path that OPML
// import uses also covers add-by-URL. Single source of truth.
//
// fetchBase defaults to "" so /discover and /fetch hit the same origin
// the page was served from. The Pages Function in functions/discover.js
// re-exports the Worker so both routes work on a plain Pages deploy.

import { resolve as resolveUrl } from "./url-resolver.js";
import { parseFeed } from "../worker/src/parse.js";
import { parseOpml } from "./opml.js";

const BRIDGE_KEY = "coda/bridge/base";

export class AddFeed {
  constructor(opts) {
    this.inputEl       = opts.inputEl;
    this.resolveBtn    = opts.resolveBtn;
    this.shelfInput    = opts.shelfInput;
    this.statusEl      = opts.statusEl;
    this.candidatesEl  = opts.candidatesEl;
    this.refusedEl     = opts.refusedEl;
    this.bridgeInput   = opts.bridgeInput;
    this.bridgeSaveBtn = opts.bridgeSaveBtn;
    this.bridgeClearBtn = opts.bridgeClearBtn;
    this.bridgeStatusEl = opts.bridgeStatusEl;
    this.bridgeBadgeEl = opts.bridgeBadgeEl;
    this.bridgeDetailsEl = opts.bridgeDetailsEl;
    this.opmlInput     = opts.opmlInput;
    this.opmlImportBtn = opts.opmlImportBtn;
    this.opmlStatusEl  = opts.opmlStatusEl;
    this.subscriptions = opts.subscriptions;
    this.fetchBase     = opts.fetchBase || "";

    if (this.bridgeInput) {
      this.bridgeInput.value = this.#loadBridge();
    }
    this.#updateBridgeBadge();

    this.resolveBtn?.addEventListener("click", () => this.#onResolve());
    this.inputEl?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); this.#onResolve(); }
    });
    this.inputEl?.addEventListener("paste", (e) => {
      // Allow the paste to land in the input, then resolve on next tick
      setTimeout(() => {
        const val = (this.inputEl.value || "").trim();
        if (/^https?:\/\//i.test(val)) this.#onResolve();
      }, 0);
    });
    this.bridgeSaveBtn?.addEventListener("click", () => this.#onSaveBridge());
    this.bridgeClearBtn?.addEventListener("click", () => this.#onClearBridge());
    this.opmlImportBtn?.addEventListener("click", () => this.#onImportOpml());
  }

  #wrapOpmlFragment(text) {
    const trimmed = text.trim();
    if (/^<\?xml/i.test(trimmed) || /^<opml\b/i.test(trimmed)) return trimmed;
    if (/<outline\b/i.test(trimmed)) {
      return `<?xml version="1.0" encoding="UTF-8"?><opml version="2.0"><head><title>Pasted</title></head><body>${trimmed}</body></opml>`;
    }
    return trimmed;
  }

  async #onImportOpml() {
    if (!this.opmlInput) return;
    const raw = (this.opmlInput.value || "").trim();
    if (!raw) {
      this.#setOpmlStatus("Paste an OPML snippet first.", "fail");
      return;
    }
    let parsed;
    try {
      parsed = parseOpml(this.#wrapOpmlFragment(raw));
    } catch (e) {
      this.#setOpmlStatus(`Could not parse: ${e.message || e}`, "fail");
      return;
    }
    if (!parsed.feeds || !parsed.feeds.length) {
      this.#setOpmlStatus("No <outline xmlUrl=\u2026> rows found in that snippet.", "fail");
      return;
    }
    const shelf = (this.shelfInput?.value || "").trim() || "all";
    this.#setOpmlStatus(`Importing ${parsed.feeds.length} feed(s)\u2026`, "pending");
    let added = 0;
    let skipped = 0;
    const failures = [];
    for (const f of parsed.feeds) {
      try {
        const written = await this.subscriptions.appendFeed({
          url:   f.url,
          title: f.title || "",
          shelf,
        });
        if (written.added) added += 1; else skipped += 1;
      } catch (e) {
        failures.push(`${f.url}: ${e.message || e}`);
      }
    }
    const parts = [`Added ${added}`];
    if (skipped) parts.push(`already present ${skipped}`);
    if (failures.length) parts.push(`failed ${failures.length}`);
    const kind = failures.length ? "fail" : "ok";
    this.#setOpmlStatus(parts.join(", ") + ".", kind);
    if (!failures.length && added > 0) {
      this.opmlInput.value = "";
    }
  }

  #setOpmlStatus(message, kind) {
    if (!this.opmlStatusEl) return;
    this.opmlStatusEl.textContent = message;
    this.opmlStatusEl.dataset.status = kind || "";
  }

  async #onResolve() {
    const raw = (this.inputEl?.value || "").trim();
    if (!raw) {
      this.#setStatus("Paste a URL first.", "fail");
      return;
    }
    this.#clearCandidates();
    this.#clearRefused();
    this.#setStatus("Resolving\u2026", "pending");

    const result = resolveUrl(raw, { bridgeBase: this.#loadBridge() });
    if (result.kind === "invalid") {
      this.#setStatus(result.reason, "fail");
      return;
    }
    if (result.kind === "refused") {
      this.#renderRefused(result);
      this.#setStatus(`${result.platform}: no public feed.`, "fail");
      return;
    }
    if (result.kind === "feed") {
      this.#renderCandidates([{
        url: result.feedUrl,
        type: this.#guessTypeFromUrl(result.feedUrl),
        title: result.title || "",
        source: result.source,
      }]);
      this.#setStatus(
        `Matched a documented feed URL pattern (${result.source}). Verify and add.`,
        "ok"
      );
      return;
    }

    let discovery;
    try {
      discovery = await this.#discover(result.pageUrl);
    } catch (e) {
      this.#setStatus(`Discover failed: ${e.message || e}`, "fail");
      return;
    }
    const { candidates, gateBlocked, gateReason, upstreamError, sourceStatus, probed } = discovery;
    if (!candidates.length) {
      this.#setStatus(diagnoseEmpty({ gateBlocked, gateReason, upstreamError, sourceStatus, probed }), "fail");
      return;
    }
    this.#renderCandidates(candidates.map(c => ({ ...c, source: "discover" })));
    this.#setStatus(
      `Found ${candidates.length} candidate feed(s). Verify and add.`,
      "ok"
    );
  }

  async #discover(pageUrl) {
    const url = `${this.fetchBase}/discover?url=${encodeURIComponent(pageUrl)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`discover responded ${res.status}`);
    const data = await res.json();
    return {
      candidates: Array.isArray(data.candidates) ? data.candidates : [],
      gateBlocked: !!data.gateBlocked,
      gateReason: data.gateReason || "",
      upstreamError: data.upstreamError || "",
      sourceStatus: typeof data.sourceStatus === "number" ? data.sourceStatus : 0,
      probed: !!data.probed,
    };
  }

  #renderCandidates(candidates) {
    if (!this.candidatesEl) return;
    this.candidatesEl.innerHTML = "";
    this.candidatesEl.hidden = false;
    for (const cand of candidates) {
      this.candidatesEl.appendChild(this.#renderRow(cand));
    }
  }

  #renderRow(cand) {
    const li = document.createElement("li");
    li.className = "add-feed__candidate";
    li.dataset.feedUrl = cand.url;

    const meta = document.createElement("div");
    meta.className = "add-feed__meta";
    const title = document.createElement("span");
    title.className = "add-feed__title";
    title.textContent = cand.title || "(no title)";
    const url = document.createElement("span");
    url.className = "add-feed__url";
    url.textContent = cand.url;
    const tag = document.createElement("span");
    tag.className = "add-feed__tag";
    tag.dataset.source = cand.source || "";
    tag.textContent = labelFor(cand);
    meta.appendChild(title);
    meta.appendChild(url);
    meta.appendChild(tag);

    const actions = document.createElement("div");
    actions.className = "add-feed__actions";

    const verifyBtn = document.createElement("button");
    verifyBtn.type = "button";
    verifyBtn.className = "add-feed__verify";
    verifyBtn.textContent = "Verify";

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "add-feed__add";
    addBtn.dataset.variant = "primary";
    addBtn.textContent = "Add to subscriptions";

    const verifyOut = document.createElement("p");
    verifyOut.className = "add-feed__verify-out";
    verifyOut.setAttribute("aria-live", "polite");

    verifyBtn.addEventListener("click", () => this.#verify(cand, verifyOut, addBtn, title));
    addBtn.addEventListener("click", () => this.#add(cand, li, title.textContent));

    actions.appendChild(verifyBtn);
    actions.appendChild(addBtn);

    li.appendChild(meta);
    li.appendChild(actions);
    li.appendChild(verifyOut);
    return li;
  }

  async #verify(cand, outEl, addBtn, titleEl) {
    outEl.dataset.status = "pending";
    outEl.textContent = "Fetching feed via /fetch\u2026";
    addBtn.disabled = true;
    try {
      const res = await fetch(`${this.fetchBase}/fetch?url=${encodeURIComponent(cand.url)}`);
      if (!res.ok) throw new Error(`/fetch responded ${res.status}`);
      const ct = res.headers.get("content-type") || "";
      const text = await res.text();
      const parsed = parseFeed(text, ct);
      if (!parsed || !Array.isArray(parsed.entries)) {
        throw new Error("Response did not parse as RSS / Atom / JSON Feed.");
      }
      const n = parsed.entries.length;
      outEl.dataset.status = "ok";
      outEl.textContent =
        `Parsed ${n} entrie${n === 1 ? "" : "s"}. Feed title: ${parsed.feedTitle || "(none)"}`;
      if (parsed.feedTitle && (!titleEl.textContent || titleEl.textContent === "(no title)")) {
        titleEl.textContent = parsed.feedTitle;
      }
    } catch (e) {
      outEl.dataset.status = "fail";
      outEl.textContent = `Verify failed: ${e.message || e}`;
    } finally {
      addBtn.disabled = false;
    }
  }

  async #add(cand, rowEl, displayTitle) {
    const shelf = (this.shelfInput?.value || "all").trim() || "all";
    rowEl.dataset.busy = "true";
    try {
      const written = await this.subscriptions.appendFeed({
        url: cand.url,
        title: displayTitle || cand.title || "",
        shelf,
      });
      const status = written.added
        ? `Added (${written.totalFeeds} total)`
        : `Already in subscriptions (${written.totalFeeds} total).`;
      this.#setStatus(status, written.added ? "ok" : "fail");
      rowEl.dataset.done = "true";
    } catch (e) {
      this.#setStatus(`Append failed: ${e.message || e}`, "fail");
    } finally {
      rowEl.dataset.busy = "";
    }
  }

  #renderRefused(result) {
    if (!this.refusedEl) return;
    this.refusedEl.hidden = false;
    this.refusedEl.innerHTML = "";

    const heading = document.createElement("p");
    heading.className = "add-feed__refused-head";
    heading.textContent = `${result.platform} — no public RSS feed`;
    this.refusedEl.appendChild(heading);

    const reason = document.createElement("p");
    reason.className = "add-feed__refused-reason";
    reason.textContent = result.reason;
    this.refusedEl.appendChild(reason);

    if (result.bridgeHint) {
      const hint = document.createElement("p");
      hint.className = "add-feed__refused-bridge";
      hint.dataset.configured = String(!!result.bridgeHint.configured);
      hint.textContent = result.bridgeHint.message;
      this.refusedEl.appendChild(hint);
      if (result.bridgeHint.candidateUrl) {
        const useBtn = document.createElement("button");
        useBtn.type = "button";
        useBtn.className = "add-feed__use-bridge";
        useBtn.textContent = "Use bridge candidate URL";
        useBtn.addEventListener("click", () => {
          this.inputEl.value = result.bridgeHint.candidateUrl;
          this.refusedEl.hidden = true;
          this.refusedEl.innerHTML = "";
          this.#onResolve();
        });
        this.refusedEl.appendChild(useBtn);
      } else if (!result.bridgeHint.configured && this.bridgeInput) {
        const configBtn = document.createElement("button");
        configBtn.type = "button";
        configBtn.className = "add-feed__configure-bridge";
        configBtn.textContent = "Configure RSSHub bridge";
        configBtn.addEventListener("click", () => this.#focusBridgeConfig());
        this.refusedEl.appendChild(configBtn);
      }
    }

    if (Array.isArray(result.alternatives) && result.alternatives.length) {
      const altHead = document.createElement("p");
      altHead.className = "add-feed__refused-alts-head";
      altHead.textContent = "Try one of these instead:";
      this.refusedEl.appendChild(altHead);

      const altList = document.createElement("ul");
      altList.className = "add-feed__refused-alts";
      for (const text of result.alternatives) {
        const li = document.createElement("li");
        li.textContent = text;
        altList.appendChild(li);
      }
      this.refusedEl.appendChild(altList);
    }
  }

  #onSaveBridge() {
    const value = (this.bridgeInput?.value || "").trim();
    if (!value) {
      this.#onClearBridge();
      return;
    }
    try {
      const u = new URL(value);
      if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("must be http(s)");
      const normalised = u.toString().replace(/\/+$/, "");
      localStorage.setItem(BRIDGE_KEY, normalised);
      if (this.bridgeInput) this.bridgeInput.value = normalised;
      this.#setBridgeStatus(`Saved. Refused platforms will now suggest ${normalised} as the bridge base.`, "ok");
      this.#updateBridgeBadge();
    } catch (e) {
      this.#setBridgeStatus(`Not a valid URL: ${e.message || e}`, "fail");
    }
  }

  #onClearBridge() {
    localStorage.removeItem(BRIDGE_KEY);
    if (this.bridgeInput) this.bridgeInput.value = "";
    this.#setBridgeStatus("Bridge URL cleared. Refused platforms will no longer suggest a bridge URL.", "ok");
    this.#updateBridgeBadge();
  }

  #updateBridgeBadge() {
    if (!this.bridgeBadgeEl) return;
    const saved = this.#loadBridge();
    if (saved) {
      this.bridgeBadgeEl.hidden = false;
      this.bridgeBadgeEl.textContent = "configured";
      this.bridgeBadgeEl.dataset.configured = "true";
    } else {
      this.bridgeBadgeEl.hidden = true;
      this.bridgeBadgeEl.textContent = "";
      this.bridgeBadgeEl.dataset.configured = "false";
    }
  }

  #focusBridgeConfig() {
    if (this.bridgeDetailsEl && !this.bridgeDetailsEl.open) {
      this.bridgeDetailsEl.open = true;
    }
    const input = this.bridgeInput;
    if (!input) return;
    input.scrollIntoView({ behavior: "smooth", block: "center" });
    input.focus({ preventScroll: true });
  }

  #loadBridge() {
    try { return localStorage.getItem(BRIDGE_KEY) || ""; }
    catch { return ""; }
  }

  #clearCandidates() {
    if (!this.candidatesEl) return;
    this.candidatesEl.innerHTML = "";
    this.candidatesEl.hidden = true;
  }
  #clearRefused() {
    if (!this.refusedEl) return;
    this.refusedEl.innerHTML = "";
    this.refusedEl.hidden = true;
  }
  #setStatus(msg, status = "pending") {
    if (!this.statusEl) return;
    this.statusEl.textContent = msg;
    this.statusEl.dataset.status = status;
  }
  #setBridgeStatus(msg, status = "pending") {
    if (!this.bridgeStatusEl) return;
    this.bridgeStatusEl.textContent = msg;
    this.bridgeStatusEl.dataset.status = status;
  }
  #guessTypeFromUrl(u) {
    if (/\.atom(\?|$)/i.test(u)) return "atom";
    if (/\.json(\?|$)/i.test(u) || /jsonfeed/i.test(u)) return "json";
    return "rss";
  }
}

function diagnoseEmpty({ gateBlocked, gateReason, upstreamError, sourceStatus, probed }) {
  if (gateBlocked) {
    return `The Worker /fetch allowlist refused this URL (${gateReason || "no reason given"}). Ask the deploy owner to add the host to PROXY_ALLOW, or set PROXY_ALLOW="*" to allow any public feed.`;
  }
  if (upstreamError) {
    return `Worker could not reach the site (${upstreamError}). The site may be offline or blocking the Worker IP.`;
  }
  if (sourceStatus >= 400) {
    return `Site returned HTTP ${sourceStatus} when the Worker fetched it. That usually means the site detected a bot fetch and blocked it. Try the feed URL directly if you know it.`;
  }
  if (probed) {
    return `Page loaded, but had no <link rel="alternate"> tag, and the /feed, /rss, /atom.xml probes returned no feed content. The site may not publish RSS.`;
  }
  return `Page loaded, but had no <link rel="alternate"> tag in the <head>. The site may not publish RSS at this URL.`;
}

function labelFor(cand) {
  if (cand.source === "youtube-channel")  return "YouTube channel";
  if (cand.source === "youtube-playlist") return "YouTube playlist";
  if (cand.source === "youtube-user")     return "YouTube user";
  if (cand.source === "reddit-subreddit") return "Reddit subreddit";
  if (cand.source === "reddit-user")      return "Reddit user";
  if (cand.source === "mastodon-profile") return "Mastodon profile";
  if (cand.source === "github-releases")  return "GitHub releases";
  if (cand.source === "substack")        return "Substack";
  if (cand.source === "medium-user")     return "Medium user";
  if (cand.source === "medium-publication") return "Medium publication";
  if (cand.source === "tumblr")          return "Tumblr";
  if (cand.source === "discover")         return cand.type ? cand.type.toUpperCase() : "discovered";
  return cand.type ? cand.type.toUpperCase() : "feed";
}
