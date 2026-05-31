// reader-output-collapse.spec.js — issue #76 acceptance.
//
// The brief-unread output got a collapse/hide toggle in #72. This brings the
// same affordance to the reader Summarise output and the Ask Q&A log via a
// shared CollapsibleOutput helper: a "Hide" / "Show" toggle carrying
// aria-expanded + aria-controls. Providers mocked via page.route.

import { test, expect } from '@playwright/test';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

async function mockGroq(page, content) {
  await page.route(GROQ_URL, async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        choices: [{ message: { role: 'assistant', content } }],
      }),
    });
  });
}

async function openFirstArticle(page) {
  await page.locator('.article-row').first().click();
  await expect(page.locator('.reader article h1')).toBeVisible();
}

async function enableSurface(page, surfaceCheckbox) {
  await page.goto('/');
  await page.locator('#enterSettingsBtn').click();
  await page.locator('#intelligenceEnable').check();
  await page.locator('#intelGroqSurfaceEnable').check();
  await page.locator('#intelGroqApiKey').fill('gsk_test_key');
  await page.locator(surfaceCheckbox).check();
  await page.locator('#intelligenceSave').click();
  await page.locator('#exitSettingsBtn').click();
}

test.describe('reader output collapse/hide (#76)', () => {
  test('the summarise output can be hidden and shown again', async ({ page }) => {
    await mockGroq(page, '- Bullet one.\n- Bullet two.');
    await enableSurface(page, '#intelGroqSurfaceEnable');
    await openFirstArticle(page);

    await page.locator('#readerSummariseBtn').click();
    await page.locator('#readerSummariseConfirm').click();
    const out = page.locator('#readerSummariseOutput');
    const toggle = page.locator('#readerSummariseToggle');
    await expect(out).toBeVisible();
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await toggle.click();
    await expect(out).toBeHidden();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toHaveText('Show summary');

    await toggle.click();
    await expect(out).toBeVisible();
    await expect(toggle).toHaveText('Hide summary');
  });

  test('the ask log can be hidden and shown again', async ({ page }) => {
    await mockGroq(page, 'The article argues calm beats noise.');
    await enableSurface(page, '#intelAskEnable');
    await openFirstArticle(page);

    await page.locator('#readerAskInput').fill('What is the main claim?');
    await page.locator('#readerAskSend').click();
    await page.locator('#readerAskConfirm').click();

    const log = page.locator('#readerAskLog');
    const toggle = page.locator('#readerAskToggle');
    await expect(log.locator('.reader__ask-a')).toContainText('calm beats noise');
    await expect(toggle).toBeVisible();

    await toggle.click();
    await expect(log).toBeHidden();
    await expect(toggle).toHaveText('Show answers');

    await toggle.click();
    await expect(log).toBeVisible();
    await expect(toggle).toHaveText('Hide answers');
  });

  test('the toggles stay hidden before any output exists', async ({ page }) => {
    await mockGroq(page, '- unused.');
    await enableSurface(page, '#intelGroqSurfaceEnable');
    await openFirstArticle(page);
    await expect(page.locator('#readerSummariseToggle')).toBeHidden();
  });
});
