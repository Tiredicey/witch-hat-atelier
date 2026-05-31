import { chatAsk, isTransientError } from "./openai-compatible.js";
import { isDisclosureAcked, ackDisclosure } from "./index.js";
import { CollapsibleOutput } from "./output-toggle.js";

export const ASK_SURFACE = "ask-qa";
const MAX_HISTORY_TURNS = 6;

export class AskSurface {
  constructor(opts) {
    if (!Array.isArray(opts.providers) || !opts.providers.length) {
      throw new Error("AskSurface: providers must be a non-empty array.");
    }
    this.intel = opts.intelligence;
    this.reader = opts.reader;
    this.providers = opts.providers;
    this.wrapEl = opts.wrapEl;
    this.formEl = opts.formEl;
    this.inputEl = opts.inputEl;
    this.sendBtn = opts.sendBtn;
    this.statusEl = opts.statusEl;
    this.disclosureEl = opts.disclosureEl;
    this.disclosureTextEl = opts.disclosureTextEl;
    this.confirmBtn = opts.confirmBtn;
    this.cancelBtn = opts.cancelBtn;
    this.logEl = opts.logEl;
    this.toggleBtn = opts.toggleBtn || null;
    this.fetchImpl = opts.fetchImpl || null;
    this.onAnswer = typeof opts.onAnswer === "function" ? opts.onAnswer : null;

    this.history = [];
    this.inflight = null;
    this.pendingQuestion = "";
    this.collapse = new CollapsibleOutput(this.toggleBtn, this.logEl, { noun: "answers" });

    this.#mountSettings();
    this.#bind();
    this.intel.subscribe(() => this.#sync());
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

  reset() {
    this.history = [];
    if (this.logEl) {
      this.logEl.replaceChildren();
      this.logEl.hidden = true;
    }
    if (this.collapse) this.collapse.clear();
    this.#dismissDisclosure();
    this.#setStatus("", null);
    if (this.inputEl) this.inputEl.value = "";
  }

  fillQuestion(text) {
    const q = String(text || "").trim();
    if (!q || !this.isReady() || !this.inputEl) return false;
    this.inputEl.value = q;
    try { this.inputEl.focus(); } catch {}
    this.#setStatus("Question ready from voice. Review, then press Ask.", "info");
    return true;
  }

  #mountSettings() {
    const target = this.intel.mountTarget();
    if (!target) return;
    const fieldset = document.createElement("fieldset");
    fieldset.className = "settings__group intel-surface";
    fieldset.dataset.surface = ASK_SURFACE;
    fieldset.innerHTML = `
      <legend>Ask about the article <span class="intel-surface__tag">§18.3 rung 2</span></legend>
      <label class="settings__field settings__field--inline">
        <input id="intelAskEnable" type="checkbox">
        <span>Answer questions about the open article, grounded in its text</span>
      </label>
      <p class="settings__hint">
        Reuses whichever providers you enabled and keyed above; no extra key needed. Each question
        sends the open article plus your question to the same provider, with the same one-line
        disclosure. The article text is treated as quoted data, never as instructions.
      </p>
    `;
    target.appendChild(fieldset);
    const enableInput = fieldset.querySelector("#intelAskEnable");
    enableInput.checked = !!this.intel.snapshot().surfaces[ASK_SURFACE];
    enableInput.addEventListener("change", () => {
      this.intel.setSurfaceEnabled(ASK_SURFACE, enableInput.checked);
    });
  }

  #bind() {
    if (this.formEl) {
      this.formEl.addEventListener("submit", (e) => {
        e.preventDefault();
        this.#onSubmit();
      });
    }
    if (this.confirmBtn) this.confirmBtn.addEventListener("click", () => this.#onConfirm());
    if (this.cancelBtn) this.cancelBtn.addEventListener("click", () => this.#dismissDisclosure());
    this.#sync();
  }

  #sync() {
    const ready = this.isReady();
    if (this.wrapEl) this.wrapEl.hidden = !ready;
    if (!ready) this.#dismissDisclosure();
  }

  #articleSnapshot() {
    const a = this.reader && this.reader.currentArticle;
    if (!a) return null;
    return {
      id: a.id,
      title: a.title || "(untitled)",
      source: a.source || a.feed || "(unknown source)",
      body: Array.isArray(a.body) ? a.body.join("\n\n") : (a.body || a.summary || ""),
    };
  }

  #onSubmit() {
    if (this.inflight) return;
    const chain = this.readyProviders();
    if (!chain.length) return;
    const article = this.#articleSnapshot();
    if (!article) {
      this.#setStatus("Open an article first.", "info");
      return;
    }
    const question = (this.inputEl.value || "").trim();
    if (!question) {
      this.#setStatus("Type a question first.", "info");
      return;
    }
    this.pendingQuestion = question;
    if (chain.every(p => isDisclosureAcked(p.hostname))) {
      this.#run(article, question);
      return;
    }
    this.disclosureTextEl.textContent = chain.length === 1
      ? `This will send "${article.source} · ${article.title}" and your question to ${chain[0].hostname}.`
      : `This will send "${article.source} · ${article.title}" and your question to ${chain[0].hostname}, falling back to ${chain.slice(1).map(p => p.hostname).join(", ")} if it is rate-limited.`;
    this.disclosureEl.hidden = false;
    this.confirmBtn.focus();
  }

  #onConfirm() {
    const chain = this.readyProviders();
    const article = this.#articleSnapshot();
    this.#dismissDisclosure();
    if (!chain.length || !article) return;
    for (const p of chain) ackDisclosure(p.hostname);
    if (this.pendingQuestion) this.#run(article, this.pendingQuestion);
  }

  #dismissDisclosure() {
    if (this.disclosureEl) this.disclosureEl.hidden = true;
    if (this.disclosureTextEl) this.disclosureTextEl.textContent = "";
  }

  #appendTurn(role, text) {
    if (!this.logEl) return;
    this.logEl.hidden = false;
    const row = document.createElement("p");
    row.className = role === "user" ? "reader__ask-q" : "reader__ask-a";
    row.textContent = text;
    this.logEl.appendChild(row);
    this.collapse.reveal();
  }

  async #run(article, question) {
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
        this.#setStatus(`Asking ${provider.hostname}…`, "pending");
        try {
          const { answer, model } = await chatAsk({
            provider,
            apiKey,
            article,
            question,
            history: this.history.slice(-MAX_HISTORY_TURNS * 2),
            signal: controller.signal,
            fetchImpl: this.fetchImpl,
          });
          this.#appendTurn("assistant", answer);
          if (this.onAnswer) { try { this.onAnswer(answer); } catch {} }
          this.history.push({ role: "user", content: question });
          this.history.push({ role: "assistant", content: answer });
          this.#setStatus(`Answered by ${provider.hostname} · ${model}`, "ok");
          return;
        } catch (e) {
          if (controller.signal.aborted) return;
          const next = chain.slice(i + 1).find(p => this.intel.getProviderKey(p.id));
          if (next && isTransientError(e)) {
            this.#setStatus(`${provider.hostname} is rate-limited. Trying ${next.hostname}…`, "pending");
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
