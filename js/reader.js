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
   */
  constructor({ wrapEl, readerEl }) {
    this.wrapEl = wrapEl;
    this.readerEl = readerEl;
    this.renderEmpty();
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
  }

  renderArticle(a) {
    this.readerEl.replaceChildren();
    const article = document.createElement("article");

    const h1 = document.createElement("h1");
    h1.textContent = a.title;
    article.appendChild(h1);

    const byline = document.createElement("p");
    byline.className = "byline";
    byline.textContent = `${a.source} · ${a.age} ago${a.read ? " · read" : ""}`;
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

    const note = document.createElement("p");
    note.className = "smallcaps";
    note.style.marginTop = "var(--gutter-xl)";
    note.style.color = "var(--ink-faint)";
    note.textContent = "sample content · the real reader fetches via the §4 worker";
    article.appendChild(note);

    this.readerEl.appendChild(article);
    this.wrapEl.classList.add("has-selection");
    this.readerEl.scrollTop = 0;
  }
}
