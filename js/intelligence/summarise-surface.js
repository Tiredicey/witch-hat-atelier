import { chatComplete } from "./openai-compatible.js";
import { isDisclosureAcked, ackDisclosure } from "./index.js";
import { relTime } from "./history-store.js";
import { CollapsibleOutput } from "./output-toggle.js";

function pascal(id) {
  return id.split(/[-_]/).map(p => p ? p[0].toUpperCase() + p.slice(1) : p).join("");
}

export class SummariseSurface {
  /**
   * Mounts a fieldset per provider into the Intelligence settings panel,
   * owns the shared reader-pane Summarise button, and routes calls to the
   * first ready provider in the supplied registration order.
   *
   * @param {object} opts
   * @param {import("./index.js").Intelligence} opts.intelligence
   * @param {object} opts.reader              Reader instance (exposes .currentArticle)
   * @param {ReadonlyArray<object>} opts.providers   Each: { id, surfaceId, label, hostname, baseUrl, defaultModel, keyPlaceholder, hintHtml }
   * @param {HTMLElement} opts.wrapEl
   * @param {HTMLButtonElement} opts.triggerBtn
   * @param {HTMLElement} opts.statusEl
   * @param {HTMLElement} opts.disclosureEl
   * @param {HTMLElement} opts.disclosureTextEl
   * @param {HTMLButtonElement} opts.confirmBtn
   * @param {HTMLButtonElement} opts.cancelBtn
   * @param {HTMLElement} opts.outputEl
   * @param {(u:string,init?:object)=>Promise<Response>=} opts.fetchImpl
   */
  constructor(opts) {
    if (!Array.isArray(opts.providers) || !opts.providers.length) {
      throw new Error("SummariseSurface: providers must be a non-empty array.");
    }
    this.intel = opts.intelligence;
    this.reader = opts.reader;
    this.providers = opts.providers;
    this.wrapEl = opts.wrapEl;
    this.triggerBtn = opts.triggerBtn;
    this.statusEl = opts.statusEl;
    this.disclosureEl = opts.disclosureEl;
    this.disclosureTextEl = opts.disclosureTextEl;
    this.confirmBtn = opts.confirmBtn;
    this.cancelBtn = opts.cancelBtn;
    this.outputEl = opts.outputEl;
    this.restoreBtn = opts.restoreBtn || null;
    this.toggleBtn = opts.toggleBtn || null;
    this.history = opts.history || null;
    this.fetchImpl = opts.fetchImpl || null;
    this.inflight = null;
    this.collapse = new CollapsibleOutput(this.toggleBtn, this.outputEl, { noun: "summary" });

    for (const provider of this.providers) {
      this.#mountFieldset(provider);
    }
    this.#bind();
    this.intel.subscribe(() => this.#syncVisibility());
  }

  activeProvider() {
    const ready = this.readyProviders();
    return ready.length ? ready[0] : null;
  }

  readyProviders() {
    return this.providers.filter(
      p => this.intel.isSurfaceEnabled(p.surfaceId) && this.intel.getProviderKey(p.id)
    );
  }

  isReady() {
    return !!this.activeProvider();
  }

  trigger() {
    if (!this.isReady()) return false;
    const article = this.reader && this.reader.currentArticle;
    if (!article) {
      this.#setStatus("Open an article first.", "info");
      return false;
    }
    this.triggerBtn.focus();
    this.triggerBtn.click();
    return true;
  }

  #mountFieldset(provider) {
    const target = this.intel.mountTarget();
    if (!target) return;
    const name = pascal(provider.id);
    const enableId = `intel${name}SurfaceEnable`;
    const keyId = `intel${name}ApiKey`;
    const fieldset = document.createElement("fieldset");
    fieldset.className = "settings__group intel-surface";
    fieldset.dataset.surface = provider.surfaceId;
    fieldset.innerHTML = `
      <legend>Reader-pane Summarise (${provider.label}) <span class="intel-surface__tag">§17.8</span></legend>
      <label class="settings__field settings__field--inline">
        <input id="${enableId}" type="checkbox">
        <span>Enable ${provider.label} for the Summarise button in the reader pane</span>
      </label>
      <label class="settings__field">
        <span>${provider.label} API key (kept in this browser only)</span>
        <input id="${keyId}" type="password" autocomplete="off" spellcheck="false" placeholder="${provider.keyPlaceholder}">
      </label>
      <p class="settings__hint">
        Default model <code>${provider.defaultModel}</code> against <code>${provider.hostname}</code>.
        ${provider.hintHtml}
      </p>
    `;
    target.appendChild(fieldset);
    const enableInput = fieldset.querySelector(`#${enableId}`);
    const keyInput = fieldset.querySelector(`#${keyId}`);
    enableInput.checked = !!this.intel.snapshot().surfaces[provider.surfaceId];
    keyInput.value = this.intel.getProviderKey(provider.id);
    enableInput.addEventListener("change", () => {
      this.intel.setSurfaceEnabled(provider.surfaceId, enableInput.checked);
    });
    keyInput.addEventListener("input", () => {
      this.intel.setProviderKey(provider.id, keyInput.value.trim());
    });
  }

