const INTELLIGENCE_KEY = "coda/intelligence";
const DISCLOSURE_PREFIX = "coda/intel/disclosure-acked/";

const DEFAULT_STATE = {
  enabled: false,
  surfaces: {},
  providers: {},
};

function clone(state) {
  return {
    enabled: !!state.enabled,
    surfaces: { ...(state.surfaces || {}) },
    providers: { ...(state.providers || {}) },
  };
}

export function loadIntelligence() {
  try {
    const raw = localStorage.getItem(INTELLIGENCE_KEY);
    if (!raw) return clone(DEFAULT_STATE);
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return clone(DEFAULT_STATE);
    return {
      enabled: !!parsed.enabled,
      surfaces: parsed.surfaces && typeof parsed.surfaces === "object" ? { ...parsed.surfaces } : {},
      providers: parsed.providers && typeof parsed.providers === "object" ? { ...parsed.providers } : {},
    };
  } catch {
    return clone(DEFAULT_STATE);
  }
}

export function saveIntelligence(state) {
  const safe = clone(state);
  localStorage.setItem(INTELLIGENCE_KEY, JSON.stringify(safe));
  return safe;
}

export function clearIntelligence() {
  localStorage.removeItem(INTELLIGENCE_KEY);
}

export function disclosureKey(hostname) {
  return DISCLOSURE_PREFIX + String(hostname || "").toLowerCase();
}

export function isDisclosureAcked(hostname) {
  try { return sessionStorage.getItem(disclosureKey(hostname)) === "1"; }
  catch { return false; }
}

export function ackDisclosure(hostname) {
  try { sessionStorage.setItem(disclosureKey(hostname), "1"); } catch {}
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
    this.listeners = new Set();
    this.#hydrate();
    this.#bind();
    this.#syncPanel();
  }

  subscribe(fn) {
    this.listeners.add(fn);
    try { fn(this.snapshot()); } catch {}
    return () => this.listeners.delete(fn);
  }

  snapshot() {
    return clone(this.state);
  }

  isEnabled() {
    return !!this.state.enabled;
  }

  isSurfaceEnabled(id) {
    return !!(this.state.enabled && this.state.surfaces && this.state.surfaces[id]);
  }

  setSurfaceEnabled(id, on) {
    this.state.surfaces[id] = !!on;
    this.#flagDirty();
    this.#emit();
  }

  getProviderKey(id) {
    const v = this.state.providers ? this.state.providers[id] : "";
    return typeof v === "string" ? v : "";
  }

  setProviderKey(id, key) {
    if (key) this.state.providers[id] = String(key);
    else delete this.state.providers[id];
    this.#flagDirty();
    this.#emit();
  }

  mountTarget() {
    return this.panelEl;
  }

  #hydrate() {
    this.enableInput.checked = this.state.enabled;
  }

  #bind() {
    this.enableInput.addEventListener("change", () => {
      this.state.enabled = this.enableInput.checked;
      this.#syncPanel();
      this.#flagDirty();
      this.#emit();
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
    const surfaceCount = Object.values(this.state.surfaces).filter(Boolean).length;
    this.statusEl.textContent = this.state.enabled
      ? (surfaceCount === 0
          ? "Intelligence panel on. No surfaces are active."
          : `Intelligence panel on. ${surfaceCount} surface${surfaceCount === 1 ? "" : "s"} active.`)
      : "Intelligence panel off.";
    this.statusEl.dataset.status = "ok";
    this.#emit();
  }

  #reset() {
    clearIntelligence();
    this.state = clone(DEFAULT_STATE);
    this.enableInput.checked = false;
    this.#syncPanel();
    this.statusEl.textContent = "Intelligence settings cleared.";
    this.statusEl.dataset.status = "ok";
    this.#emit();
  }

  #emit() {
    const snap = this.snapshot();
    for (const fn of this.listeners) {
      try { fn(snap); } catch (e) { console.error(e); }
    }
  }
}
