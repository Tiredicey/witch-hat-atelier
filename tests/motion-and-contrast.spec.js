// motion-and-contrast.spec.js — engineering constraints from the
// "human touch" protocol the user pasted, mapped to verifiable behavior.
//
// 1. prefers-reduced-motion collapses --motion-* tokens to ~1ms (per tokens.css).
// 2. Body text color contrast against the bg is high enough to read.
//    (We do a direct luminance ratio check, not a full WCAG audit — that
//    requires axe-core which we deliberately did not add as a dependency.)

import { test, expect } from '@playwright/test';

function relLuminance(r, g, b) {
  const a = [r, g, b].map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}
function contrastRatio(rgb1, rgb2) {
  const L1 = relLuminance(...rgb1);
  const L2 = relLuminance(...rgb2);
  const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}
function parseRgb(str) {
  const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) throw new Error(`not an rgb string: ${str}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

test.describe('motion + contrast (engineering constraints)', () => {
  test('reduced-motion flattens --motion-base to ~1ms', async ({ page }, info) => {
    test.skip(info.project.name !== 'reduced-motion', 'reduced-motion project only');
    // Belt-and-braces: project-level `use.reducedMotion` should set this, but
    // we explicitly emulate the media query here so the test doesn't depend on
    // config-loading order. Both routes set the same Chromium media feature.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const v = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--motion-base').trim()
    );
    expect(v).toContain('1ms');
  });

  test('default project leaves motion at 200ms ease-out', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chromium', 'default project only');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    const v = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--motion-base').trim()
    );
    expect(v).toMatch(/200ms/);
  });

  test('article body text vs surface meets WCAG AA for normal text (≥4.5:1)', async ({ page }) => {
    await page.goto('/');
    await page.locator('.article-row').first().click();
    const para = page.locator('.reader article p').nth(1);
    const fg = parseRgb(await para.evaluate(el => getComputedStyle(el).color));
    const bg = parseRgb(await para.evaluate(el => {
      // walk up to find the first non-transparent background
      let e = el;
      while (e) {
        const c = getComputedStyle(e).backgroundColor;
        if (c && !c.includes('rgba(0, 0, 0, 0)')) return c;
        e = e.parentElement;
      }
      return getComputedStyle(document.body).backgroundColor;
    }));
    const ratio = contrastRatio(fg, bg);
    // The roadmap palette: ink #1B2438 on surface #FAF4E2 → ~13.4:1 in light mode.
    // We assert ≥ 4.5:1 (WCAG AA for normal text) so dark-mode swaps still pass.
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  test('byline (small-caps, ink-faint) meets WCAG AA for normal text', async ({ page }) => {
    await page.goto('/');
    await page.locator('.article-row').first().click();
    const byline = page.locator('.reader article .byline');
    const fg = parseRgb(await byline.evaluate(el => getComputedStyle(el).color));
    const bg = parseRgb(await byline.evaluate(el => {
      let e = el;
      while (e) {
        const c = getComputedStyle(e).backgroundColor;
        if (c && !c.includes('rgba(0, 0, 0, 0)')) return c;
        e = e.parentElement;
      }
      return getComputedStyle(document.body).backgroundColor;
    }));
    const ratio = contrastRatio(fg, bg);
    // ink-faint #63687B (light) / #968F78 (dark) clears WCAG AA (4.5:1) on every
    // surface a row or byline sits on: --bg, --surface, --surface-raised.
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
