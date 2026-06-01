// voice-ondevice.spec.js — ROADMAP §18.3 rung 6, on-device Whisper dictation.
//
// Unit-tests VoiceIO's on-device path with a fake Whisper engine (injected via
// whisperFactory, which also forces on-device support on) and a fake intel.
// Verifies: the mic shows when the on-device surface is on; the first use is
// gated by a disclosure that names the model download and does not start
// listening until confirmed; after confirm, transcribed dictation routes to
// onDictation, and a transcribed command routes to onCommand.

import { test, expect } from '@playwright/test';

async function build(page, transcript) {
  return page.evaluate(async (transcript) => {
    const { VoiceIO } = await import('/js/intelligence/voice.js');
    document.body.innerHTML = `
      <div id="mount"></div>
      <div id="wrap" hidden>
        <button id="read"></button>
        <button id="mic"></button>
        <span id="status"></span>
        <div id="disc" hidden><span id="dtext"></span><button id="ok"></button><button id="no"></button></div>
      </div>`;

    const surfaces = { 'voice-ondevice-stt': true };
    const intel = {
      isEnabled: () => true,
      isSurfaceEnabled: (s) => !!surfaces[s],
      setSurfaceEnabled: (s, v) => { surfaces[s] = v; },
      mountTarget: () => document.getElementById('mount'),
      snapshot: () => ({ surfaces }),
      subscribe: () => {},
    };

    const log = { starts: 0, dictation: [], commands: [] };
    let capturedOnResult = null;
    const whisperFactory = ({ onResult }) => {
      capturedOnResult = onResult;
      return {
        start: async () => { log.starts += 1; return true; },
        stop: async () => { if (capturedOnResult) capturedOnResult(transcript); },
        abort: () => {},
      };
    };

    const v = new VoiceIO({
      intelligence: intel,
      reader: { currentArticle: { title: 'T', body: ['Body.'] } },
      whisperFactory,
      onDictation: (t) => { log.dictation.push(t); return true; },
      onCommand: (c) => { log.commands.push(c); },
      wrapEl: document.getElementById('wrap'),
      readBtn: document.getElementById('read'),
      micBtn: document.getElementById('mic'),
      statusEl: document.getElementById('status'),
      disclosureEl: document.getElementById('disc'),
      disclosureTextEl: document.getElementById('dtext'),
      confirmBtn: document.getElementById('ok'),
      cancelBtn: document.getElementById('no'),
    });
    void v;

    const mic = document.getElementById('mic');
    const micVisible = !mic.hidden;

    // First tap: disclosure shown, NOT yet listening.
    mic.click();
    const discShown = !document.getElementById('disc').hidden;
    const discText = document.getElementById('dtext').textContent;
    const startsBeforeConfirm = log.starts;

    // Confirm: starts listening on-device.
    document.getElementById('ok').click();
    await new Promise(r => setTimeout(r, 20));
    const pressed = mic.getAttribute('aria-pressed');

    // Second tap: stop -> transcribe -> route.
    mic.click();
    await new Promise(r => setTimeout(r, 20));

    return { micVisible, discShown, discText, startsBeforeConfirm, startsAfter: log.starts, pressed, dictation: log.dictation, commands: log.commands };
  }, transcript);
}

test.describe('voice: on-device Whisper dictation (§18.3 rung 6)', () => {
  test('discloses the model download, waits for confirm, then routes dictation', async ({ page }) => {
    await page.goto('/');
    const r = await build(page, 'what is happening in the world today');
    expect(r.micVisible).toBe(true);
    expect(r.discShown).toBe(true);
    expect(r.discText.toLowerCase()).toContain('downloads a speech model');
    expect(r.discText.toLowerCase()).toContain('never leaves this device');
    expect(r.startsBeforeConfirm).toBe(0);   // no listening before consent
    expect(r.startsAfter).toBe(1);
    expect(r.pressed).toBe('true');
    expect(r.dictation).toEqual(['what is happening in the world today']);
    expect(r.commands).toEqual([]);
  });

  test('a transcribed command routes to onCommand, not dictation', async ({ page }) => {
    await page.goto('/');
    const r = await build(page, 'please summarise this');
    expect(r.commands).toEqual(['summarise']);
    expect(r.dictation).toEqual([]);
  });
});
