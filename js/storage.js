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
    try {
      const db = await this.#openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction("blobs", "readwrite");
        tx.objectStore("blobs").clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } catch { /* IDB optional during clear */ }
  }

  #openDb() {
    if (typeof indexedDB === "undefined") {
      return Promise.reject(new Error("IndexedDB unavailable"));
    }
    if (this._dbPromise) return this._dbPromise;
    this._dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open("coda-blobs", 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this._dbPromise;
  }

  async putBlob(key, blob) {
    const db = await this.#openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("blobs", "readwrite");
      tx.objectStore("blobs").put(blob, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async getBlob(key) {
    const db = await this.#openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("blobs", "readonly");
      const req = tx.objectStore("blobs").get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async deleteBlob(key) {
    const db = await this.#openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("blobs", "readwrite");
      tx.objectStore("blobs").delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
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
