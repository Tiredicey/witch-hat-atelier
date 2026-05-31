import { chatBrief, isTransientError } from "./openai-compatible.js";
import { isDisclosureAcked, ackDisclosure } from "./index.js";

export const BRIEFING_SURFACE = "briefing";
const MAX_ITEMS = 20;

export class BriefingSurface {
  constructor(opts) {
    if (!Array.isArray(opts.providers) || !opts.providers.length) {
      throw new Error("BriefingSurface: providers must be a non-empty array.");
    }
    this.intel = opts.intelligence;
    this.providers = opts.providers;
    this.getUnread = typeof opts.getUnread === "function" ? opts.getUnread : () => [];
    this.wrapEl = opts.wrapEl;
    this.triggerBtn = opts.triggerBtn;
    this.statusEl = opts.statusEl;
    this.disclosureEl = opts.disclosureEl;
    this.disclosureTextEl = opts.disclosureTextEl;
    this.confirmBtn = opts.confirmBtn;
    this.cancelBtn = opts.cancelBtn;
    this.outputEl = opts.outputEl;
    this.toggleBtn = opts.toggleBtn || null;
    this.fetchImpl = opts.fetchImpl || null;
    this.inflight = null;

    this.#mountSettings();
    this.#bind();
    this.intel.subscribe(() => this.#sync());
  }

  readyProviders() {
    if (!this.intel.isEnabled() || !this.intel.isSurfaceEnabled(BRIEFING_SURFACE)) return [];
    return this.providers.filter(
      p => this.intel.isSurfaceEnabled(p.surfaceId) && this.intel.getProviderKey(p.id)
    );
  }

  isReady() {
    return this.readyProviders().length > 0;
  }

  #mountSettings() {
    const target = this.intel.mountTarget();
    if (!target) return;
    const fieldset = document.createElement("fieldset");
    fieldset.className = "settings__group intel-surface";
    fieldset.dataset.surface = BRIEFING_SURFACE;
    fieldset.innerHTML = `
      <legend>Brief my unread <span class="intel-surface__tag">§18.3 rung 4</span></legend>
      <label class="settings__field settings__field--inline">
        <input id="intelBriefingEnable" type="checkbox">
        <span>Summarise the unread articles in the current shelf into one briefing</span>
      </label>
      <p class="settings__hint">
        Reuses the providers you enabled and keyed above. One request sends up to ${MAX_ITEMS} unread
        titles and excerpts from the current shelf to the provider, after the same one-line disclosure.
        The article text is treated as quoted data, never as instructions.
      </p>
    `;
    target.appendChild(fieldset);
    const enableInput = fieldset.querySelector("#intelBriefingEnable");
    enableInput.checked = !!this.intel.snapshot().surfaces[BRIEFING_SURFACE];
    enableInput.addEventListener("change", () => {
      this.intel.setSurfaceEnabled(BRIEFING_SURFACE, enableInput.checked);
    });
  }

  #bind() {
    if (this.triggerBtn) this.triggerBtn.addEventListener("click", () => this.#onTrigger());
    if (this.toggleBtn) this.toggleBtn.addEventListener("click", () => this.#toggleOutput());
    if (this.confirmBtn) this.confirmBtn.addEventListener("click", () => this.#onConfirm());
    if (this.cancelBtn) this.cancelBtn.addEventListener("click", () => this.#dismissDisclosure());
    this.#sync();
  }

  #sync() {
    const ready = this.isReady();
    if (this.wrapEl) this.wrapEl.hidden = !ready;
    if (!ready) {
      this.#dismissDisclosure();
      this.#hideOutput();
      this.#setStatus("", null);
    }
  }

  #collectUnread() {
    const items = this.getUnread() || [];
    return items.filter(it => it && (it.title || it.body || it.summary)).slice(0, MAX_ITEMS);
  }

  #onTrigger() {
    if (this.inflight) return;
    const chain = this.readyProviders();
    if (!chain.length) return;
    const items = this.#collectUnread();
    if (!items.length) {
      this.#setStatus("No unread articles in this shelf to brief.", "info");
      return;
    }
    if (chain.every(p => isDisclosureAcked(p.hostname))) {
      this.#run(items);
      return;
    }
    const host = chain[0].hostname;
    const rest = chain.slice(1).map(p => p.hostname).join(", ");
    this.disclosureTextEl.textContent = chain.length === 1
      ? `This will send ${items.length} unread title${items.length === 1 ? "" : "s"} and excerpts to ${host}.`
      : `This will send ${items.length} unread title${items.length === 1 ? "" : "s"} and excerpts to ${host}, falling back to ${rest} if it is rate-limited.`;
    this.disclosureEl.hidden = false;
    this.confirmBtn.focus();
  }

