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
const NAME_KEY = "coda/dmz/display-name";

function loadDisplayName() {
  try { return (localStorage.getItem(NAME_KEY) || "").slice(0, 64); } catch { return ""; }
}

function saveDisplayName(name) {
  try {
    const trimmed = String(name || "").trim().slice(0, 64);
    if (trimmed) localStorage.setItem(NAME_KEY, trimmed);
    else localStorage.removeItem(NAME_KEY);
  } catch {}
}

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
  constructor({ pageEl, listEl, formEl, textareaEl, submitBtn, store, statusEl, adapter, loadError, adapterFallback, canManage, modeLabel, onPostError, fileInputEl, attachBtn, fileUrlFor, nameEl }) {
    this.pageEl = pageEl;
    this.listEl = listEl;
    this.formEl = formEl;
    this.textareaEl = textareaEl;
    this.submitBtn = submitBtn;
    this.store = store;
    this.statusEl = statusEl;
    this.kind = adapter?.constructor?.name || "LocalAdapter";
    this.canManage = typeof canManage === "function" ? canManage : () => true;
    this.modeLabel = modeLabel || "";
    this.onPostError = typeof onPostError === "function" ? onPostError : null;
    this.fileInputEl = fileInputEl || null;
    this.attachBtn = attachBtn || null;
    this.nameEl = nameEl || null;
    this.fileUrlFor = typeof fileUrlFor === "function" ? fileUrlFor : null;
    this.canUpload = typeof store.uploadFile === "function" && !!this.fileInputEl;
    this.canEdit = typeof store.editNote === "function";
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

    if (this.attachBtn) {
      if (!this.canUpload) {
        this.attachBtn.hidden = true;
      } else {
        this.attachBtn.hidden = false;
        this.attachBtn.addEventListener("click", () => this.fileInputEl.click());
        this.fileInputEl.addEventListener("change", () => this.#upload());
      }
    }

    if (this.nameEl) {
      const saved = loadDisplayName();
      if (saved) this.nameEl.value = saved;
      this.nameEl.addEventListener("change", () => saveDisplayName(this.nameEl.value));
    }

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
    } else if (this.modeLabel) {
      text = this.modeLabel;
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
    try {
      await this.store.addNote(BOARD_ID, body, this.#name());
      this.textareaEl.value = "";
    } catch (e) {
      if (this.onPostError) this.onPostError(e, body);
      else throw e;
    }
    this.#syncSubmitState();
  }

  #syncSubmitState() {
    const has = this.textareaEl.value.trim().length > 0;
    if (this.submitBtn) this.submitBtn.disabled = !has;
  }

  #name() {
    if (!this.nameEl) return "";
    const value = this.nameEl.value.trim().slice(0, 64);
    saveDisplayName(value);
    return value;
  }

  async #upload() {
    const file = this.fileInputEl.files && this.fileInputEl.files[0];
    if (!file) return;
    const wasLabel = this.attachBtn ? this.attachBtn.textContent : "";
    if (this.attachBtn) { this.attachBtn.disabled = true; this.attachBtn.textContent = "Uploading\u2026"; }
    try {
      await this.store.uploadFile(BOARD_ID, file, this.textareaEl.value.trim(), this.#name());
      this.textareaEl.value = "";
      this.#syncSubmitState();
    } catch (e) {
      if (this.onPostError) this.onPostError(e, null); else throw e;
    } finally {
      this.fileInputEl.value = "";
      if (this.attachBtn) { this.attachBtn.disabled = false; this.attachBtn.textContent = wasLabel; }
    }
  }

  #fmtSize(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  #beginEdit(card, note) {
    if (card.querySelector(".dmz-note__editor")) return;
    const bodyEl = card.querySelector(".dmz-note__body");
    const editor = document.createElement("div");
    editor.className = "dmz-note__editor";
    const ta = document.createElement("textarea");
    ta.value = note.body;
    ta.rows = Math.min(8, Math.max(2, note.body.split("\\n").length));
    const actions = document.createElement("div");
    actions.className = "dmz-note__editor-actions";
    const save = document.createElement("button");
    save.type = "button";
    save.dataset.variant = "primary";
    save.textContent = "Save";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    const restore = () => { editor.replaceWith(bodyEl); };
    cancel.addEventListener("click", restore);
    save.addEventListener("click", async () => {
      const next = ta.value.trim();
      if (!next || next === note.body) { restore(); return; }
      save.disabled = true;
      try {
        await this.store.editNote(BOARD_ID, note.id, next);
      } catch (e) {
        save.disabled = false;
        if (this.onPostError) this.onPostError(e, null); else throw e;
        return;
      }
    });
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); restore(); }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save.click(); }
    });
    actions.append(save, cancel);
    editor.append(ta, actions);
    bodyEl.replaceWith(editor);
    ta.focus();
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
    const isFile = n.kind === "file" && n.file;

    const meta = document.createElement("header");
    meta.className = "dmz-note__meta smallcaps";
    const when = document.createElement("span");
    when.className = "dmz-note__when";
    const author = (n.name || "").trim();
    if (author) {
      const who = document.createElement("span");
      who.className = "dmz-note__author";
      who.textContent = author;
      when.append(who);
    }
    const time = document.createElement("span");
    time.className = "dmz-note__time";
    time.textContent = fmtTime(n.at) + (n.editedAt ? " · edited" : "");
    when.append(time);
    meta.append(when);

    const tools = document.createElement("span");
    tools.className = "dmz-note__tools";
    if (!isFile && this.canEdit && this.canManage(n.id)) {
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "dmz-note__edit";
      edit.title = "Edit this note";
      edit.setAttribute("aria-label", "Edit note");
      edit.textContent = "Edit";
      edit.addEventListener("click", () => this.#beginEdit(card, n));
      tools.append(edit);
    }
    if (this.canManage(n.id)) {
      const del = document.createElement("button");
      del.type = "button";
      del.className = "dmz-note__delete";
      del.title = "Remove from board";
      del.setAttribute("aria-label", "Remove note");
      del.textContent = "×";
      del.addEventListener("click", async () => {
        try { await this.store.delNote(BOARD_ID, n.id); }
        catch (e) { if (this.onPostError) this.onPostError(e, null); else throw e; }
      });
      tools.append(del);
    }
    meta.append(tools);
    card.append(meta);

    if (isFile) {
      card.append(this.#renderFile(n));
    }
    if (!isFile || n.body) {
      const body = document.createElement("p");
      body.className = "dmz-note__body";
      body.textContent = n.body;
      card.append(body);
    }
    return card;
  }

  #renderFile(n) {
    const wrap = document.createElement("div");
    wrap.className = "dmz-note__file";
    const url = this.fileUrlFor ? this.fileUrlFor(n.id)
      : (typeof this.store.fileUrl === "function" ? this.store.fileUrl(n.id) : null);
    const mime = (n.file.mime || "").toLowerCase();
    const isImage = mime.startsWith("image/") && !mime.includes("svg");

    if (isImage && url) {
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      const img = document.createElement("img");
      img.className = "dmz-note__thumb";
      img.loading = "lazy";
      img.alt = n.file.name || "shared image";
      img.src = url;
      link.append(img);
      wrap.append(link);
    }

    const row = document.createElement("a");
    row.className = "dmz-note__file-link";
    if (url) {
      row.href = url;
      row.target = "_blank";
      row.rel = "noopener noreferrer";
      if (!isImage) row.setAttribute("download", n.file.name || "file");
    }
    const nameEl = document.createElement("span");
    nameEl.className = "dmz-note__file-name";
    nameEl.textContent = n.file.name || "file";
    const sizeEl = document.createElement("span");
    sizeEl.className = "dmz-note__file-size smallcaps";
    sizeEl.textContent = this.#fmtSize(n.file.size);
    row.append(nameEl, sizeEl);
    wrap.append(row);
    return wrap;
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
