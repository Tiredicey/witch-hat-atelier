// chain-form.js
//
// Renders the Settings-page "Failover chain" sub-form: up to 3 ordered slots,
// each picks a backend kind and fills the matching credentials. Slot 1 is the
// primary; subsequent slots are tried in order on read failure and mirrored
// on every write (semantics live in js/adapters/chain.js).
//
// Why a separate module:
//   The single-adapter form in js/settings.js has a fixed set of fieldsets in
//   index.html. The chain UI needs the SAME fields rendered 1-3 times with
//   per-slot IDs (chain-slot-1-github-token, chain-slot-2-github-token, ...).
//   Templating that in static HTML balloons the markup and is hard to keep in
//   sync with the single-adapter form. Driving it from JS gives one source of
//   truth and keeps the diff readable.
//
// Public shape:
//   class ChainForm {
//     constructor({ container, onChange })
//     hydrate(cfg)               // cfg.kind === "chain" with adapters[]
//     getConfig()                // returns { kind: "chain", adapters: [...] }
//     isValid()                  // true when slot 1 fields are filled
//     hasAnyNonLocal()           // gate for the PLAINTEXT acknowledgement
//   }

// Field schema mirrors the per-kind required + optional inputs in the
// single-adapter form. Kept in lockstep with js/adapters/index.js
// buildSingleAdapter() so a slot config can be passed straight through.
const FIELD_SCHEMA = {
  local: [],
  github: [
    { name: "token",  type: "password", label: "Personal access token", required: true,  placeholder: "github_pat_\u2026" },
    { name: "owner",  type: "text",     label: "Owner",                 required: true },
    { name: "repo",   type: "text",     label: "Repository",            required: true },
    { name: "branch", type: "text",     label: "Branch",                required: false, defaultValue: "main" },
  ],
  telegram: [
    { name: "token",  type: "password", label: "Bot token", required: true, placeholder: "123456:ABC-DEF\u2026" },
    { name: "chatId", type: "text",     label: "Chat ID",   required: true, placeholder: "-1001234567890" },
  ],
  webdav: [
    { name: "url",      type: "url",      label: "Server URL", required: true, placeholder: "https://nextcloud.example.com/remote.php/dav/files/me" },
    { name: "username", type: "text",     label: "Username",   required: false },
    { name: "password", type: "password", label: "Password",   required: false },
  ],
  dropbox: [
    { name: "token", type: "password", label: "Access token", required: true },
    { name: "path",  type: "text",     label: "App folder path", required: false, defaultValue: "/Apps/CODA" },
  ],
  s3: [
    { name: "endpoint",        type: "url",      label: "Endpoint",          required: true,  placeholder: "https://<account>.r2.cloudflarestorage.com" },
    { name: "region",          type: "text",     label: "Region",            required: false, defaultValue: "auto" },
    { name: "accessKeyId",     type: "text",     label: "Access key ID",     required: true },
    { name: "secretAccessKey", type: "password", label: "Secret access key", required: true },
    { name: "bucket",          type: "text",     label: "Bucket",            required: true },
  ],
};

const KIND_OPTIONS = [
  { value: "local",    label: "Local (browser only)" },
  { value: "github",   label: "GitHub (private repo)" },
  { value: "telegram", label: "Telegram bot" },
  { value: "webdav",   label: "WebDAV / Nextcloud" },
  { value: "dropbox",  label: "Dropbox" },
  { value: "s3",       label: "S3-compatible (R2, B2, Wasabi)" },
];

const MAX_SLOTS = 3;
const MIN_SLOTS = 1;

