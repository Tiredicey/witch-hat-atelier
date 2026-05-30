// cerebras-summarise.spec.js — ROADMAP §17.11:3 + §17.5 acceptance for Cerebras.
//
// The shared SummariseSurface routes to the first enabled+keyed provider. With
// only Cerebras enabled, the button reads "Summarise via Cerebras", the
// disclosure names api.cerebras.ai, and the mocked endpoint receives a POST
// with Authorization: Bearer <key> and an OpenAI-shaped body.

import { test, expect } from '@playwright/test';

const CEREBRAS_URL = 'https://api.cerebras.ai/v1/chat/completions';
const MOCK_SUMMARY = '- Cerebras bullet one.\n- Cerebras bullet two.\n- Cerebras bullet three.';

async function mockCerebras(page, { calls } = {}) {
  await page.route(CEREBRAS_URL, async route => {
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
        model: 'gpt-oss-120b',
        choices: [{ message: { role: 'assistant', content: MOCK_SUMMARY } }],
      }),
    });
  });
}

async function enableMasterAndCerebras(page, { key = 'csk-test-key' } = {}) {
  await page.goto('/');
  await page.locator('#enterSettingsBtn').click();
  await page.locator('#intelligenceEnable').check();
  await page.locator('#intelCerebrasSurfaceEnable').check();
  await page.locator('#intelCerebrasApiKey').fill(key);
  await page.locator('#intelligenceSave').click();
  await page.locator('#exitSettingsBtn').click();
}

async function openFirstArticle(page) {
  await page.locator('.article-row').first().click();
  await expect(page.locator('.reader article h1')).toBeVisible();
}

test.describe('Cerebras summarise surface (§17.11:3)', () => {
  test('Cerebras fieldset renders in the Settings panel when master is on', async ({ page }) => {
    await page.goto('/');
    await page.locator('#enterSettingsBtn').click();
    await page.locator('#intelligenceEnable').check();
    await expect(page.locator('#intelligencePanel')).toContainText('Reader-pane Summarise (Cerebras)');
    await expect(page.locator('#intelCerebrasSurfaceEnable')).toBeVisible();
    await expect(page.locator('#intelCerebrasApiKey')).toBeVisible();
  });

  test('reader surface is hidden with Cerebras surface on but no key', async ({ page }) => {
    await mockCerebras(page);
    await page.goto('/');
    await page.locator('#enterSettingsBtn').click();
    await page.locator('#intelligenceEnable').check();
    await page.locator('#intelCerebrasSurfaceEnable').check();
    await page.locator('#intelligenceSave').click();
    await page.locator('#exitSettingsBtn').click();
    await openFirstArticle(page);
    await expect(page.locator('#readerSummarise')).toBeHidden();
  });

  test('button label reads "Summarise via Cerebras" when only Cerebras is configured', async ({ page }) => {
    await mockCerebras(page);
    await enableMasterAndCerebras(page);
    await openFirstArticle(page);
    await expect(page.locator('#readerSummariseBtn')).toHaveText(/Summarise via Cerebras/);
  });

  test('first click shows the §17.1.2 disclosure naming api.cerebras.ai', async ({ page }) => {
    await mockCerebras(page);
    await enableMasterAndCerebras(page);
    await openFirstArticle(page);
    await page.locator('#readerSummariseBtn').click();
    const disclosure = page.locator('#readerSummariseDisclosure');
    await expect(disclosure).toBeVisible();
    await expect(disclosure).toContainText('api.cerebras.ai');
  });

  test('confirm posts to mocked endpoint and renders the summary', async ({ page }) => {
    const calls = [];
    await mockCerebras(page, { calls });
    await enableMasterAndCerebras(page);
    await openFirstArticle(page);
    await page.locator('#readerSummariseBtn').click();
    await page.locator('#readerSummariseConfirm').click();
    const out = page.locator('#readerSummariseOutput');
    await expect(out).toBeVisible();
    await expect(out).toContainText('Cerebras bullet one.');
    expect(calls.length).toBe(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].headers['authorization']).toBe('Bearer csk-test-key');
    const body = JSON.parse(calls[0].postData);
    expect(body.model).toBe('gpt-oss-120b');
    expect(body.messages.some(m => m.role === 'user')).toBe(true);
    await expect(page.locator('#readerSummariseStatus')).toContainText('Answered by api.cerebras.ai');
  });

  test('the u keystroke routes to Cerebras when it is the only ready provider', async ({ page }) => {
    const calls = [];
    await mockCerebras(page, { calls });
    await enableMasterAndCerebras(page);
    await openFirstArticle(page);
    await page.keyboard.press('u');
    await expect(page.locator('#readerSummariseDisclosure')).toBeVisible();
    await page.locator('#readerSummariseConfirm').click();
    await expect(page.locator('#readerSummariseOutput')).toContainText('Cerebras bullet one.');
    expect(calls.length).toBe(1);
  });

  test('Groq wins priority when both providers are configured', async ({ page }) => {
    const groqCalls = [];
    const cerebrasCalls = [];
    await page.route('https://api.groq.com/openai/v1/chat/completions', async route => {
      groqCalls.push(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          choices: [{ message: { role: 'assistant', content: '- Groq bullet.' } }],
        }),
      });
    });
    await mockCerebras(page, { calls: cerebrasCalls });

    await page.goto('/');
    await page.locator('#enterSettingsBtn').click();
    await page.locator('#intelligenceEnable').check();
    await page.locator('#intelGroqSurfaceEnable').check();
    await page.locator('#intelGroqApiKey').fill('gsk_test_key');
    await page.locator('#intelCerebrasSurfaceEnable').check();
    await page.locator('#intelCerebrasApiKey').fill('csk-test-key');
    await page.locator('#intelligenceSave').click();
    await page.locator('#exitSettingsBtn').click();

    await openFirstArticle(page);
    await expect(page.locator('#readerSummariseBtn')).toHaveText(/Summarise via Groq/);
    await page.locator('#readerSummariseBtn').click();
    await expect(page.locator('#readerSummariseDisclosure')).toContainText('api.groq.com');
    await page.locator('#readerSummariseConfirm').click();
    await expect(page.locator('#readerSummariseOutput')).toContainText('Groq bullet.');
    expect(groqCalls.length).toBe(1);
    expect(cerebrasCalls.length).toBe(0);
  });
});
