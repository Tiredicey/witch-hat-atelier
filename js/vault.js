const HARD_CAP_BYTES = 100 * 1024 * 1024;

const CAP_LABELS = {
  LocalAdapter: "Stored in this browser (IndexedDB). Limit follows your device quota.",
  S3Adapter: "S3-compatible bucket. Object size gated by your provider's PUT cap.",
  WebDAVAdapter: "WebDAV server. Size gated by server config.",
  DropboxAdapter: "Dropbox single-shot upload caps at 150 MB per file.",
  GitHubAdapter: "GitHub Contents API caps at 100 MB; uploads over 1 MB are slow.",
  TelegramAdapter: "Telegram bot upload caps at 50 MB; round-trip download caps at 20 MB.",
  ChainAdapter: "Mirrored across configured adapters. Per-adapter caps still apply.",
};

function fmtBytes(n) {
  if (!Number.isFinite(n) || n < 0) return "0 B";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  const digits = v >= 100 ? 0 : v >= 10 ? 1 : 2;
  return `${v.toFixed(digits)} ${units[i]}`;
}

function fmtTime(at) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " \u00b7 " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function shortType(t) {
  if (!t) return "file";
  const tail = String(t).split("/").pop().split("+")[0];
  return tail ? tail.slice(0, 18).toLowerCase() : "file";
}

function genId() {
  return `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export class Vault {
  constructor({ pageEl, listEl, dropEl, fileInput, emptyEl, capEl, store, adapter, loadError }) {
    this.pageEl = pageEl;
    this.listEl = listEl;
    this.dropEl = dropEl;
    this.fileInput = fileInput;
    this.emptyEl = emptyEl;
    this.capEl = capEl;
    this.store = store;
    this.adapter = adapter;
    this.kind = adapter?.constructor?.name || "LocalAdapter";
    this.loadErrorText = loadError ? `Could not load saved files: ${loadError}` : "";

    this.#resetCap();

    this.fileInput.addEventListener("change", () => {
      const files = [...this.fileInput.files];
      this.fileInput.value = "";
      void this.#upload(files);
    });

    this.dropEl.addEventListener("dragover", (e) => {
      e.preventDefault();
      this.dropEl.dataset.over = "true";
    });
    this.dropEl.addEventListener("dragleave", () => {
      delete this.dropEl.dataset.over;
    });
    this.dropEl.addEventListener("drop", (e) => {
      e.preventDefault();
      delete this.dropEl.dataset.over;
      const files = [...(e.dataTransfer?.files || [])];
      void this.#upload(files);
    });

    this.store.subscribe(() => this.#render());
  }

  #setCap(text, isError = false) {
    if (!this.capEl) return;
    if (isError) this.capEl.dataset.error = "true";
    else delete this.capEl.dataset.error;
    this.capEl.textContent = text;
  }

  #resetCap() {
    if (this.loadErrorText) {
      this.#setCap(this.loadErrorText, true);
    } else {
      this.#setCap(CAP_LABELS[this.kind] || "Stored in the configured adapter.");
    }
  }

  #flashError(text) {
    this.#setCap(text, true);
    clearTimeout(this._capTimer);
    this._capTimer = setTimeout(() => this.#resetCap(), 5000);
  }

  async #upload(files) {
    for (const f of files) {
      if (f.size > HARD_CAP_BYTES) {
        this.#flashError(`${f.name}: ${fmtBytes(f.size)} exceeds the 100 MB ceiling`);
        continue;
      }
      await this.#uploadOne(f);
    }
  }

  async #uploadOne(file) {
    const id = genId();
    const key = `${this.store.prefix}/blobs/${id}`;
    const row = this.#pendingRow(file);
    this.listEl.prepend(row);
    if (this.emptyEl) this.emptyEl.hidden = true;
    try {
      await this.adapter.putBlob(key, file);
      await this.store.addFile({
        id,
        name: file.name,
        size: file.size,
        contentType: file.type || "application/octet-stream",
        key,
      });
      row.remove();
    } catch (e) {
      row.dataset.error = "true";
      const meta = row.querySelector(".vault-row__meta");
      if (meta) meta.textContent = `failed \u00b7 ${e?.message || "upload error"}`;
      this.#flashError(`${file.name}: ${e?.message || "upload error"}`);
    }
  }

  async #download(file) {
    try {
      const blob = await this.adapter.getBlob(file.key);
      if (!blob) {
        this.#flashError(`${file.name}: not present in storage`);
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name || "file";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
      this.#flashError(`${file.name}: ${e?.message || "download failed"}`);
    }
  }

  async #remove(file) {
    try { await this.adapter.deleteBlob(file.key); }
    catch (e) { console.warn("vault: deleteBlob failed, removing metadata anyway", e); }
    await this.store.delFile(file.id);
  }

  #pendingRow(file) {
    const row = document.createElement("article");
    row.className = "vault-row vault-row--pending";
    const head = document.createElement("header");
    head.className = "vault-row__head";
    const name = document.createElement("span");
    name.className = "vault-row__name";
    name.textContent = file.name;
    head.append(name);
    const meta = document.createElement("div");
    meta.className = "vault-row__meta smallcaps";
    meta.textContent = `uploading \u00b7 ${fmtBytes(file.size)}`;
    row.append(head, meta);
    return row;
  }

  #render() {
    const files = this.store.files();
    if (this.emptyEl) this.emptyEl.hidden = files.length > 0;
    this.listEl.replaceChildren();
    if (!files.length) return;
    files
      .slice()
      .sort((a, b) => b.at - a.at)
      .forEach(f => this.listEl.appendChild(this.#row(f)));
  }

  #row(f) {
    const row = document.createElement("article");
    row.className = "vault-row";
    row.dataset.fileId = f.id;

    const head = document.createElement("header");
    head.className = "vault-row__head";
    const name = document.createElement("button");
    name.type = "button";
    name.className = "vault-row__name vault-row__name-btn";
    name.textContent = f.name;
    name.title = "Download";
    name.setAttribute("aria-label", `Download ${f.name}`);
    name.addEventListener("click", () => this.#download(f));
    const del = document.createElement("button");
    del.type = "button";
    del.className = "vault-row__delete";
    del.title = "Remove from vault";
    del.setAttribute("aria-label", `Remove ${f.name}`);
    del.textContent = "\u00d7";
    del.addEventListener("click", () => this.#remove(f));
    head.append(name, del);

    const meta = document.createElement("div");
    meta.className = "vault-row__meta smallcaps";
    const size = document.createElement("span");
    size.className = "vault-row__size";
    size.textContent = fmtBytes(f.size);
    const type = document.createElement("span");
    type.className = "vault-row__type";
    type.textContent = shortType(f.contentType);
    const time = document.createElement("span");
    time.className = "vault-row__time";
    time.textContent = fmtTime(f.at);
    meta.append(size, type, time);

    row.append(head, meta);
    return row;
  }
}
