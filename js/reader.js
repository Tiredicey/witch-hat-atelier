// reader.js
//
// Owns the .reader-wrap pane. Two render modes:
//   - renderEmpty()      "This shelf is quiet." per ROADMAP §7
//   - renderArticle(a)   header + flourish + body paragraphs
//
// Selection state toggles the watercolour-wash CSS hook on the wrapper.

export class Reader {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.wrapEl   — .reader-wrap
   * @param {HTMLElement} opts.readerEl — .reader (inside the wrap)
   * @param {HTMLElement=} opts.extractWrapEl    — .reader__extract host (hidden until link)
   * @param {HTMLButtonElement=} opts.extractBtn — Read-clean toggle
   * @param {HTMLElement=} opts.extractStatusEl  — aria-live status line
   * @param {string=} opts.extractBase           — origin for /extract (default same-origin "")
   * @param {(url:string)=>Promise<Response>=} opts.fetchImpl — injectable for tests
   */
  constructor({ wrapEl, readerEl, extractWrapEl, extractBtn, extractStatusEl, extractBase, fetchImpl, onArticleChange }) {
    this.wrapEl = wrapEl;
    this.readerEl = readerEl;
    this.onArticleChange = typeof onArticleChange === "function" ? onArticleChange : null;
    this.extractWrapEl   = extractWrapEl   || null;
    this.extractBtn      = extractBtn      || null;
    this.extractStatusEl = extractStatusEl || null;
    this.extractBase     = (extractBase != null ? extractBase : "").replace(/\/+$/, "");
    this.extractFetch    = fetchImpl || ((u) => fetch(u));
    this.currentArticle = null;
    this.extractActive  = false;
    this.savedBody      = null;
    if (this.extractBtn) {
      this.extractBtn.addEventListener("click", () => this.toggleExtract());
    }
    this.renderEmpty();
  }

  setExtractStatus(msg, status) {
    if (!this.extractStatusEl) return;
    this.extractStatusEl.textContent = msg || "";
    if (status) this.extractStatusEl.dataset.status = status;
    else this.extractStatusEl.removeAttribute("data-status");
  }

  resetExtract() {
    this.extractActive = false;
    this.savedBody = null;
    if (this.extractBtn) {
      this.extractBtn.setAttribute("aria-pressed", "false");
      this.extractBtn.textContent = "Read clean";
      this.extractBtn.disabled = false;
    }
    this.setExtractStatus("");
    const frame = this.readerEl.querySelector(".reader__extract-frame");
    if (frame) frame.remove();
  }

  syncExtractVisibility() {
    if (!this.extractWrapEl) return;
    const link = this.currentArticle && typeof this.currentArticle.link === "string" ? this.currentArticle.link.trim() : "";
    const ok = /^https?:\/\//i.test(link);
    this.extractWrapEl.hidden = !ok;
  }

