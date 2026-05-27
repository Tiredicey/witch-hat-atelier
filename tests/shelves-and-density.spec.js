// shelves-and-density.spec.js — rail behavior + density toggle.

import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test.describe('shelf rail', () => {
  test('"All" is current on load', async ({ page }) => {
    await expect(page.locator('.shelf[data-shelf="all"]'))
      .toHaveAttribute('aria-current', 'true');
  });

  test('clicking a shelf updates aria-current and the list title', async ({ page }) => {
    await page.locator('.shelf[data-shelf="standards"]').click();
    await expect(page.locator('.shelf[data-shelf="standards"]'))
      .toHaveAttribute('aria-current', 'true');
    await expect(page.locator('.shelf[data-shelf="all"]'))
      .toHaveAttribute('aria-current', 'false');
    await expect(page.locator('#shelf-title')).toHaveText(/Standards/);
  });

  test('engineering shelf shows the small ink-red fetch-error dot', async ({ page }) => {
    const dot = page.locator('.shelf[data-shelf="engineering"] .err');
    await expect(dot).toBeVisible();
    // sigil-red is #8B2A3A in light mode (see tokens.css)
    const bg = await dot.evaluate(el => getComputedStyle(el).backgroundColor);
    expect(bg.replace(/\s/g, '')).toMatch(/^rgba?\(139,42,58/);
  });

  test('hover-tooltip exists for accessibility', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile-chromium', 'no hover tooltips on mobile');
    const tooltip = page.locator('.shelf[data-shelf="science"] .shelf__label');
    await expect(tooltip).toHaveText('Science & research');
  });
});

test.describe('density toggle', () => {
  test('starts comfortable; switches to compact', async ({ page }) => {
    const list = page.locator('#list');
    await expect(list).toHaveAttribute('data-density', 'comfortable');
    await page.locator('.list__density button[data-density="compact"]').click();
    await expect(list).toHaveAttribute('data-density', 'compact');
    // compact hides excerpts (display:none) → not visible to a sighted user
    await expect(page.locator('.article-row__excerpt').first()).not.toBeVisible();
  });

  test('aria-pressed updates on the toggle buttons', async ({ page }) => {
    const comf = page.locator('.list__density button[data-density="comfortable"]');
    const comp = page.locator('.list__density button[data-density="compact"]');
    await expect(comf).toHaveAttribute('aria-pressed', 'true');
    await expect(comp).toHaveAttribute('aria-pressed', 'false');
    await comp.click();
    await expect(comf).toHaveAttribute('aria-pressed', 'false');
    await expect(comp).toHaveAttribute('aria-pressed', 'true');
  });
});
