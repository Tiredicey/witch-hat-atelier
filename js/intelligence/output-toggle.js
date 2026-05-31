export class CollapsibleOutput {
  constructor(toggleBtn, outputEl, opts) {
    this.toggleBtn = toggleBtn || null;
    this.outputEl = outputEl || null;
    this.noun = (opts && opts.noun) || "output";
    if (this.toggleBtn) this.toggleBtn.addEventListener("click", () => this.toggle());
    this.sync();
  }

  hasContent() {
    if (!this.outputEl) return false;
    return !!(this.outputEl.textContent || this.outputEl.childElementCount);
  }

  reveal() {
    if (this.outputEl) this.outputEl.hidden = false;
    this.#set(true, false);
  }

  clear() {
    if (this.outputEl) this.outputEl.hidden = true;
    this.#set(false, true);
  }

  toggle() {
    if (!this.hasContent()) return;
    const collapsed = this.outputEl.hidden;
    this.outputEl.hidden = !collapsed;
    this.#set(true, !collapsed);
  }

  sync() {
    if (this.hasContent()) this.#set(true, this.outputEl.hidden);
    else this.#set(false, true);
  }

  #set(visible, collapsed) {
    if (!this.toggleBtn) return;
    this.toggleBtn.hidden = !visible;
    this.toggleBtn.setAttribute("aria-expanded", String(!collapsed));
    this.toggleBtn.textContent = collapsed ? `Show ${this.noun}` : `Hide ${this.noun}`;
  }
}
