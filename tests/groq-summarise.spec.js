// groq-summarise.spec.js — ROADMAP §17.11:2 + §17.5 acceptance.
//
//   - Surface is invisible when the master intel checkbox is off.
//   - Surface is invisible when the master is on but the surface checkbox is off.
//   - With both on + an article open + a key pasted, the Summarise button appears.
//   - First click shows the §17.1.2 disclosure naming api.groq.com.
//   - Confirming the disclosure issues a POST to the mocked Groq endpoint and renders the summary.
//   - Subsequent clicks in the same session skip the disclosure.
//   - The `u` keystroke triggers the same flow (§17.5.5).
//   - With the master off, `u` is inert.
//
// The mocked endpoint returns a fixed bullet list so the assertion is stable.

import { test, expect } from '@playwright/test';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MOCK_SUMMARY = '- First bullet.\n- Second bullet.\n- Third bullet.';

async function mockGroq(page, { calls } = {}) {
  await page.route(GROQ_URL, async route => {
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
        model: 'llama-3.1-70b-versatile',
        choices: [{ message: { role: 'assistant', content: MOCK_SUMMARY } }],
      }),
    });
  });
}

async function enableMasterAndSurface(page, { key = 'gsk_test_key' } = {}) {
  await page.goto('/');
  await page.locator('#enterSettingsBtn').click();
  await page.locator('#intelligenceEnable').check();
  await page.locator('#intelGroqSurfaceEnable').check();
  await page.locator('#intelGroqApiKey').fill(key);
  await page.locator('#intelligenceSave').click();
  await page.locator('#exitSettingsBtn').click();
}

async function openFirstArticle(page) {
  await page.locator('.article-row').first().click();
  await expect(page.locator('.reader article h1')).toBeVisible();
}

test.describe('Groq summarise surface (§17.11:2)', () => {
  test('reader surface is hidden when the master checkbox is off', async ({ page }) => {
    await mockGroq(page);
    await page.goto('/');
    await openFirstArticle(page);
    await expect(page.locator('#readerSummarise')).toBeHidden();
  });

  test('reader surface is hidden when surface checkbox is off even with master on', async ({ page }) => {
    await mockGroq(page);
    await page.goto('/');
    await page.locator('#enterSettingsBtn').click();
    await page.locator('#intelligenceEnable').check();
    await page.locator('#intelligenceSave').click();
    await page.locator('#exitSettingsBtn').click();
    await openFirstArticle(page);
    await expect(page.locator('#readerSummarise')).toBeHidden();
  });

  test('reader surface is hidden with surface on but no API key', async ({ page }) => {
    await mockGroq(page);
    await page.goto('/');
    await page.locator('#enterSettingsBtn').click();
    await page.locator('#intelligenceEnable').check();
    await page.locator('#intelGroqSurfaceEnable').check();
    await page.locator('#intelligenceSave').click();
    await page.locator('#exitSettingsBtn').click();
    await openFirstArticle(page);
    await expect(page.locator('#readerSummarise')).toBeHidden();
  });

  test('first click shows the §17.1.2 disclosure naming api.groq.com', async ({ page }) => {
    await mockGroq(page);
    await enableMasterAndSurface(page);
    await openFirstArticle(page);
    await expect(page.locator('#readerSummarise')).toBeVisible();
    await page.locator('#readerSummariseBtn').click();
    const disclosure = page.locator('#readerSummariseDisclosure');
    await expect(disclosure).toBeVisible();
    await expect(disclosure).toContainText('api.groq.com');
  });

  test('confirm posts to mocked endpoint and renders the summary', async ({ page }) => {
    const calls = [];
    await mockGroq(page, { calls });
    await enableMasterAndSurface(page);
    await openFirstArticle(page);
    await page.locator('#readerSummariseBtn').click();
    await page.locator('#readerSummariseConfirm').click();
    const out = page.locator('#readerSummariseOutput');
    await expect(out).toBeVisible();
    await expect(out).toContainText('First bullet.');
    await expect(out).toContainText('Third bullet.');
    expect(calls.length).toBe(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].headers['authorization']).toBe('Bearer gsk_test_key');
    const body = JSON.parse(calls[0].postData);
    expect(body.model).toBe('llama-3.1-70b-versatile');
    expect(Array.isArray(body.messages)).toBe(true);
    expect(body.messages.some(m => m.role === 'user')).toBe(true);
    await expect(page.locator('#readerSummariseStatus')).toContainText('Answered by api.groq.com');
  });

  test('subsequent clicks in the same session skip the disclosure', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile-chromium',
      'desktop only: switching articles on mobile requires the list-view transition tested elsewhere');
    const calls = [];
    await mockGroq(page, { calls });
    await enableMasterAndSurface(page);
    await openFirstArticle(page);
    await page.locator('#readerSummariseBtn').click();
    await page.locator('#readerSummariseConfirm').click();
    await expect(page.locator('#readerSummariseOutput')).toBeVisible();

    await page.locator('.article-row').nth(1).click();
    await page.locator('#readerSummariseBtn').click();
    await expect(page.locator('#readerSummariseDisclosure')).toBeHidden();
    await expect(page.locator('#readerSummariseOutput')).toContainText('First bullet.');
    expect(calls.length).toBe(2);
  });

  test('the u keystroke triggers summarise when the surface is enabled', async ({ page }) => {
    const calls = [];
    await mockGroq(page, { calls });
    await enableMasterAndSurface(page);
    await openFirstArticle(page);
    await page.keyboard.press('u');
    await expect(page.locator('#readerSummariseDisclosure')).toBeVisible();
    await page.locator('#readerSummariseConfirm').click();
    await expect(page.locator('#readerSummariseOutput')).toContainText('First bullet.');
    expect(calls.length).toBe(1);
  });

  test('the u keystroke is inert when the master is off (§17.5.5 gate)', async ({ page }) => {
    const calls = [];
    await mockGroq(page, { calls });
    await page.goto('/');
    await openFirstArticle(page);
    await page.keyboard.press('u');
    await expect(page.locator('#readerSummariseDisclosure')).toBeHidden();
    expect(calls.length).toBe(0);
  });
});
