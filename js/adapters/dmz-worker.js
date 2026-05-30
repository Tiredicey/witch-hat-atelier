const CLIENT_KEY = "coda/dmz/client-id";
const TOKEN_MAP_KEY = "coda/dmz/delete-tokens";
const OWNER_KEY = "coda/dmz/owner-token";

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function ensureClientId() {
  let id = localStorage.getItem(CLIENT_KEY);
  if (!id) { id = uuid(); localStorage.setItem(CLIENT_KEY, id); }
  return id;
}

export function loadDeleteTokens() {
  try {
    const raw = localStorage.getItem(TOKEN_MAP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch { return {}; }
}

export function saveDeleteToken(noteId, token) {
  if (!noteId || !token) return;
  const map = loadDeleteTokens();
  map[noteId] = token;
  localStorage.setItem(TOKEN_MAP_KEY, JSON.stringify(map));
}

export function dropDeleteToken(noteId) {
  const map = loadDeleteTokens();
  if (!(noteId in map)) return;
  delete map[noteId];
  localStorage.setItem(TOKEN_MAP_KEY, JSON.stringify(map));
}

export function loadOwnerToken() {
  return localStorage.getItem(OWNER_KEY) || "";
}

export function saveOwnerToken(token) {
  if (!token) localStorage.removeItem(OWNER_KEY);
  else localStorage.setItem(OWNER_KEY, token);
}

export class DmzWorkerAdapter {
  constructor({ baseUrl } = {}) {
    if (baseUrl == null) throw new Error("DmzWorkerAdapter: baseUrl required");
    this.baseUrl = String(baseUrl).replace(/\/+$/, "");
    this.clientId = ensureClientId();
  }

  #url(path) { return `${this.baseUrl}${path}`; }

  #headers(extra = {}) {
    const headers = { "content-type": "application/json", "x-dmz-client": this.clientId, ...extra };
    const owner = loadOwnerToken();
    if (owner) headers["x-dmz-owner"] = owner;
    return headers;
  }

  async health() {
    const r = await fetch(this.#url("/dmz/health"), { headers: { "x-dmz-client": this.clientId } });
    if (!r.ok) throw new Error(`dmz health: ${r.status}`);
    return r.json();
  }

  async list({ limit = 200 } = {}) {
    const r = await fetch(this.#url(`/dmz/messages?limit=${limit}`), { headers: this.#headers() });
    if (!r.ok) throw new Error(`dmz list: ${r.status}`);
    const j = await r.json();
    return Array.isArray(j.notes) ? j.notes : [];
  }

  async post(body, { name } = {}) {
    const r = await fetch(this.#url("/dmz/message"), {
      method: "POST",
      headers: this.#headers(),
      body: JSON.stringify({ body, name }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const error = new Error(j.error || `dmz post: ${r.status}`);
      error.status = r.status;
      error.code = j.error;
      error.detail = j.detail;
      throw error;
    }
    if (j.deleteToken) saveDeleteToken(j.id, j.deleteToken);
    return j;
  }

  async edit(id, body) {
    const token = loadDeleteTokens()[id] || "";
    const r = await fetch(this.#url("/dmz/message"), {
      method: "PATCH",
      headers: this.#headers({ "x-dmz-token": token }),
      body: JSON.stringify({ id, body }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const error = new Error(j.error || `dmz edit: ${r.status}`);
      error.status = r.status;
      error.code = j.error;
      throw error;
    }
    return j;
  }

  async remove(id) {
    const token = loadDeleteTokens()[id] || "";
    const r = await fetch(this.#url("/dmz/message"), {
      method: "DELETE",
      headers: this.#headers({ "x-dmz-token": token }),
      body: JSON.stringify({ id }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const error = new Error(j.error || `dmz delete: ${r.status}`);
      error.status = r.status;
      error.code = j.error;
      throw error;
    }
    dropDeleteToken(id);
    return j;
  }

async uploadFile(file, { caption = "", name = "" } = {}) {
    const fd = new FormData();
    fd.append("file", file, file.name || "file");
    if (caption) fd.append("caption", caption);
    if (name) fd.append("author", name);
    const headers = { "x-dmz-client": this.clientId };
    const owner = loadOwnerToken();
    if (owner) headers["x-dmz-owner"] = owner;
    const r = await fetch(this.#url("/dmz/file"), { method: "POST", headers, body: fd });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const error = new Error(j.error || `dmz upload: ${r.status}`);
      error.status = r.status;
      error.code = j.error;
      error.detail = j.detail;
      throw error;
    }
    if (j.deleteToken) saveDeleteToken(j.id, j.deleteToken);
    return j;
  }

  fileUrl(id) {
    return `${this.baseUrl}/dmz/file?id=${encodeURIComponent(id)}`;
  }

  async migrate(notes) {
    const owner = loadOwnerToken();
    if (!owner) throw new Error("owner token required");
    const r = await fetch(this.#url("/dmz/migrate"), {
      method: "POST",
      headers: this.#headers(),
      body: JSON.stringify({ notes }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const error = new Error(j.error || `dmz migrate: ${r.status}`);
      error.status = r.status;
      error.code = j.error;
      throw error;
    }
    return j;
  }

  canManage(noteId) {
    if (loadOwnerToken()) return true;
    return Boolean(loadDeleteTokens()[noteId]);
  }
}

export class RemoteDmzStore {
  constructor({ adapter, pollMs = 5000, boardId }) {
    this.adapter = adapter;
    this.pollMs = pollMs;
    this.boardId = boardId;
    this.notes = [];
    this.listeners = new Set();
    this.timer = null;
    this.stopped = true;
    this.lastError = null;
  }

  async load() {
    try {
      this.notes = await this.adapter.list({ limit: 500 });
      this.lastError = null;
    } catch (e) {
      this.lastError = e?.message || String(e);
    }
    this.#emit();
    return this.notes;
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    const tick = async () => {
      if (this.stopped) return;
      try {
        const next = await this.adapter.list({ limit: 500 });
        if (this.#changed(next)) { this.notes = next; this.#emit(); }
        this.lastError = null;
      } catch (e) {
        this.lastError = e?.message || String(e);
      }
      if (!this.stopped) this.timer = setTimeout(tick, this.pollMs);
    };
    this.timer = setTimeout(tick, this.pollMs);
  }

  stop() {
    this.stopped = true;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  notesFor(id) {
    if (id !== this.boardId) return [];
    return this.notes.map(n => ({ ...n }));
  }

  itemFor() { return { id: this.boardId, notes: this.notes.slice() }; }

  async addNote(id, body, name = "") {
    if (id !== this.boardId) throw new Error("unknown board");
    const result = await this.adapter.post(body, { name });
    const optimistic = { id: result.id, body, at: result.at || Date.now(), name, clientId: this.adapter.clientId };
    this.notes = [optimistic, ...this.notes.filter(n => n.id !== result.id)];
    this.#emit();
    this.load();
    return result;
  }

  async delNote(id, noteId) {
    if (id !== this.boardId) throw new Error("unknown board");
    await this.adapter.remove(noteId);
    this.notes = this.notes.filter(n => n.id !== noteId);
    this.#emit();
    this.load();
  }

  async editNote(id, noteId, body) {
    if (id !== this.boardId) throw new Error("unknown board");
    const result = await this.adapter.edit(noteId, body);
    this.notes = this.notes.map(n => n.id === noteId ? { ...n, body, editedAt: Date.now() } : n);
    this.#emit();
    this.load();
    return result;
  }

  async uploadFile(id, file, caption, name = "") {
    if (id !== this.boardId) throw new Error("unknown board");
    const result = await this.adapter.uploadFile(file, { caption, name });
    await this.load();
    return result;
  }

  fileUrl(noteId) {
    return typeof this.adapter.fileUrl === "function" ? this.adapter.fileUrl(noteId) : null;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    try { fn(); } catch (e) { console.warn("dmz subscriber threw", e); }
    return () => this.listeners.delete(fn);
  }

  #emit() {
    for (const fn of this.listeners) {
      try { fn(); } catch (e) { console.warn("dmz subscriber threw", e); }
    }
  }

  #changed(next) {
    if (next.length !== this.notes.length) return true;
    for (let i = 0; i < next.length; i++) {
      const a = next[i], b = this.notes[i];
      if (!b || a.id !== b.id || a.body !== b.body || a.at !== b.at || a.editedAt !== b.editedAt) return true;
    }
    return false;
  }
}
