// welcome.js
//
// First-boot onboarding overlay. Three steps, parchment-and-ink visual
// system per ROADMAP §6, no marketing filler per ROADMAP §7 empty-state
// rule. Renders only when `coda/onboarded` is absent from localStorage.
//
// Step 1: paste a feed URL (with a "Try Hacker News" prefilled shortcut
//         pointing at https://news.ycombinator.com/rss — canonical HN feed
//         URL, well-known, not invented).
// Step 2: choose where reading state lives. Local is set immediately;
//         "Cloud sync" closes the overlay and navigates to Settings
//         instead of pretending to do OAuth inside a modal.
// Step 3: confirmation — closes overlay, marks onboarded.
//
// The controller does not own subscription state; it calls
// `subscriptions.appendFeed(...)` so step 1 writes through the same path
// every other import uses. If appendFeed fails the overlay surfaces the
// real error instead of swallowing it.

const ONBOARDED_KEY = "coda/onboarded";
const HN_FEED_URL   = "https://news.ycombinator.com/rss";

export function isOnboarded() {
  try { return localStorage.getItem(ONBOARDED_KEY) === "true"; }
  catch { return true; }
}

export function markOnboarded() {
  try { localStorage.setItem(ONBOARDED_KEY, "true"); }
  catch { /* private mode — proceed anyway */ }
}

export class Welcome {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.scrimEl      — #welcomeScrim
   * @param {HTMLInputElement} opts.urlInput — #welcomeFeedUrl
   * @param {HTMLButtonElement} opts.hnBtn   — #welcomeHnBtn
   * @param {HTMLButtonElement} opts.nextBtn — #welcomeStep1Next
   * @param {HTMLElement} opts.statusEl     — #welcomeStatus
   * @param {HTMLButtonElement[]} opts.skipBtns — every skip control
   * @param {NodeListOf<HTMLButtonElement>} opts.choiceBtns — step-2 choices
   * @param {HTMLButtonElement} opts.doneBtn — #welcomeDoneBtn
   * @param {HTMLElement} opts.doneMsg     — #welcomeDoneMsg
   * @param {object} opts.subscriptions    — has .appendFeed({url,title,shelf})
   * @param {(page:string)=>void} opts.navigate — router.go("settings")
   */
  constructor(opts) {
    this.scrimEl    = opts.scrimEl;
    this.urlInput   = opts.urlInput;
    this.hnBtn      = opts.hnBtn;
    this.nextBtn    = opts.nextBtn;
    this.statusEl   = opts.statusEl;
    this.skipBtns   = opts.skipBtns || [];
    this.choiceBtns = opts.choiceBtns || [];
    this.doneBtn    = opts.doneBtn;
    this.doneMsg    = opts.doneMsg;
    this.subscriptions = opts.subscriptions;
    this.navigate   = typeof opts.navigate === "function" ? opts.navigate : () => {};

    this.step = 1;
    this.didAddFeed = false;
    this.#bind();
  }

  open() {
    this.scrimEl.hidden = false;
    this.scrimEl.setAttribute("data-open", "true");
    this.#showStep(1);
    queueMicrotask(() => this.urlInput?.focus());
  }

  close() {
    this.scrimEl.setAttribute("data-open", "false");
    this.scrimEl.hidden = true;
  }

  #bind() {
    this.hnBtn?.addEventListener("click", () => {
      if (this.urlInput) {
        this.urlInput.value = HN_FEED_URL;
        this.urlInput.focus();
      }
    });
    this.nextBtn?.addEventListener("click", () => this.#tryAddFeed());
    this.urlInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); this.#tryAddFeed(); }
    });
    for (const b of this.skipBtns) {
      b.addEventListener("click", () => this.#showStep(2));
    }
    for (const b of this.choiceBtns) {
      b.addEventListener("click", () => this.#onChoice(b.dataset.kind));
    }
    this.doneBtn?.addEventListener("click", () => this.#finish());
  }

  async #tryAddFeed() {
    const raw = (this.urlInput?.value || "").trim();
    if (!raw) { this.#setStatus("Paste a URL or try the Hacker News button.", "fail"); return; }
    if (!/^https?:\/\//i.test(raw)) {
      this.#setStatus("That doesn't look like a URL. It should start with http:// or https://.", "fail");
      return;
    }
    this.#setStatus("Saving…", "pending");
    try {
      await this.subscriptions.appendFeed({ url: raw, title: "", shelf: "all" });
      this.didAddFeed = true;
      this.#setStatus("Feed saved.", "ok");
      this.#showStep(2);
    } catch (e) {
      this.#setStatus(`Could not save: ${e.message || e}`, "fail");
    }
  }

  #onChoice(kind) {
    if (kind === "local") {
      this.#showStep(3);
    } else if (kind === "cloud") {
      markOnboarded();
      this.close();
      this.navigate("settings");
    }
  }

  #finish() {
    markOnboarded();
    this.close();
  }

  #showStep(n) {
    this.step = n;
    for (const sec of this.scrimEl.querySelectorAll("[data-step-pane]")) {
      sec.hidden = String(n) !== sec.dataset.stepPane;
    }
    for (const s of this.scrimEl.querySelectorAll("[data-step-label]")) {
      const i = Number(s.dataset.stepLabel);
      s.setAttribute("aria-current", i === n ? "step" : "false");
      s.dataset.state = i < n ? "done" : (i === n ? "current" : "upcoming");
    }
    if (n === 3 && this.doneMsg) {
      this.doneMsg.textContent = this.didAddFeed
        ? "Your shelf has its first feed. Press j and k to walk through articles, s to star, m to mark read."
        : "Local storage is set up. Open Add Feed in Settings when you're ready to start a shelf.";
    }
  }

  #setStatus(msg, kind) {
    if (!this.statusEl) return;
    this.statusEl.textContent = msg;
    this.statusEl.dataset.status = kind || "";
  }
}
