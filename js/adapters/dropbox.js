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

const CONTENT = "https://content.dropboxapi.com/2";
const API = "https://api.dropboxapi.com/2";

export class DropboxAdapter {
  constructor({ token, path = "/Apps/CODA", prefix = "coda/v1" }) {
    if (!token) throw new Error("DropboxAdapter: token is required");
    this.token = token;
    this.base = path.replace(/\/+$/, "");
    const sub = prefix.replace(/^\/+|\/+$/g, "");
    this.logPath = `${this.base}/${sub}/log.ndjson`;
    this.snapPath = `${this.base}/${sub}/snapshot.json`;
  }

  #auth() {
    return { "Authorization": `Bearer ${this.token}` };
  }

  async #download(path) {
    const r = await fetch(`${CONTENT}/files/download`, {
      method: "POST",
      headers: { ...this.#auth(), "Dropbox-API-Arg": JSON.stringify({ path }) },
    });
    if (r.status === 409) return null;
    if (!r.ok) throw new Error(`Dropbox download ${r.status}`);
    return await r.text();
  }

  async #upload(path, body) {
    const r = await fetch(`${CONTENT}/files/upload`, {
      method: "POST",
      headers: {
        ...this.#auth(),
        "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": JSON.stringify({ path, mode: "overwrite", autorename: false, mute: true }),
      },
      body,
    });
    if (!r.ok) throw new Error(`Dropbox upload ${r.status}`);
  }

  async #delete(path) {
    await fetch(`${API}/files/delete_v2`, {
      method: "POST",
      headers: { ...this.#auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    }).catch(() => {});
  }

  async readLog() {
    const text = await this.#download(this.logPath);
    return text ? parseNdjson(text) : [];
  }

  async appendLog(events) {
    if (!events.length) return;
    const existing = await this.readLog();
    const body = eventsToNdjson([...existing, ...events]);
    await this.#upload(this.logPath, body);
  }

  async readSnapshot() {
    const text = await this.#download(this.snapPath);
    if (!text) return null;
    try { return JSON.parse(text); } catch { return null; }
  }

  async writeSnapshot(snapshot) {
    await this.#upload(this.snapPath, JSON.stringify(snapshot));
    await this.#delete(this.logPath);
  }

  async clear() {
    await this.#delete(this.logPath);
    await this.#delete(this.snapPath);
  }

  async read(key) {
    const text = await this.#download(`${this.base}/${key.replace(/^\/+/, "")}`);
    return text == null ? null : text;
  }

  async write(key, body) {
    await this.#upload(`${this.base}/${key.replace(/^\/+/, "")}`, body);
  }

  async test() {
    const r = await fetch(`${API}/check/user`, {
      method: "POST",
      headers: { ...this.#auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ query: "ping" }),
    });
    if (r.ok) return { ok: true };
    if (r.status === 401) return { ok: false, error: "token rejected" };
    return { ok: false, error: `status ${r.status}` };
  }
}
