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
import { loadDmzConfig, saveDmzConfig, markLocalMigrated, localMigratedAt } from "./dmz-config.js";
import { DmzWorkerAdapter, RemoteDmzStore, loadOwnerToken, saveOwnerToken } from "./adapters/dmz-worker.js";
import { VaultStore } from "./vault-store.js";
import { Vault } from "./vault.js";
import { Settings } from "./settings.js";
import { Intelligence } from "./intelligence/index.js";
import { SummariseSurface } from "./intelligence/summarise-surface.js";
import { GROQ_PROVIDER } from "./intelligence/groq.js";
import { CEREBRAS_PROVIDER } from "./intelligence/cerebras.js";
import { GEMINI_PROVIDER } from "./intelligence/gemini.js";
import { VoiceIO } from "./intelligence/voice.js";
import { AskSurface } from "./intelligence/ask-surface.js";
import { ClapListener } from "./intelligence/clap.js";
import { CopilotSurface } from "./intelligence/copilot-surface.js";
import { DailyFirstRitual } from "./intelligence/daily-first.js";
import { BriefingSurface } from "./intelligence/briefing-surface.js";
import { IntelHistory } from "./intelligence/history-store.js";
import { loadSettings, makeAdapter } from "./adapters/index.js";
import { loadFeedSnapshot } from "./feed-source.js";
import { loadFeedFromBrowserEngine } from "./feed-engine.js";
import { StarsImport } from "./inoreader-import.js";
import { Subscriptions } from "./subscriptions.js";
import { AddFeed } from "./add-feed.js";
import { FollowTopic, isTopicFeedUrl } from "./follow-topic.js";
import { FbConnect } from "./fb-connect.js";
import { detectVideo, looksLikeImage } from "./video-embed.js";
import { attachSwipe, attachLongPress } from "./touch-gestures.js";
import { Welcome, isOnboarded } from "./welcome.js";

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
  const trashBtn  = $("#trashBtn");
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

  let voice = null;
  let ask = null;
  let copilotSurface = null;
  let dailyFirst = null;
  let summariseSurface = null;
  let briefingSurface = null;
  const reader  = new Reader({
    wrapEl,
    readerEl,
    extractWrapEl:   document.getElementById("readerExtract"),
    extractBtn:      document.getElementById("readCleanBtn"),
    extractStatusEl: document.getElementById("readerExtractStatus"),
    extractEnabled:  false,
    onArticleChange: () => { if (voice) voice.stop(); if (ask) ask.reset(); if (summariseSurface) summariseSurface.refreshRestore(); },
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

  let baseFeedItems = items;
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
        video: detectVideo(link) || undefined,
        image: looksLikeImage(link) ? link : undefined,
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
    },
    onTrash: (id) => trashById(id)
  });

  const metaEl = document.getElementById("shelf-meta");
  function shelfPredicate(shelfId) {
    if (shelfId === "trash") return (it) => store.isTrashed(it.id);
    const base =
      shelfId === "all" ? () => true
      : shelfId === "starred" ? (it) => store.isStarred(it.id)
      : (it) => it.shelf === shelfId;
    return (it) => !store.isTrashed(it.id) && base(it);
  }
  function unreadInShelf(shelfId) {
    const pred = shelfPredicate(shelfId);
    return list.getAllItems().filter(pred).filter(it => !store.isRead(it.id)).length;
  }
  function renderCounts() {
    railEl.querySelectorAll(".shelf[data-shelf]").forEach(btn => {
      const span = btn.querySelector(".count");
      if (!span) return;
      const n = unreadInShelf(btn.dataset.shelf);
      if (n > 0) {
        span.textContent = String(n);
        span.hidden = false;
        span.setAttribute("aria-label", `${n} unread`);
      } else {
        span.textContent = "";
        span.hidden = true;
        span.removeAttribute("aria-label");
      }
    });
  }
  // Quick filter (`/`). Narrows the active shelf by title, source or excerpt.
  // It never crosses shelves, so the rail counts and the list stay consistent.
  const filterWrap = document.getElementById("listFilterWrap");
  const filterInput = document.getElementById("listFilter");
  const filterClear = document.getElementById("listFilterClear");
  let quickTerm = "";
  const quickPredicate = (it) => {
    if (!quickTerm) return true;
    const hay = `${it.title || ""} ${it.source || ""} ${it.excerpt || ""}`.toLowerCase();
    return hay.includes(quickTerm);
  };
  function applyShelf(shelfId) {
    const inShelf = shelfPredicate(shelfId);
    list.setFilter((it) => inShelf(it) && quickPredicate(it));
    if (metaEl) {
      const n = list.getIds().length;
      const noun = n === 1 ? "1 item" : `${n} items`;
      metaEl.textContent = quickTerm ? `${noun} matching` : noun;
    }
    if (briefingSurface) briefingSurface.refreshRestore();
  }
  const currentShelf = () => railEl.querySelector('.shelf[aria-current="true"]')?.dataset?.shelf || "all";
  const shelves = new Shelves({
    railEl, titleEl,
    onSwitch: (shelfId) => applyShelf(shelfId)
  });
  applyShelf("all"); // align the list-header meta with the actual sample-item count

  function setQuickTerm(term) {
    quickTerm = term.trim().toLowerCase();
    applyShelf(currentShelf());
  }
  function openQuickFilter() {
    if (!filterWrap || !filterInput) return;
    filterWrap.hidden = false;
    filterInput.focus();
    filterInput.select();
  }
  function closeQuickFilter() {
    if (!filterWrap || !filterInput) return;
    filterInput.value = "";
    filterWrap.hidden = true;
    if (quickTerm) setQuickTerm("");
  }
  if (filterInput) {
    filterInput.addEventListener("input", () => setQuickTerm(filterInput.value));
    filterInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); closeQuickFilter(); }
    });
  }
  if (filterClear) filterClear.addEventListener("click", () => closeQuickFilter());

  function ensureTopicShelf(shelf, label) {
    if (!shelf) return null;
    const existing = railEl.querySelector(`.shelf[data-shelf="${CSS.escape(shelf)}"]`);
    if (existing) return existing;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "shelf shelf--topic";
    btn.dataset.shelf = shelf;
    btn.setAttribute("aria-label", label || shelf);
    btn.innerHTML = `
      <svg class="sigil" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5 L13 5 L19 11 L11 19 L5 13 Z"/><circle cx="9" cy="9" r="1.4"/></svg>
      <span class="count" hidden></span>
      <span class="shelf__label"></span>`;
    btn.querySelector(".shelf__label").textContent = label || shelf;
    const anchor = railEl.querySelector(`.shelf[data-shelf="starred"]`);
    if (anchor) railEl.insertBefore(btn, anchor); else railEl.appendChild(btn);
    shelves.register(btn);
    return btn;
  }

  async function reloadFeed(targetShelf) {
    try {
      const fresh = await loadFeedFromBrowserEngine({ adapter });
      if (fresh && fresh.length > 0) {
        baseFeedItems = fresh;
        list.setItems(mergeStarOrphans(baseFeedItems, store));
        list.refreshFromStore(store);
      }
    } catch (e) {
      console.warn("reloadFeed failed", e);
    }
    if (targetShelf) shelves.switchTo(targetShelf);
    renderCounts();
  }

  function syncToolbar(id) {
    const starred = store.isStarred(id);
    const read = store.isRead(id);
    starBtn.dataset.starred = String(starred);
    starBtn.style.color = starred ? "var(--sepia)" : "";
    starBtn.setAttribute("aria-pressed", String(starred));
    markBtn.textContent = read ? "Mark unread" : "Mark read";
    markBtn.setAttribute("aria-pressed", String(read));
    if (trashBtn) trashBtn.textContent = store.isTrashed(id) ? "Restore" : "Trash";
  }

  store.subscribe(() => {
    list.refreshFromStore(store);
    renderCounts();
    const id = list.getSelectedId();
    if (id) syncToolbar(id);
  });

  list.refreshFromStore(store);
  renderCounts();

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

  function trashById(id) {
    if (!id) return;
    const wasSelected = list.getSelectedId() === id;
    store.toggleTrashed(id);
    applyShelf(currentShelf());
    if (wasSelected) {
      const ids = list.getIds();
      if (ids.length) {
        const nextId = ids[0];
        list.setSelected(nextId);
        const a = list.find(nextId);
        if (a) { reader.renderArticle(a); notes.bind(nextId); syncToolbar(nextId); }
      } else {
        reader.renderEmpty();
      }
    }
  }
  function trashSelected() { trashById(list.getSelectedId()); }
  trashBtn.addEventListener("click", () => trashSelected());

  const intelHistory = new IntelHistory();
  new Shortcuts({
    scrimEl,
    handlers: {
      openHelp:   () => help.open(),
      closeHelp:  () => { help.close(); notes.close(); if (copilotSurface) copilotSurface.close(); },
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
      quickFilter: () => openQuickFilter(),
      addNote:    () => {
        if (!list.getSelectedId()) return;
        notes.open();
      },
      trashToggle: () => trashSelected(),
      goShelf: (id) => {
        const shelf = railEl.querySelector(`.shelf[data-shelf="${id}"]`);
        shelf?.click();
      },
      summarise: () => { if (summariseSurface) summariseSurface.trigger(); },
      openCopilot: () => { if (copilotSurface) copilotSurface.toggle(); }
    }
  });

  list.refreshFromStore(store);

  // Mobile swipe gestures on article rows: right = star, left = mark read.
  // Inoreader pattern. Delegated at the rowsEl level so dynamic rows pick
  // up handlers without a re-attachment hook in ArticleList.
  let _swipeActive = null;
  rowsEl.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    const row = e.target.closest(".article-row");
    if (!row) return;
    const t = e.touches[0];
    _swipeActive = { row, startX: t.clientX, startY: t.clientY, locked: false, moved: false };
  }, { passive: true });
  rowsEl.addEventListener("touchmove", (e) => {
    if (!_swipeActive) return;
    const t = e.touches[0];
    const dx = t.clientX - _swipeActive.startX;
    const dy = t.clientY - _swipeActive.startY;
    if (!_swipeActive.locked && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      _swipeActive.locked = Math.abs(dx) > Math.abs(dy) * 1.5 ? "x" : "y";
    }
    if (_swipeActive.locked === "x") {
      _swipeActive.moved = true;
      _swipeActive.row.style.transform = `translateX(${dx}px)`;
      _swipeActive.row.dataset.swipeDir = dx > 0 ? "right" : "left";
      e.preventDefault();
    }
  }, { passive: false });
  rowsEl.addEventListener("touchend", (e) => {
    if (!_swipeActive) return;
    const last = _swipeActive;
    _swipeActive = null;
    last.row.style.transform = "";
    delete last.row.dataset.swipeDir;
    if (last.locked !== "x" || !last.moved) return;
    const t = (e.changedTouches && e.changedTouches[0]) || null;
    if (!t) return;
    const dx = t.clientX - last.startX;
    const id = last.row.dataset.id;
    if (!id) return;
    if (dx >= 80) store.toggleStarred(id);
    else if (dx <= -80) store.toggleRead(id);
  });
  rowsEl.addEventListener("touchcancel", () => {
    if (_swipeActive) {
      _swipeActive.row.style.transform = "";
      delete _swipeActive.row.dataset.swipeDir;
      _swipeActive = null;
    }
  });

  // Long-press on subscription rows: opens the same action menu the "..." button uses.
  const subsListElForLp = document.getElementById("subs-list");
  if (subsListElForLp) {
    let _lpTimer = null;
    let _lpStart = null;
    subsListElForLp.addEventListener("touchstart", (e) => {
      if (e.touches.length !== 1) return;
      const row = e.target.closest(".subs-list__row");
      if (!row) return;
      const t = e.touches[0];
      _lpStart = { row, x: t.clientX, y: t.clientY };
      if (_lpTimer) clearTimeout(_lpTimer);
      _lpTimer = setTimeout(() => {
        _lpTimer = null;
        if (row.dataset.url) subs.openFeedMenu(row.dataset.url);
      }, 500);
    }, { passive: true });
    subsListElForLp.addEventListener("touchmove", (e) => {
      if (!_lpStart || !_lpTimer) return;
      const t = e.touches[0];
      if (Math.abs(t.clientX - _lpStart.x) > 10 || Math.abs(t.clientY - _lpStart.y) > 10) {
        clearTimeout(_lpTimer);
        _lpTimer = null;
      }
    }, { passive: true });
    const lpCancel = () => { if (_lpTimer) { clearTimeout(_lpTimer); _lpTimer = null; } };
    subsListElForLp.addEventListener("touchend", lpCancel);
    subsListElForLp.addEventListener("touchcancel", lpCancel);
  }

  void attachSwipe; void attachLongPress;

  const dmzConfig = loadDmzConfig();
  const dmzResolvedBase = await dmzResolveBase(dmzConfig.workerUrl || "");

  let dmzAdapter;
  let dmzAdapterFallback = null;
  let dmzStore;
  let dmzLoadError = null;
  let dmzCanManage = () => true;
  let dmzModeLabel = "";
  let dmzWorkerAdapter = null;

  if (dmzResolvedBase !== null) {
    try {
      dmzWorkerAdapter = new DmzWorkerAdapter({ baseUrl: dmzResolvedBase });
      const remoteStore = new RemoteDmzStore({ adapter: dmzWorkerAdapter, pollMs: 5000, boardId: "__board__" });
      await remoteStore.load();
      dmzStore = remoteStore;
      dmzAdapter = dmzWorkerAdapter;
      dmzCanManage = (noteId) => dmzWorkerAdapter.canManage(noteId);
      dmzModeLabel = loadOwnerToken()
        ? "Shared board, owner mode. You can edit or remove any note."
        : "Shared board, synced live for everyone. You can edit or remove notes you post from this device.";
      remoteStore.start();
      tryMigrateLocalDmz(dmzWorkerAdapter).catch((e) => console.warn("dmz migration skipped:", e?.message || e));
    } catch (e) {
      console.warn("dmz worker init failed, falling back to local adapter", e);
      dmzAdapterFallback = e?.message || String(e) || "unknown error";
    }
  }

  if (!dmzStore) {
    try {
      dmzAdapter = makeAdapter(settings, "coda/dmz");
    } catch (e) {
      console.warn("dmz adapter init failed, falling back to local", e);
      dmzAdapter = new LocalAdapter("coda/dmz");
      dmzAdapterFallback = e?.message || String(e) || "unknown error";
    }
    dmzStore = new Store({ adapter: dmzAdapter });
    try {
      await dmzStore.load();
    } catch (e) {
      console.warn("dmz store load failed, continuing with empty snapshot", e);
      dmzLoadError = e?.message || String(e) || "unknown error";
    }
  }

  const dmzFileUrlFor = dmzWorkerAdapter ? (id) => dmzWorkerAdapter.fileUrl(id) : null;
  const dmz = new Dmz({
    pageEl:     $("#dmzPage"),
    listEl:     $("#dmzList"),
    formEl:     $("#dmzForm"),
    textareaEl: $("#dmzTextarea"),
    submitBtn:  $("#dmzSubmit"),
    statusEl:   document.getElementById("dmzStatus"),
    store:      dmzStore,
    adapter:    dmzAdapter,
    loadError:  dmzLoadError,
    adapterFallback: dmzAdapterFallback,
    canManage:  dmzCanManage,
    modeLabel:  dmzModeLabel,
    onPostError: (e) => surfaceDmzError(e),
    fileInputEl: $("#dmzFile"),
    attachBtn:   $("#dmzAttach"),
    fileUrlFor:  dmzFileUrlFor,
    nameEl:      $("#dmzName"),
  });
  const router = mountRouter({
    enterDmzBtn: $("#enterDmzBtn"),
    exitDmzBtn:  $("#exitDmzBtn"),
    dmz,
  });

  wireDmzSettings();

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
  let vaultAdapter;
  try {
    vaultAdapter = makeAdapter(settings, "coda/vault");
  } catch (e) {
    console.warn("vault adapter init failed, falling back to local", e);
    vaultAdapter = new LocalAdapter("coda/vault");
  }
  const vaultStore = new VaultStore({ adapter: vaultAdapter, prefix: "coda/vault" });
  let vaultLoadError = null;
  try {
    await vaultStore.load();
  } catch (e) {
    console.warn("vault store load failed, continuing with empty snapshot", e);
    vaultLoadError = e?.message || String(e) || "unknown error";
  }
  const vaultCtrl = new Vault({
    pageEl:    $("#vaultPage"),
    listEl:    $("#vaultList"),
    dropEl:    $("#vaultDrop"),
    fileInput: $("#vaultFileInput"),
    emptyEl:   $("#vaultEmpty"),
    capEl:     $("#vaultCap"),
    store:     vaultStore,
    adapter:   vaultAdapter,
    loadError: vaultLoadError,
  });
  void vaultCtrl;
  $("#enterVaultBtn").addEventListener("click", () => router.go("vault"));
  $("#exitVaultBtn").addEventListener("click", () => router.go("reader"));

  document.getElementById("enterSettingsBtn")?.addEventListener("click", () => router.go("settings"));
  $("#exitSettingsBtn").addEventListener("click", () => router.go("reader"));
  void settingsCtrl;

  const intelligenceCtrl = new Intelligence({
    pageEl:       $("#intelligenceSection"),
    enableInput:  $("#intelligenceEnable"),
    panelEl:      $("#intelligencePanel"),
    disclosureEl: $("#intelligenceDisclosure"),
    statusEl:     $("#intelligenceStatus"),
    saveBtn:      $("#intelligenceSave"),
    resetBtn:     $("#intelligenceReset"),
  });
  summariseSurface = new SummariseSurface({
    intelligence: intelligenceCtrl,
    reader,
    providers: [GROQ_PROVIDER, CEREBRAS_PROVIDER, GEMINI_PROVIDER],
    wrapEl:           $("#readerSummarise"),
    triggerBtn:       $("#readerSummariseBtn"),
    statusEl:         $("#readerSummariseStatus"),
    disclosureEl:     $("#readerSummariseDisclosure"),
    disclosureTextEl: $("#readerSummariseDisclosureText"),
    confirmBtn:       $("#readerSummariseConfirm"),
    cancelBtn:        $("#readerSummariseCancel"),
    outputEl:         $("#readerSummariseOutput"),
    restoreBtn:       $("#readerSummariseRestore"),
    toggleBtn:        $("#readerSummariseToggle"),
    history:          intelHistory,
  });
  voice = new VoiceIO({
    intelligence: intelligenceCtrl,
    reader,
    onCommand: (cmd) => { if (cmd === "summarise" && summariseSurface) summariseSurface.trigger(); },
    onDictation: (text) => {
      if (copilotSurface && copilotSurface.isOpen()) return copilotSurface.fillQuestion(text);
      return ask ? ask.fillQuestion(text) : false;
    },
    onLoopQuestion: (text) => (copilotSurface ? copilotSurface.submitQuestion(text) : false),
    wrapEl:           $("#readerVoice"),
    readBtn:          $("#readerVoiceReadBtn"),
    micBtn:           $("#readerVoiceMicBtn"),
    statusEl:         $("#readerVoiceStatus"),
    disclosureEl:     $("#readerVoiceDisclosure"),
    disclosureTextEl: $("#readerVoiceDisclosureText"),
    confirmBtn:       $("#readerVoiceConfirm"),
    cancelBtn:        $("#readerVoiceCancel"),
  });
  ask = new AskSurface({
    intelligence: intelligenceCtrl,
    reader,
    onAnswer: (text) => { if (voice) voice.speakAnswer(text); },
    providers: [GROQ_PROVIDER, CEREBRAS_PROVIDER, GEMINI_PROVIDER],
    wrapEl:           $("#readerAsk"),
    formEl:           $("#readerAskForm"),
    inputEl:          $("#readerAskInput"),
    sendBtn:          $("#readerAskSend"),
    statusEl:         $("#readerAskStatus"),
    disclosureEl:     $("#readerAskDisclosure"),
    disclosureTextEl: $("#readerAskDisclosureText"),
    confirmBtn:       $("#readerAskConfirm"),
    cancelBtn:        $("#readerAskCancel"),
    logEl:            $("#readerAskLog"),
    toggleBtn:        $("#readerAskToggle"),
  });
  copilotSurface = new CopilotSurface({
    intelligence: intelligenceCtrl,
    reader,
    providers: [GROQ_PROVIDER, CEREBRAS_PROVIDER, GEMINI_PROVIDER],
    getUnread: () => list.getItems().filter(it => !store.isRead(it.id)),
    getShelf: currentShelf,
    onAnswer: (text) => { if (voice) voice.speakAnswer(text); },
    wrapEl:           $("#copilot"),
    scopeEl:          $("#copilotScope"),
    scopeToggleEl:    $("#copilotGeneral"),
    closeBtn:         $("#copilotClose"),
    railBtn:          $("#copilotBtn"),
    formEl:           $("#copilotForm"),
    inputEl:          $("#copilotInput"),
    sendBtn:          $("#copilotSend"),
    statusEl:         $("#copilotStatus"),
    logEl:            $("#copilotLog"),
    toggleBtn:        $("#copilotToggle"),
    disclosureEl:     $("#copilotDisclosure"),
    disclosureTextEl: $("#copilotDisclosureText"),
    confirmBtn:       $("#copilotConfirm"),
    cancelBtn:        $("#copilotCancel"),
  });
  dailyFirst = new DailyFirstRitual({
    intelligence: intelligenceCtrl,
    adapter,
    history: intelHistory,
    voice,
    getShelf: currentShelf,
    onLoop: () => { if (copilotSurface) copilotSurface.open(); },
    wrapEl:    $("#copilotGreeting"),
    textEl:    $("#copilotGreetingText"),
    statusEl:  $("#copilotGreetingStatus"),
  });
  await dailyFirst.init();
  const clap = new ClapListener({
    intelligence: intelligenceCtrl,
    wrapEl:       $("#copilotClap"),
    armBtn:       $("#copilotClapBtn"),
    indicatorEl:  $("#copilotClapIndicator"),
    onClap: () => {
      if (!dailyFirst) { if (copilotSurface) copilotSurface.open(); return; }
      const greeted = dailyFirst.onClap();
      if (!greeted && voice && voice.isLoopReady() && voice.startTurn) voice.startTurn();
    },
  });
  void clap;
  briefingSurface = new BriefingSurface({
    intelligence: intelligenceCtrl,
    providers: [GROQ_PROVIDER, CEREBRAS_PROVIDER, GEMINI_PROVIDER],
    getUnread: () => list.getItems().filter(it => !store.isRead(it.id)),
    getShelf: currentShelf,
    history: intelHistory,
    wrapEl:           $("#listBriefing"),
    triggerBtn:       $("#listBriefingBtn"),
    statusEl:         $("#listBriefingStatus"),
    disclosureEl:     $("#listBriefingDisclosure"),
    disclosureTextEl: $("#listBriefingDisclosureText"),
    confirmBtn:       $("#listBriefingConfirm"),
    cancelBtn:        $("#listBriefingCancel"),
    outputEl:         $("#listBriefingOutput"),
    toggleBtn:        $("#listBriefingToggle"),
    restoreBtn:       $("#listBriefingRestore"),
  });

  const starsImport = new StarsImport({
    fileInput: document.getElementById("inoreader-stars-file"),
    statusEl:  document.getElementById("inoreader-stars-status"),
    store,
    onAfter: () => {
      const merged = mergeStarOrphans(baseFeedItems, store);
      list.setItems(merged);
      const shelfId = (railEl.querySelector(".shelf[aria-current=\"true\"]")?.dataset?.shelf) || "all";
      applyShelf(shelfId);
      renderCounts();
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
    subsListEl:      document.getElementById("subs-list"),
    subsEmptyEl:     document.getElementById("subs-list-empty"),
    adapter,
  });
  void subs;
  window.codaSubs = subs;
  subs.renderSubsList().catch(err => console.warn("subs render failed", err));

  subs.listFeeds().then(feeds => {
    const seen = new Set();
    for (const f of feeds) {
      if (!isTopicFeedUrl(f.url) || seen.has(f.shelf)) continue;
      seen.add(f.shelf);
      ensureTopicShelf(f.shelf, f.title || f.shelf);
    }
    if (seen.size) renderCounts();
  }).catch(err => console.warn("topic shelves bootstrap failed", err));

  const addFeed = new AddFeed({
    inputEl:        document.getElementById("add-feed-input"),
    resolveBtn:     document.getElementById("add-feed-resolve"),
    shelfInput:     document.getElementById("add-feed-shelf"),
    statusEl:       document.getElementById("add-feed-status"),
    candidatesEl:   document.getElementById("add-feed-candidates"),
    refusedEl:      document.getElementById("add-feed-refused"),
    bridgeInput:    document.getElementById("add-feed-bridge"),
    bridgeKindInput: document.getElementById("add-feed-bridge-kind"),
    bridgeSaveBtn:  document.getElementById("add-feed-bridge-save"),
    bridgeStatusEl: document.getElementById("add-feed-bridge-status"),
    socialEnableInput: document.getElementById("add-feed-social-enabled"),
    socialSessionInputs: {
      Facebook:  document.getElementById("add-feed-social-facebook"),
      Instagram: document.getElementById("add-feed-social-instagram"),
    },
    socialSaveBtn:  document.getElementById("add-feed-social-save"),
    socialClearBtn: document.getElementById("add-feed-social-clear"),
    socialStatusEl: document.getElementById("add-feed-social-status"),
    subscriptions:  subs,
  });
  void addFeed;

  const followTopic = new FollowTopic({
    inputEl:       document.getElementById("follow-topic-input"),
    followBtn:     document.getElementById("follow-topic-follow"),
    headlinesBtn:  document.getElementById("follow-topic-headlines"),
    statusEl:      document.getElementById("follow-topic-status"),
    listEl:        document.getElementById("follow-topic-list"),
    subscriptions: subs,
    onFollowed: async (shelf, label) => {
      ensureTopicShelf(shelf, label);
      await reloadFeed(shelf);
      return list.getAllItems().filter(it => it.shelf === shelf).length;
    },
    onUnfollowed: async (shelf) => {
      const btn = railEl.querySelector(`.shelf[data-shelf="${CSS.escape(shelf)}"]`);
      const wasActive = !!btn && btn.getAttribute("aria-current") === "true";
      if (btn) { shelves.unregister(btn); btn.remove(); }
      await reloadFeed(wasActive ? "all" : null);
    },
  });
  void followTopic;

  const fbConnect = new FbConnect({
    connectBtn:     document.getElementById("fb-connect-btn"),
    disconnectBtn:  document.getElementById("fb-disconnect-btn"),
    previewBtn:     document.getElementById("fb-preview-btn"),
    statusEl:       document.getElementById("fb-connect-status"),
    previewEl:      document.getElementById("fb-connect-preview"),
    shelfInput:     document.getElementById("add-feed-shelf"),
    subscriptions:  subs,
  });
  fbConnect.init();
  void fbConnect;

  const welcomeScrim = document.getElementById("welcomeScrim");
  if (welcomeScrim) {
    const welcome = new Welcome({
      scrimEl:    welcomeScrim,
      urlInput:   document.getElementById("welcomeFeedUrl"),
      hnBtn:      document.getElementById("welcomeHnBtn"),
      nextBtn:    document.getElementById("welcomeStep1Next"),
      statusEl:   document.getElementById("welcomeStatus"),
      skipBtns:   Array.from(welcomeScrim.querySelectorAll("[data-skip]")),
      choiceBtns: welcomeScrim.querySelectorAll(".welcome-card__choices button"),
      doneBtn:    document.getElementById("welcomeDoneBtn"),
      doneMsg:    document.getElementById("welcomeDoneMsg"),
      subscriptions: subs,
      navigate:   (page) => router.go(page),
    });
    if (!isOnboarded()) welcome.open();
  }
}

