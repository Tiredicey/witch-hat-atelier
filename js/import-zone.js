// import-zone.js
//
// One drag-and-drop surface that auto-detects OPML or Inoreader-stars JSON
// and routes to the correct existing import controller. Collapses two
// separate file inputs (subscriptions OPML + Inoreader stars) into one.
//
// The format sniffer is pure; the controllers it dispatches to
// (Subscriptions.handleOpmlText, StarsImport.handleInoreaderText) are the
// same code paths the original file inputs used, so triage, dedupe, and
// status formatting stay identical.

import { sniffImportFormat, wrapOpmlFragment } from "./format-sniffer.js";

export class ImportZone {
  /**
   * @param {object} opts
   * @param {HTMLElement}       opts.zoneEl     — the drop target
   * @param {HTMLInputElement}  opts.fileInput  — fallback <input type="file">
   * @param {HTMLElement}       opts.statusEl   — aria-live status line
   * @param {object}            opts.subscriptions — has .handleOpmlText(text, name)
   * @param {object}            opts.starsImport   — has .handleInoreaderText(text, name)
   */
  constructor({ zoneEl, fileInput, statusEl, subscriptions, starsImport }) {
    this.zoneEl       = zoneEl;
    this.fileInput    = fileInput;
    this.statusEl     = statusEl;
    this.subscriptions = subscriptions;
    this.starsImport  = starsImport;

    if (!this.zoneEl) return;
    this.#bindDrop();
    this.#bindClick();
    this.#bindFileInput();
  }

  #bindDrop() {
    const z = this.zoneEl;
    ["dragenter", "dragover"].forEach(evt => {
      z.addEventListener(evt, (e) => {
        e.preventDefault();
        z.dataset.over = "true";
      });
    });
    ["dragleave", "drop"].forEach(evt => {
      z.addEventListener(evt, (e) => {
        e.preventDefault();
        z.dataset.over = "false";
      });
    });
    z.addEventListener("drop", async (e) => {
      const files = e.dataTransfer && e.dataTransfer.files;
      if (!files || !files.length) {
        this.#setStatus("Nothing dropped. Try again.", "fail");
        return;
      }
      await this.#process(files[0]);
    });
  }

  #bindClick() {
    if (!this.fileInput) return;
    this.zoneEl.addEventListener("click", (e) => {
      // Don't double-fire when the click is on the file input itself
      if (e.target === this.fileInput) return;
      this.fileInput.click();
    });
    this.zoneEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        this.fileInput.click();
      }
    });
  }

  #bindFileInput() {
    if (!this.fileInput) return;
    this.fileInput.addEventListener("change", async () => {
      const file = this.fileInput.files && this.fileInput.files[0];
      if (!file) return;
      try { await this.#process(file); }
      finally { this.fileInput.value = ""; }
    });
  }

  async #process(file) {
    this.#setStatus(`Reading ${file.name}\u2026`, "pending");
    let text;
    try { text = await file.text(); }
    catch (e) {
      this.#setStatus(`Could not read ${file.name}: ${e.message || e}`, "fail");
      return;
    }
    const sniff = sniffImportFormat(text);
    if (sniff.kind === "opml" || sniff.kind === "opml-fragment") {
      const payload = sniff.kind === "opml-fragment" ? wrapOpmlFragment(text) : text;
      await this.subscriptions.handleOpmlText(payload, file.name);
      return;
    }
    if (sniff.kind === "inoreader-stars") {
      await this.starsImport.handleInoreaderText(text, file.name);
      return;
    }
    this.#setStatus(
      `Could not identify ${file.name}. Expected OPML (.opml/.xml) or an Inoreader stars export (.json). Reason: ${sniff.reason}.`,
      "fail"
    );
  }

  #setStatus(msg, kind) {
    if (!this.statusEl) return;
    this.statusEl.textContent = msg;
    this.statusEl.dataset.status = kind || "";
  }
}
