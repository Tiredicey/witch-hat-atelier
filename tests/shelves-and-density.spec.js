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

  test('switching to the standards shelf filters rows to standards items', async ({ page }) => {
    // Baseline: All shows every sample item.
    const allCount = await page.locator('.article-row').count();
    expect(allCount).toBeGreaterThan(0);

    await page.locator('.shelf[data-shelf="standards"]').click();
    const standardsCount = await page.locator('.article-row').count();
    expect(standardsCount).toBeGreaterThan(0);
    expect(standardsCount).toBeLessThan(allCount);
    // Every visible row should be a standards-tagged source.
    const sources = await page.locator('.article-row__source').allTextContents();
    for (const s of sources) {
      expect(['ietf.org', 'jsonfeed.org', 'w3.org', 'opml.org', 'mnot.net', 'coda.demo']).toContain(s);
    }
  });

  test('switching to a shelf with no items renders the empty state', async ({ page }) => {
    await page.locator('.shelf[data-shelf="science"]').click();
    await expect(page.locator('.article-row')).toHaveCount(0);
    await expect(page.locator('.article-list__empty'))
      .toHaveText(/No items in this shelf yet\./);
  });

  test('switching back to All restores the full list', async ({ page }) => {
    const allCount = await page.locator('.article-row').count();
    await page.locator('.shelf[data-shelf="engineering"]').click();
    await page.locator('.shelf[data-shelf="all"]').click();
    await expect(page.locator('.article-row')).toHaveCount(allCount);
  });

  test('list__scroll is the actual scroll container when content overflows', async ({ page }) => {
    // Inflate the list by cloning the first row many times so content exceeds the cell.
    await page.evaluate(() => {
      const scroll = document.querySelector('.list__scroll');
      const row = scroll.querySelector('.article-row');
      if (!scroll || !row) return;
      for (let i = 0; i < 30; i++) scroll.appendChild(row.cloneNode(true));
    });
    const metrics = await page.locator('.list__scroll').evaluate(el => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      overflowY: getComputedStyle(el).overflowY,
    }));
    expect(metrics.overflowY).toMatch(/auto|scroll/);
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);

    // Programmatic scroll should actually move the element.
    await page.locator('.list__scroll').evaluate(el => { el.scrollTop = 200; });
    const after = await page.locator('.list__scroll').evaluate(el => el.scrollTop);
    expect(after).toBeGreaterThan(0);
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
