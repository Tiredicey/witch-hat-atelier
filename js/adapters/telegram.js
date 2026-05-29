const API = "https://api.telegram.org";
const MANIFEST_CACHE_PREFIX = "coda/telegram-manifest/";

function parseNdjson(text) {
  if (!text) return [];
  const out = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try { out.push(JSON.parse(line)); } catch {}
  }
  return out;
}

function eventsToNdjson(events) {
  return events.map(e => JSON.stringify(e)).join("\n");
}

function safeLocalStorage() {
  try {
    if (typeof localStorage === "undefined") return null;
    const probe = "__coda_probe__";
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

export class TelegramAdapter {
  constructor({ token, chatId, prefix = "coda/v1" }) {
    if (!token) throw new Error("TelegramAdapter: token is required");
    if (!chatId) throw new Error("TelegramAdapter: chatId is required");
    this.token = token;
    this.chatId = String(chatId);
    this.prefix = prefix.replace(/^\/+|\/+$/g, "");
    this._manifest = null;
  }

  #botUrl(method) {
    return `${API}/bot${this.token}/${method}`;
  }

  async #call(method, body) {
    const r = await fetch(this.#botUrl(method), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) {
      const err = new Error(`Telegram ${method}: ${j.description || r.status}`);
      err.status = r.status;
      err.code = j.error_code;
      throw err;
    }
    return j.result;
  }

  async #uploadDocument(filename, text) {
    const fd = new FormData();
    fd.append("chat_id", this.chatId);
    fd.append("disable_notification", "true");
    fd.append("document", new Blob([text], { type: "application/octet-stream" }), filename);
    const r = await fetch(this.#botUrl("sendDocument"), { method: "POST", body: fd });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) {
      const err = new Error(`Telegram sendDocument: ${j.description || r.status}`);
      err.status = r.status;
      throw err;
    }
    const doc = j.result && j.result.document;
    if (!doc || !doc.file_id) throw new Error("Telegram sendDocument: missing file_id");
    return { fileId: doc.file_id, messageId: j.result.message_id };
  }

  async #downloadFile(fileId) {
    const meta = await this.#call("getFile", { file_id: fileId });
    if (!meta || !meta.file_path) throw new Error("Telegram getFile: missing file_path");
    const r = await fetch(`${API}/file/bot${this.token}/${meta.file_path}`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`Telegram file download ${r.status}`);
    return await r.text();
  }

  #cacheKey() {
    const chat = this.chatId.replace(/[^A-Za-z0-9_-]/g, "_");
    return `${MANIFEST_CACHE_PREFIX}${this.prefix}/${chat}`;
  }

  #loadCache() {
    const ls = safeLocalStorage();
    if (!ls) return null;
    const raw = ls.getItem(this.#cacheKey());
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      if (parsed.coda && parsed.coda !== this.prefix) return null;
      return {
        log: parsed.log || null,
        snapshot: parsed.snapshot || null,
        manifestMsgId: parsed.manifestMsgId || null,
      };
    } catch { return null; }
  }

  #saveCache(next) {
    const ls = safeLocalStorage();
    if (!ls) return;
    try {
      ls.setItem(this.#cacheKey(), JSON.stringify({
        coda: this.prefix,
        v: 1,
        log: next.log || null,
        snapshot: next.snapshot || null,
        manifestMsgId: next.manifestMsgId || null,
        savedAt: Date.now(),
      }));
    } catch {}
  }

  #clearCache() {
    const ls = safeLocalStorage();
    if (!ls) return;
    try { ls.removeItem(this.#cacheKey()); } catch {}
  }

  async #loadManifest() {
    if (this._manifest) return this._manifest;

    let chat = null;
    let chatErr = null;
    try {
      chat = await this.#call("getChat", { chat_id: this.chatId });
    } catch (e) {
      chatErr = e;
    }

    if (chat) {
      const pinned = chat.pinned_message;
      if (pinned && typeof pinned.text === "string") {
        let parsed = null;
        try { parsed = JSON.parse(pinned.text); } catch {}
        if (parsed && parsed.coda === this.prefix) {
          const m = {
            log: parsed.log || null,
            snapshot: parsed.snapshot || null,
            manifestMsgId: pinned.message_id,
          };
          this._manifest = m;
          this.#saveCache(m);
          return m;
        }
      }
      const cached = this.#loadCache();
      if (cached && cached.manifestMsgId) {
        this._manifest = { ...cached, _recovered: true };
        return this._manifest;
      }
      const empty = { log: null, snapshot: null, manifestMsgId: null };
      this._manifest = empty;
      return empty;
    }

    const cached = this.#loadCache();
    if (cached && (cached.log || cached.snapshot || cached.manifestMsgId)) {
      this._manifest = { ...cached, _recovered: true };
      return this._manifest;
    }

    const hint = (chatErr && (chatErr.code === 400 || chatErr.status === 400))
      ? " (check chatId: channels/supergroups need the -100\u2026 prefix; private chats need /start with the bot)"
      : "";
    const err = new Error(`TelegramAdapter: cannot reach chat ${this.chatId}${hint}`);
    err.cause = chatErr;
    err.status = chatErr && chatErr.status;
    err.code = chatErr && chatErr.code;
    throw err;
  }

  async #saveManifest(next) {
    const payload = JSON.stringify({
      coda: this.prefix,
      v: 1,
      log: next.log || null,
      snapshot: next.snapshot || null,
    });
    let manifestMsgId = next.manifestMsgId || null;
    if (manifestMsgId) {
      try {
        await this.#call("editMessageText", {
          chat_id: this.chatId,
          message_id: manifestMsgId,
          text: payload,
        });
      } catch (e) {
        if (e.code === 400 || e.status === 400) {
          manifestMsgId = null;
        } else {
          throw e;
        }
      }
    }
    if (!manifestMsgId) {
      const sent = await this.#call("sendMessage", {
        chat_id: this.chatId,
        text: payload,
        disable_notification: true,
      });
      await this.#call("pinChatMessage", {
        chat_id: this.chatId,
        message_id: sent.message_id,
        disable_notification: true,
      }).catch(() => {});
      manifestMsgId = sent.message_id;
    }
    const persisted = {
      log: next.log || null,
      snapshot: next.snapshot || null,
      manifestMsgId,
    };
    this._manifest = persisted;
    this.#saveCache(persisted);
  }

  async readLog() {
    const m = await this.#loadManifest();
    if (!m.log || !m.log.fileId) return [];
    const text = await this.#downloadFile(m.log.fileId);
    return text ? parseNdjson(text) : [];
  }

  async appendLog(events) {
    if (!events.length) return;
    const m = await this.#loadManifest();
    const existing = m.log && m.log.fileId
      ? parseNdjson((await this.#downloadFile(m.log.fileId)) || "")
      : [];
    const body = eventsToNdjson([...existing, ...events]);
    const up = await this.#uploadDocument(`${this.prefix.replace(/\//g, "_")}_log.ndjson`, body);
    await this.#saveManifest({ ...m, log: { fileId: up.fileId, messageId: up.messageId } });
  }

  async readSnapshot() {
    const m = await this.#loadManifest();
    if (!m.snapshot || !m.snapshot.fileId) return null;
    const text = await this.#downloadFile(m.snapshot.fileId);
    if (!text) return null;
    try { return JSON.parse(text); } catch { return null; }
  }

  async writeSnapshot(snapshot) {
    const m = await this.#loadManifest();
    const up = await this.#uploadDocument(
      `${this.prefix.replace(/\//g, "_")}_snapshot.json`,
      JSON.stringify(snapshot),
    );
    await this.#saveManifest({
      ...m,
      snapshot: { fileId: up.fileId, messageId: up.messageId },
      log: null,
    });
  }

  async clear() {
    let m;
    try { m = await this.#loadManifest(); }
    catch { m = { log: null, snapshot: null, manifestMsgId: null }; }
    if (m.manifestMsgId) {
      await this.#saveManifest({
        log: null,
        snapshot: null,
        manifestMsgId: m.manifestMsgId,
      });
    }
    this._manifest = { log: null, snapshot: null, manifestMsgId: m.manifestMsgId || null };
    this.#clearCache();
  }

  async test() {
    try {
      const me = await this.#call("getMe");
      if (!me || !me.is_bot) return { ok: false, error: "not a bot token" };
    } catch (e) {
      if (e.status === 401 || e.code === 401) return { ok: false, error: "auth rejected" };
      return { ok: false, error: e.message || "getMe failed" };
    }
    try {
      await this.#call("getChat", { chat_id: this.chatId });
      return { ok: true };
    } catch (e) {
      if (e.code === 400 || e.status === 400) {
        return { ok: false, error: "chat not found or bot not a member (channels/supergroups need the -100\u2026 prefix)" };
      }
      if (e.code === 403 || e.status === 403) return { ok: false, error: "bot kicked or blocked in chat" };
      return { ok: false, error: e.message || "getChat failed" };
    }
  }
}
