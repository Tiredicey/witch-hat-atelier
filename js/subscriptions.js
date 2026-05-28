// subscriptions.js
//
// Controller for the Settings page "Subscriptions" section. Wires the
// import (OPML file picker) and export (download as OPML) gestures.
//
// Storage shape (lives at key `coda/subs/subscriptions.json` on the active
// adapter):
//
//   {
//     "version": 1,
//     "updated": <unix ms>,
//     "title":   "<source export title, optional>",
//     "feeds":   [{ id, url, title, shelf }, ...]
//   }
//
// Worker (§4) reads this file from R2 first; if absent, falls back to its
// `env.FEEDS` configuration. So once the user imports an OPML, the Worker
// picks up the new feed list on the next cron tick automatically.

import { parseOpml, serializeOpml, subscriptionsFromOpml } from "./opml.js";

const SUBS_KEY = "coda/subs/subscriptions.json";

export class Subscriptions {
  /**
   * @param {object} opts
   * @param {HTMLInputElement}  opts.importInput  — <input type="file">
   * @param {HTMLButtonElement} opts.exportBtn    — Export-OPML button
   * @param {HTMLElement}       opts.statusEl     — <p> for status messages
   * @param {object}            opts.adapter      — active storage adapter (must have read/write)
   */
  constructor({ importInput, exportBtn, statusEl, adapter }) {
    this.importInput = importInput;
    this.exportBtn   = exportBtn;
    this.statusEl    = statusEl;
    this.adapter     = adapter;

    if (importInput) importInput.addEventListener("change", () => this.#onImport());
    if (exportBtn)   exportBtn.addEventListener("click", () => this.#onExport());
  }

  async #onImport() {
    const file = this.importInput.files?.[0];
    if (!file) return;
    this.#setStatus(`Reading ${file.name}…`);
    try {
      const text = await file.text();
      const parsed = parseOpml(text);
      if (!parsed.feeds.length) {
        this.#setStatus(`No feeds found in ${file.name}.`, "warn");
        return;
      }
      const subs = subscriptionsFromOpml(parsed);
      await this.adapter.write(SUBS_KEY, JSON.stringify(subs));
      this.#setStatus(
        `Imported ${subs.feeds.length} feed(s) from ${file.name}. ` +
        `The Worker will pick these up on its next cron tick (up to 30 min).`,
        "ok"
      );
    } catch (e) {
      this.#setStatus(`Import failed: ${e.message || e}`, "warn");
    } finally {
      this.importInput.value = "";  // allow re-importing the same file
    }
  }

  async #onExport() {
    this.#setStatus("Reading subscriptions…");
    try {
      const raw = await this.adapter.read(SUBS_KEY);
      if (!raw) {
        this.#setStatus("No subscriptions stored yet. Import an OPML first, then export to round-trip.", "warn");
        return;
      }
      const subs = JSON.parse(raw);
      const opml = serializeOpml({
        title: subs.title || "CODA subscriptions",
        feeds: subs.feeds || [],
      });
      downloadText(opml, "coda-subscriptions.opml", "application/xml");
      this.#setStatus(`Exported ${subs.feeds?.length || 0} feed(s).`, "ok");
    } catch (e) {
      this.#setStatus(`Export failed: ${e.message || e}`, "warn");
    }
  }

  #setStatus(msg, kind = "info") {
    if (!this.statusEl) return;
    this.statusEl.textContent = msg;
    this.statusEl.dataset.kind = kind;
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
