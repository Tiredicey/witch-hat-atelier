// whisper-stt.js — on-device speech-to-text (ROADMAP §18.3 rung 6 / issue #62).
//
// Captures microphone audio, resamples it to 16 kHz mono, and transcribes it
// entirely in the browser via Transformers.js Whisper. No audio leaves the
// device: capture (Web Audio) and inference (WASM/ONNX) both run locally.
//
// The engine + model load from a configurable URL (BYO / self-hosted per §17).
// The first run downloads the model (tens of MB) — the caller MUST disclose
// that before starting, per §17.11 item 7 and the §18 mic guardrails. This
// module only opens the mic when start() is called; the consent/disclosure
// and kill switch live at the voice-surface integration (a follow-up PR).

const OUT_RATE = 16000;
const DEFAULT_LIB_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3";
const DEFAULT_MODEL = "Xenova/whisper-tiny.en";

export function isWhisperSupported() {
  if (typeof window === "undefined") return false;
  const hasWasm = typeof WebAssembly === "object";
  const hasCtx = !!(window.AudioContext || window.webkitAudioContext);
  const hasGum = !!(typeof navigator !== "undefined" && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  return hasWasm && hasCtx && hasGum;
}

export function mergeFrames(frames) {
  const list = Array.isArray(frames) ? frames : [];
  let total = 0;
  for (const f of list) total += (f && f.length) ? f.length : 0;
  const out = new Float32Array(total);
  let off = 0;
  for (const f of list) { if (f && f.length) { out.set(f, off); off += f.length; } }
  return out;
}

export function resampleTo16k(input, inRate) {
  if (!input || !input.length) return new Float32Array(0);
  const rate = Number(inRate) || OUT_RATE;
  if (rate === OUT_RATE) return input instanceof Float32Array ? input : Float32Array.from(input);
  const ratio = rate / OUT_RATE;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = pos - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

async function defaultEngineFactory({ libUrl, model }) {
  const mod = await import(/* webpackIgnore: true */ libUrl);
  const pipeline = mod.pipeline || (mod.default && mod.default.pipeline);
  if (typeof pipeline !== "function") {
    throw new Error("Transformers.js pipeline() not found at the configured engine URL.");
  }
  const transcriber = await pipeline("automatic-speech-recognition", model);
  return {
    async transcribe(pcm16k) {
      const out = await transcriber(pcm16k);
      if (Array.isArray(out)) return out.map(o => (o && o.text) || "").join(" ").trim();
      return out && out.text ? String(out.text).trim() : "";
    },
  };
}

export class WhisperSTT {
  constructor(opts = {}) {
    this.libUrl = opts.libUrl || DEFAULT_LIB_URL;
    this.model = opts.model || DEFAULT_MODEL;
    this.engineFactory = typeof opts.engineFactory === "function" ? opts.engineFactory : defaultEngineFactory;
    this.getUserMediaImpl = opts.getUserMediaImpl || null;
    this.audioContextCtor = opts.audioContextCtor || null;
    this.onResult = typeof opts.onResult === "function" ? opts.onResult : () => {};
    this.onStatus = typeof opts.onStatus === "function" ? opts.onStatus : () => {};
    this.onAutoStop = typeof opts.onAutoStop === "function" ? opts.onAutoStop : () => {};
    this.autoStop = opts.autoStop !== false;
    this.silenceMs = Number(opts.silenceMs) > 0 ? Number(opts.silenceMs) : 1200;
    this.maxMs = Number(opts.maxMs) > 0 ? Number(opts.maxMs) : 15000;
    this.speechThreshold = Number(opts.speechThreshold) > 0 ? Number(opts.speechThreshold) : 0.012;
    this.heardSpeech = false;
    this.finalizing = false;
    this.startedAt = 0;
    this.lastVoiceAt = 0;
    this.engine = null;
    this.recording = false;
    this.frames = [];
    this.sampleRate = OUT_RATE;
    this.stream = null;
    this.ctx = null;
    this.node = null;
    this.source = null;
  }

  #status(msg, state) { try { this.onStatus(msg, state || null); } catch {} }

  async #ensureEngine() {
    if (this.engine) return this.engine;
    this.#status("Loading the on-device model (first run downloads it)\u2026", "pending");
    this.engine = await this.engineFactory({ libUrl: this.libUrl, model: this.model });
    return this.engine;
  }

  #getUserMedia() {
    if (this.getUserMediaImpl) return this.getUserMediaImpl;
    if (typeof navigator !== "undefined" && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      return (c) => navigator.mediaDevices.getUserMedia(c);
    }
    return null;
  }

  #getCtxCtor() {
    if (this.audioContextCtor) return this.audioContextCtor;
    if (typeof window !== "undefined") return window.AudioContext || window.webkitAudioContext || null;
    return null;
  }

  async start() {
    if (this.recording) return false;
    const gum = this.#getUserMedia();
    const Ctx = this.#getCtxCtor();
    if (!gum || !Ctx) {
      this.#status("On-device transcription is not available in this browser.", "fail");
      return false;
    }
    let stream;
    try { stream = await gum({ audio: true }); }
    catch { this.#status("The microphone could not be opened.", "fail"); return false; }
    try {
      const ctx = new Ctx();
      const source = ctx.createMediaStreamSource(stream);
      if (typeof ctx.createScriptProcessor !== "function") throw new Error("no capture node");
      const node = ctx.createScriptProcessor(4096, 1, 1);
      this.frames = [];
      this.sampleRate = ctx.sampleRate || OUT_RATE;
      node.onaudioprocess = (e) => {
        const ch = e.inputBuffer.getChannelData(0);
        this.frames.push(Float32Array.from(ch));
        if (this.autoStop && this.recording) this.#detectSilence(ch);
      };
      source.connect(node);
      node.connect(ctx.destination);
      this.stream = stream; this.ctx = ctx; this.node = node; this.source = source;
    } catch {
      try { stream.getTracks().forEach(t => t.stop && t.stop()); } catch {}
      this.#status("Audio capture could not start.", "fail");
      return false;
    }
    this.recording = true;
    this.finalizing = false;
    this.heardSpeech = false;
    this.startedAt = Date.now();
    this.lastVoiceAt = this.startedAt;
    this.#status(this.autoStop ? "Listening\u2026 speak, then pause." : "Listening\u2026 speak, then stop to transcribe.", "pending");
    return true;
  }

  #detectSilence(ch) {
    if (this.finalizing) return;
    let sum = 0;
    for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
    const rms = Math.sqrt(sum / (ch.length || 1));
    const now = Date.now();
    if (rms >= this.speechThreshold) { this.heardSpeech = true; this.lastVoiceAt = now; }
    const quiet = now - this.lastVoiceAt;
    const elapsed = now - this.startedAt;
    if ((this.heardSpeech && quiet >= this.silenceMs) || elapsed >= this.maxMs) {
      this.finalizing = true;
      try { this.onAutoStop(); } catch {}
      Promise.resolve().then(() => this.stop());
    }
  }

  async stop() {
    if (!this.recording) return "";
    this.recording = false;
    this.#teardownAudio();
    const rate = this.sampleRate;
    const frames = this.frames;
    this.frames = [];
    this.#status("Transcribing on your device\u2026", "pending");
    try {
      const text = await this.transcribeBuffer(frames, rate);
      this.#status(text ? "" : "No speech detected.", text ? null : "info");
      if (text) this.onResult(text);
      return text;
    } catch (e) {
      this.#status(`Transcription failed: ${String((e && e.message) || e)}`, "fail");
      return "";
    }
  }

  abort() {
    this.recording = false;
    this.frames = [];
    this.#teardownAudio();
    this.#status("", null);
  }

  #teardownAudio() {
    try { if (this.node) { this.node.onaudioprocess = null; this.node.disconnect(); } } catch {}
    try { if (this.source) this.source.disconnect(); } catch {}
    try { if (this.stream && this.stream.getTracks) this.stream.getTracks().forEach(t => t.stop && t.stop()); } catch {}
    try { if (this.ctx && this.ctx.close) this.ctx.close(); } catch {}
    this.node = null; this.source = null; this.stream = null; this.ctx = null;
  }

  async transcribeBuffer(frames, rate) {
    const merged = mergeFrames(frames);
    if (!merged.length) return "";
    const pcm = resampleTo16k(merged, rate || OUT_RATE);
    const engine = await this.#ensureEngine();
    const text = await engine.transcribe(pcm);
    return String(text || "").trim();
  }
}
