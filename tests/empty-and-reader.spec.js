// empty-and-reader.spec.js — reader pane states.
//
// Two states only, per ROADMAP §7:
//   - empty:    "This shelf is quiet." in italic Cormorant, no marketing filler
//   - article:  h1 title, byline, hand-drawn flourish, body paragraphs

import { test, expect } from '@playwright/test';

test.describe('reader pane', () => {
  test('starts in empty state with required copy', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile-chromium',
      'mobile defaults to list view; empty state is desktop-visible');
    await page.goto('/');
    await expect(page.locator('.reader__empty p')).toHaveText('This shelf is quiet.');
    // has-selection should NOT be applied yet
    await expect(page.locator('.reader-wrap')).not.toHaveClass(/has-selection/);
  });

  test('clicking a row swaps in the article with flourish', async ({ page }) => {
    await page.goto('/');
    await page.locator('.article-row').first().click();
    await expect(page.locator('.reader article h1')).toBeVisible();
    await expect(page.locator('.reader article .byline')).toBeVisible();
    await expect(page.locator('.reader article .flourish')).toBeVisible();
    // at least one body paragraph
    const paras = page.locator('.reader article p').filter({ hasNot: page.locator('.byline, .smallcaps') });
    expect(await paras.count()).toBeGreaterThan(0);
    await expect(page.locator('.reader-wrap')).toHaveClass(/has-selection/);
  });

  test('selected row has aria-selected=true; siblings false', async ({ page }) => {
    await page.goto('/');
    const rows = page.locator('.article-row');
    await rows.nth(2).click();
    await expect(rows.nth(2)).toHaveAttribute('aria-selected', 'true');
    await expect(rows.nth(0)).toHaveAttribute('aria-selected', 'false');
    await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'false');
  });
});
