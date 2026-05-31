export const CLAP_SUMMON_SURFACE = "clap-summon";

const PEAK_THRESHOLD = 0.45;
const RESET_THRESHOLD = 0.2;
const REFRACTORY_MS = 600;

function detectAudioContext() {
  if (typeof window === "undefined") return null;
  return window.AudioContext || window.webkitAudioContext || null;
}

function detectGetUserMedia() {
  if (typeof navigator === "undefined" || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return null;
  return (constraints) => navigator.mediaDevices.getUserMedia(constraints);
}

export class ClapListener {
  constructor(opts) {
    this.intel = opts.intelligence;
    this.onClap = typeof opts.onClap === "function" ? opts.onClap : () => {};
    this.wrapEl = opts.wrapEl;
    this.armBtn = opts.armBtn;
    this.indicatorEl = opts.indicatorEl;

    this.AudioCtor = opts.audioContextCtor !== undefined ? opts.audioContextCtor : detectAudioContext();
    this.getStream = opts.getUserMediaImpl !== undefined ? opts.getUserMediaImpl : detectGetUserMedia();
    this.rafImpl = opts.rafImpl || ((typeof window !== "undefined" && window.requestAnimationFrame) ? window.requestAnimationFrame.bind(window) : null);
    this.cancelRaf = opts.cancelRafImpl || ((typeof window !== "undefined" && window.cancelAnimationFrame) ? window.cancelAnimationFrame.bind(window) : null);

    this.supported = !!(this.AudioCtor && this.getStream && this.rafImpl);
    this.armed = false;
    this.ctx = null;
    this.stream = null;
    this.analyser = null;
    this.buf = null;
    this.rafId = null;
    this.lastPeak = 0;
    this.lastClapAt = 0;

    this.#mountSettings();
    this.#bind();
    this.intel.subscribe(() => this.#sync());
  }

  isReady() {
    return this.supported && this.intel.isEnabled() && this.intel.isSurfaceEnabled(CLAP_SUMMON_SURFACE);
  }

  #mountSettings() {
    const target = this.intel.mountTarget();
    if (!target) return;
    const fieldset = document.createElement("fieldset");
    fieldset.className = "settings__group intel-surface";
    fieldset.dataset.surface = "clap";
    fieldset.innerHTML = `
      <legend>Clap to summon <span class="intel-surface__tag">\u00a718.3 rung 8</span></legend>
      <label class="settings__field settings__field--inline">
        <input id="intelClapSummonEnable" type="checkbox">
        <span>Listen for a clap to summon the copilot (on-device, no recording)</span>
      </label>
      <p class="settings__hint" data-clap-support></p>
      <p class="settings__hint">
        When you arm it in the reader, your device listens only for the sharp sound of a clap. It measures
        loudness on your device, never records or sends audio, and never transcribes. A visible indicator
        shows while it is listening, and you can stop it any time. Off by default.
      </p>
    `;
    target.appendChild(fieldset);
    const input = fieldset.querySelector("#intelClapSummonEnable");
    const support = fieldset.querySelector("[data-clap-support]");
    input.checked = !!this.intel.snapshot().surfaces[CLAP_SUMMON_SURFACE];
    if (!this.supported) {
      input.disabled = true;
      input.checked = false;
      support.textContent = "Clap detection is not available in this browser.";
      support.dataset.status = "fail";
    } else {
      support.remove();
    }
    input.addEventListener("change", () => {
      this.intel.setSurfaceEnabled(CLAP_SUMMON_SURFACE, input.checked);
    });
  }

  #bind() {
    if (this.armBtn) this.armBtn.addEventListener("click", () => this.#toggle());
    this.#sync();
  }

  #sync() {
    const ready = this.isReady();
    if (this.wrapEl) this.wrapEl.hidden = !ready;
    if (!ready) this.disarm();
  }

  #toggle() {
    if (!this.isReady()) return;
    if (this.armed) this.disarm();
    else this.arm();
  }

  async arm() {
    if (this.armed || !this.supported) return;
    let stream;
    try {
      stream = await this.getStream({ audio: true });
    } catch {
      this.#showIndicator("The microphone could not be opened.", "fail");
      return;
    }
    let ctx;
    try {
      ctx = new this.AudioCtor();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      this.ctx = ctx;
      this.stream = stream;
      this.analyser = analyser;
      this.buf = new Uint8Array(analyser.fftSize);
    } catch {
      this.#teardown(stream, ctx);
      this.#showIndicator("Audio could not start.", "fail");
      return;
    }
    this.armed = true;
    this.lastPeak = 0;
    this.lastClapAt = 0;
    if (this.armBtn) {
      this.armBtn.setAttribute("aria-pressed", "true");
      this.armBtn.textContent = "Stop clap summon";
    }
    this.#showIndicator("Listening for a clap", null);
    this.#loop();
  }

  disarm() {
    if (!this.armed && !this.ctx && !this.stream) return;
    if (this.rafId !== null && this.cancelRaf) { try { this.cancelRaf(this.rafId); } catch {} }
    this.rafId = null;
    this.#teardown(this.stream, this.ctx);
    this.stream = null;
    this.ctx = null;
    this.analyser = null;
    this.buf = null;
    this.armed = false;
    if (this.armBtn) {
      this.armBtn.setAttribute("aria-pressed", "false");
      this.armBtn.textContent = "Arm clap summon";
    }
    this.#hideIndicator();
  }

  #teardown(stream, ctx) {
    try { if (stream && stream.getTracks) stream.getTracks().forEach(t => t.stop && t.stop()); } catch {}
    try { if (ctx && ctx.close) ctx.close(); } catch {}
  }

  #loop() {
    if (!this.armed || !this.analyser) return;
    this.#processFrame();
    if (this.armed && this.rafImpl) this.rafId = this.rafImpl(() => this.#loop());
  }

  #processFrame() {
    if (!this.analyser || !this.buf) return;
    try { this.analyser.getByteTimeDomainData(this.buf); } catch { return; }
    let peak = 0;
    for (let i = 0; i < this.buf.length; i++) {
      const dev = Math.abs(this.buf[i] - 128) / 128;
      if (dev > peak) peak = dev;
    }
    const now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    const rising = this.lastPeak < RESET_THRESHOLD;
    if (peak >= PEAK_THRESHOLD && rising && (now - this.lastClapAt) > REFRACTORY_MS) {
      this.lastClapAt = now;
      this.lastPeak = peak;
      try { this.onClap(); } catch {}
      return;
    }
    this.lastPeak = peak;
  }

  #showIndicator(msg, state) {
    if (!this.indicatorEl) return;
    this.indicatorEl.textContent = msg || "";
    this.indicatorEl.hidden = false;
    if (state) this.indicatorEl.dataset.state = state;
    else this.indicatorEl.removeAttribute("data-state");
  }

  #hideIndicator() {
    if (!this.indicatorEl) return;
    this.indicatorEl.hidden = true;
    this.indicatorEl.textContent = "";
    this.indicatorEl.removeAttribute("data-state");
  }
}
