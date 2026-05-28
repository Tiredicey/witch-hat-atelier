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

  const store = new Store({ adapter: new LocalAdapter() });
  await store.load();

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

  const list = new ArticleList({
    listEl, rowsEl, items: SAMPLE,
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

  new Shelves({
    railEl, titleEl,
    onSwitch: (_shelfId) => { /* shelf filtering belongs to a §5 follow-up */ }
  });

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
        if (!list.getSelectedId() && SAMPLE[0]) {
          list.setSelected(SAMPLE[0].id);
          reader.renderArticle(SAMPLE[0]);
          notes.bind(SAMPLE[0].id);
          mobile.showReader();
          syncToolbar(SAMPLE[0].id);
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

  const dmzStore = new Store({ adapter: new LocalAdapter("coda/dmz") });
  await dmzStore.load();
  const dmz = new Dmz({
    pageEl:     $("#dmzPage"),
    listEl:     $("#dmzList"),
    formEl:     $("#dmzForm"),
    textareaEl: $("#dmzTextarea"),
    submitBtn:  $("#dmzSubmit"),
    store:      dmzStore,
  });
  mountRouter({
    enterDmzBtn: $("#enterDmzBtn"),
    exitDmzBtn:  $("#exitDmzBtn"),
    dmz,
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => { boot().catch(err => console.error(err)); });
} else {
  boot().catch(err => console.error(err));
}
