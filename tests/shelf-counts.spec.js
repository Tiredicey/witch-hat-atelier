import { test, expect } from '@playwright/test';

test.describe('sigil-rail unread counts', () => {
  test.beforeEach(async ({ page }, info) => {
    test.skip(info.project.name === 'mobile-chromium', 'rail counts verified on the desktop rail');
    await page.goto('/');
    await page.locator('.article-row').first().waitFor();
  });

  test('counts reflect the real unread set, not the old static placeholders', async ({ page }) => {
    await expect(page.locator('.shelf[data-shelf="all"] .count')).toHaveText('7');
    await expect(page.locator('.shelf[data-shelf="standards"] .count')).toHaveText('6');
    await expect(page.locator('.shelf[data-shelf="engineering"] .count')).toHaveText('1');
    const texts = await page.locator('.rail .shelf .count').allTextContents();
    for (const t of texts) expect(['42', '12', '18']).not.toContain(t.trim());
  });

  test('shelves with nothing unread render no numeral', async ({ page }) => {
    for (const s of ['indie', 'science', 'starred']) {
      await expect(page.locator(`.shelf[data-shelf="${s}"] .count`)).toBeHidden();
    }
  });

  test('marking an item read decrements both All and its shelf', async ({ page }) => {
    const all = page.locator('.shelf[data-shelf="all"] .count');
    const standards = page.locator('.shelf[data-shelf="standards"] .count');
    await expect(all).toHaveText('7');
    await expect(standards).toHaveText('6');

    await page.locator('.shelf[data-shelf="standards"]').click();
    const row = page.locator('.article-row').first();
    await row.click();
    await page.keyboard.press('m');

    await expect(row).toHaveAttribute('data-read', 'true');
    await expect(all).toHaveText('6');
    await expect(standards).toHaveText('5');
  });

  test('clearing a shelf last unread makes its count go quiet while the row stays', async ({ page }) => {
    const eng = page.locator('.shelf[data-shelf="engineering"] .count');
    await expect(eng).toHaveText('1');

    await page.locator('.shelf[data-shelf="engineering"]').click();
    const rows = page.locator('.article-row');
    await expect(rows).toHaveCount(1);
    await rows.first().click();
    await page.keyboard.press('m');

    await expect(rows.first()).toHaveAttribute('data-read', 'true');
    await expect(eng).toBeHidden();
    await expect(rows).toHaveCount(1);
  });

  test('marking the read item back to unread restores the numeral', async ({ page }) => {
    const eng = page.locator('.shelf[data-shelf="engineering"] .count');
    await page.locator('.shelf[data-shelf="engineering"]').click();
    const row = page.locator('.article-row').first();
    await row.click();
    await page.keyboard.press('m');
    await expect(eng).toBeHidden();
    await page.keyboard.press('m');
    await expect(eng).toHaveText('1');
  });
});
