import { loadSettings, saveSettings, clearSettings, makeAdapter, ADAPTER_KINDS } from "./adapters/index.js";

const GATE_WORD = "PLAINTEXT";

const FIELD_IDS = {
  webdav:  ["webdav-url", "webdav-username", "webdav-password"],
  dropbox: ["dropbox-token", "dropbox-path"],
  s3:      ["s3-endpoint", "s3-region", "s3-accessKey", "s3-secretKey", "s3-bucket"],
};

const REQUIRED = {
  webdav:  ["webdav-url"],
  dropbox: ["dropbox-token"],
  s3:      ["s3-endpoint", "s3-accessKey", "s3-secretKey", "s3-bucket"],
};

export class Settings {
  constructor({
    pageEl, formEl, kindSelect, groupsEl, plaintextGate, plaintextInput,
    testBtn, saveBtn, resetBtn, testOutput, activeBanner,
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
    this.plaintextGate.hidden = kind === "local";
    this.testBtn.disabled = kind === "local";
    this.testOutput.textContent = "";
    this.testOutput.removeAttribute("data-status");
    this.#syncSaveEnabled();
  }

  #syncSaveEnabled() {
    const kind = this.kindSelect.value;
    const fieldsOk = this.#requiredFilled(kind);
    const gateOk = kind === "local" || this.plaintextInput.value === GATE_WORD;
    this.saveBtn.disabled = !(fieldsOk && gateOk);
  }

  #requiredFilled(kind) {
    if (kind === "local") return true;
    return (REQUIRED[kind] || []).every(id => this.#get(id).trim().length > 0);
  }

  #buildConfig() {
    const kind = this.kindSelect.value;
    if (kind === "local") return { kind };
    if (kind === "webdav") return {
      kind,
      url: this.#get("webdav-url").trim(),
      username: this.#get("webdav-username"),
      password: this.#get("webdav-password"),
    };
    if (kind === "dropbox") return {
      kind,
      token: this.#get("dropbox-token").trim(),
      path: this.#get("dropbox-path").trim() || "/Apps/CODA",
    };
    if (kind === "s3") return {
      kind,
      endpoint: this.#get("s3-endpoint").trim(),
      region: this.#get("s3-region").trim() || "auto",
      accessKeyId: this.#get("s3-accessKey").trim(),
      secretAccessKey: this.#get("s3-secretKey"),
      bucket: this.#get("s3-bucket").trim(),
    };
    throw new Error(`unknown kind: ${kind}`);
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
    clearSettings();
    location.reload();
  }
}

function labelFor(kind) {
  const map = {
    local: "Local (browser only)",
    webdav: "WebDAV",
    dropbox: "Dropbox",
    s3: "S3-compatible",
  };
  return map[kind] || kind;
}

export { ADAPTER_KINDS };
