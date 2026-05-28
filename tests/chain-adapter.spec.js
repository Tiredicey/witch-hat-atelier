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

  test('chain adapter (advanced JSON form) genuinely tries cloud first then falls back to local', async ({ page }) => {
    let githubCalls = 0;
    await page.route(/api\.github\.com/, async (route) => {
      githubCalls += 1;
      return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
    });
    await page.evaluate(() => localStorage.setItem('coda/settings', JSON.stringify({
      kind: 'chain',
      adapters: [
        { kind: 'github', token: 'ghp_x', owner: 'me', repo: 'coda-state', branch: 'main' },
        { kind: 'local' },
      ],
    })));
    await page.reload();
    await page.locator('.article-row').first().click();
    await page.locator('#starBtn').click();
    await page.waitForTimeout(200);
    // Before PR #14, loadSettings silently rejected kind:'chain' (not in
    // ADAPTER_KINDS) and fell back to local — so this assertion would have
    // been zero. It must be > 0 to prove the chain actually built.
    expect(githubCalls).toBeGreaterThan(0);
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

test.describe('Failover chain UI — Settings form (PR #14)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.reload();
  });

  async function gotoSettings(page) {
    await page.locator('#enterSettingsBtn').scrollIntoViewIfNeeded();
    await page.locator('#enterSettingsBtn').click();
    await expect(page.locator('#settingsPage')).toBeVisible();
  }

  test('picking "chain" reveals the chain fieldset with one slot by default', async ({ page }) => {
    await gotoSettings(page);
    await page.locator('#settingsKind').selectOption('chain');
    await expect(page.locator('#chainFieldset')).toBeVisible();
    await expect(page.locator('.chain-slot')).toHaveCount(1);
    await expect(page.locator('#chain-slot-1-kind')).toBeVisible();
    // Default first slot is local — no plaintext gate yet.
    await expect(page.locator('#plaintextGate')).toBeHidden();
  });

  test('add and remove buttons cap at 3 slots and bottom at 1', async ({ page }) => {
    await gotoSettings(page);
    await page.locator('#settingsKind').selectOption('chain');
    const addBtn = page.locator('.chain-add');

    await addBtn.click();
    await expect(page.locator('.chain-slot')).toHaveCount(2);
    await addBtn.click();
    await expect(page.locator('.chain-slot')).toHaveCount(3);
    await expect(addBtn).toBeHidden(); // capped at MAX_SLOTS

    // Remove slot 2 — slot 3 becomes slot 2; addBtn returns.
    await page.locator('.chain-slot[data-slot="2"] .chain-slot__remove').click();
    await expect(page.locator('.chain-slot')).toHaveCount(2);
    await expect(addBtn).toBeVisible();

    // Cannot remove slot 1 — no remove button on the primary.
    await expect(page.locator('.chain-slot[data-slot="1"] .chain-slot__remove')).toHaveCount(0);
  });

  test('save writes a valid chain config; reload hydrates the slots', async ({ page }) => {
    await gotoSettings(page);
    await page.locator('#settingsKind').selectOption('chain');

    // Slot 1: github, slot 2: local.
    await page.locator('#chain-slot-1-kind').selectOption('github');
    await page.locator('#chain-slot-1-github-token').fill('ghp_chainx');
    await page.locator('#chain-slot-1-github-owner').fill('me');
    await page.locator('#chain-slot-1-github-repo').fill('coda-state');

    await page.locator('.chain-add').click();
    await expect(page.locator('.chain-slot')).toHaveCount(2);
    // Slot 2 defaults to local.
    await expect(page.locator('#chain-slot-2-kind')).toHaveValue('local');

    // Plaintext gate is now visible because slot 1 is cloud.
    await expect(page.locator('#plaintextGate')).toBeVisible();
    await page.locator('#plaintextConfirm').fill('PLAINTEXT');
    await expect(page.locator('#saveSettingsBtn')).toBeEnabled();
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'load' }),
      page.locator('#saveSettingsBtn').click(),
    ]);
    await expect(page.locator('.app')).toBeVisible();
    // Wait for boot to complete by polling for a known late-bound listener
    // effect: any rail shelf click sets a numeric meta count. Cheaper:
    // wait for the article-list to render at least one row (post-store.load).
    await expect(page.locator('.article-row').first()).toBeVisible();

    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('coda/settings')));
    expect(stored.kind).toBe('chain');
    expect(stored.adapters).toHaveLength(2);
    expect(stored.adapters[0]).toMatchObject({ kind: 'github', token: 'ghp_chainx', owner: 'me', repo: 'coda-state', branch: 'main' });
    expect(stored.adapters[1]).toMatchObject({ kind: 'local' });

    // Revisiting Settings rehydrates the slots in order. Use a retrying
    // click — the enterSettingsBtn listener attaches at the tail of boot()
    // and the first click can land before it does.
    await expect(async () => {
      await page.locator('#enterSettingsBtn').scrollIntoViewIfNeeded();
      await page.locator('#enterSettingsBtn').click();
      await expect(page.locator('#settingsPage')).toBeVisible({ timeout: 500 });
    }).toPass({ timeout: 5000 });
    await expect(page.locator('#settingsKind')).toHaveValue('chain');
    await expect(page.locator('.chain-slot')).toHaveCount(2);
    await expect(page.locator('#chain-slot-1-kind')).toHaveValue('github');
    await expect(page.locator('#chain-slot-1-github-token')).toHaveValue('ghp_chainx');
    await expect(page.locator('#chain-slot-2-kind')).toHaveValue('local');
  });

  test('chain saved via UI survives reload and routes writes through the chain', async ({ page }) => {
    let githubCalls = 0;
    await page.route(/api\.github\.com/, async (route) => {
      githubCalls += 1;
      return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
    });

    await gotoSettings(page);
    await page.locator('#settingsKind').selectOption('chain');
    await page.locator('#chain-slot-1-kind').selectOption('github');
    await page.locator('#chain-slot-1-github-token').fill('ghp_chainx');
    await page.locator('#chain-slot-1-github-owner').fill('me');
    await page.locator('#chain-slot-1-github-repo').fill('coda-state');
    await page.locator('.chain-add').click();
    await page.locator('#plaintextConfirm').fill('PLAINTEXT');
    await page.locator('#saveSettingsBtn').click();
    await page.waitForLoadState('domcontentloaded');

    await page.locator('.article-row').first().click();
    await page.locator('#starBtn').click();
    await page.waitForTimeout(200);

    // Chain was actually built — primary cloud tried, local mirror caught it.
    expect(githubCalls).toBeGreaterThan(0);
    const localLog = await page.evaluate(() => localStorage.getItem('coda/v1/log.ndjson'));
    expect(localLog).toContain('item.star');
  });

  test('all-local chain skips the plaintext gate', async ({ page }) => {
    await gotoSettings(page);
    await page.locator('#settingsKind').selectOption('chain');
    await page.locator('.chain-add').click(); // 2 local slots
    await expect(page.locator('#plaintextGate')).toBeHidden();
    await expect(page.locator('#saveSettingsBtn')).toBeEnabled();
  });
});
