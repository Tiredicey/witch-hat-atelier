// a11y-basics.spec.js — landmark roles, focus visibility, labels.
//
// We do not bundle axe-core; this is a hand-rolled set of basic checks
// that are cheap to keep green and that match the spec's accessibility
// affordances (aria-label on every shelf, role/aria on rows and overlay).

import { test, expect } from '@playwright/test';

test.describe('accessibility basics', () => {
  test('document has a sensible <title> and lang', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/CODA/);
    const lang = await page.evaluate(() => document.documentElement.lang);
    expect(lang).toBe('en');
  });

  test('rail nav has accessible label', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('nav.rail')).toHaveAttribute('aria-label', /Shelves/i);
  });

  test('every shelf button has aria-label', async ({ page }) => {
    await page.goto('/');
    const shelves = page.locator('.shelf');
    const n = await shelves.count();
    expect(n).toBeGreaterThanOrEqual(7);
    for (let i = 0; i < n; i++) {
      const label = await shelves.nth(i).getAttribute('aria-label');
      expect(label, `shelf #${i}`).toBeTruthy();
      expect(label.length, `shelf #${i}`).toBeGreaterThan(0);
    }
  });

  test('article rows are tabbable and Enter-activatable', async ({ page }) => {
    await page.goto('/');
    const first = page.locator('.article-row').first();
    await expect(first).toHaveAttribute('tabindex', '0');
    await expect(first).toHaveAttribute('role', 'button');
    await first.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.reader article h1')).toBeVisible();
  });
  test('a keyboard-focused article row paints a visible outline', async ({ page }) => {
    await page.goto('/');
    // :focus-visible only matches when the focus came from the keyboard, so
    // walk Tab until a row is the active element rather than calling focus().
    const first = page.locator('.article-row').first();
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      const onRow = await page.evaluate(() =>
        document.activeElement?.classList.contains('article-row'));
      if (onRow) break;
    }
    await expect(first).toBeFocused();
    const ring = await first.evaluate(el => {
      const s = getComputedStyle(el);
      return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) };
    });
    expect(ring.style).not.toBe('none');
    expect(ring.width).toBeGreaterThanOrEqual(2);
  });

  test('shortcuts overlay is a labelled modal dialog', async ({ page }, info) => {
    await page.goto('/');
    // Click the appropriate help affordance for this viewport.
    // Desktop: #helpBtn in the reader actions toolbar.
    // Mobile:  #helpBtnRail in the rail (added because .reader__actions is
    //          display:none in mobile list view).
    const sel = info.project.name === 'mobile-chromium' ? '#helpBtnRail' : '#helpBtn';
    await page.locator(sel).click();
    const scrim = page.locator('#scrim');
    await expect(scrim).toHaveAttribute('role', 'dialog');
    await expect(scrim).toHaveAttribute('aria-modal', 'true');
    await expect(scrim).toHaveAttribute('aria-label', /Keyboard/i);
  });
});
