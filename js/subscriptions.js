// subscriptions.js
//
// Settings-page OPML import + export with an intermediate triage screen.
//
// Flow:
//   1. User picks an OPML file
//   2. parseOpml() runs in-browser; we render every feed in a checkbox list
//      (default checked) grouped by source folder
//   3. User unchecks anything they don't want — dormant feeds, defunct blogs,
//      whatever — then clicks "Import N of M"
//   4. Selected feeds are serialised into the Worker's subs shape and written
//      to `coda/subs/subscriptions.json` on the active adapter
//
// Honest scope note (and §1 caveat):
//   The roadmap §1 pitch — "17 of your 89 feeds haven't published in 2+
//   years — keep, archive, or unsubscribe?" — requires per-feed last-publish
//   metadata. The browser cannot compute that during import: most feeds are
//   CORS-blocked from a static site, and fetching N feeds inline would
//   stall the user. Automated dormancy detection is a §4 Worker job and
//   ships in a follow-up PR. What this PR ships is the *manual* triage
//   UI — every feed visible, every feed togglable, bulk select-all/none.
//   When the Worker's snapshot lands a `dormantFeeds[]` field, that data
//   flows into this list as a pre-unchecked default.

import { parseOpml, serializeOpml, subscriptionsFromOpml } from "./opml.js";

const SUBS_KEY = "coda/subs/subscriptions.json";

export class Subscriptions {
  /**
   * @param {object} opts
   * @param {HTMLInputElement}  opts.importInput   — <input type="file">
   * @param {HTMLElement}       opts.statusEl      — status line for parse / commit
   * @param {HTMLElement}       opts.triageEl      — root .opml-triage element (hidden)
   * @param {HTMLElement}       opts.triageListEl  — <ul> to populate with rows
   * @param {HTMLElement}       opts.triageSummaryEl — <p> for "N of M selected"
   * @param {HTMLButtonElement} opts.selectAllBtn
   * @param {HTMLButtonElement} opts.selectNoneBtn
   * @param {HTMLButtonElement} opts.commitBtn     — "Import N of M"
   * @param {HTMLButtonElement} opts.cancelBtn
   * @param {HTMLButtonElement} opts.exportBtn
   * @param {HTMLElement}       opts.exportStatusEl
   * @param {object}            opts.adapter       — active storage adapter (read/write)
   */
  constructor(opts) {
    this.importInput      = opts.importInput;
    this.statusEl         = opts.statusEl;
    this.triageEl         = opts.triageEl;
    this.triageListEl     = opts.triageListEl;
    this.triageSummaryEl  = opts.triageSummaryEl;
    this.selectAllBtn     = opts.selectAllBtn;
    this.selectNoneBtn    = opts.selectNoneBtn;
    this.commitBtn        = opts.commitBtn;
    this.cancelBtn        = opts.cancelBtn;
    this.exportBtn        = opts.exportBtn;
    this.exportStatusEl   = opts.exportStatusEl;
    this.adapter          = opts.adapter;

    this.pendingFeeds = [];
    this.pendingTitle = "";
    this.pendingFileName = "";

    if (this.importInput)  this.importInput.addEventListener("change", () => this.#onPick());
    if (this.selectAllBtn) this.selectAllBtn.addEventListener("click", () => this.#setAll(true));
    if (this.selectNoneBtn) this.selectNoneBtn.addEventListener("click", () => this.#setAll(false));
    if (this.commitBtn)    this.commitBtn.addEventListener("click", () => this.#commit());
    if (this.cancelBtn)    this.cancelBtn.addEventListener("click", () => this.#cancel());
    if (this.exportBtn)    this.exportBtn.addEventListener("click", () => this.#export());

    if (this.triageListEl) {
      this.triageListEl.addEventListener("change", (e) => {
        if (e.target && e.target.matches('input[type="checkbox"][data-feed-index]')) {
          this.#syncCommit();
        }
      });
    }
  }

  // ─── Import: pick file → parse → reveal triage ─────────────────────────

  async #onPick() {
    const file = this.importInput.files && this.importInput.files[0];
    if (!file) return;
    this.pendingFileName = file.name;
    this.#setStatus(`Reading ${file.name}\u2026`, "pending");
    try {
      const text = await file.text();
      const parsed = parseOpml(text);
      if (!parsed.feeds.length) {
        this.#setStatus(`No feeds found in ${file.name}.`, "fail");
        this.#hideTriage();
        return;
      }
      this.pendingFeeds = parsed.feeds;
      this.pendingTitle = parsed.title || "";
      this.#renderTriage();
      this.#setStatus(
        `Parsed ${parsed.feeds.length} feed(s) from ${file.name}. Review the list below, then commit.`,
        "ok"
      );
    } catch (e) {
      this.#setStatus(`Import failed: ${e.message || e}`, "fail");
      this.#hideTriage();
    } finally {
      this.importInput.value = "";  // allow re-importing the same file
    }
  }

  #renderTriage() {
    if (!this.triageListEl || !this.triageEl) return;
    this.triageListEl.innerHTML = "";

    // Group by shelf for readability; "all" group (root-level feeds) goes last.
    const groups = new Map();
    this.pendingFeeds.forEach((f, idx) => {
      const shelf = f.shelf || "all";
      if (!groups.has(shelf)) groups.set(shelf, []);
      groups.get(shelf).push({ feed: f, idx });
    });
    const ordered = [...groups.keys()].sort((a, b) => {
      if (a === "all") return 1;
      if (b === "all") return -1;
      return a.localeCompare(b);
    });

    for (const shelf of ordered) {
      const groupEl = document.createElement("li");
      groupEl.className = "opml-triage__group";
      const heading = document.createElement("h3");
      heading.className = "opml-triage__group-title";
      heading.textContent = shelf === "all" ? "Uncategorised" : shelf;
      groupEl.appendChild(heading);
      const inner = document.createElement("ul");
      inner.className = "opml-triage__group-list";
      for (const { feed, idx } of groups.get(shelf)) {
        inner.appendChild(this.#renderRow(feed, idx));
      }
      groupEl.appendChild(inner);
      this.triageListEl.appendChild(groupEl);
    }

    this.triageEl.hidden = false;
    this.#syncCommit();
  }

  #renderRow(feed, idx) {
    const li = document.createElement("li");
    li.className = "opml-triage__item";
    const label = document.createElement("label");
    label.className = "opml-triage__label";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = true;
    cb.dataset.feedIndex = String(idx);
    label.appendChild(cb);

    const meta = document.createElement("span");
    meta.className = "opml-triage__meta";

    const title = document.createElement("span");
    title.className = "opml-triage__title";
    title.textContent = feed.title || feed.id || feed.url;
    meta.appendChild(title);

    const url = document.createElement("span");
    url.className = "opml-triage__url";
    url.textContent = feed.url;
    meta.appendChild(url);

    label.appendChild(meta);
    li.appendChild(label);
    return li;
  }

  #setAll(checked) {
    if (!this.triageListEl) return;
    for (const cb of this.triageListEl.querySelectorAll('input[type="checkbox"][data-feed-index]')) {
      cb.checked = checked;
    }
    this.#syncCommit();
  }

  #selectedIndices() {
    if (!this.triageListEl) return [];
    const out = [];
    for (const cb of this.triageListEl.querySelectorAll('input[type="checkbox"][data-feed-index]:checked')) {
      const i = parseInt(cb.dataset.feedIndex, 10);
      if (Number.isInteger(i)) out.push(i);
    }
    return out;
  }

  #syncCommit() {
    const selected = this.#selectedIndices().length;
    const total = this.pendingFeeds.length;
    if (this.triageSummaryEl) {
      this.triageSummaryEl.textContent = `${selected} of ${total} feed(s) selected`;
    }
    if (this.commitBtn) {
      this.commitBtn.textContent = selected
        ? `Import ${selected} of ${total}`
        : `Import (none selected)`;
      this.commitBtn.disabled = selected === 0;
    }
  }

