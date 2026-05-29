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
import { loadDmzConfig, saveDmzConfig, isDmzWorkerActive, markLocalMigrated, localMigratedAt } from "./dmz-config.js";
import { DmzWorkerAdapter, RemoteDmzStore, loadOwnerToken, saveOwnerToken } from "./adapters/dmz-worker.js";
import { VaultStore } from "./vault-store.js";
import { Vault } from "./vault.js";
import { Settings } from "./settings.js";
import { Intelligence } from "./intelligence/index.js";
import { loadSettings, makeAdapter } from "./adapters/index.js";
import { loadFeedSnapshot } from "./feed-source.js";
import { loadFeedFromBrowserEngine } from "./feed-engine.js";
import { StarsImport } from "./inoreader-import.js";
import { Subscriptions } from "./subscriptions.js";
import { AddFeed } from "./add-feed.js";
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
  const dmzWorkerActive = isDmzWorkerActive(dmzConfig);

  let dmzAdapter;
  let dmzAdapterFallback = null;
  let dmzStore;
  let dmzLoadError = null;
  let dmzCanManage = () => true;
  let dmzModeLabel = "";
  let dmzWorkerAdapter = null;

  if (dmzWorkerActive) {
    try {
      dmzWorkerAdapter = new DmzWorkerAdapter({ baseUrl: dmzConfig.workerUrl });
      const remoteStore = new RemoteDmzStore({ adapter: dmzWorkerAdapter, pollMs: 5000, boardId: "__board__" });
      await remoteStore.load();
      dmzStore = remoteStore;
      dmzAdapter = dmzWorkerAdapter;
      dmzCanManage = (noteId) => dmzWorkerAdapter.canManage(noteId);
      dmzModeLabel = loadOwnerToken()
        ? "Shared board synced via your Worker (owner-mode)."
        : "Shared board synced via your Worker. You can only remove notes you posted from this device.";
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
  void intelligenceCtrl;

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
    subsListEl:      document.getElementById("subs-list"),
    subsEmptyEl:     document.getElementById("subs-list-empty"),
    adapter,
  });
  void subs;
  window.codaSubs = subs;
  subs.renderSubsList().catch(err => console.warn("subs render failed", err));

  const addFeed = new AddFeed({
    inputEl:        document.getElementById("add-feed-input"),
    resolveBtn:     document.getElementById("add-feed-resolve"),
    shelfInput:     document.getElementById("add-feed-shelf"),
    statusEl:       document.getElementById("add-feed-status"),
    candidatesEl:   document.getElementById("add-feed-candidates"),
    refusedEl:      document.getElementById("add-feed-refused"),
    bridgeInput:    document.getElementById("add-feed-bridge"),
    bridgeSaveBtn:  document.getElementById("add-feed-bridge-save"),
    bridgeStatusEl: document.getElementById("add-feed-bridge-status"),
    subscriptions:  subs,
  });
  void addFeed;

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

function surfaceDmzError(e) {
  const status = document.getElementById("dmzStatus");
  if (!status) { console.warn("dmz error", e); return; }
  const reason = e?.code === "moderation_blocked"
    ? (e?.detail?.severity === "hard"
        ? "Blocked: this content cannot be posted."
        : "Blocked: this content was flagged. Revise and try again.")
    : e?.code === "forbidden"
      ? "Only the original sender or the owner can remove this note."
      : e?.code === "not_configured"
        ? "The DMZ Worker is not fully configured yet."
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
