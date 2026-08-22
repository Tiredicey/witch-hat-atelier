// shortcuts.js
//
// Keyboard map per ROADMAP §7. Inherited from Google Reader muscle memory:
//   j/k        next / prev article
//   o / Enter  open
//   m          mark read / unread
//   s          star
//   n          add note
//   u          summarise (only fires when an intelligence surface is enabled)
//   a          atelier mode
//   c          summon the copilot (global, §18 owner directive)
//   g g        go to All
//   g s        go to Starred
//   /          quick filter over the current shelf
//   ?          show shortcuts panel
//   Esc        close panel

const G_TIMEOUT_MS = 800;

export class Shortcuts {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.scrimEl   — .scrim overlay
   * @param {object} opts.handlers
   *   handlers.openHelp(): void
   *   handlers.closeHelp(): void
   *   handlers.toggleAtelier(): void
   *   handlers.selectNext(): void
   *   handlers.selectPrev(): void
   *   handlers.openFirstIfNone(): void
   *   handlers.markToggle(): void
   *   handlers.starToggle(): void
   *   handlers.quickFilter(): void
   *   handlers.goShelf(id): void   // "all" or "starred"
   */
  constructor({ scrimEl, handlers }) {
    this.scrimEl = scrimEl;
    this.h = handlers;
    this.gPending = false;
    this.gTimer = null;
    this.#bind();
    if (scrimEl) {
      scrimEl.addEventListener("click", e => {
        if (e.target === scrimEl) this.h.closeHelp();
      });
    }
  }

  #bind() {
    document.addEventListener("keydown", e => {
      if (e.target.matches("input, textarea")) return;

      if (e.key === "Escape") { this.h.closeHelp(); return; }
      if (e.key === "?")      { e.preventDefault(); this.h.openHelp(); return; }
      if (e.key === "/")      { e.preventDefault(); if (this.h.quickFilter) this.h.quickFilter(); return; }
      if (e.key === "a")      { this.h.toggleAtelier(); return; }

      if (e.key === "j") { e.preventDefault(); this.h.selectNext(); return; }
      if (e.key === "k") { e.preventDefault(); this.h.selectPrev(); return; }

      if (e.key === "m") { this.h.markToggle(); return; }
      if (e.key === "s" && !this.gPending) { this.h.starToggle(); return; }

      if (e.key === "o" || e.key === "Enter") { this.h.openFirstIfNone(); return; }

      if (e.key === "n") { e.preventDefault(); this.h.addNote(); return; }

      if (e.key === "x") { e.preventDefault(); if (this.h.trashToggle) this.h.trashToggle(); return; }

      if (e.key === "u") { e.preventDefault(); if (this.h.summarise) this.h.summarise(); return; }

      if (e.key === "c") { e.preventDefault(); if (this.h.openCopilot) this.h.openCopilot(); return; }

      // `g g` and `g s` — two-key prefix
      if (this.gPending && (e.key === "g" || e.key === "s")) {
        this.h.goShelf(e.key === "g" ? "all" : "starred");
        this.gPending = false;
        clearTimeout(this.gTimer);
        return;
      }
      if (e.key === "g") {
        this.gPending = true;
        clearTimeout(this.gTimer);
        this.gTimer = setTimeout(() => { this.gPending = false; }, G_TIMEOUT_MS);
        return;
      }
    });
  }
}
