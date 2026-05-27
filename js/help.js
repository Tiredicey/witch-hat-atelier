// help.js
//
// Tiny class around the .scrim cheat-sheet overlay. Open/close are also
// reachable from the Shortcuts handler map.

export class Help {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.scrimEl  — .scrim
   * @param {HTMLElement} [opts.openEl] — the toolbar `?` button
   */
  constructor({ scrimEl, openEl }) {
    this.scrimEl = scrimEl;
    if (openEl) openEl.addEventListener("click", () => this.open());
  }
  open()  { this.scrimEl.setAttribute("data-open", "true"); }
  close() { this.scrimEl.setAttribute("data-open", "false"); }
}
