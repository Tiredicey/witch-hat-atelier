// mobile-no-horizontal-scroll.spec.js — issue: draggable right-side gap on
// mobile during video / Shorts playback.
//
// Root cause: the reader and list scroll panes set only overflow-y, so the
// browser computes overflow-x as `auto`, letting a loaded video iframe drag
// the pane sideways. Both panes are vertical-only scrollers, so the
// horizontal axis must be locked. These assert the computed axis and that a
// mounted Shorts embed does not introduce horizontal scroll.

import { test, expect } from '@playwright/test';

const PANES = ['.reader-wrap', '.list__scroll'];

test.describe('mobile panes do not scroll horizontally', () => {
  test('reader and list scroll panes lock the horizontal axis', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    for (const sel of PANES) {
      const overflowX = await page.locator(sel).evaluate(el => getComputedStyle(el).overflowX);
      expect(overflowX, `${sel} overflow-x`).toBe('hidden');
    }
  });

  test('a Shorts embed in the reader adds no horizontal scroll', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile-chromium',
      'reader-wrap is display:none in mobile list view; measured on desktop-chromium');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.locator('.article-row').first().click();
    await page.evaluate(async () => {
      const { buildVideoEmbed } = await import('/js/video-embed.js');
      const art = document.querySelector('.reader article') || document.querySelector('.reader');
      const { holder, fallback } = buildVideoEmbed({ id: 'dQw4w9WgXcQ', provider: 'youtube', short: true }, 'reader');
      art.appendChild(holder);
      art.appendChild(fallback);
      holder.querySelector('.reader__videoPlay').click();
    });
    await page.waitForTimeout(200);
    const hScroll = await page.locator('.reader-wrap').evaluate(el => el.scrollWidth - el.clientWidth);
    expect(hScroll).toBeLessThanOrEqual(0);
  });
});