  #bind() {
    this.triggerBtn.addEventListener("click", () => this.#onTrigger());
    this.confirmBtn.addEventListener("click", () => this.#onConfirm());
    this.cancelBtn.addEventListener("click", () => this.#dismissDisclosure());
    if (this.restoreBtn) this.restoreBtn.addEventListener("click", () => this.#showSaved());
    this.#syncVisibility();
  }

  refreshRestore() {
    if (!this.restoreBtn) return;
    const article = this.#articleSnapshot();
    const saved = this.isReady() && this.history && article ? this.history.getSummary(article.id) : null;
    this.restoreBtn.hidden = !saved;
  }

  #showSaved() {
    const article = this.#articleSnapshot();
    const saved = article && this.history ? this.history.getSummary(article.id) : null;
    if (!saved) return;
    this.outputEl.textContent = saved.text;
    this.outputEl.hidden = false;
    this.collapse.reveal();
    const where = saved.hostname ? ` · ${saved.hostname}` : "";
    this.#setStatus(`Saved summary${where} · ${relTime(saved.ts)}`, "ok");
  }

  #syncVisibility() {
    const active = this.activeProvider();
    const on = !!active;
    this.wrapEl.hidden = !on;
    if (on) {
      this.triggerBtn.textContent = `Summarise via ${active.label}`;
      this.refreshRestore();
    } else {
      this.#dismissDisclosure();
      this.outputEl.hidden = true;
      this.outputEl.textContent = "";
      this.collapse.clear();
      this.#setStatus("", null);
      if (this.restoreBtn) this.restoreBtn.hidden = true;
    }
  }

  #setStatus(msg, status) {
    this.statusEl.textContent = msg || "";
    if (status) this.statusEl.dataset.status = status;
    else this.statusEl.removeAttribute("data-status");
  }

  #articleSnapshot() {
    const a = this.reader && this.reader.currentArticle;
    if (!a) return null;
    return {
      id: a.id,
      title: a.title || "(untitled)",
      source: a.source || a.feed || "(unknown source)",
      body: a.body || a.summary || "",
    };
  }

  #onTrigger() {
    if (this.inflight) return;
    const chain = this.readyProviders();
    if (!chain.length) return;
    const article = this.#articleSnapshot();
    if (!article) {
      this.#setStatus("Open an article first.", "info");
      return;
    }
    if (chain.every(p => isDisclosureAcked(p.hostname))) {
      this.#run(chain[0], article);
      return;
    }
    this.disclosureTextEl.textContent = chain.length === 1
      ? `This will send "${article.source} · ${article.title}" to ${chain[0].hostname}.`
      : `This will send "${article.source} · ${article.title}" to ${chain[0].hostname}, falling back to ${chain.slice(1).map(p => p.hostname).join(", ")} if it is rate-limited.`;
    this.disclosureEl.hidden = false;
    this.confirmBtn.focus();
  }

  #onConfirm() {
    const active = this.activeProvider();
    if (!active) {
      this.#dismissDisclosure();
      return;
    }
    const article = this.#articleSnapshot();
    if (!article) {
      this.#dismissDisclosure();
      this.#setStatus("Open an article first.", "info");
      return;
    }
    for (const p of this.readyProviders()) ackDisclosure(p.hostname);
    this.#dismissDisclosure();
    this.#run(this.activeProvider(), article);
  }

  #dismissDisclosure() {
    this.disclosureEl.hidden = true;
    this.disclosureTextEl.textContent = "";
  }

  async #run(startProvider, article) {
    const ready = this.readyProviders();
    let start = ready.indexOf(startProvider);
    if (start < 0) start = 0;
    const chain = ready.slice(start);
    if (!chain.length) {
      this.#setStatus("Enable and key a provider in Settings.", "fail");
      return;
    }
    this.outputEl.hidden = true;
    this.outputEl.textContent = "";
    this.collapse.clear();
    this.triggerBtn.disabled = true;
    const controller = new AbortController();
    this.inflight = controller;
    try {
      for (let i = 0; i < chain.length; i++) {
        const provider = chain[i];
        const apiKey = this.intel.getProviderKey(provider.id);
        if (!apiKey) continue;
        this.#setStatus(`Summarising via ${provider.hostname}…`, "pending");
        try {
          const { summary, model } = await chatComplete({
            provider,
            apiKey,
            article,
            signal: controller.signal,
            fetchImpl: this.fetchImpl,
          });
          this.outputEl.textContent = summary;
          this.outputEl.hidden = false;
          this.collapse.reveal();
          this.#setStatus(`Answered by ${provider.hostname} · ${model}`, "ok");
          if (this.history) {
            this.history.recordSummary({ id: article.id, title: article.title, source: article.source, text: summary, hostname: provider.hostname, model });
            this.refreshRestore();
          }
          return;
        } catch (e) {
          if (controller.signal.aborted) return;
          const next = chain.slice(i + 1).find(p => this.intel.getProviderKey(p.id));
          if (next && this.#shouldFailover(e)) {
            this.#setStatus(`${provider.hostname} is rate-limited. Trying ${next.hostname}…`, "pending");
            continue;
          }
          const msg = e && e.message ? e.message : "Summary failed.";
          this.#setStatus(msg, "fail");
          return;
        }
      }
      this.#setStatus("No provider with an API key was available.", "fail");
    } finally {
      this.triggerBtn.disabled = false;
      this.inflight = null;
    }
  }

  #shouldFailover(e) {
    if (!e) return false;
    const s = e.status;
    if (s === 429 || s === 408) return true;
    if (typeof s === "number" && s >= 500) return true;
    if (typeof s !== "number") return true;
    return false;
  }
}
