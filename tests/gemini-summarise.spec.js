// gemini-summarise.spec.js — ROADMAP §17.11:4 + §17.5 acceptance for Google Gemini.
//
// The shared SummariseSurface routes to the first enabled+keyed provider. With
// only Gemini enabled, the button reads "Summarise via Google Gemini", the
// disclosure names generativelanguage.googleapis.com, and the mocked OpenAI-
// compatible endpoint receives a POST with Authorization: Bearer <key>.

import { test, expect } from '@playwright/test';

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const MOCK_SUMMARY = '- Gemini bullet one.\n- Gemini bullet two.\n- Gemini bullet three.';

async function mockGemini(page, { calls } = {}) {
  await page.route(GEMINI_URL, async route => {
    const req = route.request();
    if (calls) calls.push({
      method: req.method(),
      headers: req.headers(),
      postData: req.postData(),
    });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        model: 'gemini-2.5-flash',
        choices: [{ message: { role: 'assistant', content: MOCK_SUMMARY } }],
      }),
    });
  });
}

async function enableMasterAndGemini(page, { key = 'AIza-test-key' } = {}) {
  await page.goto('/');
  await page.locator('#enterSettingsBtn').click();
  await page.locator('#intelligenceEnable').check();
  await page.locator('#intelGeminiSurfaceEnable').check();
  await page.locator('#intelGeminiApiKey').fill(key);
  await page.locator('#intelligenceSave').click();
  await page.locator('#exitSettingsBtn').click();
}

async function openFirstArticle(page) {
  await page.locator('.article-row').first().click();
  await expect(page.locator('.reader article h1')).toBeVisible();
}

test.describe('Gemini summarise surface (§17.11:4)', () => {
  test('Gemini fieldset renders in the Settings panel when master is on', async ({ page }) => {
    await page.goto('/');
    await page.locator('#enterSettingsBtn').click();
    await page.locator('#intelligenceEnable').check();
    await expect(page.locator('#intelligencePanel')).toContainText('Reader-pane Summarise (Google Gemini)');
    await expect(page.locator('#intelGeminiSurfaceEnable')).toBeVisible();
    await expect(page.locator('#intelGeminiApiKey')).toBeVisible();
  });

  test('reader surface is hidden with Gemini surface on but no key', async ({ page }) => {
    await mockGemini(page);
    await page.goto('/');
    await page.locator('#enterSettingsBtn').click();
    await page.locator('#intelligenceEnable').check();
    await page.locator('#intelGeminiSurfaceEnable').check();
    await page.locator('#intelligenceSave').click();
    await page.locator('#exitSettingsBtn').click();
    await openFirstArticle(page);
    await expect(page.locator('#readerSummarise')).toBeHidden();
  });

  test('button label reads "Summarise via Google Gemini" when only Gemini is configured', async ({ page }) => {
    await mockGemini(page);
    await enableMasterAndGemini(page);
    await openFirstArticle(page);
    await expect(page.locator('#readerSummariseBtn')).toHaveText(/Summarise via Google Gemini/);
  });

  test('first click shows the §17.1.2 disclosure naming the Gemini host', async ({ page }) => {
    await mockGemini(page);
    await enableMasterAndGemini(page);
    await openFirstArticle(page);
    await page.locator('#readerSummariseBtn').click();
    const disclosure = page.locator('#readerSummariseDisclosure');
    await expect(disclosure).toBeVisible();
    await expect(disclosure).toContainText('generativelanguage.googleapis.com');
  });

  test('confirm posts to mocked endpoint and renders the summary', async ({ page }) => {
    const calls = [];
    await mockGemini(page, { calls });
    await enableMasterAndGemini(page);
    await openFirstArticle(page);
    await page.locator('#readerSummariseBtn').click();
    await page.locator('#readerSummariseConfirm').click();
    const out = page.locator('#readerSummariseOutput');
    await expect(out).toBeVisible();
    await expect(out).toContainText('Gemini bullet one.');
    expect(calls.length).toBe(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].headers['authorization']).toBe('Bearer AIza-test-key');
    const body = JSON.parse(calls[0].postData);
    expect(body.model).toBe('gemini-2.5-flash');
    expect(body.messages.some(m => m.role === 'user')).toBe(true);
    await expect(page.locator('#readerSummariseStatus')).toContainText('Answered by generativelanguage.googleapis.com');
  });

  test('the u keystroke routes to Gemini when it is the only ready provider', async ({ page }) => {
    const calls = [];
    await mockGemini(page, { calls });
    await enableMasterAndGemini(page);
    await openFirstArticle(page);
    await page.keyboard.press('u');
    await expect(page.locator('#readerSummariseDisclosure')).toBeVisible();
    await page.locator('#readerSummariseConfirm').click();
    await expect(page.locator('#readerSummariseOutput')).toContainText('Gemini bullet one.');
    expect(calls.length).toBe(1);
  });
});
