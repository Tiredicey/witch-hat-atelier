import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('normal startup does not show fictional reporting', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('coda/examples'));
  await page.goto('/');
  await expect(page.locator('#feedStatus')).toContainText('Add a feed');
  await expect(page.locator('.article-row')).toHaveCount(0);
});

test('reading preferences persist and native dialog restores focus', async ({ page }) => {
  await page.goto('/');
  await page.locator('#readingPrefsBtn').click();
  await page.locator('#readingTheme').selectOption('dark');
  await page.locator('#readingSize').selectOption('larger');
  await page.locator('#readingMotion').check();
  await expect(page.locator('#readingPrefsStatus')).toContainText('saved');
  await page.keyboard.press('Escape');
  await expect(page.locator('#readingPrefsBtn')).toBeFocused();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-reading-size', 'larger');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduce');
});

test('search button works with Escape and restores focus', async ({ page }) => {
  await page.goto('/');
  await page.locator('#searchShelfBtn').click();
  await page.locator('#listFilter').fill('no matching article here');
  await expect(page.locator('.article-row')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('#searchShelfBtn')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#searchShelfBtn')).toBeFocused();
  await expect(page.locator('.article-row')).toHaveCount(7);
});

test('add-feed shortcut and brand return use existing navigation', async ({ page }) => {
  await page.goto('/');
  await page.locator('#quickAddFeedBtn').click();
  await expect(page.locator('body')).toHaveAttribute('data-page', 'settings');
  await expect(page.locator('#add-feed-input')).toBeFocused();
  await page.locator('.atelier-brand').click();
  await expect(page.locator('body')).toHaveAttribute('data-page', 'reader');
  await expect(page.locator('#list')).toBeFocused();
});

test('reading preferences pass scoped WCAG A and AA axe checks', async ({ page }) => {
  await page.goto('/');
  await page.locator('#readingPrefsBtn').click();
  for (const theme of ['light', 'dark']) {
    await page.locator('#readingTheme').selectOption(theme);
    const result = await new AxeBuilder({ page }).include('#readingPrefsDialog').withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(result.violations).toEqual([]);
  }
});

test('reading desk fits narrow and wide viewports', async ({ page }) => {
  await page.goto('/');
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
});
