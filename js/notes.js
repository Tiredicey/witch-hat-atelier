function fmtTime(at) {
  const d = new Date(at);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " · " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export class Notes {
  constructor({ panelEl, listEl, formEl, textareaEl, saveBtn, cancelBtn, store }) {
    this.panelEl = panelEl;
    this.listEl = listEl;
    this.formEl = formEl;
    this.textareaEl = textareaEl;
    this.saveBtn = saveBtn;
    this.cancelBtn = cancelBtn;
    this.store = store;
    this.itemId = null;

    this.panelEl.dataset.open = "false";

    this.formEl.addEventListener("submit", (e) => {
      e.preventDefault();
      this.#save();
    });
    this.saveBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      this.#save();
    });
    this.cancelBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      this.close();
    });
    this.textareaEl.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        this.#save();
      }
    });

    this.store.subscribe(() => this.#renderList());
  }

  bind(itemId) {
    this.itemId = itemId;
    this.close();
    this.#renderList();
  }

  unbind() {
    this.itemId = null;
    this.close();
    this.listEl.replaceChildren();
  }

  open() {
    if (!this.itemId) return;
    this.panelEl.dataset.open = "true";
    this.textareaEl.focus();
  }

  close() {
    this.panelEl.dataset.open = "false";
    this.textareaEl.value = "";
  }

  isOpen() {
    return this.panelEl.dataset.open === "true";
  }

  async #save() {
    if (!this.itemId) return;
    const body = this.textareaEl.value.trim();
    if (!body) return;
    await this.store.addNote(this.itemId, body);
    this.textareaEl.value = "";
    this.panelEl.dataset.open = "false";
  }

  #renderList() {
    if (!this.itemId) return;
    const notes = this.store.notesFor(this.itemId);
    this.listEl.replaceChildren();
    if (!notes.length) {
      const empty = document.createElement("p");
      empty.className = "notes__empty smallcaps";
      empty.textContent = "no notes yet · press n to add one";
      this.listEl.appendChild(empty);
      return;
    }
    notes
      .slice()
      .sort((a, b) => b.at - a.at)
      .forEach(n => this.listEl.appendChild(this.#renderNote(n)));
  }

  #renderNote(n) {
    const card = document.createElement("article");
    card.className = "note";
    card.dataset.noteId = n.id;

    const meta = document.createElement("header");
    meta.className = "note__meta smallcaps";
    const time = document.createElement("span");
    time.textContent = fmtTime(n.at);
    const del = document.createElement("button");
    del.type = "button";
    del.className = "note__delete";
    del.setAttribute("aria-label", "Delete note");
    del.title = "Delete note";
    del.textContent = "×";
    del.addEventListener("click", () => this.store.delNote(this.itemId, n.id));
    meta.append(time, del);

    const body = document.createElement("p");
    body.className = "note__body";
    body.textContent = n.body;

    card.append(meta, body);
    return card;
  }
}
