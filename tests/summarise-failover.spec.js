// summarise-failover.spec.js — §17.5 smart failover acceptance.
//
// When the first ready provider returns a rate-limit (429) or transient error,
// the surface automatically retries the next enabled+keyed provider in order,
// without a second confirmation (the multi-host disclosure was already
// consented). A definitive failure on the last provider surfaces the error.

import { test, expect } from '@playwright/test';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const CEREBRAS_URL = 'https://api.cerebras.ai/v1/chat/completions';

async function arm(page, { groqStatus, cerebrasStatus, groqCalls, cerebrasCalls }) {
  await page.route(GROQ_URL, async route => {
    groqCalls.push(1);
    if (groqStatus === 200) {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ model: 'llama-3.3-70b-versatile', choices: [{ message: { role: 'assistant', content: '- Groq bullet.' } }] }),
      });
    } else {
      await route.fulfill({ status: groqStatus, contentType: 'application/json', body: JSON.stringify({ error: { message: 'rate limit exceeded' } }) });
    }
  });
  await page.route(CEREBRAS_URL, async route => {
    cerebrasCalls.push(1);
    if (cerebrasStatus === 200) {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ model: 'gpt-oss-120b', choices: [{ message: { role: 'assistant', content: '- Cerebras bullet.' } }] }),
      });
    } else {
      await route.fulfill({ status: cerebrasStatus, contentType: 'application/json', body: JSON.stringify({ error: { message: 'rate limit exceeded' } }) });
    }
  });
}

async function enableBoth(page) {
  await page.goto('/');
  await page.locator('#enterSettingsBtn').click();
  await page.locator('#intelligenceEnable').check();
  await page.locator('#intelGroqSurfaceEnable').check();
  await page.locator('#intelGroqApiKey').fill('gsk_test_key');
  await page.locator('#intelCerebrasSurfaceEnable').check();
  await page.locator('#intelCerebrasApiKey').fill('csk-test-key');
  await page.locator('#intelligenceSave').click();
  await page.locator('#exitSettingsBtn').click();
}

async function openFirstArticle(page) {
  await page.locator('.article-row').first().click();
  await expect(page.locator('.reader article h1')).toBeVisible();
}

test.describe('smart provider failover (§17.5)', () => {
  test('Groq 429 falls over to Cerebras without a second confirmation', async ({ page }) => {
    const groqCalls = [];
    const cerebrasCalls = [];
    await arm(page, { groqStatus: 429, cerebrasStatus: 200, groqCalls, cerebrasCalls });
    await enableBoth(page);
    await openFirstArticle(page);

    await page.locator('#readerSummariseBtn').click();
    await expect(page.locator('#readerSummariseDisclosure')).toContainText('api.cerebras.ai');
    await page.locator('#readerSummariseConfirm').click();

    const out = page.locator('#readerSummariseOutput');
    await expect(out).toBeVisible();
    await expect(out).toContainText('Cerebras bullet.');
    await expect(page.locator('#readerSummariseStatus')).toContainText('Answered by api.cerebras.ai');
    expect(groqCalls.length).toBe(1);
    expect(cerebrasCalls.length).toBe(1);
  });

  test('all providers rate-limited surfaces the final error', async ({ page }) => {
    const groqCalls = [];
    const cerebrasCalls = [];
    await arm(page, { groqStatus: 429, cerebrasStatus: 429, groqCalls, cerebrasCalls });
    await enableBoth(page);
    await openFirstArticle(page);

    await page.locator('#readerSummariseBtn').click();
    await page.locator('#readerSummariseConfirm').click();

    await expect(page.locator('#readerSummariseOutput')).toBeHidden();
    await expect(page.locator('#readerSummariseStatus')).toContainText('429');
    expect(groqCalls.length).toBe(1);
    expect(cerebrasCalls.length).toBe(1);
  });
});