  async toggleExtract() {
    if (!this.currentArticle || !this.extractBtn) return;
    const link = (this.currentArticle.link || "").trim();
    if (!/^https?:\/\//i.test(link)) return;
    if (this.extractActive) {
      const frame = this.readerEl.querySelector(".reader__extract-frame");
      if (frame) frame.remove();
      if (this.savedBody) this.readerEl.replaceChildren(this.savedBody);
      this.extractActive = false;
      this.extractBtn.setAttribute("aria-pressed", "false");
      this.extractBtn.textContent = "Read clean";
      this.setExtractStatus("");
      return;
    }
    this.extractBtn.disabled = true;
    this.setExtractStatus("Fetching clean copy…", "pending");
    const endpoint = `${this.extractBase}/extract?url=${encodeURIComponent(link)}`;
    try {
      const res = await this.extractFetch(endpoint);
      if (!res.ok) {
        this.setExtractStatus(`Extract failed (HTTP ${res.status}).`, "fail");
        return;
      }
      const html = await res.text();
      this.savedBody = this.readerEl.firstElementChild;
      const frame = document.createElement("iframe");
      frame.className = "reader__extract-frame";
      frame.setAttribute("title", `Clean copy of ${this.currentArticle.title || link}`);
      frame.setAttribute("sandbox", "allow-same-origin");
      frame.setAttribute("referrerpolicy", "no-referrer");
      frame.srcdoc = html;
      this.readerEl.replaceChildren(frame);
      this.extractActive = true;
      this.extractBtn.setAttribute("aria-pressed", "true");
      this.extractBtn.textContent = "Read original";
      this.setExtractStatus("Clean copy shown. Scripts stripped, print CSS promoted.", "ok");
    } catch (e) {
      this.setExtractStatus(`Extract error: ${e.message || e}`, "fail");
    } finally {
      this.extractBtn.disabled = false;
    }
  }

  renderEmpty() {
    this.readerEl.replaceChildren();
    const wrap = document.createElement("div");
    wrap.className = "reader__empty";
    wrap.innerHTML = `
      <div>
        <svg width="48" height="48" viewBox="0 0 24 24"
             style="stroke: var(--sepia); stroke-width: 1.2; fill: none;
                    stroke-linecap: round; stroke-linejoin: round;"
             aria-hidden="true">
          <path d="M4 18 Q 8 6, 12 12 T 20 6"/>
          <path d="M4 21 L 20 21"/>
        </svg>
        <p>This shelf is quiet.</p>
      </div>`;
    this.readerEl.appendChild(wrap);
    this.wrapEl.classList.remove("has-selection");
    this.currentArticle = null;
    if (this.onArticleChange) this.onArticleChange(null);
    this.resetExtract();
    this.syncExtractVisibility();
  }

  renderArticle(a) {
    this.currentArticle = a;
    if (this.onArticleChange) this.onArticleChange(a);
    this.resetExtract();
    this.syncExtractVisibility();
    this.readerEl.replaceChildren();
    const article = document.createElement("article");

    const h1 = document.createElement("h1");
    h1.textContent = a.title;
    article.appendChild(h1);

    let words = 0;
    for (const para of a.body) words += para.split(/\s+/).length;
    const mins = Math.max(1, Math.round(words / 200));

    const byline = document.createElement("p");
    byline.className = "byline";
    byline.textContent = `${a.source} · ${a.age} ago · ${mins} min read${a.read ? " · read" : ""}`;
    article.appendChild(byline);

    const flourish = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    flourish.setAttribute("class", "flourish");
    flourish.setAttribute("viewBox", "0 0 120 18");
    flourish.setAttribute("preserveAspectRatio", "none");
    flourish.setAttribute("aria-hidden", "true");
    flourish.innerHTML = `
      <path d="M2 9 Q 20 3, 40 9 T 80 9 T 118 9"
            fill="none" stroke="currentColor"
            stroke-width="0.9" stroke-opacity="0.5" stroke-linecap="round"/>
      <circle cx="60" cy="9" r="1.4" fill="currentColor" opacity="0.5"/>`;
    article.appendChild(flourish);

    for (const para of a.body) {
      const p = document.createElement("p");
      p.textContent = para;
      article.appendChild(p);
    }

    if (a.orphan && a.link) {
      const intro = document.createElement("p");
      intro.textContent = "Imported star — the original article lives at the source.";
      article.appendChild(intro);
      const linkPara = document.createElement("p");
      const anchor = document.createElement("a");
      anchor.href = a.link;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.textContent = a.link;
      linkPara.appendChild(anchor);
      article.appendChild(linkPara);
    } else {
      const note = document.createElement("p");
      note.className = "smallcaps";
      note.style.marginTop = "var(--gutter-xl)";
      note.style.color = "var(--ink-faint)";
      note.textContent = "sample content · the real reader fetches via the §4 worker";
      article.appendChild(note);
    }

    this.readerEl.appendChild(article);
    this.wrapEl.classList.add("has-selection");
    this.readerEl.scrollTop = 0;
  }
}