export class ChainForm {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.container — wrapper element where slot rows go
   * @param {() => void}  opts.onChange  — fires whenever a slot/field changes
   */
  constructor({ container, onChange }) {
    this.container = container;
    this.onChange = typeof onChange === "function" ? onChange : () => {};
    this.slotCount = 1;

    this.slotsEl = document.createElement("div");
    this.slotsEl.className = "chain-slots";
    this.container.appendChild(this.slotsEl);

    this.addBtn = document.createElement("button");
    this.addBtn.type = "button";
    this.addBtn.className = "chain-add";
    this.addBtn.textContent = "Add another backend";
    this.addBtn.addEventListener("click", () => this.#addSlot());
    this.container.appendChild(this.addBtn);

    this.#renderSlots();
  }

  hydrate(cfg) {
    if (!cfg || cfg.kind !== "chain" || !Array.isArray(cfg.adapters) || !cfg.adapters.length) {
      this.slotCount = 1;
      this.#renderSlots();
      return;
    }
    this.slotCount = Math.min(MAX_SLOTS, Math.max(MIN_SLOTS, cfg.adapters.length));
    this.#renderSlots();
    cfg.adapters.slice(0, this.slotCount).forEach((sub, i) => {
      this.#applySlot(i + 1, sub);
    });
    this.#syncAddBtn();
  }

  getConfig() {
    const adapters = [];
    for (let i = 1; i <= this.slotCount; i++) {
      adapters.push(this.#readSlot(i));
    }
    return { kind: "chain", adapters };
  }

  isValid() {
    if (this.slotCount < MIN_SLOTS) return false;
    for (let i = 1; i <= this.slotCount; i++) {
      const sub = this.#readSlot(i);
      const schema = FIELD_SCHEMA[sub.kind] || [];
      for (const f of schema) {
        if (f.required && !String(sub[f.name] || "").trim()) return false;
      }
    }
    return true;
  }

  hasAnyNonLocal() {
    for (let i = 1; i <= this.slotCount; i++) {
      const kindSel = this.container.querySelector(`#chain-slot-${i}-kind`);
      if (kindSel && kindSel.value !== "local") return true;
    }
    return false;
  }

  // ─── Internals ─────────────────────────────────────────────────────────

  #renderSlots() {
    this.slotsEl.innerHTML = "";
    for (let i = 1; i <= this.slotCount; i++) {
      this.slotsEl.appendChild(this.#buildSlot(i));
    }
    this.#syncAddBtn();
  }

  #addSlot() {
    if (this.slotCount >= MAX_SLOTS) return;
    this.slotCount += 1;
    this.slotsEl.appendChild(this.#buildSlot(this.slotCount));
    this.#syncAddBtn();
    this.onChange();
  }

  #removeSlot(i) {
    if (this.slotCount <= MIN_SLOTS) return;
    // Snapshot existing slot configs in order, drop the chosen one, re-render.
    const remaining = [];
    for (let k = 1; k <= this.slotCount; k++) {
      if (k !== i) remaining.push(this.#readSlot(k));
    }
    this.slotCount = remaining.length;
    this.#renderSlots();
    remaining.forEach((sub, idx) => this.#applySlot(idx + 1, sub));
    this.onChange();
  }

  #syncAddBtn() {
    this.addBtn.hidden = this.slotCount >= MAX_SLOTS;
  }

  #buildSlot(i) {
    const row = document.createElement("div");
    row.className = "chain-slot";
    row.dataset.slot = String(i);

    const header = document.createElement("div");
    header.className = "chain-slot__header";

    const idx = document.createElement("span");
    idx.className = "chain-slot__index";
    idx.textContent = String(i);
    idx.setAttribute("aria-label", `Slot ${i}`);
    header.appendChild(idx);

    const kindLabel = document.createElement("label");
    kindLabel.className = "chain-slot__kind";
    const kindSpan = document.createElement("span");
    kindSpan.textContent = i === 1 ? "Primary backend" : `Failover ${i - 1}`;
    kindLabel.appendChild(kindSpan);
    const kindSel = document.createElement("select");
    kindSel.id = `chain-slot-${i}-kind`;
    for (const opt of KIND_OPTIONS) {
      const o = document.createElement("option");
      o.value = opt.value;
      o.textContent = opt.label;
      kindSel.appendChild(o);
    }
    kindSel.addEventListener("change", () => {
      this.#renderFields(i, kindSel.value);
      this.onChange();
    });
    kindLabel.appendChild(kindSel);
    header.appendChild(kindLabel);

    if (i > 1) {
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "chain-slot__remove";
      removeBtn.setAttribute("aria-label", `Remove slot ${i}`);
      removeBtn.dataset.removeSlot = String(i);
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", () => this.#removeSlot(i));
      header.appendChild(removeBtn);
    }

    row.appendChild(header);

    const fields = document.createElement("div");
    fields.className = "chain-slot__fields";
    fields.dataset.fieldsFor = String(i);
    row.appendChild(fields);

    this.#renderFields(i, kindSel.value, row);
    return row;
  }

  #renderFields(i, kind, slotEl) {
    const row = slotEl || this.slotsEl.querySelector(`.chain-slot[data-slot="${i}"]`);
    if (!row) return;
    const fields = row.querySelector(".chain-slot__fields");
    fields.innerHTML = "";
    const schema = FIELD_SCHEMA[kind] || [];
    if (!schema.length) {
      const note = document.createElement("p");
      note.className = "settings__hint chain-slot__local-hint";
      note.textContent = "Local browser storage. No fields needed; works offline and persists in localStorage.";
      fields.appendChild(note);
      return;
    }
    for (const f of schema) {
      const label = document.createElement("label");
      label.className = "settings__field";
      const span = document.createElement("span");
      span.textContent = f.label + (f.required ? "" : " (optional)");
      label.appendChild(span);
      const input = document.createElement("input");
      input.id = `chain-slot-${i}-${kind}-${f.name}`;
      input.type = f.type;
      input.autocomplete = "off";
      if (f.placeholder) input.placeholder = f.placeholder;
      if (f.defaultValue) input.value = f.defaultValue;
      input.addEventListener("input", () => this.onChange());
      label.appendChild(input);
      fields.appendChild(label);
    }
  }

  #readSlot(i) {
    const kindSel = this.container.querySelector(`#chain-slot-${i}-kind`);
    const kind = kindSel ? kindSel.value : "local";
    const sub = { kind };
    const schema = FIELD_SCHEMA[kind] || [];
    for (const f of schema) {
      const el = this.container.querySelector(`#chain-slot-${i}-${kind}-${f.name}`);
      if (!el) continue;
      const v = (el.value || "").trim();
      if (v) sub[f.name] = v;
      else if (f.defaultValue) sub[f.name] = f.defaultValue;
    }
    return sub;
  }

  #applySlot(i, sub) {
    const kind = (sub && sub.kind) || "local";
    const kindSel = this.container.querySelector(`#chain-slot-${i}-kind`);
    if (kindSel) {
      kindSel.value = kind;
      this.#renderFields(i, kind);
    }
    const schema = FIELD_SCHEMA[kind] || [];
    for (const f of schema) {
      const el = this.container.querySelector(`#chain-slot-${i}-${kind}-${f.name}`);
      if (!el) continue;
      if (sub[f.name] != null) el.value = sub[f.name];
    }
  }
}