  async #commit() {
    const indices = new Set(this.#selectedIndices());
    if (!indices.size) return;
    const keptFeeds = this.pendingFeeds.filter((_, i) => indices.has(i));
    const parsed = { title: this.pendingTitle, feeds: keptFeeds, folders: [] };
    const subs = subscriptionsFromOpml(parsed);
    this.#setStatus(`Writing ${keptFeeds.length} feed(s) to subscriptions.json\u2026`, "pending");
    try {
      await this.adapter.write(SUBS_KEY, JSON.stringify(subs));
      const dropped = this.pendingFeeds.length - keptFeeds.length;
      const parts = [`Imported ${keptFeeds.length} feed(s) from ${this.pendingFileName}.`];
      if (dropped) parts.push(`${dropped} unchecked feed(s) skipped.`);
      parts.push(`The Worker picks these up on its next cron tick (up to 30 min).`);
      this.#setStatus(parts.join(" "), "ok");
      this.#hideTriage();
    } catch (e) {
      this.#setStatus(`Commit failed: ${e.message || e}`, "fail");
    }
  }

  #cancel() {
    this.#hideTriage();
    this.#setStatus("Import cancelled.", "fail");
  }

  #hideTriage() {
    if (this.triageEl) this.triageEl.hidden = true;
    if (this.triageListEl) this.triageListEl.innerHTML = "";
    this.pendingFeeds = [];
    this.pendingTitle = "";
    this.pendingFileName = "";
    if (this.commitBtn) this.commitBtn.disabled = true;
  }

  // ─── Export ─────────────────────────────────────────────────────────────

  async #export() {
    this.#setExportStatus("Reading subscriptions\u2026", "pending");
    try {
      const raw = await this.adapter.read(SUBS_KEY);
      if (!raw) {
        this.#setExportStatus(
          "No subscriptions stored yet. Import an OPML first, then export to round-trip.",
          "fail"
        );
        return;
      }
      const subs = JSON.parse(raw);
      const opml = serializeOpml({
        title: subs.title || "CODA subscriptions",
        feeds: subs.feeds || [],
      });
      downloadText(opml, "coda-subscriptions.opml", "application/xml");
      this.#setExportStatus(`Exported ${subs.feeds?.length || 0} feed(s).`, "ok");
    } catch (e) {
      this.#setExportStatus(`Export failed: ${e.message || e}`, "fail");
    }
  }

  // ─── Status helpers ─────────────────────────────────────────────────────

  #setStatus(msg, status = "pending") {
    if (!this.statusEl) return;
    this.statusEl.textContent = msg;
    this.statusEl.dataset.status = status;
  }

  #setExportStatus(msg, status = "pending") {
    if (!this.exportStatusEl) return;
    this.exportStatusEl.textContent = msg;
    this.exportStatusEl.dataset.status = status;
  }
}

function downloadText(text, filename, contentType) {
  const blob = new Blob([text], { type: contentType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