function wireDmzSettings() {
  const urlEl = document.getElementById("dmz-workerUrl");
  const tokenEl = document.getElementById("dmz-ownerToken");
  const enabledEl = document.getElementById("dmz-enabled");
  const saveBtn = document.getElementById("dmz-save");
  const statusEl = document.getElementById("dmz-status");
  if (!urlEl || !tokenEl || !enabledEl || !saveBtn || !statusEl) return;

  const cfg = loadDmzConfig();
  urlEl.value = cfg.workerUrl || "";
  enabledEl.checked = !!cfg.enabled;
  tokenEl.value = loadOwnerToken() || "";

  saveBtn.addEventListener("click", () => {
    const url = urlEl.value.trim();
    const looksLikeUrl = url.startsWith("http://") || url.startsWith("https://");
    if (enabledEl.checked && url && !looksLikeUrl) {
      statusEl.textContent = "Worker URL must start with https:// or http://";
      statusEl.dataset.state = "error";
      return;
    }
    saveDmzConfig({ workerUrl: url, enabled: !!enabledEl.checked });
    saveOwnerToken(tokenEl.value.trim());
    statusEl.textContent = "Saved. Reload the page for the change to take effect.";
    statusEl.dataset.state = "ok";
  });
}

async function dmzResolveBase(preferred) {
  const candidates = preferred ? [preferred, ""] : [""];
  for (const base of candidates) {
    try {
      const r = await fetch(`${base}/dmz/health`);
      if (!r.ok) continue;
      const j = await r.json();
      if (j && j.ok && j.configured) return base;
    } catch (e) { /* try next candidate */ }
  }
  return null;
}

