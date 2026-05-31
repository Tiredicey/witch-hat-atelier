// voice-speak-answers.spec.js — ROADMAP §18.3 rung 7 (closed conversational loop, speaker half).
//
// When the user opts in, a Q&A answer is spoken back on-device via
// speechSynthesis. Verifies the §18.2.11 guardrails: off by default, its own
// kill switch separate from read-aloud, a once-per-session spoken-answer
// disclosure before the first voiced answer, on-device only, and that turning
// the surface off stops voicing. speechSynthesis is stubbed so the suite is
// deterministic and needs no audio device.

import { test, expect } from '@playwright/test';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

async function stubSpeech(page) {
  await page.addInitScript(() => {
    window.__spoken = [];
    const synth = {
      speaking: false,
      speak(u) { window.__spoken.push(u.text); this.speaking = true; if (u.onend) setTimeout(() => { synth.speaking = false; u.onend(); }, 5); },
      cancel() { this.speaking = false; },
    };
    try { Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synth }); }
    catch { window.speechSynthesis = synth; }
    window.SpeechSynthesisUtterance = function (text) { this.text = text; this.onend = null; this.onerror = null; };
  });
}

async function mockGroq(page, answer) {
  await page.route(GROQ_URL, async route => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ model: 'llama-3.3-70b-versatile', choices: [{ message: { role: 'assistant', content: answer } }] }),
    });
  });
}

async function enable(page, { speak = true } = {}) {
  await page.locator('#enterSettingsBtn').click();
  await page.locator('#intelligenceEnable').check();
  await page.locator('#intelGroqSurfaceEnable').check();
  await page.locator('#intelGroqApiKey').fill('gsk_test_key');
  await page.locator('#intelAskEnable').check();
  if (speak) await page.locator('#intelVoiceSpeakAnswersEnable').check();
  await page.locator('#intelligenceSave').click();
  await page.locator('#exitSettingsBtn').click();
}

async function ask(page, question) {
  await page.locator('.article-row').first().click();
  await expect(page.locator('.reader article h1')).toBeVisible();
  await page.locator('#readerAskInput').fill(question);
  await page.locator('#readerAskSend').click();
  if (await page.locator('#readerAskConfirm').isVisible()) {
    await page.locator('#readerAskConfirm').click();
  }
  await expect(page.locator('#readerAskLog .reader__ask-a')).toBeVisible();
}

const spoken = (page) => page.evaluate(() => window.__spoken.slice());

test.describe('speak answers aloud (§18.3 rung 7)', () => {
  test.beforeEach(async ({ page }) => { await stubSpeech(page); });

  test('the surface is off by default', async ({ page }) => {
    await page.goto('/');
    await page.locator('#enterSettingsBtn').click();
    await page.locator('#intelligenceEnable').check();
    const box = page.locator('#intelVoiceSpeakAnswersEnable');
    await expect(box).toBeVisible();
    await expect(box).not.toBeChecked();
  });

  test('with the surface off, an answer is never voiced', async ({ page }) => {
    await mockGroq(page, 'Calm beats noise.');
    await page.goto('/');
    await enable(page, { speak: false });
    await ask(page, 'What is the main claim?');
    await expect(page.locator('#readerVoiceDisclosure')).toBeHidden();
    expect(await spoken(page)).toEqual([]);
  });

  test('first answer asks for spoken-answer consent, then voices it on confirm', async ({ page }) => {
    await mockGroq(page, 'The article argues calm beats noise.');
    await page.goto('/');
    await enable(page);
    await ask(page, 'What is the main claim?');

    const disclosure = page.locator('#readerVoiceDisclosure');
    await expect(disclosure).toBeVisible();
    await expect(disclosure).toContainText('on your device');
    expect(await spoken(page)).toEqual([]);

    await page.locator('#readerVoiceConfirm').click();
    expect(await spoken(page)).toContain('The article argues calm beats noise.');
  });

  test('after consent, later answers voice without a second disclosure', async ({ page }) => {
    await mockGroq(page, 'First answer.');
    await page.goto('/');
    await enable(page);
    await ask(page, 'First question?');
    await page.locator('#readerVoiceConfirm').click();
    expect(await spoken(page)).toEqual(['First answer.']);

    await page.unroute(GROQ_URL);
    await mockGroq(page, 'Second answer.');
    await page.locator('#readerAskInput').fill('Second question?');
    await page.locator('#readerAskSend').click();
    if (await page.locator('#readerAskConfirm').isVisible()) await page.locator('#readerAskConfirm').click();
    await expect(page.locator('#readerVoiceDisclosure')).toBeHidden();
    await expect.poll(() => spoken(page)).toContain('Second answer.');
  });

  test('disabling the surface stops answers being voiced (kill switch)', async ({ page }) => {
    await mockGroq(page, 'First answer.');
    await page.goto('/');
    await enable(page);
    await ask(page, 'First question?');
    await page.locator('#readerVoiceConfirm').click();
    expect(await spoken(page)).toEqual(['First answer.']);

    await page.locator('#enterSettingsBtn').click();
    await page.locator('#intelVoiceSpeakAnswersEnable').uncheck();
    await page.locator('#intelligenceSave').click();
    await page.locator('#exitSettingsBtn').click();

    await page.unroute(GROQ_URL);
    await mockGroq(page, 'Second answer.');
    await page.locator('#readerAskInput').fill('Second question?');
    await page.locator('#readerAskSend').click();
    if (await page.locator('#readerAskConfirm').isVisible()) await page.locator('#readerAskConfirm').click();
    await expect(page.locator('#readerAskLog .reader__ask-a').nth(1)).toBeVisible();
    expect(await spoken(page)).toEqual(['First answer.']);
  });
});
