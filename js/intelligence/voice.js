import { isDisclosureAcked, ackDisclosure } from "./index.js";

export const VOICE_READALOUD_SURFACE = "voice-readaloud";
export const VOICE_COMMANDS_SURFACE = "voice-commands";
const STT_DISCLOSURE_HOST = "browser-speech-recognition";

const COMMAND_RULES = [
  { test: /\b(summari[sz]e|summary)\b/, command: "summarise" },
  { test: /\b(read|read aloud|read it|play)\b/, command: "read" },
  { test: /\b(stop|silence|quiet|cancel)\b/, command: "stop" },
];

export function matchCommand(transcript) {
  const text = String(transcript || "").toLowerCase().trim();
  if (!text) return null;
  for (const rule of COMMAND_RULES) {
    if (rule.test.test(text)) return rule.command;
  }
  return null;
}

function detectRecognition() {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function detectSynth() {
  if (typeof window === "undefined") return null;
  return window.speechSynthesis || null;
}

function detectUtterance() {
  if (typeof window === "undefined") return null;
  return window.SpeechSynthesisUtterance || null;
}

export class VoiceIO {
  constructor(opts) {
    this.intel = opts.intelligence;
    this.reader = opts.reader;
    this.onCommand = typeof opts.onCommand === "function" ? opts.onCommand : () => {};
    this.wrapEl = opts.wrapEl;
    this.readBtn = opts.readBtn;
    this.micBtn = opts.micBtn;
    this.statusEl = opts.statusEl;
    this.disclosureEl = opts.disclosureEl;
    this.disclosureTextEl = opts.disclosureTextEl;
    this.confirmBtn = opts.confirmBtn;
    this.cancelBtn = opts.cancelBtn;

    this.synth = opts.synthImpl !== undefined ? opts.synthImpl : detectSynth();
    this.UtteranceCtor = opts.utteranceCtor !== undefined ? opts.utteranceCtor : detectUtterance();
    this.RecognitionCtor = opts.recognitionCtor !== undefined ? opts.recognitionCtor : detectRecognition();

    this.recognition = null;
    this.listening = false;
    this.speaking = false;

    this.readSupported = !!(this.synth && this.UtteranceCtor);
    this.commandsSupported = !!this.RecognitionCtor;

    this.#mountSettings();
    this.#bind();
    this.intel.subscribe(() => this.#sync());
  }

  isReadReady() {
    return this.readSupported && this.intel.isEnabled() && this.intel.isSurfaceEnabled(VOICE_READALOUD_SURFACE);
  }

  isCommandsReady() {
    return this.commandsSupported && this.intel.isEnabled() && this.intel.isSurfaceEnabled(VOICE_COMMANDS_SURFACE);
  }

  stop() {
    this.#stopSpeaking();
    this.#stopListening();
    this.#setStatus("", null);
  }

  #mountSettings() {
    const target = this.intel.mountTarget();
    if (!target) return;
    const fieldset = document.createElement("fieldset");
    fieldset.className = "settings__group intel-surface";
    fieldset.dataset.surface = "voice";
    fieldset.innerHTML = `
      <legend>Voice I/O <span class="intel-surface__tag">§18.3 rung 6</span></legend>
      <label class="settings__field settings__field--inline">
        <input id="intelVoiceReadAloudEnable" type="checkbox">
        <span>Read the open article aloud (on-device speech, nothing leaves your device)</span>
      </label>
      <label class="settings__field settings__field--inline">
        <input id="intelVoiceCommandsEnable" type="checkbox">
        <span>Voice commands via microphone (summarise · read · stop)</span>
      </label>
      <p class="settings__hint" data-voice-support></p>
      <p class="settings__hint">
        Read-aloud uses the voices built into your device. Voice commands use your browser's speech
        recognition; in Chrome and Edge the audio is sent to the browser maker to be transcribed, so
        a disclosure appears before the microphone starts. Both are off by default.
      </p>
    `;
    target.appendChild(fieldset);

    const readInput = fieldset.querySelector("#intelVoiceReadAloudEnable");
    const cmdInput = fieldset.querySelector("#intelVoiceCommandsEnable");
    const support = fieldset.querySelector("[data-voice-support]");

    const snap = this.intel.snapshot();
    readInput.checked = !!snap.surfaces[VOICE_READALOUD_SURFACE];
    cmdInput.checked = !!snap.surfaces[VOICE_COMMANDS_SURFACE];

    if (!this.readSupported) {
      readInput.disabled = true;
      readInput.checked = false;
    }
    if (!this.commandsSupported) {
      cmdInput.disabled = true;
      cmdInput.checked = false;
    }

    const notes = [];
    if (!this.readSupported) notes.push("Read-aloud is not available in this browser.");
    if (!this.commandsSupported) notes.push("Voice commands are not available in this browser.");
    if (notes.length) {
      support.textContent = notes.join(" ");
      support.dataset.status = "fail";
    } else {
      support.remove();
    }

    readInput.addEventListener("change", () => {
      this.intel.setSurfaceEnabled(VOICE_READALOUD_SURFACE, readInput.checked);
    });
    cmdInput.addEventListener("change", () => {
      this.intel.setSurfaceEnabled(VOICE_COMMANDS_SURFACE, cmdInput.checked);
    });
  }

  #bind() {
    if (this.readBtn) this.readBtn.addEventListener("click", () => this.#onReadClick());
    if (this.micBtn) this.micBtn.addEventListener("click", () => this.#onMicClick());
    if (this.confirmBtn) this.confirmBtn.addEventListener("click", () => this.#onDisclosureConfirm());
    if (this.cancelBtn) this.cancelBtn.addEventListener("click", () => this.#dismissDisclosure());
    this.#sync();
  }

  #sync() {
    const readReady = this.isReadReady();
    const cmdReady = this.isCommandsReady();
    if (this.readBtn) this.readBtn.hidden = !readReady;
    if (this.micBtn) this.micBtn.hidden = !cmdReady;
    if (this.wrapEl) this.wrapEl.hidden = !(readReady || cmdReady);
    if (!readReady) this.#stopSpeaking();
    if (!cmdReady) {
      this.#stopListening();
      this.#dismissDisclosure();
    }
    if (!readReady && !cmdReady) this.#setStatus("", null);
  }

  #articleText() {
    const a = this.reader && this.reader.currentArticle;
    if (!a) return "";
    const title = (a.title || "").trim();
    const body = Array.isArray(a.body) ? a.body.join("\n\n") : String(a.body || "");
    return [title, body].filter(Boolean).join("\n\n").trim();
  }

  #onReadClick() {
    if (!this.isReadReady()) return;
    if (this.speaking) {
      this.#stopSpeaking();
      return;
    }
    const text = this.#articleText();
    if (!text) {
      this.#setStatus("Open an article first.", "info");
      return;
    }
    this.#stopListening();
    this.#startSpeaking(text);
  }

  #startSpeaking(text) {
    if (!this.synth || !this.UtteranceCtor) return;
    try { this.synth.cancel(); } catch {}
    const utterance = new this.UtteranceCtor(text);
    utterance.onend = () => this.#onSpeechEnd();
    utterance.onerror = () => {
      this.#setStatus("Read-aloud stopped.", "fail");
      this.#onSpeechEnd();
    };
    this.speaking = true;
    if (this.readBtn) {
      this.readBtn.setAttribute("aria-pressed", "true");
      this.readBtn.textContent = "Stop reading";
    }
    this.#setStatus("Reading aloud…", "pending");
    try {
      this.synth.speak(utterance);
    } catch {
      this.#setStatus("Read-aloud could not start.", "fail");
      this.#onSpeechEnd();
    }
  }

  #stopSpeaking() {
    if (this.synth && this.speaking) {
      try { this.synth.cancel(); } catch {}
    }
    this.#onSpeechEnd();
  }

  #onSpeechEnd() {
    this.speaking = false;
    if (this.readBtn) {
      this.readBtn.setAttribute("aria-pressed", "false");
      this.readBtn.textContent = "Read aloud";
    }
    if (this.statusEl && this.statusEl.dataset.status === "pending") this.#setStatus("", null);
  }

  #onMicClick() {
    if (!this.isCommandsReady()) return;
    if (this.listening) {
      this.#stopListening();
      return;
    }
    if (isDisclosureAcked(STT_DISCLOSURE_HOST)) {
      this.#startListening();
      return;
    }
    this.disclosureTextEl.textContent =
      "Voice commands use your browser's built-in speech recognition. In some browsers, including " +
      "Chrome and Edge, the audio is sent to the browser maker's servers to be transcribed. CODA " +
      "never receives or stores the audio. Start listening?";
    this.disclosureEl.hidden = false;
    this.confirmBtn.focus();
  }

  #onDisclosureConfirm() {
    ackDisclosure(STT_DISCLOSURE_HOST);
    this.#dismissDisclosure();
    this.#startListening();
  }

  #dismissDisclosure() {
    if (this.disclosureEl) this.disclosureEl.hidden = true;
    if (this.disclosureTextEl) this.disclosureTextEl.textContent = "";
  }

  #startListening() {
    if (!this.RecognitionCtor || this.listening) return;
    this.#stopSpeaking();
    let rec;
    try {
      rec = new this.RecognitionCtor();
    } catch {
      this.#setStatus("The microphone could not be opened.", "fail");
      return;
    }
    rec.lang = (typeof document !== "undefined" && document.documentElement.lang) || "en-US";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.continuous = false;
    rec.onresult = (event) => this.#onRecognitionResult(event);
    rec.onerror = (event) => {
      const code = event && event.error ? event.error : "unknown";
      this.#setStatus(code === "not-allowed" ? "Microphone permission was denied." : `Microphone error: ${code}.`, "fail");
      this.#endListening();
    };
    rec.onend = () => this.#endListening();
    this.recognition = rec;
    this.listening = true;
    if (this.micBtn) {
      this.micBtn.setAttribute("aria-pressed", "true");
      this.micBtn.textContent = "Listening… (tap to stop)";
    }
    this.#setStatus("Listening for a command: summarise, read, or stop.", "pending");
    try {
      rec.start();
    } catch {
      this.#setStatus("The microphone could not start.", "fail");
      this.#endListening();
    }
  }

  #stopListening() {
    if (this.recognition && this.listening) {
      try { this.recognition.stop(); } catch {}
    }
    this.#endListening();
  }

  #endListening() {
    this.listening = false;
    this.recognition = null;
    if (this.micBtn) {
      this.micBtn.setAttribute("aria-pressed", "false");
      this.micBtn.textContent = "Voice command";
    }
    if (this.statusEl && this.statusEl.dataset.status === "pending") this.#setStatus("", null);
  }

  #onRecognitionResult(event) {
    let transcript = "";
    try {
      transcript = event.results[0][0].transcript;
    } catch {
      transcript = "";
    }
    const command = matchCommand(transcript);
    if (!command) {
      const heard = transcript ? ` Heard "${transcript.trim()}".` : "";
      this.#setStatus(`No command recognised.${heard}`, "fail");
      return;
    }
    if (command === "read") {
      const text = this.#articleText();
      if (!text) {
        this.#setStatus("Open an article first.", "info");
        return;
      }
      this.#startSpeaking(text);
      return;
    }
    if (command === "stop") {
      this.#stopSpeaking();
      this.#setStatus("Stopped.", "ok");
      return;
    }
    if (command === "summarise") {
      this.#setStatus("Command: summarise.", "ok");
      this.onCommand("summarise");
    }
  }

  #setStatus(msg, status) {
    if (!this.statusEl) return;
    this.statusEl.textContent = msg || "";
    if (status) this.statusEl.dataset.status = status;
    else this.statusEl.removeAttribute("data-status");
  }
}
