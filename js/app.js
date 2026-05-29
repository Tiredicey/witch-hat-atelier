import { SAMPLE } from "./sample-data.js";
import { ArticleList } from "./article-list.js";
import { Reader } from "./reader.js";
import { Shelves } from "./shelves.js";
import { Atelier } from "./atelier.js";
import { Mobile } from "./mobile.js";
import { Help } from "./help.js";
import { Shortcuts } from "./shortcuts.js";
import { Store } from "./store.js";
import { LocalAdapter } from "./storage.js";
import { Notes } from "./notes.js";
import { Dmz, mountRouter } from "./dmz.js";
import { Settings } from "./settings.js";
import { loadSettings, makeAdapter } from "./adapters/index.js";
import { loadFeedSnapshot } from "./feed-source.js";
import { loadFeedFromBrowserEngine } from "./feed-engine.js";
import { StarsImport } from "./inoreader-import.js";
import { Subscriptions } from "./subscriptions.js";
import { AddFeed } from "./add-feed.js";

function $(sel, root = document) {
  const el = root.querySelector(sel);
  if (!el) throw new Error(`app.js: required element not found: ${sel}`);
  return el;
}

async function boot() {
  const appEl     = $("#app");
  const listEl    = $("#list");
  const rowsEl    = $("#rows");
  const wrapEl    = $("#readerWrap");
  const readerEl  = $("#reader");
  const railEl    = $('nav.rail');
  const titleEl   = $("#shelf-title");
  const scrimEl   = $("#scrim");
  const helpBtn   = $("#helpBtn");
  const helpBtnRail = document.getElementById("helpBtnRail");
  const atelierBtn= $("#atelierBtn");
  const markBtn   = $("#markBtn");
  const starBtn   = $("#starBtn");
  const noteBtn   = $("#noteBtn");
  const backBtn   = $("#mobileBack");

  const notesPanel = $("#notesPanel");
  const notesList  = $("#notesList");
  const notesForm  = $("#notesForm");
  const notesText  = $("#notesTextarea");
  const notesSave  = $("#notesSave");
  const notesCancel = $("#notesCancel");

  const settings = loadSettings();
  let adapter;
  try {
    adapter = makeAdapter(settings, "coda/v1");
  } catch (e) {
    console.warn("primary adapter init failed, falling back to local", e);
    adapter = new LocalAdapter("coda/v1");
  }
  const store = new Store({ adapter });
  try {
    await store.load();
  } catch (e) {
    console.warn("primary store load failed, continuing with empty snapshot", e);
  }

  const reader  = new Reader({
    wrapEl,
    readerEl,
    extractWrapEl:   document.getElementById("readerExtract"),
    extractBtn:      document.getElementById("readCleanBtn"),
    extractStatusEl: document.getElementById("readerExtractStatus"),
  });
  const atelier = new Atelier({ appEl, toggleEl: atelierBtn });
  const mobile  = new Mobile({ appEl, backBtn });
  const help    = new Help({ scrimEl, openEl: helpBtn });
  if (helpBtnRail) helpBtnRail.addEventListener("click", () => help.open());

  const notes = new Notes({
    panelEl: notesPanel,
    listEl: notesList,
    formEl: notesForm,
    textareaEl: notesText,
    saveBtn: notesSave,
    cancelBtn: notesCancel,
    store,
  });

  // Try to load real entries. Preference order:
  //   1. R2 snapshot written by the §4 Worker (S3 adapter only).
  //   2. Browser-side fetch via the same-origin /fetch proxy, reading the
  //      subscriptions written by Settings → Import OPML. Works on every
  //      adapter and is the path that makes OPML imports visible on the
  //      default LocalAdapter.
  //   3. SAMPLE, so the shell never boots empty.
  // Never blocks boot for longer than the per-feed timeout; loadFeedSnapshot
  // and the browser engine each have their own AbortControllers.
  let items = SAMPLE;
  try {
    const r2 = await loadFeedSnapshot(settings, adapter);
    if (r2 && r2.length > 0) {
      items = r2;
    } else {
      const browser = await loadFeedFromBrowserEngine({ adapter });
      if (browser && browser.length > 0) items = browser;
    }
  } catch (e) {
    console.warn("app: feed load failed, using SAMPLE", e);
  }

  const baseFeedItems = items;
  items = mergeStarOrphans(baseFeedItems, store);

  function mergeStarOrphans(base, st) {
    const haveId = new Set(base.map(x => x.id));
    const orphans = [];
    for (const it of st.snapshot.items) {
      if (!it.starred) continue;
      if (haveId.has(it.id)) continue;
      const link = it.link || it.id;
      let host = "";
      try { host = new URL(link).hostname.replace(/^www\./, ""); } catch { host = "imported"; }
      orphans.push({
        id: it.id,
        source: host,
        shelf: "starred-import",
        title: it.title || link,
        age: "imported",
        read: !!it.read,
        excerpt: link,
        body: [],
        link,
        orphan: true,
      });
    }
    if (!orphans.length) return base;
    return [...base, ...orphans];
  }

  const list = new ArticleList({
    listEl, rowsEl, items,
    onSelect: (id) => {
      const a = list.find(id);
      if (a) {
        reader.renderArticle(a);
        notes.bind(id);
        mobile.showReader();
        syncToolbar(id);
      } else {
        reader.renderEmpty();
        notes.unbind();
      }
    }
  });

  const metaEl = document.getElementById("shelf-meta");
  function applyShelf(shelfId) {
    let pred;
    if (shelfId === "all")          pred = () => true;
    else if (shelfId === "starred") pred = (it) => store.isStarred(it.id);
    else                            pred = (it) => it.shelf === shelfId;
    list.setFilter(pred);
    if (metaEl) {
      const n = list.getIds().length;
      metaEl.textContent = n === 1 ? "1 item" : `${n} items`;
    }
  }
  new Shelves({
    railEl, titleEl,
    onSwitch: (shelfId) => applyShelf(shelfId)
  });
  applyShelf("all"); // align the list-header meta with the actual sample-item count

  function syncToolbar(id) {
    const starred = store.isStarred(id);
    const read = store.isRead(id);
    starBtn.dataset.starred = String(starred);
    starBtn.style.color = starred ? "var(--sepia)" : "";
    starBtn.setAttribute("aria-pressed", String(starred));
    markBtn.textContent = read ? "Mark unread" : "Mark read";
    markBtn.setAttribute("aria-pressed", String(read));
  }

  store.subscribe(() => {
    list.refreshFromStore(store);
    const id = list.getSelectedId();
    if (id) syncToolbar(id);
  });

  markBtn.addEventListener("click", () => {
    const id = list.getSelectedId();
    if (id) store.toggleRead(id);
  });
  starBtn.addEventListener("click", () => {
    const id = list.getSelectedId();
    if (id) store.toggleStarred(id);
  });
  noteBtn.addEventListener("click", () => {
    if (!list.getSelectedId()) return;
    notes.isOpen() ? notes.close() : notes.open();
  });

  new Shortcuts({
    scrimEl,
    handlers: {
      openHelp:   () => help.open(),
      closeHelp:  () => { help.close(); notes.close(); },
      toggleAtelier: () => atelier.toggle(),
      selectNext: () => {
        const ids = list.getIds();
        const cur = list.getSelectedId();
        const i = ids.indexOf(cur);
        const next = i === -1 ? ids[0] : ids[Math.min(i + 1, ids.length - 1)];
        list.setSelected(next);
        const a = list.find(next);
        if (a) { reader.renderArticle(a); notes.bind(next); mobile.showReader(); syncToolbar(next); }
      },
      selectPrev: () => {
        const ids = list.getIds();
        const cur = list.getSelectedId();
        const i = ids.indexOf(cur);
        const prev = i === -1 ? ids[0] : ids[Math.max(i - 1, 0)];
        list.setSelected(prev);
        const a = list.find(prev);
        if (a) { reader.renderArticle(a); notes.bind(prev); mobile.showReader(); syncToolbar(prev); }
      },
      openFirstIfNone: () => {
        if (!list.getSelectedId() && items[0]) {
          list.setSelected(items[0].id);
          reader.renderArticle(items[0]);
          notes.bind(items[0].id);
          mobile.showReader();
          syncToolbar(items[0].id);
        }
      },
      markToggle: () => markBtn.click(),
      starToggle: () => starBtn.click(),
      addNote:    () => {
        if (!list.getSelectedId()) return;
        notes.open();
      },
      goShelf: (id) => {
        const shelf = railEl.querySelector(`.shelf[data-shelf="${id}"]`);
        shelf?.click();
      }
    }
  });

  list.refreshFromStore(store);

  let dmzAdapter;
  try {
    dmzAdapter = makeAdapter(settings, "coda/dmz");
  } catch (e) {
    console.warn("dmz adapter init failed, falling back to local", e);
    dmzAdapter = new LocalAdapter("coda/dmz");
  }
  const dmzStore = new Store({ adapter: dmzAdapter });
  try {
    await dmzStore.load();
  } catch (e) {
    console.warn("dmz store load failed, continuing with empty snapshot", e);
  }
  const dmz = new Dmz({
    pageEl:     $("#dmzPage"),
    listEl:     $("#dmzList"),
    formEl:     $("#dmzForm"),
    textareaEl: $("#dmzTextarea"),
    submitBtn:  $("#dmzSubmit"),
    store:      dmzStore,
  });
  const router = mountRouter({
    enterDmzBtn: $("#enterDmzBtn"),
    exitDmzBtn:  $("#exitDmzBtn"),
    dmz,
  });

  const settingsPage = $("#settingsPage");
  const settingsCtrl = new Settings({
    pageEl:         settingsPage,
    formEl:         $("#settingsForm"),
    kindSelect:     $("#settingsKind"),
    groupsEl:       $("#settingsGroups"),
    plaintextGate:  $("#plaintextGate"),
    plaintextInput: $("#plaintextConfirm"),
    testBtn:        $("#testSettingsBtn"),
    saveBtn:        $("#saveSettingsBtn"),
    resetBtn:       $("#resetSettingsBtn"),
    testOutput:     $("#settingsTestOutput"),
    activeBanner:   $("#settingsActiveBanner"),
    mirrorLocalInput: $("#mirrorLocalToggle"),
  });
  document.getElementById("enterSettingsBtn")?.addEventListener("click", () => router.go("settings"));
  $("#exitSettingsBtn").addEventListener("click", () => router.go("reader"));
  void settingsCtrl;

  const starsImport = new StarsImport({
    fileInput: document.getElementById("inoreader-stars-file"),
    statusEl:  document.getElementById("inoreader-stars-status"),
    store,
    onAfter: () => {
      const merged = mergeStarOrphans(baseFeedItems, store);
      list.setItems(merged);
      const shelfId = (railEl.querySelector(".shelf[aria-current=\"true\"]")?.dataset?.shelf) || "all";
      applyShelf(shelfId);
    },
  });
  void starsImport;

  const subs = new Subscriptions({
    importInput:     document.getElementById("opml-import-file"),
    statusEl:        document.getElementById("opml-import-status"),
    triageEl:        document.getElementById("opml-triage"),
    triageListEl:    document.getElementById("opml-triage-list"),
    triageSummaryEl: document.getElementById("opml-triage-summary"),
    selectAllBtn:    document.getElementById("opml-select-all"),
    selectNoneBtn:   document.getElementById("opml-select-none"),
    commitBtn:       document.getElementById("opml-commit-import"),
    cancelBtn:       document.getElementById("opml-cancel-import"),
    exportBtn:       document.getElementById("opml-export-btn"),
    exportStatusEl:  document.getElementById("opml-export-status"),
    adapter,
  });
  void subs;

  const addFeed = new AddFeed({
    inputEl:        document.getElementById("add-feed-input"),
    resolveBtn:     document.getElementById("add-feed-resolve"),
    shelfInput:     document.getElementById("add-feed-shelf"),
    statusEl:       document.getElementById("add-feed-status"),
    candidatesEl:   document.getElementById("add-feed-candidates"),
    refusedEl:      document.getElementById("add-feed-refused"),
    bridgeInput:    document.getElementById("add-feed-bridge"),
    bridgeSaveBtn:  document.getElementById("add-feed-bridge-save"),
    bridgeClearBtn: document.getElementById("add-feed-bridge-clear"),
    bridgeStatusEl: document.getElementById("add-feed-bridge-status"),
    bridgeBadgeEl:  document.getElementById("add-feed-bridge-badge"),
    bridgeDetailsEl: document.getElementById("add-feed-bridge-details"),
    subscriptions:  subs,
  });
  void addFeed;
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => { boot().catch(err => console.error(err)); });
} else {
  boot().catch(err => console.error(err));
}
