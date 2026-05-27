// app.js — entry point.
// Instantiates each module and wires them together. This is the only
// file that knows the layout of the DOM; every other module receives
// its elements via constructor injection.

import { SAMPLE } from "./sample-data.js";
import { ArticleList } from "./article-list.js";
import { Reader } from "./reader.js";
import { Shelves } from "./shelves.js";
import { Atelier } from "./atelier.js";
import { Mobile } from "./mobile.js";
import { Help } from "./help.js";
import { Shortcuts } from "./shortcuts.js";

function $(sel, root = document) {
  const el = root.querySelector(sel);
  if (!el) throw new Error(`app.js: required element not found: ${sel}`);
  return el;
}

function boot() {
  const appEl     = $("#app");
  const listEl    = $("#list");
  const rowsEl    = $("#rows");
  const wrapEl    = $("#readerWrap");
  const readerEl  = $("#reader");
  const railEl    = $('nav.rail');
  const titleEl   = $("#shelf-title");
  const scrimEl   = $("#scrim");
  const helpBtn   = $("#helpBtn");
  // Rail help button — only present on mobile widths (see .shelf--help in
  // shell.css). Optional because some smaller layouts might omit it.
  const helpBtnRail = document.getElementById("helpBtnRail");
  const atelierBtn= $("#atelierBtn");
  const markBtn   = $("#markBtn");
  const starBtn   = $("#starBtn");
  const backBtn   = $("#mobileBack");

  const reader  = new Reader({ wrapEl, readerEl });
  const atelier = new Atelier({ appEl, toggleEl: atelierBtn });
  const mobile  = new Mobile({ appEl, backBtn });
  const help    = new Help({ scrimEl, openEl: helpBtn });
  if (helpBtnRail) helpBtnRail.addEventListener("click", () => help.open());

  const list = new ArticleList({
    listEl, rowsEl, items: SAMPLE,
    onSelect: (id) => {
      const a = list.find(id);
      if (a) {
        reader.renderArticle(a);
        mobile.showReader();
      } else {
        reader.renderEmpty();
      }
    }
  });

  // Shelves: visual switch only on the sample data; real filtering needs §5 store
  new Shelves({
    railEl, titleEl,
    onSwitch: (_shelfId) => { /* no-op for the static shell */ }
  });

  // Toolbar buttons that need wiring beyond their constructor hooks
  markBtn.addEventListener("click", () => {
    const id = list.getSelectedId();
    if (id) list.toggleRead(id);
  });
  starBtn.addEventListener("click", () => {
    // visual-only stub for the shell; real starring writes to the §5 event log
    const cur = starBtn.dataset.starred === "true";
    starBtn.dataset.starred = String(!cur);
    starBtn.style.color = !cur ? "var(--sepia)" : "";
  });

  // Keyboard shortcuts — all the cross-module wiring lives here
  new Shortcuts({
    scrimEl,
    handlers: {
      openHelp:   () => help.open(),
      closeHelp:  () => help.close(),
      toggleAtelier: () => atelier.toggle(),
      selectNext: () => {
        const ids = list.getIds();
        const cur = list.getSelectedId();
        const i = ids.indexOf(cur);
        const next = i === -1 ? ids[0] : ids[Math.min(i + 1, ids.length - 1)];
        list.setSelected(next);
        const a = list.find(next);
        if (a) { reader.renderArticle(a); mobile.showReader(); }
      },
      selectPrev: () => {
        const ids = list.getIds();
        const cur = list.getSelectedId();
        const i = ids.indexOf(cur);
        const prev = i === -1 ? ids[0] : ids[Math.max(i - 1, 0)];
        list.setSelected(prev);
        const a = list.find(prev);
        if (a) { reader.renderArticle(a); mobile.showReader(); }
      },
      openFirstIfNone: () => {
        if (!list.getSelectedId() && SAMPLE[0]) {
          list.setSelected(SAMPLE[0].id);
          reader.renderArticle(SAMPLE[0]);
          mobile.showReader();
        }
      },
      markToggle: () => markBtn.click(),
      starToggle: () => starBtn.click(),
      goShelf: (id) => {
        const shelf = railEl.querySelector(`.shelf[data-shelf="${id}"]`);
        shelf?.click();
      }
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
