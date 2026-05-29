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

const BOARD_ID = "__board__";

const STATUS_LABELS = {
  LocalAdapter: "Stored on this device only. Configure a cloud adapter in Settings to sync across devices.",
  GitHubAdapter: "Synced to your GitHub repository.",
  WebDAVAdapter: "Synced to your WebDAV server.",
  S3Adapter: "Synced to your S3-compatible bucket.",
  DropboxAdapter: "Synced to your Dropbox.",
  TelegramAdapter: "Synced via your Telegram bot.",
  ChainAdapter: "Synced via your mirrored adapter chain.",
};

export class Dmz {
  constructor({ pageEl, listEl, formEl, textareaEl, submitBtn, store, statusEl, adapter, loadError, adapterFallback }) {
    this.pageEl = pageEl;
    this.listEl = listEl;
    this.formEl = formEl;
    this.textareaEl = textareaEl;
    this.submitBtn = submitBtn;
    this.store = store;
    this.statusEl = statusEl;
    this.kind = adapter?.constructor?.name || "LocalAdapter";
    this.loadErrorText = loadError ? `Could not load shared notes: ${loadError}` : "";
    this.adapterFallbackText = adapterFallback ? `Cloud adapter failed to start (${adapterFallback}). Falling back to local storage on this device only.` : "";

    this.#renderStatus();

    this.formEl.addEventListener("submit", (e) => {
      e.preventDefault();
      this.#save();
    });
    this.textareaEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        this.#save();
      }
    });
    this.textareaEl.addEventListener("input", () => this.#syncSubmitState());

    this.store.subscribe(() => this.#render());
    this.#syncSubmitState();
  }

  focusInput() {
    this.textareaEl.focus();
  }

  #renderStatus() {
    if (!this.statusEl) return;
    let text = "";
    let isError = false;
    if (this.loadErrorText) {
      text = this.loadErrorText;
      isError = true;
    } else if (this.adapterFallbackText) {
      text = this.adapterFallbackText;
      isError = true;
    } else {
      text = STATUS_LABELS[this.kind] || "Synced via the configured adapter.";
    }
    if (isError) this.statusEl.dataset.error = "true";
    else delete this.statusEl.dataset.error;
    this.statusEl.textContent = text;
  }

  async #save() {
    const body = this.textareaEl.value.trim();
    if (!body) return;
    await this.store.addNote(BOARD_ID, body);
    this.textareaEl.value = "";
    this.#syncSubmitState();
  }

  #syncSubmitState() {
    const has = this.textareaEl.value.trim().length > 0;
    if (this.submitBtn) this.submitBtn.disabled = !has;
  }

  #render() {
    const notes = this.store.notesFor(BOARD_ID);
    this.listEl.replaceChildren();
    if (!notes.length) {
      const empty = document.createElement("p");
      empty.className = "dmz__empty";
      empty.textContent = "The board is empty. Be the first to drop a thought.";
      this.listEl.appendChild(empty);
      return;
    }
    notes
      .slice()
      .sort((a, b) => b.at - a.at)
      .forEach(n => this.listEl.appendChild(this.#renderCard(n)));
  }

  #renderCard(n) {
    const card = document.createElement("article");
    card.className = "dmz-note";
    card.dataset.noteId = n.id;

    const meta = document.createElement("header");
    meta.className = "dmz-note__meta smallcaps";
    const time = document.createElement("span");
    time.textContent = fmtTime(n.at);
    const del = document.createElement("button");
    del.type = "button";
    del.className = "dmz-note__delete";
    del.title = "Remove from board";
    del.setAttribute("aria-label", "Remove note");
    del.textContent = "×";
    del.addEventListener("click", () => this.store.delNote(BOARD_ID, n.id));
    meta.append(time, del);

    const body = document.createElement("p");
    body.className = "dmz-note__body";
    body.textContent = n.body;

    card.append(meta, body);
    return card;
  }
}

export function mountRouter({ enterDmzBtn, exitDmzBtn, dmz }) {
  function go(page) {
    document.body.dataset.page = page;
    if (page === "dmz") {
      sessionStorage.setItem("coda.page", "dmz");
      dmz.focusInput();
    } else {
      sessionStorage.removeItem("coda.page");
    }
  }
  enterDmzBtn?.addEventListener("click", () => go("dmz"));
  exitDmzBtn?.addEventListener("click", () => go("reader"));

  const initial = sessionStorage.getItem("coda.page") === "dmz" ? "dmz" : "reader";
  document.body.dataset.page = initial;

  return { go };
}
