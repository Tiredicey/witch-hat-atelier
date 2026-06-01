import { LocalAdapter } from "./storage.js";

const COMPACT_THRESHOLD = 256;

function blankItem(id) {
  return { id, read: false, starred: false, trashed: false, notes: [], title: "", link: "" };
}

function blankSnapshot() {
  return { version: 1, items: [], generated: 0 };
}

export function materialise(base, events) {
  const items = new Map();
  for (const it of base?.items || []) {
    items.set(it.id, { id: it.id, read: !!it.read, starred: !!it.starred, trashed: !!it.trashed, notes: (it.notes || []).map(n => ({ ...n })), title: it.title || "", link: it.link || "" });
  }
  const ensure = (id) => {
    if (!items.has(id)) items.set(id, blankItem(id));
    return items.get(id);
  };
  for (const ev of events) {
    switch (ev.t) {
      case "item.read":   ensure(ev.itemId).read = true; break;
      case "item.unread": ensure(ev.itemId).read = false; break;
      case "item.trash":   ensure(ev.itemId).trashed = true; break;
      case "item.untrash": ensure(ev.itemId).trashed = false; break;
      case "item.star": {
        const it = ensure(ev.itemId);
        it.starred = !!ev.on;
        if (ev.on) {
          if (typeof ev.title === "string" && ev.title && !it.title) it.title = ev.title;
          if (typeof ev.link  === "string" && ev.link  && !it.link)  it.link  = ev.link;
        }
        break;
      }
      case "note.add": {
        const it = ensure(ev.itemId);
        it.notes.push({ id: ev.noteId, body: String(ev.body || ""), at: ev.at, name: String(ev.name || "") });
        break;
      }
      case "note.del": {
        const it = items.get(ev.itemId);
        if (it) it.notes = it.notes.filter(n => n.id !== ev.noteId);
        break;
      }
      default: break;
    }
  }
  return { version: 1, items: [...items.values()], generated: Date.now() };
}

export class Store {
  constructor({ adapter } = {}) {
    this.adapter = adapter || new LocalAdapter();
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

  itemFor(id) {
    return this.snapshot.items.find(it => it.id === id) || blankItem(id);
  }

  isRead(id)    { return this.itemFor(id).read; }
  isStarred(id) { return this.itemFor(id).starred; }
  isTrashed(id) { return this.itemFor(id).trashed; }
  notesFor(id)  { return this.itemFor(id).notes.map(n => ({ ...n })); }

  setRead(id, read) {
    return this.#append({ t: read ? "item.read" : "item.unread", itemId: id, at: Date.now() });
  }

  toggleRead(id) {
    return this.setRead(id, !this.isRead(id));
  }

  setStarred(id, on) {
    return this.#append({ t: "item.star", itemId: id, on: !!on, at: Date.now() });
  }

  toggleStarred(id) {
    return this.setStarred(id, !this.isStarred(id));
  }

  setTrashed(id, on) {
    return this.#append({ t: on ? "item.trash" : "item.untrash", itemId: id, at: Date.now() });
  }

  toggleTrashed(id) {
    return this.setTrashed(id, !this.isTrashed(id));
  }

  async addNote(id, body, name = "") {
    const trimmed = String(body || "").trim();
    if (!trimmed) return null;
    const noteId = this.#noteId();
    const label = String(name || "").trim().slice(0, 64);
    await this.#append({ t: "note.add", itemId: id, noteId, body: trimmed, at: Date.now(), name: label });
    return noteId;
  }

  delNote(id, noteId) {
    return this.#append({ t: "note.del", itemId: id, noteId, at: Date.now() });
  }

  subscribe(fn) {
    this.listeners.add(fn);
    fn(this.snapshot);
    return () => this.listeners.delete(fn);
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

  async bulkAppend(events) {
    if (!events || !events.length) return;
    this.snapshot = materialise(this.snapshot, events);
    await this.adapter.appendLog(events);
    this.eventsSinceSnapshot += events.length;
    if (this.eventsSinceSnapshot >= COMPACT_THRESHOLD) {
      await this.adapter.writeSnapshot(this.snapshot);
      this.eventsSinceSnapshot = 0;
    }
    this.#emit();
  }

  #emit() {
    for (const fn of this.listeners) fn(this.snapshot);
  }

  #noteId() {
    return `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }
}
