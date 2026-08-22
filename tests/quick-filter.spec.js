// quick-filter.spec.js — the `/` quick filter advertised in the cheat sheet.
//
// Contract per ROADMAP §7: `/` reveals a filter input over the current shelf,
// typing narrows the visible rows, Esc clears the term and hides the input,
// and the filter never crosses shelf boundaries.

import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test.describe('quick filter', () => {
  test('the input is hidden until `/` is pressed', async ({ page }) => {
    await expect(page.locator('#listFilterWrap')).toBeHidden();
    await page.keyboard.press('/');
    await expect(page.locator('#listFilterWrap')).toBeVisible();
    await expect(page.locator('#listFilter')).toBeFocused();
  });

  test('typing narrows the visible rows and reports the match count', async ({ page }) => {
    const allCount = await page.locator('.article-row').count();
    expect(allCount).toBeGreaterThan(1);

    await page.keyboard.press('/');
    await page.locator('#listFilter').fill('websub');

    await expect(page.locator('.article-row')).toHaveCount(1);
    await expect(page.locator('.article-row__title')).toHaveText(/WebSub/);
    await expect(page.locator('#shelf-meta')).toHaveText('1 item matching');
  });

  test('the term matches the source column too', async ({ page }) => {
    await page.keyboard.press('/');
    await page.locator('#listFilter').fill('ietf.org');
    const sources = await page.locator('.article-row__source').allTextContents();
    expect(sources.length).toBeGreaterThan(0);
    for (const s of sources) expect(s).toBe('ietf.org');
  });

  test('a term with no matches renders the empty state', async ({ page }) => {
    await page.keyboard.press('/');
    await page.locator('#listFilter').fill('zzzznomatch');
    await expect(page.locator('.article-row')).toHaveCount(0);
    await expect(page.locator('.article-list__empty'))
      .toHaveText(/No items in this shelf yet\./);
  });

  test('Esc clears the term, hides the input and restores the list', async ({ page }) => {
    const allCount = await page.locator('.article-row').count();
    await page.keyboard.press('/');
    await page.locator('#listFilter').fill('websub');
    await expect(page.locator('.article-row')).toHaveCount(1);

    await page.locator('#listFilter').press('Escape');
    await expect(page.locator('#listFilterWrap')).toBeHidden();
    await expect(page.locator('.article-row')).toHaveCount(allCount);
  });

  test('the Clear button resets the filter', async ({ page }) => {
    const allCount = await page.locator('.article-row').count();
    await page.keyboard.press('/');
    await page.locator('#listFilter').fill('websub');
    await page.locator('#listFilterClear').click();
    await expect(page.locator('#listFilterWrap')).toBeHidden();
    await expect(page.locator('.article-row')).toHaveCount(allCount);
  });

  test('the filter stays inside the active shelf', async ({ page }) => {
    // "Obsidian BYOC" lives on the engineering shelf, not on standards.
    await page.locator('.shelf[data-shelf="standards"]').click();
    await page.keyboard.press('/');
    await page.locator('#listFilter').fill('obsidian');
    await expect(page.locator('.article-row')).toHaveCount(0);

    await page.locator('.shelf[data-shelf="engineering"]').click();
    await expect(page.locator('.article-row')).toHaveCount(1);
    await expect(page.locator('.article-row__title')).toHaveText(/Obsidian BYOC/);
  });

  test('typing a shortcut key inside the input does not trigger the shortcut', async ({ page }) => {
    await page.keyboard.press('/');
    await page.locator('#listFilter').pressSequentially('a');
    await expect(page.locator('#app')).not.toHaveAttribute('data-atelier', 'true');
    await expect(page.locator('#listFilter')).toHaveValue('a');
  });
});
