const HISTORY_KEY = "coda/intel/history";
const SUMMARY_CAP = 100;
const BRIEFING_CAP = 30;

function safeArray(v) {
  return Array.isArray(v) ? v : [];
}

export function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return { summaries: [], briefings: [] };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { summaries: [], briefings: [] };
    return {
      summaries: safeArray(parsed.summaries),
      briefings: safeArray(parsed.briefings),
    };
  } catch {
    return { summaries: [], briefings: [] };
  }
}

export function saveHistory(history) {
  const safe = {
    summaries: safeArray(history && history.summaries).slice(0, SUMMARY_CAP),
    briefings: safeArray(history && history.briefings).slice(0, BRIEFING_CAP),
  };
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(safe)); } catch {}
  return safe;
}

export function clearHistory() {
  try { localStorage.removeItem(HISTORY_KEY); } catch {}
}

export function relTime(ts, now) {
  const then = Number(ts);
  if (!Number.isFinite(then)) return "";
  const delta = Math.max(0, (now || Date.now()) - then);
  const mins = Math.round(delta / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

export class IntelHistory {
  constructor(opts) {
    this.now = opts && typeof opts.now === "function" ? opts.now : () => Date.now();
    this.state = loadHistory();
  }

  recordSummary({ id, title, source, text, hostname, model }) {
    if (!id || !text) return;
    const entry = {
      id: String(id),
      title: title || "(untitled)",
      source: source || "(unknown source)",
      text: String(text),
      hostname: hostname || "",
      model: model || "",
      ts: this.now(),
    };
    this.state.summaries = this.state.summaries.filter(s => s && s.id !== entry.id);
    this.state.summaries.unshift(entry);
    this.state = saveHistory(this.state);
    return entry;
  }

  getSummary(id) {
    if (!id) return null;
    const want = String(id);
    return this.state.summaries.find(s => s && s.id === want) || null;
  }

  recordBriefing({ shelf, count, text, hostname, model }) {
    if (!text) return;
    const entry = {
      shelf: shelf || "all",
      count: Number.isFinite(count) ? count : 0,
      text: String(text),
      hostname: hostname || "",
      model: model || "",
      ts: this.now(),
    };
    this.state.briefings.unshift(entry);
    this.state = saveHistory(this.state);
    return entry;
  }

  latestBriefing(shelf) {
    const want = shelf || "all";
    return this.state.briefings.find(b => b && b.shelf === want) || null;
  }
}
