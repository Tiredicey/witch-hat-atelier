// voice-io.spec.js — ROADMAP §18.3 rung 6 (Voice I/O) acceptance.
//
// Covers the on-device read-aloud "speaker" half and the microphone command
// half. Web Speech APIs are stubbed via addInitScript so the suite is
// deterministic and needs no real microphone or network. Verifies the
// §18.2/§17.1 guardrails: off by default, gesture-fired, transmission
// disclosure before the first microphone use, command allowlist only.

import { test, expect } from '@playwright/test';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

async function stubSpeech(page) {
  await page.addInitScript(() => {
    window.__spoken = [];
    window.__cancels = 0;
    window.__autoEndSpeech = true;
    const synth = {
      speaking: false,
      speak(u) {
        window.__spoken.push(u.text);
        this.speaking = true;
        if (window.__autoEndSpeech && u.onend) setTimeout(() => { synth.speaking = false; u.onend(); }, 5);
      },
      cancel() { window.__cancels += 1; this.speaking = false; },
    };
    try { Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synth }); }
    catch { window.speechSynthesis = synth; }
    window.SpeechSynthesisUtterance = function (text) { this.text = text; this.onend = null; this.onerror = null; };

    function FakeRecognition() { this.onresult = null; this.onerror = null; this.onend = null; }
    FakeRecognition.prototype.start = function () {
      const t = window.__nextTranscript;
      setTimeout(() => {
        if (t === '__error__') { if (this.onerror) this.onerror({ error: 'not-allowed' }); }
        else if (this.onresult) this.onresult({ results: [[{ transcript: t || '' }]] });
        if (this.onend) this.onend();
      }, 5);
    };
    FakeRecognition.prototype.stop = function () { if (this.onend) this.onend(); };
    try { Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: FakeRecognition }); }
    catch { window.SpeechRecognition = FakeRecognition; }
    try { Object.defineProperty(window, 'webkitSpeechRecognition', { configurable: true, value: FakeRecognition }); }
    catch { window.webkitSpeechRecognition = FakeRecognition; }
  });
}

async function stubNoSpeech(page) {
  await page.addInitScript(() => {
    try { Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: undefined }); } catch {}
    try { Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: undefined }); } catch {}
    try { Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: undefined }); } catch {}
    try { Object.defineProperty(window, 'webkitSpeechRecognition', { configurable: true, value: undefined }); } catch {}
  });
}

async function enableVoice(page, { read = true, commands = true } = {}) {
  await page.locator('#enterSettingsBtn').click();
  await page.locator('#intelligenceEnable').check();
  if (read) await page.locator('#intelVoiceReadAloudEnable').check();
  if (commands) await page.locator('#intelVoiceCommandsEnable').check();
  await page.locator('#intelligenceSave').click();
  await page.locator('#exitSettingsBtn').click();
}

async function openFirstArticle(page) {
  await page.locator('.article-row').first().click();
  await expect(page.locator('.reader article h1')).toBeVisible();
}

