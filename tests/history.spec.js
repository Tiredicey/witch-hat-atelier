// history.spec.js — issue #74 acceptance.
//
// Re-readable history for AI outputs. A localStorage-backed store
// (coda/intel/history) keeps the latest summary per article and recent
// briefings per shelf, surfaced via "Show last summary" / "Show last
// briefing" controls that survive a reload. Providers mocked via page.route.

import { test, expect } from '@playwright/test';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MOCK_SUMMARY = '- Saved summary bullet one.\n- Saved summary bullet two.';
const MOCK_BRIEFING = '- Briefing theme A.\n- Briefing theme B.';

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

async function enableSummarise(page) {
  await page.goto('/');
  await page.locator('#enterSettingsBtn').click();
  await page.locator('#intelligenceEnable').check();
  await page.locator('#intelGroqSurfaceEnable').check();
  await page.locator('#intelGroqApiKey').fill('gsk_test_key');
  await page.locator('#intelligenceSave').click();
  await page.locator('#exitSettingsBtn').click();
}

async function enableBriefing(page) {
  await page.goto('/');
  await page.locator('#enterSettingsBtn').click();
  await page.locator('#intelligenceEnable').check();
  await page.locator('#intelGroqSurfaceEnable').check();
  await page.locator('#intelGroqApiKey').fill('gsk_test_key');
  await page.locator('#intelBriefingEnable').check();
  await page.locator('#intelligenceSave').click();
  await page.locator('#exitSettingsBtn').click();
}

async function openFirstArticle(page) {
  await page.locator('.article-row').first().click();
  await expect(page.locator('.reader article h1')).toBeVisible();
}

test.describe('re-readable intelligence history (#74)', () => {
  test('a summary is stored and re-openable after reload', async ({ page }) => {
    await mockGroq(page, MOCK_SUMMARY);
    await enableSummarise(page);
    await openFirstArticle(page);

    await page.locator('#readerSummariseBtn').click();
    await page.locator('#readerSummariseConfirm').click();
    await expect(page.locator('#readerSummariseOutput')).toContainText('Saved summary bullet one');
    await expect(page.locator('#readerSummariseRestore')).toBeVisible();

    await page.reload();
    await openFirstArticle(page);
    const restore = page.locator('#readerSummariseRestore');
    await expect(restore).toBeVisible();
    await restore.click();
    await expect(page.locator('#readerSummariseOutput')).toContainText('Saved summary bullet one');
    await expect(page.locator('#readerSummariseStatus')).toContainText('Saved summary');
  });

  test('the restore control stays hidden on an article with no saved summary', async ({ page }) => {
    await mockGroq(page, MOCK_SUMMARY);
    await enableSummarise(page);
    await openFirstArticle(page);
    await expect(page.locator('#readerSummariseRestore')).toBeHidden();
  });

  test('a briefing is stored and re-openable after reload', async ({ page }) => {
    await mockGroq(page, MOCK_BRIEFING);
    await enableBriefing(page);

    await expect(page.locator('#listBriefing')).toBeVisible();
    await page.locator('#listBriefingBtn').click();
    await page.locator('#listBriefingConfirm').click();
    await expect(page.locator('#listBriefingOutput')).toContainText('Briefing theme A');
    await expect(page.locator('#listBriefingRestore')).toBeVisible();

    await page.reload();
    const restore = page.locator('#listBriefingRestore');
    await expect(restore).toBeVisible();
    await restore.click();
    await expect(page.locator('#listBriefingOutput')).toContainText('Briefing theme A');
    await expect(page.locator('#listBriefingStatus')).toContainText('Saved briefing');
  });
});
