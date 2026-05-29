import { loadSettings, saveSettings, clearSettings, makeAdapter, ADAPTER_KINDS } from "./adapters/index.js";
import { ChainForm } from "./chain-form.js";

const GATE_WORD = "PLAINTEXT";

const FIELD_IDS = {
  webdav:   ["webdav-url", "webdav-username", "webdav-password"],
  dropbox:  ["dropbox-token", "dropbox-path"],
  s3:       ["s3-endpoint", "s3-region", "s3-accessKey", "s3-secretKey", "s3-bucket"],
  github:   ["github-token", "github-owner", "github-repo", "github-branch"],
  telegram: ["telegram-token", "telegram-chatId"],
};

const REQUIRED = {
  webdav:   ["webdav-url"],
  dropbox:  ["dropbox-token"],
  s3:       ["s3-endpoint", "s3-accessKey", "s3-secretKey", "s3-bucket"],
  github:   ["github-token", "github-owner", "github-repo"],
  telegram: ["telegram-token", "telegram-chatId"],
};

export class Settings {
  constructor({
    pageEl, formEl, kindSelect, groupsEl, plaintextGate, plaintextInput,
    testBtn, saveBtn, resetBtn, testOutput, activeBanner, mirrorLocalInput,
  }) {
    this.pageEl = pageEl;
    this.formEl = formEl;
    this.kindSelect = kindSelect;
    this.groupsEl = groupsEl;
    this.plaintextGate = plaintextGate;
    this.plaintextInput = plaintextInput;
    this.testBtn = testBtn;
    this.saveBtn = saveBtn;
    this.resetBtn = resetBtn;
    this.testOutput = testOutput;
    this.activeBanner = activeBanner;
    this.mirrorLocalInput = mirrorLocalInput || null;

    this.chainForm = null;
    const chainHost = document.getElementById("chainFormHost");
    if (chainHost) {
      this.chainForm = new ChainForm({
        container: chainHost,
        onChange: () => this.#syncSaveEnabled(),
      });
    }

    this.#hydrate();
    this.#bind();
    this.#syncFields();
  }

  #bind() {
    this.kindSelect.addEventListener("change", () => this.#syncFields());
    this.plaintextInput.addEventListener("input", () => this.#syncSaveEnabled());
    for (const fs of this.groupsEl.querySelectorAll("fieldset[data-kind] input")) {
      fs.addEventListener("input", () => this.#syncSaveEnabled());
    }
    if (this.mirrorLocalInput) {
      this.mirrorLocalInput.addEventListener("change", () => this.#syncSaveEnabled());
    }
    this.formEl.addEventListener("submit", (e) => {
      e.preventDefault();
      this.#save();
    });
    this.testBtn.addEventListener("click", () => this.#testConnection());
    this.resetBtn.addEventListener("click", () => this.#reset());
  }

  #hydrate() {
    const cur = loadSettings();
    this.activeBanner.textContent = `Active adapter: ${labelFor(cur.kind)}`;
    this.activeBanner.dataset.kind = cur.kind;
    this.#pingActiveAdapter(cur);
    if (cur.kind === "chain" && this.chainForm) {
      this.kindSelect.value = "chain";
      this.chainForm.hydrate(cur);
      return;
    }
    this.kindSelect.value = cur.kind;
    if (cur.kind === "webdav") {
      this.#set("webdav-url", cur.url);
      this.#set("webdav-username", cur.username);
      this.#set("webdav-password", cur.password);
    } else if (cur.kind === "dropbox") {
      this.#set("dropbox-token", cur.token);
      this.#set("dropbox-path", cur.path || "/Apps/CODA");
    } else if (cur.kind === "s3") {
      this.#set("s3-endpoint", cur.endpoint);
      this.#set("s3-region", cur.region || "auto");
      this.#set("s3-accessKey", cur.accessKeyId);
      this.#set("s3-secretKey", cur.secretAccessKey);
      this.#set("s3-bucket", cur.bucket);
    } else if (cur.kind === "github") {
      this.#set("github-token", cur.token);
      this.#set("github-owner", cur.owner);
      this.#set("github-repo", cur.repo);
      this.#set("github-branch", cur.branch || "main");
    } else if (cur.kind === "telegram") {
      this.#set("telegram-token", cur.token);
      this.#set("telegram-chatId", cur.chatId);
    }
    if (this.mirrorLocalInput) {
      this.mirrorLocalInput.checked = !!cur.mirrorLocal;
    }
  }

  #set(id, value) {
    const el = document.getElementById(id);
    if (el && value != null) el.value = value;
  }

  #get(id) {
    return document.getElementById(id)?.value || "";
  }

  #syncFields() {
    const kind = this.kindSelect.value;
    for (const fs of this.groupsEl.querySelectorAll("fieldset[data-kind]")) {
      fs.hidden = fs.dataset.kind !== kind;
    }
    const isChain = kind === "chain";
    const chainHasCloud = isChain && this.chainForm ? this.chainForm.hasAnyNonLocal() : false;
    this.plaintextGate.hidden = isChain ? !chainHasCloud : kind === "local";
    this.testBtn.disabled = kind === "local";
    this.testOutput.textContent = "";
    this.testOutput.removeAttribute("data-status");
    this.#syncSaveEnabled();
  }

  #syncSaveEnabled() {
    const kind = this.kindSelect.value;
    const fieldsOk = this.#requiredFilled(kind);
    const isChain = kind === "chain";
    const chainHasCloud = isChain && this.chainForm ? this.chainForm.hasAnyNonLocal() : false;
    this.plaintextGate.hidden = isChain ? !chainHasCloud : kind === "local";
    const needsGate = isChain ? chainHasCloud : kind !== "local";
    const gateOk = !needsGate || this.plaintextInput.value === GATE_WORD;
    this.saveBtn.disabled = !(fieldsOk && gateOk);
  }

