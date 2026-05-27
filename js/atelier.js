// atelier.js
//
// "Atelier mode" — hides both rails and centres the reader. Triggered
// by the toolbar button or the `a` keystroke. Per ROADMAP §7 the mode
// is default-on at viewports ≤ 768px (handled in shell.css).

export class Atelier {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.appEl    — the .app grid root
   * @param {HTMLElement} opts.toggleEl — the button that flips the mode
   */
  constructor({ appEl, toggleEl }) {
    this.appEl = appEl;
    if (toggleEl) toggleEl.addEventListener("click", () => this.toggle());
  }

  isOn() { return this.appEl.getAttribute("data-atelier") === "true"; }
  toggle() { this.appEl.setAttribute("data-atelier", String(!this.isOn())); }
  on()     { this.appEl.setAttribute("data-atelier", "true"); }
  off()    { this.appEl.setAttribute("data-atelier", "false"); }
}
