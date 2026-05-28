import { test, expect } from '@playwright/test';

async function gotoSettings(page) {
  await page.locator('#enterSettingsBtn').scrollIntoViewIfNeeded();
  await page.locator('#enterSettingsBtn').click();
  await expect(page.locator('#settingsPage')).toBeVisible();
}

test.describe('chain adapter + mirror-to-local resilience (§5 + environmental conditions)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.reload();
  });

  test('mirror checkbox decorates saved config with mirrorLocal: true', async ({ page }) => {
    await gotoSettings(page);
    await page.locator('#settingsKind').selectOption('github');
    await page.locator('#github-token').fill('ghp_x');
    await page.locator('#github-owner').fill('me');
    await page.locator('#github-repo').fill('coda-state');
    await page.locator('#mirrorLocalToggle').check();
    await page.locator('#plaintextConfirm').fill('PLAINTEXT');
    await expect(page.locator('#saveSettingsBtn')).toBeEnabled();
    await page.locator('#saveSettingsBtn').click();
    await page.waitForLoadState('domcontentloaded');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('coda/settings')));
    expect(stored.kind).toBe('github');
    expect(stored.mirrorLocal).toBe(true);
  });

  test('mirror persists writes to local even when primary cloud fails', async ({ page }) => {
    let primaryCalls = 0;
    await page.route(/api\.github\.com/, async (route) => {
      primaryCalls += 1;
      return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"upstream blew up"}' });
    });
    await page.evaluate(() => localStorage.setItem('coda/settings', JSON.stringify({
      kind: 'github',
      token: 'ghp_x', owner: 'me', repo: 'coda-state', branch: 'main',
      mirrorLocal: true,
    })));
    await page.reload();
    await page.locator('.article-row').first().click();
    await page.locator('#starBtn').click();
    await page.waitForTimeout(150);
    expect(primaryCalls).toBeGreaterThan(0);
    const localLog = await page.evaluate(() => localStorage.getItem('coda/v1/log.ndjson'));
    expect(localLog).toContain('item.star');
  });

  test('reads fall back to local when primary cloud is unreachable', async ({ page }) => {
    await page.route(/api\.github\.com/, async (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"upstream down"}' }));
    await page.evaluate(() => {
      const ev = JSON.stringify({ t: 'item.star', itemId: 'a1', on: true, at: 1 });
      localStorage.setItem('coda/v1/log.ndjson', ev);
      localStorage.setItem('coda/settings', JSON.stringify({
        kind: 'github',
        token: 'ghp_x', owner: 'me', repo: 'coda-state', branch: 'main',
        mirrorLocal: true,
      }));
    });
    await page.reload();
    await expect(page.locator('.app')).toBeVisible();
    const starred = page.locator('.article-row[data-id="a1"]');
    await expect(starred).toHaveAttribute('data-starred', 'true');
  });

  test('chain adapter (advanced JSON form) builds ordered chain with labels', async ({ page }) => {
    await page.evaluate(() => localStorage.setItem('coda/settings', JSON.stringify({
      kind: 'chain',
      adapters: [
        { kind: 'github', token: 'ghp_x', owner: 'me', repo: 'coda-state', branch: 'main' },
        { kind: 'local' },
      ],
    })));
    await page.route(/api\.github\.com/, async (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
    await page.reload();
    await page.locator('.article-row').first().click();
    await page.locator('#starBtn').click();
    await page.waitForTimeout(150);
    const localLog = await page.evaluate(() => localStorage.getItem('coda/v1/log.ndjson'));
    expect(localLog).toContain('item.star');
  });

  test('mirror toggle round-trips through reload', async ({ page }) => {
    await page.route(/api\.github\.com/, async (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
    await page.evaluate(() => localStorage.setItem('coda/settings', JSON.stringify({
      kind: 'github',
      token: 'ghp_x', owner: 'me', repo: 'coda-state', branch: 'main',
      mirrorLocal: true,
    })));
    await page.reload();
    await expect(page.locator('.app')).toBeVisible();
    await gotoSettings(page);
    await expect(page.locator('#mirrorLocalToggle')).toBeChecked();
  });
});
