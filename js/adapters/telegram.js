const API = "https://api.telegram.org";

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

  async #loadManifest() {
    if (this._manifest) return this._manifest;
    let chat;
    try { chat = await this.#call("getChat", { chat_id: this.chatId }); }
    catch (e) { this._manifest = { log: null, snapshot: null }; return this._manifest; }
    const pinned = chat && chat.pinned_message;
    if (!pinned || typeof pinned.text !== "string") {
      this._manifest = { log: null, snapshot: null, manifestMsgId: null };
      return this._manifest;
    }
    let parsed = null;
    try { parsed = JSON.parse(pinned.text); } catch {}
    if (!parsed || parsed.coda !== this.prefix) {
      this._manifest = { log: null, snapshot: null, manifestMsgId: null };
      return this._manifest;
    }
    this._manifest = {
      log: parsed.log || null,
      snapshot: parsed.snapshot || null,
      manifestMsgId: pinned.message_id,
    };
    return this._manifest;
  }

  async #saveManifest(next) {
    const payload = JSON.stringify({
      coda: this.prefix,
      v: 1,
      log: next.log || null,
      snapshot: next.snapshot || null,
    });
    if (next.manifestMsgId) {
      await this.#call("editMessageText", {
        chat_id: this.chatId,
        message_id: next.manifestMsgId,
        text: payload,
      });
      this._manifest = next;
      return;
    }
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
    this._manifest = { ...next, manifestMsgId: sent.message_id };
  }

  async readLog() {
    const m = await this.#loadManifest();
    if (!m.log || !m.log.fileId) return [];
    const text = await this.#downloadFile(m.log.fileId);
    return text ? parseNdjson(text) : [];
  }

  async appendLog(events) {
    if (!events.length) return;
    const existing = await this.readLog();
    const body = eventsToNdjson([...existing, ...events]);
    const up = await this.#uploadDocument(`${this.prefix.replace(/\//g, "_")}_log.ndjson`, body);
    const m = await this.#loadManifest();
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
    const up = await this.#uploadDocument(
      `${this.prefix.replace(/\//g, "_")}_snapshot.json`,
      JSON.stringify(snapshot),
    );
    const m = await this.#loadManifest();
    await this.#saveManifest({
      ...m,
      snapshot: { fileId: up.fileId, messageId: up.messageId },
      log: null,
    });
  }

  async clear() {
    const m = await this.#loadManifest();
    if (m.manifestMsgId) {
      await this.#saveManifest({
        log: null,
        snapshot: null,
        manifestMsgId: m.manifestMsgId,
      });
    }
    this._manifest = { log: null, snapshot: null, manifestMsgId: m.manifestMsgId || null };
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
      if (e.code === 400 || e.status === 400) return { ok: false, error: "chat not found or bot not a member" };
      if (e.code === 403 || e.status === 403) return { ok: false, error: "bot kicked or blocked in chat" };
      return { ok: false, error: e.message || "getChat failed" };
    }
  }
}
