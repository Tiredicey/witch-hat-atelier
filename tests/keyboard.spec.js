// keyboard.spec.js — every shortcut from ROADMAP §7.
//
// j/k       next/prev
// o/Enter   open
// m         mark read/unread (toggles data-read on the row)
// s         star (visual stub — flips dataset.starred on the button)
// a         atelier mode
// ?         shortcuts overlay
// Esc       close overlay
// g g       go to All
// g s       go to Starred

import { test, expect } from '@playwright/test';

test.describe('keyboard shortcuts (§7)', () => {
  test('j and k move selection forward and back', async ({ page }) => {
    await page.goto('/');
    await page.locator('.article-row').first().click();
    const firstTitle = await page.locator('.reader article h1').textContent();

    await page.keyboard.press('j');
    const secondTitle = await page.locator('.reader article h1').textContent();
    expect(secondTitle).not.toBe(firstTitle);

    await page.keyboard.press('k');
    const backToFirst = await page.locator('.reader article h1').textContent();
    expect(backToFirst).toBe(firstTitle);
  });

  test('o opens the first article when none selected', async ({ page }) => {
    await page.goto('/');
    await page.locator('body').click({ position: { x: 10, y: 10 } });
    await page.keyboard.press('o');
    await expect(page.locator('.reader article h1')).toBeVisible();
  });

  test('m toggles the read state on the selected row', async ({ page }) => {
    await page.goto('/');
    const row = page.locator('.article-row').first();
    await row.click();
    const before = await row.getAttribute('data-read');
    await page.keyboard.press('m');
    const after = await row.getAttribute('data-read');
    expect(after).not.toBe(before);
  });

  test('s flips the star button state', async ({ page }) => {
    await page.goto('/');
    await page.locator('.article-row').first().click();
    const before = await page.locator('#starBtn').getAttribute('data-starred');
    await page.keyboard.press('s');
    const after = await page.locator('#starBtn').getAttribute('data-starred');
    expect(after).toBe('true');
    expect(before === null || before === 'false').toBeTruthy();
  });

  test('a toggles atelier mode', async ({ page }) => {
    await page.goto('/');
    const app = page.locator('#app');
    await expect(app).not.toHaveAttribute('data-atelier', 'true');
    await page.keyboard.press('a');
    await expect(app).toHaveAttribute('data-atelier', 'true');
    await page.keyboard.press('a');
    await expect(app).not.toHaveAttribute('data-atelier', 'true');
  });

  test('? opens the shortcuts overlay, Escape closes it', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('?');
    await expect(page.locator('#scrim')).toHaveAttribute('data-open', 'true');
    await page.keyboard.press('Escape');
    await expect(page.locator('#scrim')).toHaveAttribute('data-open', 'false');
  });

  test('g g jumps to All shelf, g s jumps to Starred', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile-chromium',
      'mobile rail is horizontal — same buttons but no current/aria difference to assert visually');
    await page.goto('/');
    // first switch off "All" so the assertion is meaningful
    await page.locator('.shelf[data-shelf="science"]').click();
    await expect(page.locator('.shelf[data-shelf="science"]'))
      .toHaveAttribute('aria-current', 'true');

    await page.keyboard.press('g');
    await page.keyboard.press('g');
    await expect(page.locator('.shelf[data-shelf="all"]'))
      .toHaveAttribute('aria-current', 'true');

    await page.keyboard.press('g');
    await page.keyboard.press('s');
    await expect(page.locator('.shelf[data-shelf="starred"]'))
      .toHaveAttribute('aria-current', 'true');
  });

  test('shortcuts are ignored when typing in an input', async ({ page }) => {
    await page.goto('/');
    // Inject a temp input so we can verify the input-guard rule
    await page.evaluate(() => {
      const i = document.createElement('input');
      i.id = '_temp_input';
      document.body.appendChild(i);
      i.focus();
    });
    await page.keyboard.type('jjjkkk');
    // No article selected because keys went into the input
    await expect(page.locator('.reader-wrap')).not.toHaveClass(/has-selection/);
    await expect(page.locator('#_temp_input')).toHaveValue('jjjkkk');
  });
});
