// follow-topic.js
// Follow a plain-language topic as its own shelf, sourced from Google News
// RSS (free, no key, no account). A topic becomes a search feed; the
// "What's happening" button adds the regional top-stories feed. Both write
// through subscriptions.appendFeed, the same path OPML import and add-by-URL
// use.

const NEWS_HOST = "news.google.com";
const NEWS_BASE = `https://${NEWS_HOST}/rss`;
const LOCALE = { hl: "en-PH", gl: "PH", ceid: "PH:en" };
const HEADLINES_SHELF = "headlines";
const HEADLINES_LABEL = "What\u2019s happening";

function localeQuery() {
  return `hl=${encodeURIComponent(LOCALE.hl)}&gl=${encodeURIComponent(LOCALE.gl)}&ceid=${encodeURIComponent(LOCALE.ceid)}`;
}

export function topicFeedUrl(topic) {
  const q = String(topic || "").trim();
  if (!q) return "";
  return `${NEWS_BASE}/search?q=${encodeURIComponent(q)}&${localeQuery()}`;
}

export function headlinesFeedUrl() {
  return `${NEWS_BASE}?${localeQuery()}`;
}

export function isTopicFeedUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "") === NEWS_HOST;
  } catch {
    return false;
  }
}

function shelfId(topic) {
  return String(topic || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export class FollowTopic {
  constructor({ inputEl, followBtn, headlinesBtn, statusEl, subscriptions, onFollowed }) {
    this.inputEl = inputEl;
    this.followBtn = followBtn;
    this.headlinesBtn = headlinesBtn;
    this.statusEl = statusEl;
    this.subscriptions = subscriptions;
    this.onFollowed = onFollowed;
    this.#bind();
  }

  #bind() {
    this.followBtn?.addEventListener("click", () => this.#followTyped());
    this.inputEl?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); this.#followTyped(); }
    });
    this.headlinesBtn?.addEventListener("click", () =>
      this.#follow(headlinesFeedUrl(), HEADLINES_LABEL, HEADLINES_SHELF));
  }

  #followTyped() {
    const topic = (this.inputEl?.value || "").trim();
    if (!topic) { this.#status("Type a topic first.", "fail"); return; }
    this.#follow(topicFeedUrl(topic), topic, shelfId(topic));
  }

  async #follow(url, label, shelf) {
    if (!url) { this.#status("Type a topic first.", "fail"); return; }
    this.#busy(true);
    try {
      const res = await this.subscriptions.appendFeed({ url, title: label, shelf });
      if (!res.added) { this.#status(`You already follow \u201c${label}\u201d.`, "fail"); return; }
      if (this.inputEl) this.inputEl.value = "";
      this.#status(`Following \u201c${label}\u201d. Gathering the latest\u2026`, "ok");
      if (this.onFollowed) await this.onFollowed(shelf, label);
      this.#status(`Following \u201c${label}\u201d. It has its own shelf now.`, "ok");
    } catch (e) {
      this.#status(`Could not follow that: ${e.message || e}`, "fail");
    } finally {
      this.#busy(false);
    }
  }

  #busy(b) {
    if (this.followBtn) this.followBtn.disabled = b;
    if (this.headlinesBtn) this.headlinesBtn.disabled = b;
  }

  #status(msg, kind) {
    if (!this.statusEl) return;
    this.statusEl.textContent = msg;
    this.statusEl.dataset.status = kind || "";
  }
}
