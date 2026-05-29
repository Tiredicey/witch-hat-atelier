import {
  summariseWithGroq,
  GROQ_ID,
  GROQ_HOSTNAME,
  GROQ_DEFAULT_MODEL,
  GROQ_PRICING_URL,
} from "./groq.js";
import { isDisclosureAcked, ackDisclosure } from "./index.js";

export const GROQ_SURFACE_ID = "groq-summarise";

export class GroqSummariseSurface {
  /**
   * @param {object} opts
   * @param {import("./index.js").Intelligence} opts.intelligence
   * @param {object} opts.reader              Reader instance (exposes .currentArticle)
   * @param {HTMLElement} opts.wrapEl         Reader-pane surface host (#readerSummarise)
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
    this.intel = opts.intelligence;
    this.reader = opts.reader;
    this.wrapEl = opts.wrapEl;
    this.triggerBtn = opts.triggerBtn;
    this.statusEl = opts.statusEl;
    this.disclosureEl = opts.disclosureEl;
    this.disclosureTextEl = opts.disclosureTextEl;
    this.confirmBtn = opts.confirmBtn;
    this.cancelBtn = opts.cancelBtn;
    this.outputEl = opts.outputEl;
    this.fetchImpl = opts.fetchImpl || null;
    this.inflight = null;

    this.#mountFieldset();
    this.#bind();
    this.intel.subscribe(() => this.#syncVisibility());
  }

  isReady() {
    return this.intel.isSurfaceEnabled(GROQ_SURFACE_ID) && !!this.intel.getProviderKey(GROQ_ID);
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

  #mountFieldset() {
    const target = this.intel.mountTarget();
    if (!target) return;
    const fieldset = document.createElement("fieldset");
    fieldset.className = "settings__group intel-surface";
    fieldset.dataset.surface = GROQ_SURFACE_ID;
    fieldset.innerHTML = `
      <legend>Reader-pane Summarise (Groq) <span class="intel-surface__tag">§17.8</span></legend>
      <label class="settings__field settings__field--inline">
        <input id="intelGroqSurfaceEnable" type="checkbox">
        <span>Enable the Summarise button in the reader pane</span>
      </label>
      <label class="settings__field">
        <span>Groq API key (kept in this browser only)</span>
        <input id="intelGroqApiKey" type="password" autocomplete="off" spellcheck="false" placeholder="gsk_…">
      </label>
      <p class="settings__hint">
        Default model <code>${GROQ_DEFAULT_MODEL}</code> against <code>api.groq.com</code>.
        Free-tier prompts may be retained for evaluation per Groq's TOS &mdash; check
        <a href="${GROQ_PRICING_URL}" target="_blank" rel="noopener noreferrer">groq.com/pricing</a> before pasting a key.
      </p>
    `;
    target.appendChild(fieldset);
    this.enableInput = fieldset.querySelector("#intelGroqSurfaceEnable");
    this.keyInput = fieldset.querySelector("#intelGroqApiKey");
    this.enableInput.checked = !!this.intel.snapshot().surfaces[GROQ_SURFACE_ID];
    this.keyInput.value = this.intel.getProviderKey(GROQ_ID);
    this.enableInput.addEventListener("change", () => {
      this.intel.setSurfaceEnabled(GROQ_SURFACE_ID, this.enableInput.checked);
    });
    this.keyInput.addEventListener("input", () => {
      this.intel.setProviderKey(GROQ_ID, this.keyInput.value.trim());
    });
  }

  #bind() {
    this.triggerBtn.addEventListener("click", () => this.#onTrigger());
    this.confirmBtn.addEventListener("click", () => this.#onConfirm());
    this.cancelBtn.addEventListener("click", () => this.#dismissDisclosure());
    this.#syncVisibility();
  }

  #syncVisibility() {
    const on = this.isReady();
    this.wrapEl.hidden = !on;
    if (!on) {
      this.#dismissDisclosure();
      this.outputEl.hidden = true;
      this.outputEl.textContent = "";
      this.#setStatus("", null);
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
    if (!this.isReady()) return;
    if (this.inflight) return;
    const article = this.#articleSnapshot();
    if (!article) {
      this.#setStatus("Open an article first.", "info");
      return;
    }
    if (isDisclosureAcked(GROQ_HOSTNAME)) {
      this.#run(article);
      return;
    }
    this.disclosureTextEl.textContent =
      `This will send "${article.source} · ${article.title}" to ${GROQ_HOSTNAME}.`;
    this.disclosureEl.hidden = false;
    this.confirmBtn.focus();
  }

  #onConfirm() {
    const article = this.#articleSnapshot();
    if (!article) {
      this.#dismissDisclosure();
      this.#setStatus("Open an article first.", "info");
      return;
    }
    ackDisclosure(GROQ_HOSTNAME);
    this.#dismissDisclosure();
    this.#run(article);
  }

  #dismissDisclosure() {
    this.disclosureEl.hidden = true;
    this.disclosureTextEl.textContent = "";
  }

  async #run(article) {
    const apiKey = this.intel.getProviderKey(GROQ_ID);
    if (!apiKey) {
      this.#setStatus("Paste a Groq API key in Settings.", "fail");
      return;
    }
    this.outputEl.hidden = true;
    this.outputEl.textContent = "";
    this.triggerBtn.disabled = true;
    this.#setStatus(`Summarising via ${GROQ_HOSTNAME}…`, "pending");
    const controller = new AbortController();
    this.inflight = controller;
    try {
      const { summary, model } = await summariseWithGroq({
        apiKey,
        article,
        signal: controller.signal,
        fetchImpl: this.fetchImpl,
      });
      this.outputEl.textContent = summary;
      this.outputEl.hidden = false;
      this.#setStatus(`Answered by ${GROQ_HOSTNAME} · ${model}`, "ok");
    } catch (e) {
      const msg = e && e.message ? e.message : "Summary failed.";
      this.#setStatus(msg, "fail");
    } finally {
      this.triggerBtn.disabled = false;
      this.inflight = null;
    }
  }
}
