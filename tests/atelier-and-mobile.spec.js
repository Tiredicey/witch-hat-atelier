// atelier-and-mobile.spec.js — distraction-free reading mode + mobile single-pane.

import { test, expect } from '@playwright/test';

test.describe('atelier mode', () => {
  test('button hides the rail and list', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile-chromium',
      'mobile rail is horizontal; atelier flow differs');
    await page.goto('/');
    await page.locator('#atelierBtn').click();
    await expect(page.locator('#app')).toHaveAttribute('data-atelier', 'true');
    // both side-panes should be display:none
    await expect(page.locator('nav.rail')).toBeHidden();
    await expect(page.locator('section.list')).toBeHidden();
    await expect(page.locator('main.reader-wrap')).toBeVisible();
  });

  test('clicking button again restores both side-panes', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile-chromium', 'desktop only');
    await page.goto('/');
    await page.locator('#atelierBtn').click();
    await page.locator('#atelierBtn').click();
    await expect(page.locator('#app')).not.toHaveAttribute('data-atelier', 'true');
    await expect(page.locator('nav.rail')).toBeVisible();
    await expect(page.locator('section.list')).toBeVisible();
  });
});

test.describe('mobile single-pane (@width: 390px)', () => {
  test('list is visible by default, reader hidden', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile-chromium', 'mobile-only test');
    await page.goto('/');
    await expect(page.locator('section.list')).toBeVisible();
    await expect(page.locator('main.reader-wrap')).toBeHidden();
  });

  test('tapping a row swaps to the reader; "← List" button returns', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile-chromium', 'mobile-only test');
    await page.goto('/');
    await page.locator('.article-row').first().click();
    await expect(page.locator('main.reader-wrap')).toBeVisible();
    await expect(page.locator('section.list')).toBeHidden();
    // The mobile-back button should be visible only at mobile width
    const back = page.locator('#mobileBack');
    await expect(back).toBeVisible();
    await back.click();
    await expect(page.locator('section.list')).toBeVisible();
    await expect(page.locator('main.reader-wrap')).toBeHidden();
  });

  test('data-mobile-view attribute flips between list and reader', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile-chromium', 'mobile-only test');
    await page.goto('/');
    await expect(page.locator('#app')).toHaveAttribute('data-mobile-view', 'list');
    await page.locator('.article-row').first().click();
    await expect(page.locator('#app')).toHaveAttribute('data-mobile-view', 'reader');
  });
});
