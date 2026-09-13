// reader.js
//
// Owns the .reader-wrap pane. Two render modes:
//   - renderEmpty()      "This shelf is quiet." per ROADMAP §7
//   - renderArticle(a)   header + flourish + body paragraphs
//
// Selection state toggles the watercolour-wash CSS hook on the wrapper.

import { buildVideoEmbed } from "./video-embed.js";

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
  constructor({ wrapEl, readerEl, extractWrapEl, extractBtn, extractStatusEl, extractBase, extractEnabled, fetchImpl, onArticleChange, enrichImages }) {
    this.wrapEl = wrapEl;
    this.readerEl = readerEl;
    this.onArticleChange = typeof onArticleChange === "function" ? onArticleChange : null;
    this.extractWrapEl   = extractWrapEl   || null;
    this.extractBtn      = extractBtn      || null;
    this.extractStatusEl = extractStatusEl || null;
    this.extractBase     = (extractBase != null ? extractBase : "").replace(/\/+$/, "");
    this.extractEnabled  = extractEnabled != null ? !!extractEnabled : true;
    this.extractFetch    = fetchImpl || ((u) => fetch(u));
    this.enrichImages    = enrichImages != null ? !!enrichImages : true;
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
    if (!this.extractEnabled) {
      this.setExtractStatus("Read clean needs the extract Worker (ROADMAP §4), which isn’t configured in this build.", "info");
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
    wrap.innerHTML = `<div>
      <svg class="atelier-emblem" viewBox="0 0 300 300" aria-hidden="true">
        <g class="emblem-orbit"><circle cx="150" cy="150" r="132"/><circle cx="150" cy="150" r="124" stroke-dasharray="1 9"/><path d="M150 9v27 M150 264v27 M9 150h27 M264 150h27 M52 52l18 18 M230 230l18 18 M52 248l18-18 M230 70l18-18"/><path d="M150 30 270 210H30Z" opacity=".3"/></g>
        <path d="M77 204q32-18 73 3 41-21 73-3v32q-38-14-73 3-35-17-73-3Z M150 207v32 M85 211q26-10 55 2 M160 213q29-12 55-2 M85 221q26-10 55 2 M160 223q29-12 55-2"/>
        <path d="M80 181q70 22 140-1l-41-19-26-86-19 30-23 58Z M111 163q32 16 68-2 M134 105l29 18" stroke-width="1.6"/><circle cx="148" cy="147" r="9"/><path d="M145 147h6 M148 144v6 M108 90v12 M102 96h12 M207 118v16 M199 126h16"/>
      </svg>
      <h1>A little room<br>for what matters.</h1>
      <p class="empty-copy">This shelf is quiet.</p>
      <div class="empty-actions"><button type="button" data-reader-action="add" data-variant="primary">+ Add a feed</button><button type="button" data-reader-action="import">Import subscriptions</button></div>
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

    if (a.image && !(a.video && a.video.id)) {
      const img = document.createElement("img");
      img.className = "reader__image";
      img.src = a.image;
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      img.referrerPolicy = "no-referrer";
      article.appendChild(img);
    } else if (a.link && !(a.video && a.video.id) && this.enrichImages) {
      this.#enrichImage(a, flourish);
    }

    if (a.video && a.video.id) {
      const { holder, fallback } = buildVideoEmbed(a.video, "reader");
      article.appendChild(holder);
      article.appendChild(fallback);
    }

    const enc = a.enclosure;
    if (enc && enc.url) {
      const encType = enc.type || "";
      if (/^audio\//i.test(encType)) {
        const audio = document.createElement("audio");
        audio.controls = true;
        audio.preload = "none";
        audio.src = enc.url;
        audio.className = "reader__audio";
        article.appendChild(audio);
      } else if (/^video\//i.test(encType)) {
        const video = document.createElement("video");
        video.controls = true;
        video.preload = "none";
        video.src = enc.url;
        video.className = "reader__enclosureVideo";
        article.appendChild(video);
      } else if (/^image\//i.test(encType)) {
        const img = document.createElement("img");
        img.className = "reader__image";
        img.src = enc.url;
        img.alt = "";
        img.loading = "lazy";
        img.decoding = "async";
        img.referrerPolicy = "no-referrer";
        article.appendChild(img);
      }
    }

    for (const para of a.body) {
      const p = document.createElement("p");
      p.textContent = para;
      article.appendChild(p);
    }

    if (a.orphan && a.link) {
      const intro = document.createElement("p");
      intro.textContent = "Imported star. The original article lives at the source.";
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

  async #enrichImage(a, afterEl) {
    if (!a || !a.link) return;
    let image = "";
    try {
      const res = await this.extractFetch(`${this.extractBase}/ogimage?url=${encodeURIComponent(a.link)}`);
      if (res && res.ok) {
        const data = await res.json();
        image = data && data.image ? String(data.image) : "";
      }
    } catch { return; }
    if (!image || this.currentArticle !== a) return;
    a.image = image;
    const img = document.createElement("img");
    img.className = "reader__image";
    img.src = image;
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    if (afterEl && afterEl.insertAdjacentElement) afterEl.insertAdjacentElement("afterend", img);
  }
}
