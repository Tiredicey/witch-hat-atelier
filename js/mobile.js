// mobile.js
//
// Owns the mobile single-pane swap. Below 768px, the .app grid shows
// either the list or the reader, not both. The "← List" button in the
// reader actions returns to the list view.
//
// Desktop ignores this entirely — the data-mobile-view attribute has
// no effect on the wider grid template.

export class Mobile {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.appEl    — .app root (carries data-mobile-view)
   * @param {HTMLElement} opts.backBtn  — the .mobile-back button
   */
  constructor({ appEl, backBtn }) {
    this.appEl = appEl;
    if (backBtn) backBtn.addEventListener("click", () => this.showList());
    if (!this.appEl.getAttribute("data-mobile-view")) {
      this.appEl.setAttribute("data-mobile-view", "list");
    }
  }

  showReader() { this.appEl.setAttribute("data-mobile-view", "reader"); }
  showList()   { this.appEl.setAttribute("data-mobile-view", "list"); }
}
