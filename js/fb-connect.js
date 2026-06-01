// Compliant Facebook connector — client controller (ROADMAP §19).
//
// Drives the Settings "Connect Facebook" surface: opens the Worker OAuth
// popup, keeps the returned user access token in localStorage on this
// device only, previews the reader's own posts (count + up to five titles)
// before anything is subscribed, and disconnects by deleting the token.
// No app secret ever touches this file; the Worker holds it.

const TOKEN_KEY = "coda/social/fb-token";

export class FbConnect {
  constructor(opts = {}) {
    this.fetchBase = opts.fetchBase || "";
    this.connectBtn = opts.connectBtn || null;
    this.disconnectBtn = opts.disconnectBtn || null;
    this.previewBtn = opts.previewBtn || null;
    this.statusEl = opts.statusEl || null;
    this.previewEl = opts.previewEl || null;
    this.subscriptions = opts.subscriptions || null;
    this.shelfInput = opts.shelfInput || null;
    this._disclosed = false;
    this._onMessage = (e) => this.#onMessage(e);
  }

  init() {
    this.connectBtn?.addEventListener("click", () => this.#startLogin());
    this.disconnectBtn?.addEventListener("click", () => this.#disconnect());
    this.previewBtn?.addEventListener("click", () => this.#preview());
    if (typeof window !== "undefined") window.addEventListener("message", this._onMessage);
    this.#render();
  }

  #loadToken() {
    try {
      const raw = localStorage.getItem(TOKEN_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      return obj && typeof obj.token === "string" && obj.token ? obj : null;
    } catch { return null; }
  }

  #saveToken(token, expiresIn) {
    const expiresAt = expiresIn > 0 ? Date.now() + expiresIn * 1000 : 0;
    try { localStorage.setItem(TOKEN_KEY, JSON.stringify({ token, expiresAt })); } catch {}
  }

  #connected() {
    return Boolean(this.#loadToken());
  }

  #endpointOrigin() {
    try {
      const base = typeof location !== "undefined" && location.href ? location.href : "http://localhost/";
      return new URL(`${this.fetchBase || ""}/fb/feed`, base).origin;
    } catch { return this.fetchBase || "this Worker"; }
  }

  #startLogin() {
    const loginUrl = `${this.fetchBase || ""}/fb/login`;
    const win = typeof window !== "undefined"
      ? window.open(loginUrl, "coda-fb-login", "width=600,height=720")
      : null;
    if (!win) {
      this.#status("Allow popups for this site, then click Connect again.", "fail");
      return;
    }
    this.#status("Waiting for Facebook sign-in…", "pending");
  }

  #onMessage(e) {
    const d = e && e.data;
    if (!d || d.source !== "coda-fb") return;
    if (d.ok && typeof d.token === "string" && d.token) {
      this.#saveToken(d.token, Number(d.expiresIn) || 0);
      this.#render();
      this.#status("Connected. Preview your posts before subscribing.", "ok");
    } else {
      this.#status(d.error ? `Sign-in failed: ${d.error}` : "Sign-in failed.", "fail");
    }
  }

  #disconnect() {
    try { localStorage.removeItem(TOKEN_KEY); } catch {}
    this._disclosed = false;
    if (this.previewEl) { this.previewEl.innerHTML = ""; this.previewEl.hidden = true; }
    this.#render();
    this.#status("Disconnected. Token deleted from this device.", "ok");
  }

  async #preview() {
    const saved = this.#loadToken();
    if (!saved) { this.#status("Connect Facebook first.", "fail"); return; }
    if (!this._disclosed) {
      this.#renderDisclosure();
      return;
    }
    await this.#fetchAndRender(saved.token);
  }

  #renderDisclosure() {
    if (!this.previewEl) { this._disclosed = true; this.#preview(); return; }
    this.previewEl.hidden = false;
    this.previewEl.innerHTML = "";
    const note = document.createElement("p");
    note.className = "settings__test";
    note.dataset.kind = "pending";
    note.textContent = `This sends your Facebook access token to ${this.#endpointOrigin()} to fetch your own posts. Continue?`;
    const go = document.createElement("button");
    go.type = "button";
    go.id = "fb-preview-continue";
    go.dataset.variant = "primary";
    go.textContent = "Continue";
    go.addEventListener("click", () => { this._disclosed = true; this.#preview(); });
    this.previewEl.append(note, go);
  }

  async #fetchAndRender(token) {
    this.#status("Loading your posts…", "pending");
    const url = `${this.fetchBase || ""}/fb/feed?kind=posts&token=${encodeURIComponent(token)}`;
    let titles = [];
    try {
      const res = await fetch(url);
      const text = await res.text();
      if (!res.ok) {
        let msg = `Request failed (${res.status}).`;
        try { const j = JSON.parse(text); if (j && j.error) msg = j.error; } catch {}
        this.#status(`Could not load posts: ${msg}`, "fail");
        return;
      }
      const doc = new DOMParser().parseFromString(text, "application/xml");
      titles = Array.from(doc.querySelectorAll("entry > title")).map(t => t.textContent || "");
    } catch (e) {
      this.#status(`Could not load posts: ${String((e && e.message) || e)}`, "fail");
      return;
    }
    this.#renderPreview(titles);
  }

  #renderPreview(titles) {
    if (!this.previewEl) return;
    this.previewEl.hidden = false;
    this.previewEl.innerHTML = "";
    const count = document.createElement("p");
    count.className = "settings__test";
    count.dataset.kind = titles.length ? "ok" : "fail";
    count.textContent = titles.length
      ? `${titles.length} post${titles.length > 1 ? "s" : ""} found. Preview:`
      : "No posts returned for this account.";
    this.previewEl.append(count);
    if (titles.length) {
      const ul = document.createElement("ul");
      for (const t of titles.slice(0, 5)) {
        const li = document.createElement("li");
        li.textContent = t;
        ul.append(li);
      }
      this.previewEl.append(ul);
      const add = document.createElement("button");
      add.type = "button";
      add.id = "fb-preview-add";
      add.dataset.variant = "primary";
      add.textContent = "Add to subscriptions";
      add.addEventListener("click", () => this.#add(add));
      this.previewEl.append(add);
    }
  }

  async #add(btn) {
    const saved = this.#loadToken();
    if (!saved || !this.subscriptions) { this.#status("Connect Facebook first.", "fail"); return; }
    btn.disabled = true;
    const shelf = (this.shelfInput?.value || "all").trim() || "all";
    const url = `${this.fetchBase || ""}/fb/feed?kind=posts&token=${encodeURIComponent(saved.token)}`;
    try {
      const written = await this.subscriptions.appendFeed({ url, title: "My Facebook posts", shelf });
      this.#status(
        written.added
          ? `Added (${written.totalFeeds} total).`
          : `Already in subscriptions (${written.totalFeeds} total).`,
        written.added ? "ok" : "fail",
      );
    } catch (e) {
      this.#status(`Add failed: ${String((e && e.message) || e)}`, "fail");
    } finally {
      btn.disabled = false;
    }
  }

  #render() {
    const on = this.#connected();
    if (this.connectBtn) this.connectBtn.hidden = on;
    if (this.disconnectBtn) this.disconnectBtn.hidden = !on;
    if (this.previewBtn) this.previewBtn.hidden = !on;
  }

  #status(msg, kind) {
    if (!this.statusEl) return;
    this.statusEl.textContent = msg;
    this.statusEl.dataset.kind = kind || "";
  }
}
