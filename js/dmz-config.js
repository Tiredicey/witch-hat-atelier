const CONFIG_KEY = "coda/dmz/worker-config";
const MIGRATED_LOCAL_KEY = "coda/dmz/migrated-at";

const DEFAULT = { workerUrl: "", enabled: false };

export function loadDmzConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return { ...DEFAULT };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT };
    return {
      workerUrl: typeof parsed.workerUrl === "string" ? parsed.workerUrl.trim().replace(/\/+$/, "") : "",
      enabled: !!parsed.enabled,
    };
  } catch { return { ...DEFAULT }; }
}

export function saveDmzConfig(cfg) {
  const safe = {
    workerUrl: typeof cfg.workerUrl === "string" ? cfg.workerUrl.trim().replace(/\/+$/, "") : "",
    enabled: !!cfg.enabled,
  };
  localStorage.setItem(CONFIG_KEY, JSON.stringify(safe));
  return safe;
}

export function isDmzWorkerActive(cfg) {
  return !!(cfg && cfg.enabled && cfg.workerUrl && /^https?:\/\//.test(cfg.workerUrl));
}

export function markLocalMigrated() {
  localStorage.setItem(MIGRATED_LOCAL_KEY, String(Date.now()));
}

export function localMigratedAt() {
  const raw = localStorage.getItem(MIGRATED_LOCAL_KEY);
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}
