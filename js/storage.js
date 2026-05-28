const NDJSON_SEP = "\n";

export class LocalAdapter {
  constructor(prefix = "coda/v1") {
    this.prefix = prefix;
    this.logKey = `${prefix}/log.ndjson`;
    this.snapKey = `${prefix}/snapshot.json`;
  }

  async readLog() {
    const raw = localStorage.getItem(this.logKey);
    if (!raw) return [];
    const out = [];
    for (const line of raw.split(NDJSON_SEP)) {
      if (!line) continue;
      try { out.push(JSON.parse(line)); } catch { /* malformed line, drop */ }
    }
    return out;
  }

  async appendLog(events) {
    if (!events.length) return;
    const cur = localStorage.getItem(this.logKey);
    const add = events.map(e => JSON.stringify(e)).join(NDJSON_SEP);
    localStorage.setItem(this.logKey, cur ? cur + NDJSON_SEP + add : add);
  }

  async readSnapshot() {
    const raw = localStorage.getItem(this.snapKey);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  async writeSnapshot(snapshot) {
    localStorage.setItem(this.snapKey, JSON.stringify(snapshot));
    localStorage.removeItem(this.logKey);
  }

  async clear() {
    localStorage.removeItem(this.logKey);
    localStorage.removeItem(this.snapKey);
  }

  // Generic key-based read/write used by features that need a JSON file at a
  // fixed path (subscriptions, future imports/exports). Returns null on miss.
  async read(key) {
    return localStorage.getItem(key);
  }

  async write(key, body) {
    localStorage.setItem(key, body);
  }
}

export class MemoryAdapter {
  constructor() { this.log = []; this.snap = null; }
  async readLog() { return [...this.log]; }
  async appendLog(events) { this.log.push(...events); }
  async readSnapshot() { return this.snap ? JSON.parse(JSON.stringify(this.snap)) : null; }
  async writeSnapshot(s) { this.snap = JSON.parse(JSON.stringify(s)); this.log = []; }
  async clear() { this.log = []; this.snap = null; }
}
