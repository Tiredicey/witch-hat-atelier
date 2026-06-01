import { chatAsk, isTransientError } from "./openai-compatible.js";
import { isDisclosureAcked, ackDisclosure } from "./index.js";
import { ASK_SURFACE } from "./ask-surface.js";
import { CollapsibleOutput } from "./output-toggle.js";

const MAX_HISTORY_TURNS = 6;
const DIGEST_CHAR_BUDGET = 12000;
const DIGEST_MAX_ITEMS = 200;
const DIGEST_EXCERPT_CHARS = 200;

function excerptOf(item) {
  if (!item) return "";
  if (Array.isArray(item.body) && item.body.length) return item.body.join(" ");
  const raw = item.summary || item.excerpt || item.body || "";
  return String(raw);
}

function truncate(text, max) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "\u2026" : t;
}

export class CopilotSurface {
  constructor(opts) {
    if (!Array.isArray(opts.providers) || !opts.providers.length) {
      throw new Error("CopilotSurface: providers must be a non-empty array.");
    }
    this.intel = opts.intelligence;
    this.reader = opts.reader;
    this.providers = opts.providers;
    this.getUnread = typeof opts.getUnread === "function" ? opts.getUnread : () => [];
    this.getShelf = typeof opts.getShelf === "function" ? opts.getShelf : () => "all";
    this.onAnswer = typeof opts.onAnswer === "function" ? opts.onAnswer : null;
    this.fetchImpl = opts.fetchImpl || null;
    this.scopeToggleEl = opts.scopeToggleEl || null;
    this.generalMode = false;

    this.wrapEl = opts.wrapEl;
    this.scopeEl = opts.scopeEl;
    this.closeBtn = opts.closeBtn;
    this.railBtn = opts.railBtn;
    this.formEl = opts.formEl;
    this.inputEl = opts.inputEl;
    this.sendBtn = opts.sendBtn;
    this.statusEl = opts.statusEl;
    this.logEl = opts.logEl;
    this.toggleBtn = opts.toggleBtn || null;
    this.disclosureEl = opts.disclosureEl;
    this.disclosureTextEl = opts.disclosureTextEl;
    this.confirmBtn = opts.confirmBtn;
    this.cancelBtn = opts.cancelBtn;

    this.history = [];
    this.lastScopeId = null;
    this.inflight = null;
    this.pendingQuestion = "";
    this.collapse = new CollapsibleOutput(this.toggleBtn, this.logEl, { noun: "answers" });

    this.#bind();
    this.intel.subscribe(() => this.#syncAvailability());
  }

  readyProviders() {
    if (!this.intel.isEnabled() || !this.intel.isSurfaceEnabled(ASK_SURFACE)) return [];
    return this.providers.filter(
      p => this.intel.isSurfaceEnabled(p.surfaceId) && this.intel.getProviderKey(p.id)
    );
  }

  isReady() {
    return this.readyProviders().length > 0;
  }

  isOpen() {
    return !!this.wrapEl && !this.wrapEl.hidden;
  }

  open() {
    if (!this.intel.isEnabled() || !this.wrapEl) return;
    this.wrapEl.hidden = false;
    this.#refreshScope();
    try { this.inputEl.focus(); this.inputEl.scrollIntoView({ block: "nearest" }); } catch {}
  }

  close() {
    if (!this.wrapEl) return;
    this.wrapEl.hidden = true;
    this.#dismissDisclosure();
  }

  toggle() {
    if (this.isOpen()) this.close();
    else this.open();
  }

  #bind() {
    if (this.railBtn) this.railBtn.addEventListener("click", () => this.toggle());
    if (this.closeBtn) this.closeBtn.addEventListener("click", () => this.close());
    if (this.formEl) {
      this.formEl.addEventListener("submit", (e) => { e.preventDefault(); this.#onSubmit(); });
    }
    if (this.confirmBtn) this.confirmBtn.addEventListener("click", () => this.#onConfirm());
    if (this.cancelBtn) this.cancelBtn.addEventListener("click", () => this.#dismissDisclosure());
    if (this.scopeToggleEl) {
      this.scopeToggleEl.addEventListener("change", () => {
        this.generalMode = !!this.scopeToggleEl.checked;
        this.#refreshScope();
      });
    }
    this.#syncAvailability();
  }

  fillQuestion(text) {
    const q = String(text || "").trim();
    if (!q || !this.intel.isEnabled() || !this.inputEl) return false;
    if (!this.isOpen()) this.open();
    this.inputEl.value = q;
    try { this.inputEl.focus(); } catch {}
    this.#setStatus("Question ready from voice. Review, then press Ask.", "info");
    return true;
  }

  submitQuestion(text) {
    const q = String(text || "").trim();
    if (!q || !this.intel.isEnabled() || !this.inputEl) return false;
    if (!this.isOpen()) this.open();
    this.inputEl.value = q;
    this.#onSubmit();
    return true;
  }

  #syncAvailability() {
    const on = this.intel.isEnabled();
    if (this.railBtn) this.railBtn.hidden = !on;
    if (!on) this.close();
    else if (this.isOpen()) this.#refreshScope();
  }

  #resolveScope() {
    const a = this.reader && this.reader.currentArticle;
    if (a && !this.generalMode) {
      return {
        id: `article:${a.id}`,
        label: "Grounded in this article",
        article: {
          id: a.id,
          title: a.title || "(untitled)",
          source: a.source || a.feed || "(unknown source)",
          body: Array.isArray(a.body) ? a.body.join("\n\n") : (a.body || a.summary || ""),
        },
      };
    }
    const shelf = this.getShelf() || "all";
    const unread = this.getUnread() || [];
    if (!unread.length) {
      return {
        id: this.generalMode ? `unread:${shelf}` : "empty",
        label: this.generalMode
          ? `Nothing unread on the ${shelf} shelf`
          : "No open article, nothing unread",
        article: null,
      };
    }
    const lines = [];
    let used = 0;
    let included = 0;
    for (const it of unread) {
      if (included >= DIGEST_MAX_ITEMS) break;
      const title = it.title || "(untitled)";
      const src = it.source || it.feed || "(unknown source)";
      const ex = truncate(excerptOf(it), DIGEST_EXCERPT_CHARS);
      const line = `${included + 1}. ${title} \u2014 ${src}${ex ? `: ${ex}` : ""}`;
      if (included > 0 && used + line.length > DIGEST_CHAR_BUDGET) break;
      lines.push(line);
      used += line.length + 1;
      included += 1;
    }
    const remaining = unread.length - included;
    if (remaining > 0) lines.push(`(+${remaining} more unread not shown, to fit the model's context.)`);
    const label = remaining > 0
      ? `Grounded in ${included} of ${unread.length} unread on the ${shelf} shelf`
      : `Grounded in ${included} unread item${included === 1 ? "" : "s"} on the ${shelf} shelf`;
    return {
      id: `unread:${shelf}`,
      label,
      article: {
        id: `unread-${shelf}`,
        title: `Unread digest \u2014 ${shelf} shelf`,
        source: "CODA unread feed",
        body: lines.join("\n"),
      },
    };
  }

  #refreshScope() {
    const scope = this.#resolveScope();
    if (this.scopeEl) this.scopeEl.textContent = scope.label;
    if (scope.id !== this.lastScopeId) {
      this.lastScopeId = scope.id;
      this.history = [];
      if (this.logEl) { this.logEl.replaceChildren(); this.logEl.hidden = true; }
      if (this.collapse) this.collapse.clear();
    }
    return scope;
  }

  #onSubmit() {
    if (this.inflight) return;
    const chain = this.readyProviders();
    if (!chain.length) {
      this.#setStatus("Enable the Ask surface and key a provider in Settings.", "fail");
      return;
    }
    const scope = this.#refreshScope();
    if (!scope.article) {
      this.#setStatus("Open an article or load unread items first.", "info");
      return;
    }
    const question = (this.inputEl.value || "").trim();
    if (!question) {
      this.#setStatus("Type a question first.", "info");
      return;
    }
    this.pendingQuestion = question;
    if (chain.every(p => isDisclosureAcked(p.hostname))) {
      this.#run(scope, question);
      return;
    }
    const where = scope.article.id && String(scope.article.id).startsWith("unread")
      ? `your unread digest (${scope.label.toLowerCase()})`
      : `"${scope.article.source} \u00b7 ${scope.article.title}"`;
    this.disclosureTextEl.textContent = chain.length === 1
      ? `This will send ${where} and your question to ${chain[0].hostname}.`
      : `This will send ${where} and your question to ${chain[0].hostname}, falling back to ${chain.slice(1).map(p => p.hostname).join(", ")} if it is rate-limited.`;
    this.disclosureEl.hidden = false;
    this.confirmBtn.focus();
  }

