import { chatBrief, chatBriefMerge, isTransientError } from "./openai-compatible.js";
import { isDisclosureAcked, ackDisclosure } from "./index.js";
import { relTime } from "./history-store.js";

export const BRIEFING_SURFACE = "briefing";
const BATCH_SIZE = 20;

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

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
    this.restoreBtn = opts.restoreBtn || null;
    this.history = opts.history || null;
    this.getShelf = typeof opts.getShelf === "function" ? opts.getShelf : () => "all";
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
        Reuses the providers you enabled and keyed above. It batches the unread items of the current
        shelf in groups of ${BATCH_SIZE}, briefs each batch, then merges the results into one briefing,
        so a full day of unread is covered rather than only the first ${BATCH_SIZE}. Each request goes
        out after the same one-line disclosure. The article text is treated as quoted data, never as
        instructions.
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
    if (this.restoreBtn) this.restoreBtn.addEventListener("click", () => this.#showSaved());
    this.#sync();
  }

  refreshRestore() {
    if (!this.restoreBtn) return;
    const saved = this.isReady() && this.history ? this.history.latestBriefing(this.getShelf()) : null;
    this.restoreBtn.hidden = !saved;
  }

  #showSaved() {
    const saved = this.history ? this.history.latestBriefing(this.getShelf()) : null;
    if (!saved) return;
    this.#showOutput(saved.text);
    const where = saved.hostname ? ` · ${saved.hostname}` : "";
    const n = saved.count ? `${saved.count} unread · ` : "";
    this.#setStatus(`Saved briefing · ${n}${relTime(saved.ts)}${where}`, "ok");
  }

  #sync() {
    const ready = this.isReady();
    if (this.wrapEl) this.wrapEl.hidden = !ready;
    if (!ready) {
      this.#dismissDisclosure();
      this.#hideOutput();
      this.#setStatus("", null);
      if (this.restoreBtn) this.restoreBtn.hidden = true;
    } else {
      this.refreshRestore();
    }
  }

  #collectUnread() {
    const items = this.getUnread() || [];
    return items.filter(it => it && (it.title || it.body || it.summary));
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
    const shelf = this.getShelf();
    const controller = new AbortController();
    this.inflight = controller;
    try {
      const batches = chunk(items, BATCH_SIZE);
      if (batches.length === 1) {
        this.#setStatus(`Briefing ${items.length} unread…`, "pending");
        const r = await this.#briefBatch(batches[0], controller.signal);
        this.#showOutput(r.briefing);
        this.#setStatus(`Briefed ${items.length} unread · ${r.hostname} · ${r.model}`, "ok");
        this.#record(shelf, items.length, r.briefing, r.hostname, r.model);
        return;
      }
      const partials = [];
      for (let b = 0; b < batches.length; b++) {
        this.#setStatus(`Briefing batch ${b + 1} of ${batches.length} · ${items.length} unread…`, "pending");
        const r = await this.#briefBatch(batches[b], controller.signal);
        if (controller.signal.aborted) return;
        partials.push(r.briefing);
      }
      this.#setStatus(`Merging ${batches.length} batches…`, "pending");
      const merged = await this.#mergeBatches(partials, controller.signal);
      this.#showOutput(merged.briefing);
      this.#setStatus(`Briefed ${items.length} unread in ${batches.length} batches · ${merged.hostname} · ${merged.model}`, "ok");
      this.#record(shelf, items.length, merged.briefing, merged.hostname, merged.model);
    } catch (e) {
      if (controller.signal.aborted) return;
      this.#setStatus(e && e.message ? e.message : "The briefing failed.", "fail");
    } finally {
      this.triggerBtn.disabled = false;
      this.inflight = null;
    }
  }

  async #callChain(signal, fn) {
    const chain = this.readyProviders();
    for (let i = 0; i < chain.length; i++) {
      const provider = chain[i];
      const apiKey = this.intel.getProviderKey(provider.id);
      if (!apiKey) continue;
      try {
        return await fn(provider, apiKey, signal);
      } catch (e) {
        if (signal.aborted) throw e;
        const next = chain.slice(i + 1).find(p => this.intel.getProviderKey(p.id));
        if (next && isTransientError(e)) {
          this.#setStatus(`${provider.hostname} is rate-limited. Trying ${next.hostname}…`, "pending");
          continue;
        }
        throw e;
      }
    }
    throw new Error("No provider with an API key was available.");
  }

  #briefBatch(batch, signal) {
    return this.#callChain(signal, (provider, apiKey, s) =>
      chatBrief({ provider, apiKey, items: batch, maxItems: BATCH_SIZE, signal: s, fetchImpl: this.fetchImpl }));
  }

  #mergeBatches(partials, signal) {
    return this.#callChain(signal, (provider, apiKey, s) =>
      chatBriefMerge({ provider, apiKey, partials, signal: s, fetchImpl: this.fetchImpl }));
  }

  #record(shelf, count, text, hostname, model) {
    if (!this.history || !text) return;
    this.history.recordBriefing({ shelf, count, text, hostname, model });
    this.refreshRestore();
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
