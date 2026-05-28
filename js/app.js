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

  const reader  = new Reader({ wrapEl, readerEl });
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

  // Try to load real entries from the §4 Worker R2 snapshot. Falls back to
  // SAMPLE if the user is not on the S3 adapter, the bucket has no snapshot,
  // or the fetch fails (network, CORS, expired creds). Never blocks boot for
  // longer than 15s; loadFeedSnapshot has its own AbortController.
  let items = SAMPLE;
  try {
    const real = await loadFeedSnapshot(settings);
    if (real && real.length > 0) items = real;
  } catch (e) {
    console.warn("app: feed snapshot load failed, using SAMPLE", e);
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
  });
  document.getElementById("enterSettingsBtn")?.addEventListener("click", () => router.go("settings"));
  $("#exitSettingsBtn").addEventListener("click", () => router.go("reader"));
  void settingsCtrl;
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => { boot().catch(err => console.error(err)); });
} else {
  boot().catch(err => console.error(err));
}
