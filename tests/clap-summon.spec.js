// clap-summon.spec.js — ROADMAP §18.3 rung 8 / §18.8 (acoustic summon, foundation).
//
// The clap detector is on-device and envelope-only: Web Audio AnalyserNode,
// no SpeechRecognition, no MediaRecorder, no audio buffer stored or sent.
// All audio APIs are stubbed via addInitScript so the suite is deterministic
// and the mic boundary is mocked, per the §18.8 acceptance gate. Verifies:
// off by default, armed only by explicit opt-in, a visible armed state, the
// kill switch disarms, a clap summons the global copilot from any view, and
// no transcription or recording primitive is ever constructed.

import { test, expect } from '@playwright/test';

async function stubAudio(page) {
  await page.addInitScript(() => {
    window.__clapLevel = 0;
    window.__sttCount = 0;
    window.__recCount = 0;

    const md = navigator.mediaDevices || (navigator.mediaDevices = {});
    md.getUserMedia = async () => ({ getTracks: () => [{ stop() {} }] });

    function FakeAnalyser() { this.fftSize = 1024; this.frequencyBinCount = 512; }
    FakeAnalyser.prototype.connect = function () {};
    FakeAnalyser.prototype.getByteTimeDomainData = function (buf) {
      for (let i = 0; i < buf.length; i++) buf[i] = 128;
      buf[0] = 128 + Math.round((window.__clapLevel || 0) * 127);
    };
    function FakeCtx() {}
    FakeCtx.prototype.createMediaStreamSource = function () { return { connect() {} }; };
    FakeCtx.prototype.createAnalyser = function () { return new FakeAnalyser(); };
    FakeCtx.prototype.close = function () {};
    window.AudioContext = FakeCtx;
    window.webkitAudioContext = FakeCtx;

    window.SpeechRecognition = function () { window.__sttCount += 1; };
    window.webkitSpeechRecognition = window.SpeechRecognition;
    window.MediaRecorder = function () { window.__recCount += 1; };
  });
}

async function enable(page, { clap = true, ask = true } = {}) {
  await page.locator('#enterSettingsBtn').click();
  await page.locator('#intelligenceEnable').check();
  if (ask) {
    await page.locator('#intelGroqSurfaceEnable').check();
    await page.locator('#intelGroqApiKey').fill('gsk_test_key');
    await page.locator('#intelAskEnable').check();
  }
  if (clap) await page.locator('#intelClapSummonEnable').check();
  await page.locator('#intelligenceSave').click();
  await page.locator('#exitSettingsBtn').click();
}

test.describe('clap to summon (§18.3 rung 8)', () => {
  test.beforeEach(async ({ page }) => { await stubAudio(page); });

  test('the surface is off by default', async ({ page }) => {
    await page.goto('/');
    await page.locator('#enterSettingsBtn').click();
    await page.locator('#intelligenceEnable').check();
    const box = page.locator('#intelClapSummonEnable');
    await expect(box).toBeVisible();
    await expect(box).not.toBeChecked();
  });

  test('arming shows a visible state; closing reveals the indicator; the kill switch disarms', async ({ page }) => {
    await page.goto('/');
    await enable(page, { ask: false });

    await page.locator('#copilotBtn').click();
    const arm = page.locator('#copilotClapBtn');
    await expect(arm).toBeVisible();

    await arm.click();
    await expect(arm).toHaveAttribute('aria-pressed', 'true');
    await expect(arm).toContainText('Stop clap summon');

    await page.locator('#copilotClose').click();
    const indicator = page.locator('#copilotClapIndicator');
    await expect(indicator).toBeVisible();
    await expect(indicator).toContainText('Listening for a clap');

    await page.locator('#enterSettingsBtn').click();
    await page.locator('#intelClapSummonEnable').uncheck();
    await page.locator('#intelligenceSave').click();
    await page.locator('#exitSettingsBtn').click();

    await expect(indicator).toBeHidden();
  });

  test('a clap summons the global copilot from the list view, no open article', async ({ page }) => {
    await page.goto('/');
    await enable(page, { clap: true, ask: true });

    await page.locator('#copilotBtn').click();
    await page.locator('#copilotClapBtn').click();
    await page.locator('#copilotClose').click();
    await expect(page.locator('#copilot')).toBeHidden();

    await page.evaluate(() => { window.__clapLevel = 1; });
    await expect(page.locator('#copilot')).toBeVisible();
    await page.evaluate(() => { window.__clapLevel = 0; });
  });

  test('detection never constructs a transcriber or recorder', async ({ page }) => {
    await page.goto('/');
    await enable(page, { clap: true, ask: true });

    await page.locator('#copilotBtn').click();
    await page.locator('#copilotClapBtn').click();
    await page.locator('#copilotClose').click();

    await page.evaluate(() => { window.__clapLevel = 1; });
    await expect(page.locator('#copilot')).toBeVisible();

    expect(await page.evaluate(() => window.__sttCount)).toBe(0);
    expect(await page.evaluate(() => window.__recCount)).toBe(0);
  });
});
