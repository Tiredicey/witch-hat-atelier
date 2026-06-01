// legal-reference.spec.js — a calm, optional legal-help reference in the copilot.
//
// Non-intrusive by design: a static link, no detection, no popups, no
// alarming language. Verifies the link is present, opens in a new tab safely,
// points at the intended resource, and the copy stays gentle.

import { test, expect } from '@playwright/test';

test.describe('copilot legal reference', () => {
  test('offers a single calm link that opens safely in a new tab', async ({ page }) => {
    await page.goto('/');
    const link = page.locator('.copilot__legal a');
    await expect(link).toHaveAttribute('href', 'https://batasnatin.com/chat');
    await expect(link).toHaveAttribute('target', '_blank');
    const rel = await link.getAttribute('rel');
    expect(rel).toContain('noopener');
    expect(rel).toContain('noreferrer');
    await expect(page.locator('.copilot__legal a')).toHaveCount(1);
  });

  test('the copy is non-confronting (no alarming or distress wording)', async ({ page }) => {
    await page.goto('/');
    const text = (await page.locator('.copilot__legal').innerText()).toLowerCase();
    for (const word of ['crisis', 'emergency', 'distress', 'anxiety', 'depress', 'urgent', 'help now', 'hotline']) {
      expect(text).not.toContain(word);
    }
    expect(text).toContain('legal');
  });
});
