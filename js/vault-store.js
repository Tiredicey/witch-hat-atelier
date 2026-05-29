import { LocalAdapter } from "./storage.js";

const COMPACT_THRESHOLD = 64;

function blankSnapshot() {
  return { version: 1, files: [], generated: 0 };
}

export function materialise(base, events) {
  const map = new Map();
  for (const f of base?.files || []) {
    map.set(f.id, {
      id: f.id,
      name: f.name || "",
      size: typeof f.size === "number" ? f.size : 0,
      contentType: f.contentType || "application/octet-stream",
      key: f.key || "",
      at: typeof f.at === "number" ? f.at : 0,
    });
  }
  for (const ev of events) {
    switch (ev.t) {
      case "file.add":
        map.set(ev.id, {
          id: ev.id,
          name: ev.name || "",
          size: typeof ev.size === "number" ? ev.size : 0,
          contentType: ev.contentType || "application/octet-stream",
          key: ev.key || "",
          at: typeof ev.at === "number" ? ev.at : Date.now(),
        });
        break;
      case "file.del":
        map.delete(ev.id);
        break;
      default:
        break;
    }
  }
  return { version: 1, files: [...map.values()], generated: Date.now() };
}

export class VaultStore {
  constructor({ adapter, prefix = "coda/vault" } = {}) {
    this.adapter = adapter || new LocalAdapter(prefix);
    this.prefix = prefix;
    this.snapshot = blankSnapshot();
    this.listeners = new Set();
    this.eventsSinceSnapshot = 0;
  }

  async load() {
    const base = (await this.adapter.readSnapshot()) || blankSnapshot();
    const events = await this.adapter.readLog();
    this.eventsSinceSnapshot = events.length;
    this.snapshot = materialise(base, events);
    this.#emit();
    return this.snapshot;
  }

  files() {
    return this.snapshot.files.map(f => ({ ...f }));
  }

  fileFor(id) {
    const f = this.snapshot.files.find(x => x.id === id);
    return f ? { ...f } : null;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    fn(this.snapshot);
    return () => this.listeners.delete(fn);
  }

  async addFile({ id, name, size, contentType, key }) {
    return this.#append({
      t: "file.add",
      id,
      name: String(name || ""),
      size: Number(size) || 0,
      contentType: contentType || "application/octet-stream",
      key,
      at: Date.now(),
    });
  }

  async delFile(id) {
    return this.#append({ t: "file.del", id, at: Date.now() });
  }

  async #append(ev) {
    this.snapshot = materialise(this.snapshot, [ev]);
    await this.adapter.appendLog([ev]);
    this.eventsSinceSnapshot += 1;
    if (this.eventsSinceSnapshot >= COMPACT_THRESHOLD) {
      await this.adapter.writeSnapshot(this.snapshot);
      this.eventsSinceSnapshot = 0;
    }
    this.#emit();
  }

  #emit() {
    for (const fn of this.listeners) fn(this.snapshot);
  }
}