function surfaceDmzError(e) {
  const status = document.getElementById("dmzStatus");
  if (!status) { console.warn("dmz error", e); return; }
  const reason = e?.code === "moderation_blocked"
    ? (e?.detail?.severity === "hard"
        ? "Blocked: this content cannot be posted."
        : e?.detail?.source === "image"
          ? "Blocked: this image was flagged as explicit."
          : "Blocked: this content was flagged. Revise and try again.")
    : e?.code === "file_too_large"
      ? "That file is over the size limit for the board."
    : e?.code === "bad_type"
      ? "That file type is not allowed on the board."
    : e?.code === "no_file"
      ? "No file was selected."
    : e?.code === "forbidden"
      ? "Only the original sender or the owner can remove this note."
      : e?.code === "not_configured"
        ? "The DMZ Worker is not fully configured yet."
      : (e?.code === "upload_failed" || e?.code === "store_failed" || e?.code === "blob_unavailable" || e?.code === "dmz_error")
        ? `File transfer failed: ${e?.detail?.detail || (typeof e?.detail === "string" ? e.detail : "") || e?.message || "the storage backend rejected it"}`
        : e?.message || "Could not reach the DMZ Worker.";
  status.dataset.error = "true";
  status.textContent = reason;
  setTimeout(() => {
    if (status.dataset.error === "true" && status.textContent === reason) {
      delete status.dataset.error;
      status.textContent = "";
    }
  }, 6000);
}

async function tryMigrateLocalDmz(adapter) {
  if (localMigratedAt()) return;
  if (!loadOwnerToken()) return;
  const local = readLocalDmzEvents();
  if (!local.length) { markLocalMigrated(); return; }
  try {
    await adapter.migrate(local);
    markLocalMigrated();
  } catch (e) {
    if (e?.code === "already_migrated" || e?.code === "log_not_empty") {
      markLocalMigrated();
      return;
    }
    throw e;
  }
}

function readLocalDmzEvents() {
  try {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith("coda/dmz/")) continue;
      if (key === "coda/dmz/migrated-at" || key === "coda/dmz/worker-config" || key === "coda/dmz/client-id" || key === "coda/dmz/delete-tokens" || key === "coda/dmz/owner-token") continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        const notes = parsed?.items?.["__board__"]?.notes || parsed?.notes || [];
        for (const n of notes) {
          if (n && typeof n.body === "string" && n.body.trim()) {
            out.push({ id: n.id, body: n.body, at: n.at || Date.now() });
          }
        }
      } catch {}
    }
    return out;
  } catch { return []; }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => { boot().catch(err => console.error(err)); });
} else {
  boot().catch(err => console.error(err));
}