  #onConfirm() {
    const chain = this.readyProviders();
    this.#dismissDisclosure();
    if (!chain.length) return;
    for (const p of chain) ackDisclosure(p.hostname);
    const items = this.#collectUnread();
    if (!items.length) {
      this.#setStatus("No unread articles in this shelf to brief.", "info");
      return;
    }
    this.#run(items);
  }

  #dismissDisclosure() {
    if (this.disclosureEl) this.disclosureEl.hidden = true;
    if (this.disclosureTextEl) this.disclosureTextEl.textContent = "";
  }

  async #run(items) {
    const chain = this.readyProviders();
    if (!chain.length) {
      this.#setStatus("Enable and key a provider in Settings.", "fail");
      return;
    }
    this.#hideOutput();
    this.triggerBtn.disabled = true;
    const controller = new AbortController();
    this.inflight = controller;
    try {
      for (let i = 0; i < chain.length; i++) {
        const provider = chain[i];
        const apiKey = this.intel.getProviderKey(provider.id);
        if (!apiKey) continue;
        this.#setStatus(`Briefing ${items.length} unread via ${provider.hostname}…`, "pending");
        try {
          const { briefing, count, model } = await chatBrief({
            provider,
            apiKey,
            items,
            maxItems: MAX_ITEMS,
            signal: controller.signal,
            fetchImpl: this.fetchImpl,
          });
          this.#showOutput(briefing);
          this.#setStatus(`Briefed ${count} unread · ${provider.hostname} · ${model}`, "ok");
          return;
        } catch (e) {
          if (controller.signal.aborted) return;
          const next = chain.slice(i + 1).find(p => this.intel.getProviderKey(p.id));
          if (next && isTransientError(e)) {
            this.#setStatus(`${provider.hostname} is rate-limited. Trying ${next.hostname}…`, "pending");
            continue;
          }
          this.#setStatus(e && e.message ? e.message : "The briefing failed.", "fail");
          return;
        }
      }
      this.#setStatus("No provider with an API key was available.", "fail");
    } finally {
      this.triggerBtn.disabled = false;
      this.inflight = null;
    }
  }

  #showOutput(text) {
    if (!this.outputEl) return;
    this.outputEl.textContent = text;
    this.outputEl.hidden = false;
    this.#setToggle(true, false);
  }

  #hideOutput() {
    if (this.outputEl) { this.outputEl.hidden = true; this.outputEl.textContent = ""; }
    this.#setToggle(false, true);
  }

  #toggleOutput() {
    if (!this.outputEl || !this.outputEl.textContent) return;
    const collapsed = this.outputEl.hidden;
    this.outputEl.hidden = !collapsed;
    this.#setToggle(true, !collapsed);
  }

  #setToggle(visible, collapsed) {
    if (!this.toggleBtn) return;
    this.toggleBtn.hidden = !visible;
    this.toggleBtn.setAttribute("aria-expanded", String(!collapsed));
    this.toggleBtn.textContent = collapsed ? "Show briefing" : "Hide briefing";
  }

  #setStatus(msg, status) {
    if (!this.statusEl) return;
    this.statusEl.textContent = msg || "";
    if (status) this.statusEl.dataset.status = status;
    else this.statusEl.removeAttribute("data-status");
  }
}
