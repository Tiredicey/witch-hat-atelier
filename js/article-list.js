// article-list.js
//
// Renders the middle pane: article rows + density toggle.
// Single responsibility — owns the .list section.
// Emits no events; callers register a row-select callback via the
// constructor's `onSelect` argument.

const DIVIDERS = ["a", "b", "c"];

export class ArticleList {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.listEl    — the .list root (data-density attr lives here)
   * @param {HTMLElement} opts.rowsEl    — the .list__scroll container
   * @param {Array}       opts.items     — array of sample data items
   * @param {(id:string)=>void} opts.onSelect — fired when a row is activated
   */
  constructor({ listEl, rowsEl, items, onSelect }) {
    this.listEl = listEl;
    this.rowsEl = rowsEl;
    this.allItems = items;
    this.items = items;            // currently-visible (post-filter)
    this.filterFn = () => true;
    this.onSelect = onSelect;
    this.selectedId = null;

    this.#renderRows();
    this.#bindDensity();
  }

  /** Public: which article id is currently selected (or null). */
  getSelectedId() { return this.selectedId; }

  /** Public: id list of currently visible items (for j/k navigation). */
  getIds() { return this.items.map(x => x.id); }

  /**
   * Public: filter the visible rows.
   * @param {(item:object)=>boolean} fn predicate over an item
   */
  setFilter(fn) {
    this.filterFn = typeof fn === "function" ? fn : () => true;
    this.items = this.allItems.filter(this.filterFn);
    this.#renderRows();
    if (this.store) this.refreshFromStore(this.store);
    // Drop selection if the selected id was filtered out.
    if (this.selectedId && !this.items.some(x => x.id === this.selectedId)) {
      this.selectedId = null;
    }
  }

  /** Public: mark row as selected (visual + aria), no callback fired. */
  setSelected(id) {
    this.selectedId = id;
    this.rowsEl.querySelectorAll(".article-row").forEach(r => {
      r.setAttribute("aria-selected", r.dataset.id === id ? "true" : "false");
    });
    if (id) {
      const row = this.rowsEl.querySelector(`.article-row[data-id="${id}"]`);
      row?.scrollIntoView({ block: "nearest" });
    }
  }

  /** Public: reflect read/starred state from the store onto every row. */
  refreshFromStore(store) {
    this.store = store;
    this.rowsEl.querySelectorAll(".article-row").forEach(r => {
      const id = r.dataset.id;
      r.dataset.read = String(store.isRead(id));
      r.dataset.starred = String(store.isStarred(id));
    });
  }

  /** Public: look up item by id. */
  find(id) { return this.items.find(x => x.id === id) || null; }

  // ────────────────────────────────────────────────────────────────
  #renderRows() {
    this.rowsEl.innerHTML = "";
    if (this.items.length === 0) {
      const empty = document.createElement("p");
      empty.className = "article-list__empty";
      empty.textContent = "No items in this shelf yet.";
      this.rowsEl.appendChild(empty);
      return;
    }
    this.items.forEach((it, i) => {
      const div = document.createElement("div");
      div.className = "article-row";
      div.setAttribute("role", "button");
      div.setAttribute("tabindex", "0");
      div.setAttribute("aria-selected", "false");
      div.dataset.id = it.id;
      div.dataset.read = String(it.read);
      div.dataset.starred = "false";
      div.dataset.divider = DIVIDERS[i % DIVIDERS.length];
      div.innerHTML = `
        <div class="article-row__top">
          <span class="article-row__source"></span>
          <span class="article-row__age"></span>
        </div>
        <h3 class="article-row__title"></h3>
        <p class="article-row__excerpt"></p>
      `;
      // textContent assignments — never innerHTML on user-ish fields
      div.querySelector(".article-row__source").textContent  = it.source;
      div.querySelector(".article-row__age").textContent     = it.age;
      div.querySelector(".article-row__title").textContent   = it.title;
      div.querySelector(".article-row__excerpt").textContent = it.excerpt;

      const activate = () => {
        this.setSelected(it.id);
        this.onSelect?.(it.id);
      };
      div.addEventListener("click", activate);
      div.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(); }
      });
      this.rowsEl.appendChild(div);
    });
  }

  #bindDensity() {
    const buttons = this.listEl.querySelectorAll(".list__density button");
    buttons.forEach(b => {
      b.addEventListener("click", () => {
        const d = b.dataset.density;
        this.listEl.dataset.density = d;
        buttons.forEach(x => x.setAttribute("aria-pressed", String(x.dataset.density === d)));
      });
    });
  }
}
