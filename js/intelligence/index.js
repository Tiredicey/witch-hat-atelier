const INTELLIGENCE_KEY = "coda/intelligence";

const DEFAULT_STATE = {
  enabled: false,
  surfaces: {},
  providers: {},
};

export function loadIntelligence() {
  try {
    const raw = localStorage.getItem(INTELLIGENCE_KEY);
    if (!raw) return { ...DEFAULT_STATE };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_STATE };
    return {
      enabled: !!parsed.enabled,
      surfaces: parsed.surfaces && typeof parsed.surfaces === "object" ? parsed.surfaces : {},
      providers: parsed.providers && typeof parsed.providers === "object" ? parsed.providers : {},
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export function saveIntelligence(state) {
  const safe = {
    enabled: !!state.enabled,
    surfaces: state.surfaces && typeof state.surfaces === "object" ? state.surfaces : {},
    providers: state.providers && typeof state.providers === "object" ? state.providers : {},
  };
  localStorage.setItem(INTELLIGENCE_KEY, JSON.stringify(safe));
  return safe;
}

export function clearIntelligence() {
  localStorage.removeItem(INTELLIGENCE_KEY);
}

export class Intelligence {
  constructor({ pageEl, enableInput, panelEl, disclosureEl, statusEl, saveBtn, resetBtn }) {
    this.pageEl = pageEl;
    this.enableInput = enableInput;
    this.panelEl = panelEl;
    this.disclosureEl = disclosureEl;
    this.statusEl = statusEl;
    this.saveBtn = saveBtn;
    this.resetBtn = resetBtn;

    this.state = loadIntelligence();
    this.#hydrate();
    this.#bind();
    this.#syncPanel();
  }

  #hydrate() {
    this.enableInput.checked = this.state.enabled;
  }

  #bind() {
    this.enableInput.addEventListener("change", () => {
      this.state.enabled = this.enableInput.checked;
      this.#syncPanel();
      this.#flagDirty();
    });
    this.saveBtn.addEventListener("click", () => this.#save());
    this.resetBtn.addEventListener("click", () => this.#reset());
  }

  #syncPanel() {
    this.panelEl.hidden = !this.state.enabled;
    this.disclosureEl.hidden = !this.state.enabled;
  }

  #flagDirty() {
    this.statusEl.textContent = "";
    this.statusEl.removeAttribute("data-status");
  }

  #save() {
    this.state = saveIntelligence(this.state);
    this.statusEl.textContent = this.state.enabled
      ? "Intelligence panel on. No providers are wired yet."
      : "Intelligence panel off.";
    this.statusEl.dataset.status = "ok";
  }

  #reset() {
    clearIntelligence();
    this.state = { ...DEFAULT_STATE };
    this.enableInput.checked = false;
    this.#syncPanel();
    this.statusEl.textContent = "Intelligence settings cleared.";
    this.statusEl.dataset.status = "ok";
  }
}
