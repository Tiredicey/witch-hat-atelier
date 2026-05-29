// intelligence-settings.spec.js — ROADMAP §17.11 PR #1 acceptance.
//
// The roadmap requires three assertions for the scaffolding PR:
//   1. The Settings panel section exists.
//   2. The §17.1.2 disclosure text renders (gated visible by the master checkbox).
//   3. The master checkbox toggles the visibility of the rest of the panel.

import { test, expect } from '@playwright/test';

async function enterSettings(page) {
  await page.goto('/');
  await page.locator('#enterSettingsBtn').click();
  await expect(page.locator('#settingsPage')).toBeVisible();
}

test.describe('intelligence settings scaffolding (§17.11 PR #1)', () => {
  test('panel section exists and is off by default', async ({ page }) => {
    await enterSettings(page);
    const section = page.locator('#intelligenceSection');
    await expect(section).toBeVisible();
    await expect(section.locator('h2')).toHaveText('Optional intelligence surfaces');
    const enable = page.locator('#intelligenceEnable');
    await expect(enable).not.toBeChecked();
    await expect(page.locator('#intelligencePanel')).toBeHidden();
    await expect(page.locator('#intelligenceDisclosure')).toBeHidden();
  });

  test('§17.1.2 disclosure becomes visible when master checkbox is on', async ({ page }) => {
    await enterSettings(page);
    const disclosure = page.locator('#intelligenceDisclosure');
    await expect(disclosure).toBeHidden();
    await page.locator('#intelligenceEnable').check();
    await expect(disclosure).toBeVisible();
    await expect(disclosure).toContainText('hostname');
  });

  test('master checkbox toggles rest-of-panel visibility', async ({ page }) => {
    await enterSettings(page);
    const panel = page.locator('#intelligencePanel');
    const enable = page.locator('#intelligenceEnable');

    await expect(panel).toBeHidden();
    await enable.check();
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Reader-pane Summarise (Groq)');
    await enable.uncheck();
    await expect(panel).toBeHidden();
  });

  test('save persists the enabled state across reload', async ({ page }) => {
    await enterSettings(page);
    await page.locator('#intelligenceEnable').check();
    await page.locator('#intelligenceSave').click();
    await expect(page.locator('#intelligenceStatus')).toContainText(/panel on/i);

    await page.reload();
    await page.locator('#enterSettingsBtn').click();
    await expect(page.locator('#intelligenceEnable')).toBeChecked();
    await expect(page.locator('#intelligencePanel')).toBeVisible();
  });

  test('reset clears the stored state', async ({ page }) => {
    await enterSettings(page);
    await page.locator('#intelligenceEnable').check();
    await page.locator('#intelligenceSave').click();
    await page.locator('#intelligenceReset').click();
    await expect(page.locator('#intelligenceEnable')).not.toBeChecked();
    await expect(page.locator('#intelligencePanel')).toBeHidden();
    const stored = await page.evaluate(() => localStorage.getItem('coda/intelligence'));
    expect(stored).toBeNull();
  });
});
