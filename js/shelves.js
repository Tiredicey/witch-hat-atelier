// shelves.js
//
// Owns the left sigil rail's active-shelf state.
// Switching shelves on the demo only updates the list title (no real
// filtering — the sample data is a single shelf). The real reader's
// shelf-switching hits the storage layer per ROADMAP §5.

export class Shelves {
  /**
   * @param {object} opts
   * @param {HTMLElement}   opts.railEl     — .rail
   * @param {HTMLElement}   opts.titleEl    — .list__title
   * @param {(s:string)=>void} [opts.onSwitch] — fires with the new shelf id
   */
  constructor({ railEl, titleEl, onSwitch }) {
    this.railEl = railEl;
    this.titleEl = titleEl;
    this.onSwitch = onSwitch;
    this.buttons = Array.from(railEl.querySelectorAll(".shelf[data-shelf]"));
    this.#bind();
  }

  /** Public: programmatically switch to a shelf id (e.g. from `g g`). */
  switchTo(id) {
    const target = this.buttons.find(b => b.dataset.shelf === id);
    if (target) target.click();
  }

  #bind() {
    this.buttons.forEach(b => {
      b.addEventListener("click", () => {
        this.buttons.forEach(x => x.setAttribute("aria-current", "false"));
        b.setAttribute("aria-current", "true");
        const label = b.querySelector(".shelf__label")?.textContent || b.getAttribute("aria-label") || "Shelf";
        this.titleEl.textContent = label;
        this.onSwitch?.(b.dataset.shelf);
      });
    });
  }
}