  #requiredFilled(kind) {
    if (kind === "local") return true;
    if (kind === "chain") return this.chainForm ? this.chainForm.isValid() : false;
    return (REQUIRED[kind] || []).every(id => this.#get(id).trim().length > 0);
  }

  #buildConfig() {
    const kind = this.kindSelect.value;
    if (kind === "local") return { kind };
    if (kind === "chain") {
      if (!this.chainForm) throw new Error("chain form not initialised");
      return this.chainForm.getConfig();
    }
    if (kind === "webdav") return this.#decorate({
      kind,
      url: this.#get("webdav-url").trim(),
      username: this.#get("webdav-username"),
      password: this.#get("webdav-password"),
    }, true);
    if (kind === "dropbox") return this.#decorate({
      kind,
      token: this.#get("dropbox-token").trim(),
      path: this.#get("dropbox-path").trim() || "/Apps/CODA",
    }, true);
    if (kind === "s3") return this.#decorate({
      kind,
      endpoint: this.#get("s3-endpoint").trim(),
      region: this.#get("s3-region").trim() || "auto",
      accessKeyId: this.#get("s3-accessKey").trim(),
      secretAccessKey: this.#get("s3-secretKey"),
      bucket: this.#get("s3-bucket").trim(),
    }, true);
    if (kind === "github") return this.#decorate({
      kind,
      token: this.#get("github-token").trim(),
      owner: this.#get("github-owner").trim(),
      repo: this.#get("github-repo").trim(),
      branch: this.#get("github-branch").trim() || "main",
    });
    if (kind === "telegram") return this.#decorate({
      kind,
      token: this.#get("telegram-token").trim(),
      chatId: this.#get("telegram-chatId").trim(),
    });
    throw new Error(`unknown kind: ${kind}`);
  }

  #decorate(cfg) {
    if (cfg.kind !== "local" && this.mirrorLocalInput && this.mirrorLocalInput.checked) {
      cfg.mirrorLocal = true;
    }
    return cfg;
  }

  async #pingActiveAdapter(cfg) {
    // Only ping remote adapters
    if (cfg.kind === "local") {
      this.activeBanner.dataset.health = "ok";
      return;
    }
    this.activeBanner.dataset.health = "pending";
    try {
      const adapter = makeAdapter(cfg, "coda/v1");
      const result = await adapter.test();
      this.activeBanner.dataset.health = result.ok ? "ok" : "fail";
      if (!result.ok && result.error) {
        this.activeBanner.title = result.error;
      }
    } catch (e) {
      this.activeBanner.dataset.health = "fail";
      this.activeBanner.title = e.message || String(e);
    }
  }

  async #testConnection() {
    this.testBtn.disabled = true;
    this.testOutput.textContent = "Testing…";
    this.testOutput.dataset.status = "pending";
    try {
      const cfg = this.#buildConfig();
      const adapter = makeAdapter(cfg, "coda/v1");
      const result = await adapter.test();
      if (result.ok) {
        this.testOutput.textContent = "Connection ok.";
        this.testOutput.dataset.status = "ok";
      } else {
        this.testOutput.textContent = `Failed: ${result.error || "unknown error"}`;
        this.testOutput.dataset.status = "fail";
      }
    } catch (e) {
      this.testOutput.textContent = `Error: ${e.message}`;
      this.testOutput.dataset.status = "fail";
    } finally {
      this.testBtn.disabled = false;
    }
  }

  #save() {
    const cfg = this.#buildConfig();
    saveSettings(cfg);
    location.reload();
  }

  #reset() {
    if (confirm("Are you sure you want to reset the active adapter and clear all keys? This cannot be undone.")) {
      clearSettings();
      location.reload();
    }
  }
}

function labelFor(kind) {
  const map = {
    local: "Local (browser only)",
    webdav: "WebDAV",
    dropbox: "Dropbox",
    s3: "S3-compatible",
    github: "GitHub",
    telegram: "Telegram",
    chain: "Failover chain",
  };
  return map[kind] || kind;
}

export { ADAPTER_KINDS };
