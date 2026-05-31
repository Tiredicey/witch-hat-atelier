// shell.spec.js — three-pane structure exists.
//
// The roadmap §7 specifies the desktop layout: 56px rail · 360px list · fluid reader.
// We assert the panes exist, the brand glyph is present, and the article-list
// renders all SAMPLE rows from the fixture module.

import { test, expect } from '@playwright/test';

test.describe('three-pane shell', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('renders rail, list, reader', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile-chromium', 'mobile is single-pane');
    await expect(page.locator('nav.rail')).toBeVisible();
    await expect(page.locator('section.list')).toBeVisible();
    await expect(page.locator('main.reader-wrap')).toBeVisible();
  });

  test('brand glyph "C" appears in the rail', async ({ page }) => {
    await expect(page.locator('.rail__brand')).toHaveText('C');
  });

  test('article rows render with title, source, age', async ({ page }) => {
    const rows = page.locator('.article-row');
    await expect(rows).toHaveCount(7);
    const first = rows.first();
    await expect(first.locator('.article-row__title')).not.toBeEmpty();
    await expect(first.locator('.article-row__source')).not.toBeEmpty();
    await expect(first.locator('.article-row__age')).not.toBeEmpty();
  });

  test('rail width matches token --rail-w on desktop', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile-chromium', 'mobile rail is horizontal');
    const w = await page.locator('nav.rail').evaluate(el => el.getBoundingClientRect().width);
    // tokens.css sets --rail-w: 56px
    expect(w).toBeGreaterThanOrEqual(55);
    expect(w).toBeLessThanOrEqual(57);
  });

  test('list width matches token --list-w on desktop', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile-chromium', 'mobile list is full-width');
    const w = await page.locator('section.list').evaluate(el => el.getBoundingClientRect().width);
    // tokens.css sets --list-w: 360px
    expect(w).toBeGreaterThanOrEqual(359);
    expect(w).toBeLessThanOrEqual(361);
  });
});
