const API = "https://api.github.com";

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

function b64encode(text) {
  return btoa(unescape(encodeURIComponent(text)));
}

function b64decode(b64) {
  return decodeURIComponent(escape(atob(b64.replace(/\n/g, ""))));
}

export class GitHubAdapter {
  constructor({ token, owner, repo, branch = "main", prefix = "coda/v1" }) {
    if (!token) throw new Error("GitHubAdapter: token is required");
    if (!owner) throw new Error("GitHubAdapter: owner is required");
    if (!repo) throw new Error("GitHubAdapter: repo is required");
    this.token = token;
    this.owner = owner.replace(/^\/+|\/+$/g, "");
    this.repo = repo.replace(/^\/+|\/+$/g, "");
    this.branch = branch || "main";
    const sub = prefix.replace(/^\/+|\/+$/g, "");
    this.logPath = `${sub}/log.ndjson`;
    this.snapPath = `${sub}/snapshot.json`;
    this.shaCache = new Map();
    this.pathLocks = new Map();
  }

  #headers(extra = {}) {
    return {
      "Authorization": `Bearer ${this.token}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...extra,
    };
  }

  #contentsUrl(path) {
    return `${API}/repos/${this.owner}/${this.repo}/contents/${encodeURI(path)}?ref=${encodeURIComponent(this.branch)}`;
  }

  #writeUrl(path) {
    return `${API}/repos/${this.owner}/${this.repo}/contents/${encodeURI(path)}`;
  }

  async #read(path) {
    const r = await fetch(this.#contentsUrl(path), { headers: this.#headers() });
    if (r.status === 404) {
      this.shaCache.delete(path);
      return null;
    }
    if (!r.ok) throw new Error(`GitHub read ${path} ${r.status}`);
    const j = await r.json();
    if (j && j.sha) this.shaCache.set(path, j.sha);
    if (!j || typeof j.content !== "string") return "";
    return b64decode(j.content);
  }

  async #serialise(path, fn) {
    const prev = this.pathLocks.get(path);
    let release;
    const gate = new Promise(r => { release = r; });
    this.pathLocks.set(path, gate);
    if (prev) { try { await prev; } catch {} }
    try {
      return await fn();
    } finally {
      release();
      if (this.pathLocks.get(path) === gate) this.pathLocks.delete(path);
    }
  }

  async #putContents(path, buildBody, errLabel) {
    const MAX_ATTEMPTS = 4;
    const BASE_MS = 100;
    let lastStatus = 0;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      let sha = this.shaCache.get(path);
      if (!sha) {
        const probe = await fetch(this.#contentsUrl(path), { headers: this.#headers() });
        if (probe.ok) {
          const pj = await probe.json();
          if (pj && pj.sha) { sha = pj.sha; this.shaCache.set(path, sha); }
        } else if (probe.status !== 404) {
          throw new Error(`GitHub probe ${path} ${probe.status}`);
        }
      }
      const body = buildBody(sha);
      const r = await fetch(this.#writeUrl(path), {
        method: "PUT",
        headers: this.#headers({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      });
      if (r.ok) {
        const j = await r.json();
        if (j && j.content && j.content.sha) this.shaCache.set(path, j.content.sha);
        return;
      }
      lastStatus = r.status;
      if (r.status !== 409 && r.status !== 422) break;
      this.shaCache.delete(path);
      if (attempt === MAX_ATTEMPTS - 1) break;
      const delay = BASE_MS * Math.pow(2, attempt) * (0.5 + Math.random());
      await new Promise(res => setTimeout(res, delay));
    }
    throw new Error(`GitHub ${errLabel} ${path} ${lastStatus}`);
  }

  async #write(path, text, message) {
    return this.#serialise(path, () => this.#putContents(
      path,
      (sha) => {
        const body = { message: message || `coda: update ${path}`, content: b64encode(text), branch: this.branch };
        if (sha) body.sha = sha;
        return body;
      },
      "write",
    ));
  }

  async #delete(path, message) {
    let sha = this.shaCache.get(path);
    if (!sha) {
      const probe = await fetch(this.#contentsUrl(path), { headers: this.#headers() });
      if (probe.status === 404) return;
      if (!probe.ok) return;
      const pj = await probe.json();
      sha = pj && pj.sha;
      if (!sha) return;
    }
    const r = await fetch(this.#writeUrl(path), {
      method: "DELETE",
      headers: this.#headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        message: message || `coda: delete ${path}`,
        sha,
        branch: this.branch,
      }),
    });
    if (r.ok || r.status === 404) {
      this.shaCache.delete(path);
      return;
    }
  }

  async readLog() {
    const text = await this.#read(this.logPath);
    return text ? parseNdjson(text) : [];
  }

  async appendLog(events) {
    if (!events.length) return;
    const existing = await this.readLog();
    const body = eventsToNdjson([...existing, ...events]);
    await this.#write(this.logPath, body, `coda: append ${events.length} event(s)`);
  }

  async readSnapshot() {
    const text = await this.#read(this.snapPath);
    if (!text) return null;
    try { return JSON.parse(text); } catch { return null; }
  }

  async writeSnapshot(snapshot) {
    await this.#write(this.snapPath, JSON.stringify(snapshot), "coda: write snapshot");
    await this.#delete(this.logPath, "coda: snapshot rotated, clearing log");
  }

  async clear() {
    await this.#delete(this.logPath, "coda: clear log");
    await this.#delete(this.snapPath, "coda: clear snapshot");
  }

  async read(key) {
    return await this.#read(key);
  }

  async write(key, body) {
    await this.#write(key, body, `coda: update ${key}`);
  }

  async #writeB64(path, b64Content, message) {
    return this.#serialise(path, () => this.#putContents(
      path,
      (sha) => {
        const body = { message: message || `coda: upload ${path}`, content: b64Content, branch: this.branch };
        if (sha) body.sha = sha;
        return body;
      },
      "putBlob",
    ));
  }

  async putBlob(key, blob) {
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    const b64 = btoa(bin);
    await this.#writeB64(key, b64, `coda: upload ${key.split("/").pop()}`);
  }

  async getBlob(key) {
    const r = await fetch(this.#contentsUrl(key), { headers: this.#headers() });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`GitHub getBlob ${key} ${r.status}`);
    const j = await r.json();
    if (j && j.sha) this.shaCache.set(key, j.sha);
    if (!j || typeof j.content !== "string") return null;
    const b64 = j.content.replace(/\n/g, "");
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes]);
  }

  async deleteBlob(key) {
    await this.#delete(key, `coda: delete ${key.split("/").pop()}`);
  }

  async test() {
    const r = await fetch(`${API}/repos/${this.owner}/${this.repo}`, { headers: this.#headers() });
    if (r.ok) return { ok: true };
    if (r.status === 401) return { ok: false, error: "auth rejected" };
    if (r.status === 403) return { ok: false, error: "token lacks contents:write" };
    if (r.status === 404) return { ok: false, error: "repo not found or token lacks access" };
    return { ok: false, error: `status ${r.status}` };
  }
}