test.describe('voice I/O (§18.3 rung 6)', () => {
  test('settings exposes both voice surfaces, off by default', async ({ page }) => {
    await stubSpeech(page);
    await page.goto('/');
    await page.locator('#enterSettingsBtn').click();
    await page.locator('#intelligenceEnable').check();
    const read = page.locator('#intelVoiceReadAloudEnable');
    const commands = page.locator('#intelVoiceCommandsEnable');
    await expect(read).toBeVisible();
    await expect(commands).toBeVisible();
    await expect(read).not.toBeChecked();
    await expect(commands).not.toBeChecked();
  });

  test('voice controls stay hidden until enabled', async ({ page }) => {
    await stubSpeech(page);
    await page.goto('/');
    await openFirstArticle(page);
    await expect(page.locator('#readerVoice')).toBeHidden();
  });

  test('read-aloud speaks the open article on demand', async ({ page }) => {
    await stubSpeech(page);
    await page.goto('/');
    await enableVoice(page, { read: true, commands: false });
    await openFirstArticle(page);
    const readBtn = page.locator('#readerVoiceReadBtn');
    await expect(readBtn).toBeVisible();
    await readBtn.click();
    await expect.poll(() => page.evaluate(() => window.__spoken.length)).toBeGreaterThan(0);
    const title = await page.locator('.reader article h1').textContent();
    const spoken = await page.evaluate(() => window.__spoken[0]);
    expect(spoken).toContain(title.trim());
    await expect.poll(() => readBtn.textContent()).toBe('Read aloud');
  });

  test('read-aloud toggles to a stop control while speaking', async ({ page }) => {
    await stubSpeech(page);
    await page.goto('/');
    await page.evaluate(() => { window.__autoEndSpeech = false; });
    await enableVoice(page, { read: true, commands: false });
    await openFirstArticle(page);
    const readBtn = page.locator('#readerVoiceReadBtn');
    await readBtn.click();
    await expect(readBtn).toHaveText('Stop reading');
    await expect(readBtn).toHaveAttribute('aria-pressed', 'true');
    await readBtn.click();
    await expect(readBtn).toHaveText('Read aloud');
    expect(await page.evaluate(() => window.__cancels)).toBeGreaterThan(0);
  });

  test('microphone shows the transmission disclosure before listening', async ({ page }) => {
    await stubSpeech(page);
    await page.goto('/');
    await enableVoice(page, { read: false, commands: true });
    await openFirstArticle(page);
    const micBtn = page.locator('#readerVoiceMicBtn');
    await expect(micBtn).toBeVisible();
    await page.evaluate(() => { window.__nextTranscript = 'summarise this'; });
    await micBtn.click();
    const disclosure = page.locator('#readerVoiceDisclosure');
    await expect(disclosure).toBeVisible();
    await expect(disclosure).toContainText('sent to the browser maker');
    await page.locator('#readerVoiceCancel').click();
    await expect(disclosure).toBeHidden();
  });

  test('confirmed voice command "summarise" triggers the summarise surface', async ({ page }) => {
    await stubSpeech(page);
    await page.route(GROQ_URL, async route => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ model: 'llama-3.3-70b-versatile', choices: [{ message: { role: 'assistant', content: '- Spoken-command bullet.' } }] }),
      });
    });
    await page.goto('/');
    await page.locator('#enterSettingsBtn').click();
    await page.locator('#intelligenceEnable').check();
    await page.locator('#intelVoiceCommandsEnable').check();
    await page.locator('#intelGroqSurfaceEnable').check();
    await page.locator('#intelGroqApiKey').fill('gsk_test_key');
    await page.locator('#intelligenceSave').click();
    await page.locator('#exitSettingsBtn').click();
    await openFirstArticle(page);

    await page.evaluate(() => { window.__nextTranscript = 'please summarise this article'; });
    await page.locator('#readerVoiceMicBtn').click();
    await page.locator('#readerVoiceConfirm').click();

    await expect(page.locator('#readerSummariseDisclosure')).toContainText('api.groq.com');
    await page.locator('#readerSummariseConfirm').click();
    const out = page.locator('#readerSummariseOutput');
    await expect(out).toBeVisible();
    await expect(out).toContainText('Spoken-command bullet.');
  });

  test('an off-allowlist utterance is rejected, not executed', async ({ page }) => {
    await stubSpeech(page);
    await page.goto('/');
    await enableVoice(page, { read: false, commands: true });
    await openFirstArticle(page);
    await page.evaluate(() => { window.__nextTranscript = 'what is the weather today'; });
    await page.locator('#readerVoiceMicBtn').click();
    await page.locator('#readerVoiceConfirm').click();
    await expect(page.locator('#readerVoiceStatus')).toContainText('No command recognised');
  });

  test('degrades gracefully when the browser lacks speech APIs', async ({ page }) => {
    await stubNoSpeech(page);
    await page.goto('/');
    await page.locator('#enterSettingsBtn').click();
    await page.locator('#intelligenceEnable').check();
    await expect(page.locator('#intelVoiceReadAloudEnable')).toBeDisabled();
    await expect(page.locator('#intelVoiceCommandsEnable')).toBeDisabled();
    await expect(page.locator('[data-voice-support]')).toContainText('not available');
  });
});
