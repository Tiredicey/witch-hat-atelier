// orphan-stars-boot.spec.js
//
// Reload-time persistence of imported stars. The orphan-stars test in
// tests/inoreader-import.spec.js covers the in-session import path. This
// spec covers what happens on a second visit, when boot must rebuild the
// orphan rows from the store snapshot alone.

import { test, expect } from '@playwright/test';

const STAR_EVENTS = [
  {
    t: 'item.star',
    itemId: 'https://www.mnot.net/blog/2026/feed-survey',
    on: true,
    at: 1714520000000,
    title: 'Mark Nottingham — Web Feeds in 2026',
    link: 'https://www.mnot.net/blog/2026/feed-survey',
  },
  {
    t: 'item.star',
    itemId: 'https://www.jsonfeed.org/version/1.1/',
    on: true,
    at: 1714521000000,
    title: 'JSON Feed 1.1',
    link: 'https://www.jsonfeed.org/version/1.1/',
  },
];

test.describe('orphan stars survive a page reload', () => {
  test('stars imported on first visit appear in the Starred shelf on reload', async ({ page }) => {
    await page.goto('/');
    await page.evaluate((events) => {
      localStorage.removeItem('coda/v1/snapshot.json');
      localStorage.setItem('coda/v1/log.ndjson', events.map(e => JSON.stringify(e)).join('\n'));
    }, STAR_EVENTS);

    await page.reload();
    await page.locator('nav.rail .shelf[data-shelf="starred"]').click();

    const mnotRow = page.locator('.article-row[data-orphan="true"]', {
      hasText: 'Web Feeds in 2026',
    });
    await expect(mnotRow).toBeVisible({ timeout: 5000 });
    await expect(mnotRow).toHaveAttribute('data-starred', 'true');

    const jfRow = page.locator('.article-row[data-orphan="true"]', {
      hasText: 'JSON Feed 1.1',
    });
    await expect(jfRow).toBeVisible();
  });

  test('orphan row opens the original link target in a new tab', async ({ page }) => {
    await page.goto('/');
    await page.evaluate((events) => {
      localStorage.removeItem('coda/v1/snapshot.json');
      localStorage.setItem('coda/v1/log.ndjson', events.map(e => JSON.stringify(e)).join('\n'));
    }, STAR_EVENTS);

    await page.reload();
    await page.locator('nav.rail .shelf[data-shelf="starred"]').click();
    await page.locator('.article-row[data-orphan="true"]', { hasText: 'Web Feeds in 2026' }).click();

    const link = page.locator('#reader a[href="https://www.mnot.net/blog/2026/feed-survey"]');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
  });

  test('orphan rows survive a compacted snapshot (no log, snapshot only)', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.removeItem('coda/v1/log.ndjson');
      const snap = {
        version: 1,
        generated: Date.now(),
        items: [
          {
            id: 'https://www.mnot.net/blog/2026/feed-survey',
            read: false,
            starred: true,
            notes: [],
            title: 'Mark Nottingham — Web Feeds in 2026',
            link: 'https://www.mnot.net/blog/2026/feed-survey',
          },
        ],
      };
      localStorage.setItem('coda/v1/snapshot.json', JSON.stringify(snap));
    });

    await page.reload();
    await page.locator('nav.rail .shelf[data-shelf="starred"]').click();

    const row = page.locator('.article-row[data-orphan="true"]', {
      hasText: 'Web Feeds in 2026',
    });
    await expect(row).toBeVisible({ timeout: 5000 });
  });
});
