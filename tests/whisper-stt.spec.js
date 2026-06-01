// whisper-stt.spec.js — on-device STT pipeline (issue #62 foundation).
//
// Tests the parts that are deterministic without a real mic or model: the
// 16 kHz resampler, frame merging, the engine-adapter contract (with a fake
// engine, so no model download), and the mic-failure path. The real Web Audio
// capture and the Transformers.js model load are feature-detected at runtime
// and exercised live, not here.

import { test, expect } from '@playwright/test';

const MOD = '/js/intelligence/whisper-stt.js';

test.describe('whisper-stt pipeline', () => {
  test('mergeFrames concatenates Float32 chunks', async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(async (mod) => {
      const { mergeFrames } = await import(mod);
      const merged = mergeFrames([new Float32Array([1, 2]), new Float32Array([3]), new Float32Array([])]);
      return { len: merged.length, vals: Array.from(merged) };
    }, MOD);
    expect(r.len).toBe(3);
    expect(r.vals).toEqual([1, 2, 3]);
  });

  test('resampleTo16k is identity at 16k and downsamples higher rates', async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(async (mod) => {
      const { resampleTo16k } = await import(mod);
      const same = resampleTo16k(new Float32Array(1600), 16000);
      const down = resampleTo16k(new Float32Array(48000), 48000);
      const empty = resampleTo16k(new Float32Array(0), 44100);
      return { same: same.length, down: down.length, empty: empty.length };
    }, MOD);
    expect(r.same).toBe(1600);
    expect(r.down).toBe(16000); // 48000 @ 48k -> 1s -> 16000 @ 16k
    expect(r.empty).toBe(0);
  });

  test('transcribeBuffer resamples to 16k and passes it to the engine', async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(async (mod) => {
      const { WhisperSTT } = await import(mod);
      let receivedLen = -1;
      const stt = new WhisperSTT({
        engineFactory: async () => ({
          transcribe: async (pcm) => { receivedLen = pcm.length; return '  hello world  '; },
        }),
      });
      const text = await stt.transcribeBuffer([new Float32Array(32000)], 32000); // 1s @ 32k
      const empty = await stt.transcribeBuffer([], 16000);
      return { text, receivedLen, empty };
    }, MOD);
    expect(r.text).toBe('hello world');     // trimmed
    expect(r.receivedLen).toBe(16000);      // 32000 @ 32k -> 16000 @ 16k
    expect(r.empty).toBe('');
  });

  test('start() reports a clear failure when the mic cannot open, and never loads the model', async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(async (mod) => {
      const { WhisperSTT } = await import(mod);
      const statuses = [];
      let engineLoaded = false;
      const stt = new WhisperSTT({
        getUserMediaImpl: async () => { throw new Error('denied'); },
        audioContextCtor: function () {},
        engineFactory: async () => { engineLoaded = true; return { transcribe: async () => '' }; },
        onStatus: (m, s) => statuses.push([m, s]),
      });
      const ok = await stt.start();
      return { ok, engineLoaded, lastStatus: statuses[statuses.length - 1] };
    }, MOD);
    expect(r.ok).toBe(false);
    expect(r.engineLoaded).toBe(false);
    expect(r.lastStatus[1]).toBe('fail');
    expect(r.lastStatus[0]).toContain('microphone');
  });

  test('isWhisperSupported returns a boolean', async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(async (mod) => {
      const { isWhisperSupported } = await import(mod);
      return typeof isWhisperSupported();
    }, MOD);
    expect(r).toBe('boolean');
  });
});
