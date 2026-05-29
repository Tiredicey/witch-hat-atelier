const COOLDOWN_BASE_MS = 60_000;
const COOLDOWN_MAX_MS  = 600_000;

function now() { return Date.now(); }

function isOnline() {
  if (typeof navigator === "undefined") return true;
  if (typeof navigator.onLine !== "boolean") return true;
  return navigator.onLine;
}

export class ChainAdapter {
  constructor({ chain, labels = [] }) {
    if (!Array.isArray(chain) || !chain.length) {
      throw new Error("ChainAdapter: chain must be a non-empty array");
    }
    this.chain = chain;
    this.labels = chain.map((a, i) => labels[i] || a.constructor?.name || `adapter[${i}]`);
    this.health = chain.map(() => ({ failures: 0, cooldownUntil: 0, lastError: null, lastOk: 0 }));
  }

  #isLocal(adapter) {
    return adapter && adapter.constructor && adapter.constructor.name === "LocalAdapter";
  }

  #usable(i) {
    const h = this.health[i];
    if (h.cooldownUntil > now()) return false;
    if (!isOnline() && !this.#isLocal(this.chain[i])) return false;
    return true;
  }

  #recordOk(i) {
    this.health[i].failures = 0;
    this.health[i].cooldownUntil = 0;
    this.health[i].lastError = null;
    this.health[i].lastOk = now();
  }

  #recordFail(i, err) {
    const h = this.health[i];
    h.failures += 1;
    h.lastError = (err && err.message) || String(err);
    const wait = Math.min(COOLDOWN_BASE_MS * Math.pow(2, h.failures - 1), COOLDOWN_MAX_MS);
    h.cooldownUntil = now() + wait;
  }

  async #tryRead(method, ...args) {
    let lastErr = null;
    for (let i = 0; i < this.chain.length; i++) {
      if (!this.#usable(i)) continue;
      if (typeof this.chain[i][method] !== "function") continue;
      try {
        const out = await this.chain[i][method](...args);
        this.#recordOk(i);
        return out;
      } catch (e) {
        this.#recordFail(i, e);
        lastErr = e;
      }
    }
    if (lastErr) throw lastErr;
    if (method === "readLog") return [];
    if (method === "readSnapshot") return null;
    return null;
  }

  async #mirrorWrite(method, ...args) {
    const indices = [];
    for (let i = 0; i < this.chain.length; i++) {
      if (!this.#usable(i)) continue;
      if (typeof this.chain[i][method] !== "function") continue;
      indices.push(i);
    }
    if (!indices.length) throw new Error(`ChainAdapter: no adapter in the chain supports ${method}`);
    const results = await Promise.allSettled(
      indices.map(i => this.chain[i][method](...args)),
    );
    let oneOk = false;
    let lastErr = null;
    results.forEach((r, idx) => {
      const i = indices[idx];
      if (r.status === "fulfilled") { this.#recordOk(i); oneOk = true; }
      else { this.#recordFail(i, r.reason); lastErr = r.reason; }
    });
    if (!oneOk) throw lastErr || new Error("ChainAdapter: all writes failed");
  }

  async readLog() {
    const polled = await this.#pollRead("readLog");
    if (!polled.ok.length) { if (polled.lastErr) throw polled.lastErr; return []; }
    polled.ok.sort((a, b) => (b.value?.length || 0) - (a.value?.length || 0));
    const best = polled.ok[0];
    const primary = polled.ok.find(r => r.i === 0);
    if (primary && best.i !== 0 && (best.value?.length || 0) > (primary.value?.length || 0)) {
      console.warn(
        `ChainAdapter.readLog: ${this.labels[0]} returned ${primary.value?.length || 0} events but ${this.labels[best.i]} has ${best.value?.length || 0}. Primary appears out of sync.`,
      );
    }
    return best.value || [];
  }

  async readSnapshot() {
    const polled = await this.#pollRead("readSnapshot");
    if (!polled.ok.length) { if (polled.lastErr) throw polled.lastErr; return null; }
    const nonNull = polled.ok.filter(r => r.value && typeof r.value.generated === "number");
    if (!nonNull.length) {
      const any = polled.ok.find(r => r.value != null);
      return any ? any.value : null;
    }
    nonNull.sort((a, b) => (b.value.generated || 0) - (a.value.generated || 0));
    const best = nonNull[0];
    const primary = nonNull.find(r => r.i === 0);
    if (primary && best.i !== 0 && (best.value.generated || 0) > (primary.value.generated || 0)) {
      console.warn(
        `ChainAdapter.readSnapshot: ${this.labels[0]} snapshot is older than ${this.labels[best.i]}. Primary appears out of sync.`,
      );
    }
    return best.value;
  }

  async #pollRead(method, ...args) {
    const usable = [];
    for (let i = 0; i < this.chain.length; i++) {
      if (!this.#usable(i)) continue;
      if (typeof this.chain[i][method] !== "function") continue;
      usable.push(i);
    }
    const settled = await Promise.allSettled(
      usable.map(i => this.chain[i][method](...args)),
    );
    const ok = [];
    let lastErr = null;
    settled.forEach((r, idx) => {
      const i = usable[idx];
      if (r.status === "fulfilled") { this.#recordOk(i); ok.push({ i, value: r.value }); }
      else { this.#recordFail(i, r.reason); lastErr = r.reason; }
    });
    return { ok, lastErr };
  }
  async appendLog(events) { return this.#mirrorWrite("appendLog", events); }
  async writeSnapshot(s)  { return this.#mirrorWrite("writeSnapshot", s); }
  async clear()           { return this.#mirrorWrite("clear"); }

  // Generic key-based read/write. Required for features that store a JSON
  // file at a fixed path independent of the event log; OPML subscriptions
  // (coda/subs/subscriptions.json) was the first such feature. Adapters
  // that do not implement these (TelegramAdapter, today) are skipped by the
  // typeof guards in #tryRead / #mirrorWrite, so a chain containing Telegram
  // does not crash; it just routes around it.
  async read(key)         { return this.#tryRead("read", key); }
  async write(key, body)  { return this.#mirrorWrite("write", key, body); }

  async putBlob(key, blob)    { return this.#mirrorWrite("putBlob", key, blob); }
  async deleteBlob(key)       { return this.#mirrorWrite("deleteBlob", key); }
  async getBlob(key) {
    let lastErr = null;
    for (let i = 0; i < this.chain.length; i++) {
      if (!this.#usable(i)) continue;
      if (typeof this.chain[i].getBlob !== "function") continue;
      try {
        const out = await this.chain[i].getBlob(key);
        if (out) { this.#recordOk(i); return out; }
        this.#recordOk(i);
      } catch (e) {
        this.#recordFail(i, e);
        lastErr = e;
      }
    }
    if (lastErr) throw lastErr;
    return null;
  }

  async test() {
    const results = await Promise.all(
      this.chain.map(async (a, i) => {
        if (!a.test) return { label: this.labels[i], ok: true, note: "no test method" };
        try { const r = await a.test(); return { label: this.labels[i], ...r }; }
        catch (e) { return { label: this.labels[i], ok: false, error: e.message }; }
      }),
    );
    const okCount = results.filter(r => r.ok).length;
    if (okCount === results.length) return { ok: true, chain: results };
    if (okCount > 0) return { ok: true, partial: true, chain: results };
    return { ok: false, error: "all adapters failed", chain: results };
  }

  status() {
    return this.chain.map((a, i) => ({
      label: this.labels[i],
      kind: a.constructor?.name || "unknown",
      healthy: this.health[i].cooldownUntil <= now(),
      failures: this.health[i].failures,
      lastError: this.health[i].lastError,
      lastOk: this.health[i].lastOk,
      cooldownUntil: this.health[i].cooldownUntil,
    }));
  }
}