  #onConfirm() {
    const chain = this.readyProviders();
    const scope = this.#refreshScope();
    this.#dismissDisclosure();
    if (!chain.length || !scope.article) return;
    for (const p of chain) ackDisclosure(p.hostname);
    if (this.pendingQuestion) this.#run(scope, this.pendingQuestion);
  }

  #dismissDisclosure() {
    if (this.disclosureEl) this.disclosureEl.hidden = true;
    if (this.disclosureTextEl) this.disclosureTextEl.textContent = "";
  }

  #appendTurn(role, text) {
    if (!this.logEl) return;
    this.logEl.hidden = false;
    const row = document.createElement("p");
    row.className = role === "user" ? "copilot__q" : "copilot__a";
    row.textContent = text;
    this.logEl.appendChild(row);
    this.collapse.reveal();
  }

  async #run(scope, question) {
    const chain = this.readyProviders();
    if (!chain.length) {
      this.#setStatus("Enable and key a provider in Settings.", "fail");
      return;
    }
    this.#appendTurn("user", question);
    this.inputEl.value = "";
    this.sendBtn.disabled = true;
    const controller = new AbortController();
    this.inflight = controller;
    try {
      for (let i = 0; i < chain.length; i++) {
        const provider = chain[i];
        const apiKey = this.intel.getProviderKey(provider.id);
        if (!apiKey) continue;
        this.#setStatus(`Asking ${provider.hostname}\u2026`, "pending");
        try {
          const { answer, model } = await chatAsk({
            provider,
            apiKey,
            article: scope.article,
            question,
            history: this.history.slice(-MAX_HISTORY_TURNS * 2),
            signal: controller.signal,
            fetchImpl: this.fetchImpl,
          });
          this.#appendTurn("assistant", answer);
          if (this.onAnswer) { try { this.onAnswer(answer); } catch {} }
          this.history.push({ role: "user", content: question });
          this.history.push({ role: "assistant", content: answer });
          this.#setStatus(`Answered by ${provider.hostname} \u00b7 ${model}`, "ok");
          return;
        } catch (e) {
          if (controller.signal.aborted) return;
          const next = chain.slice(i + 1).find(p => this.intel.getProviderKey(p.id));
          if (next && isTransientError(e)) {
            this.#setStatus(`${provider.hostname} is rate-limited. Trying ${next.hostname}\u2026`, "pending");
            continue;
          }
          this.#setStatus(e && e.message ? e.message : "The question failed.", "fail");
          return;
        }
      }
      this.#setStatus("No provider with an API key was available.", "fail");
    } finally {
      this.sendBtn.disabled = false;
      this.inflight = null;
    }
  }

  #setStatus(msg, status) {
    if (!this.statusEl) return;
    this.statusEl.textContent = msg || "";
    if (status) this.statusEl.dataset.status = status;
    else this.statusEl.removeAttribute("data-status");
  }
}
