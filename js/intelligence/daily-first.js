import { isDisclosureAcked } from "./index.js";

export const DAILY_FIRST_SURFACE = "clap-daily-first";
export const DAILY_FIRST_STATE_KEY = "coda/intel/daily-first";
export const DEFAULT_GREETING = "Welcome back. Here is your unread briefing.";

function pad2(n) {
  return String(n).padStart(2, "0");
}

function dateKey(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export class DailyFirstRitual {
  constructor(opts) {
    this.intel = opts.intelligence;
    this.adapter = opts.adapter;
    this.history = opts.history;
    this.voice = opts.voice || null;
    this.getShelf = typeof opts.getShelf === "function" ? opts.getShelf : () => "all";
    this.onLoop = typeof opts.onLoop === "function" ? opts.onLoop : () => {};
    this.now = typeof opts.now === "function" ? opts.now : () => new Date();

    this.wrapEl = opts.wrapEl;
    this.textEl = opts.textEl;
    this.statusEl = opts.statusEl;
    this.greetingInput = opts.greetingInput || null;

    this.state = { greeting: DEFAULT_GREETING, lastGreetedDate: "" };
    this.loaded = false;

    this.#mountSettings();
    this.intel.subscribe(() => this.#syncSettings());
  }

  async init() {
    try {
      const raw = await this.adapter.read(DAILY_FIRST_STATE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          this.state.greeting = typeof parsed.greeting === "string" && parsed.greeting.trim()
            ? parsed.greeting : DEFAULT_GREETING;
          this.state.lastGreetedDate = typeof parsed.lastGreetedDate === "string" ? parsed.lastGreetedDate : "";
        }
      }
    } catch {}
    this.loaded = true;
    this.#syncSettings();
  }

  isEnabled() {
    return this.intel.isEnabled() && this.intel.isSurfaceEnabled(DAILY_FIRST_SURFACE);
  }

  greeting() {
    const g = String(this.state.greeting || "").trim();
    return g || DEFAULT_GREETING;
  }

  onClap() {
    this.onLoop();
    if (!this.isEnabled()) { this.#hideGreeting(); return false; }
    const today = dateKey(this.now());
    if (this.state.lastGreetedDate === today) { this.#hideGreeting(); return false; }
    this.state.lastGreetedDate = today;
    this.#persist();
    this.#greet();
    return true;
  }

  #greet() {
    const greet = this.greeting();
    const shelf = this.getShelf();
    const saved = this.history ? this.history.latestBriefing(shelf) : null;
    const briefing = saved && saved.text ? String(saved.text).trim() : "";
    const spoken = briefing ? `${greet}\n\n${briefing}` : greet;

    this.#showGreeting(spoken);

    const canSpeak = this.voice && this.voice.isSpeakAnswersReady && this.voice.isSpeakAnswersReady()
      && this.voice.speakAnswersConsented && this.voice.speakAnswersConsented();
    if (canSpeak) {
      this.voice.speakAnswer(spoken);
      this.#status(briefing ? "Reading your greeting and briefing aloud." : "Reading your greeting aloud.", "ok");
    } else if (briefing) {
      this.#status("Enable and consent to \u201cSpeak answers aloud\u201d to hear this.", "info");
    } else {
      this.#status("Run \u201cBrief unread\u201d once to hear a briefing here next time.", "info");
    }
  }

  #showGreeting(text) {
    if (this.textEl) this.textEl.textContent = text;
    if (this.wrapEl) this.wrapEl.hidden = false;
  }

  #hideGreeting() {
    if (this.wrapEl) this.wrapEl.hidden = true;
    if (this.textEl) this.textEl.textContent = "";
    this.#status("", null);
  }

  #status(msg, status) {
    if (!this.statusEl) return;
    this.statusEl.textContent = msg || "";
    if (status) this.statusEl.dataset.status = status;
    else this.statusEl.removeAttribute("data-status");
  }

  async #persist() {
    try { await this.adapter.write(DAILY_FIRST_STATE_KEY, JSON.stringify(this.state)); } catch {}
  }

  #mountSettings() {
    const target = this.intel.mountTarget();
    if (!target) return;
    const fieldset = document.createElement("fieldset");
    fieldset.className = "settings__group intel-surface";
    fieldset.dataset.surface = DAILY_FIRST_SURFACE;
    fieldset.innerHTML = `
      <legend>Daily-first greeting <span class="intel-surface__tag">\u00a718.3 rung 8</span></legend>
      <label class="settings__field settings__field--inline">
        <input id="intelDailyFirstEnable" type="checkbox">
        <span>On the first clap each day, greet me and show my latest unread briefing</span>
      </label>
      <label class="settings__field">
        <span>Greeting line</span>
        <input id="intelDailyFirstGreeting" type="text" autocomplete="off" maxlength="200" placeholder="${DEFAULT_GREETING}">
      </label>
      <p class="settings__hint">
        The greeting is your words, in CODA's own voice. It is spoken only if you have turned on and
        consented to \u201cSpeak answers aloud\u201d above; otherwise it just appears. The briefing read here is the
        most recent one you generated with \u201cBrief unread\u201d, so the clap stays envelope-only and sends nothing
        new. \u201cLast greeted\u201d is stored on your device through the storage adapter and resets each calendar day.
      </p>
    `;
    target.appendChild(fieldset);
    this.enableInput = fieldset.querySelector("#intelDailyFirstEnable");
    this.greetingInput = fieldset.querySelector("#intelDailyFirstGreeting");
    this.enableInput.checked = !!this.intel.snapshot().surfaces[DAILY_FIRST_SURFACE];
    this.enableInput.addEventListener("change", () => {
      this.intel.setSurfaceEnabled(DAILY_FIRST_SURFACE, this.enableInput.checked);
    });
    this.greetingInput.addEventListener("change", () => {
      const v = this.greetingInput.value.trim();
      this.state.greeting = v || DEFAULT_GREETING;
      this.#persist();
    });
    this.#syncSettings();
  }

  #syncSettings() {
    if (this.enableInput) this.enableInput.checked = !!this.intel.snapshot().surfaces[DAILY_FIRST_SURFACE];
    if (this.greetingInput && this.loaded && document.activeElement !== this.greetingInput) {
      this.greetingInput.value = this.state.greeting === DEFAULT_GREETING ? "" : this.state.greeting;
    }
  }
}
