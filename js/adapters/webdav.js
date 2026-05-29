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

export class WebDAVAdapter {
  constructor({ url, username = "", password = "", prefix = "coda/v1" }) {
    if (!url) throw new Error("WebDAVAdapter: url is required");
    this.base = url.replace(/\/+$/, "");
    this.prefix = prefix.replace(/^\/+|\/+$/g, "");
    this.auth = (username || password)
      ? "Basic " + btoa(`${username}:${password}`)
      : null;
    this.logUrl = `${this.base}/${this.prefix}/log.ndjson`;
    this.snapUrl = `${this.base}/${this.prefix}/snapshot.json`;
  }

  #headers(extra = {}) {
    const h = { ...extra };
    if (this.auth) h["Authorization"] = this.auth;
    return h;
  }

  async readLog() {
    const r = await fetch(this.logUrl, { headers: this.#headers() });
    if (r.status === 404) return [];
    if (!r.ok) throw new Error(`WebDAV readLog ${r.status}`);
    return parseNdjson(await r.text());
  }

  async appendLog(events) {
    if (!events.length) return;
    const existing = await this.readLog();
    const body = eventsToNdjson([...existing, ...events]);
    const r = await fetch(this.logUrl, {
      method: "PUT",
      headers: this.#headers({ "Content-Type": "application/octet-stream" }),
      body,
    });
    if (!r.ok && r.status !== 201 && r.status !== 204) {
      throw new Error(`WebDAV appendLog ${r.status}`);
    }
  }

  async readSnapshot() {
    const r = await fetch(this.snapUrl, { headers: this.#headers() });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`WebDAV readSnapshot ${r.status}`);
    try { return await r.json(); } catch { return null; }
  }

  async writeSnapshot(snapshot) {
    const r = await fetch(this.snapUrl, {
      method: "PUT",
      headers: this.#headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(snapshot),
    });
    if (!r.ok && r.status !== 201 && r.status !== 204) {
      throw new Error(`WebDAV writeSnapshot ${r.status}`);
    }
    await fetch(this.logUrl, { method: "DELETE", headers: this.#headers() }).catch(() => {});
  }

  async clear() {
    await fetch(this.logUrl, { method: "DELETE", headers: this.#headers() }).catch(() => {});
    await fetch(this.snapUrl, { method: "DELETE", headers: this.#headers() }).catch(() => {});
  }

  async read(key) {
    const r = await fetch(`${this.base}/${key.replace(/^\/+/, "")}`, { headers: this.#headers() });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`WebDAV read ${key} ${r.status}`);
    return await r.text();
  }

  async write(key, body) {
    const r = await fetch(`${this.base}/${key.replace(/^\/+/, "")}`, {
      method: "PUT",
      headers: this.#headers({ "Content-Type": "application/octet-stream" }),
      body,
    });
    if (!r.ok && r.status !== 201 && r.status !== 204) {
      throw new Error(`WebDAV write ${key} ${r.status}`);
    }
  }

  async putBlob(key, blob) {
    const r = await fetch(`${this.base}/${key.replace(/^\/+/, "")}`, {
      method: "PUT",
      headers: this.#headers({ "Content-Type": blob.type || "application/octet-stream" }),
      body: blob,
    });
    if (!r.ok && r.status !== 201 && r.status !== 204) {
      throw new Error(`WebDAV putBlob ${r.status}`);
    }
  }

  async getBlob(key) {
    const r = await fetch(`${this.base}/${key.replace(/^\/+/, "")}`, { headers: this.#headers() });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`WebDAV getBlob ${r.status}`);
    return await r.blob();
  }

  async deleteBlob(key) {
    const r = await fetch(`${this.base}/${key.replace(/^\/+/, "")}`, {
      method: "DELETE", headers: this.#headers(),
    });
    if (!r.ok && r.status !== 204 && r.status !== 404) {
      throw new Error(`WebDAV deleteBlob ${r.status}`);
    }
  }

  async test() {
    const r = await fetch(this.snapUrl, { method: "HEAD", headers: this.#headers() });
    if (r.ok || r.status === 404) return { ok: true };
    if (r.status === 401 || r.status === 403) return { ok: false, error: "auth rejected" };
    return { ok: false, error: `status ${r.status}` };
  }
}
