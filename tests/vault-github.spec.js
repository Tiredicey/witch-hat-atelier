import { test, expect } from '@playwright/test';

async function gotoSettings(page) {
  const btn = page.locator('#enterSettingsBtn');
  await btn.scrollIntoViewIfNeeded();
  await btn.click();
  await expect(page.locator('#settingsPage')).toBeVisible();
}

async function configureGithub(page) {
  await page.locator('#settingsKind').selectOption('github');
  await page.locator('#github-token').fill('ghp_testtoken');
  await page.locator('#github-owner').fill('me');
  await page.locator('#github-repo').fill('coda-state');
  await page.locator('#github-branch').fill('main');
  await page.locator('#plaintextConfirm').fill('PLAINTEXT');
  await expect(page.locator('#saveSettingsBtn')).toBeEnabled();
  await page.locator('#saveSettingsBtn').click();
}

async function enterVault(page) {
  const btn = page.locator('#enterVaultBtn');
  await btn.scrollIntoViewIfNeeded();
  await btn.click();
  await expect(page.locator('#vaultPage')).toBeVisible();
}

function contentsPath(url) {
  const m = url.match(/\/repos\/me\/coda-state\/contents\/([^?]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

async function installGithubContentsMock(page, { failPath = null, failStatus = 503 } = {}) {
  const state = { files: new Map(), shas: new Map(), seq: 0 };
  await page.route(/api\.github\.com/, async (route, request) => {
    const url = request.url();
    const method = request.method();
    if (method === 'GET' && !url.includes('/contents/')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ full_name: 'me/coda-state' }) });
    }
    const path = contentsPath(url);
    if (!path) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    if (failPath && path === failPath && method === 'GET') {
      return route.fulfill({ status: failStatus, contentType: 'application/json', body: '{"message":"Service unavailable"}' });
    }
    if (method === 'GET') {
      if (!state.files.has(path)) {
        return route.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"Not Found"}' });
      }
      const content = state.files.get(path);
      const sha = state.shas.get(path);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ path, sha, content, encoding: 'base64', size: Buffer.from(content, 'base64').length }),
      });
    }
    if (method === 'PUT') {
      const body = JSON.parse(request.postData() || '{}');
      state.seq += 1;
      const sha = `sha_${state.seq}`;
      state.files.set(path, body.content);
      state.shas.set(path, sha);
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ content: { path, sha } }) });
    }
    if (method === 'DELETE') {
      state.files.delete(path);
      state.shas.delete(path);
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"commit":{}}' });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  return state;
}

async function clearLocal(page) {
  await page.goto('/');
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();
    if (indexedDB.databases) {
      const dbs = await indexedDB.databases();
      for (const db of dbs) if (db.name) indexedDB.deleteDatabase(db.name);
    }
  });
  await page.reload();
}

test.describe('Vault \u2014 GitHub adapter round-trip (\u00a75 + \u00a718)', () => {
  test.beforeEach(async ({ page }) => {
    await clearLocal(page);
  });

  test('uploaded file survives a full reload via GitHub adapter', async ({ page }) => {
    const state = await installGithubContentsMock(page);
    await gotoSettings(page);
    await configureGithub(page);
    await page.waitForLoadState('networkidle');
    await enterVault(page);

    await page.locator('#vaultFileInput').setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('hello world from the vault'),
    });

    await expect(page.locator('.vault-row')).toHaveCount(1);
    await expect(page.locator('.vault-row--pending')).toHaveCount(0);

    expect([...state.files.keys()]).toContain('coda/vault/log.ndjson');
    expect([...state.files.keys()].some(k => k.startsWith('coda/vault/blobs/'))).toBe(true);

    await page.reload();
    await enterVault(page);
    await expect(page.locator('.vault-row')).toHaveCount(1);
    await expect(page.locator('.vault-row__name')).toContainText('notes.txt');
    await expect(page.locator('#vaultCap')).not.toHaveAttribute('data-error', 'true');
  });

  test('binary bytes round-trip through put/get blob without corruption', async ({ page }) => {
    await installGithubContentsMock(page);
    await gotoSettings(page);
    await configureGithub(page);
    await page.waitForLoadState('networkidle');
    await enterVault(page);

    const bytes = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x42, 0x10, 0x20, 0x30, 0x40]);
    await page.locator('#vaultFileInput').setInputFiles({
      name: 'raw.bin',
      mimeType: 'application/octet-stream',
      buffer: bytes,
    });
    await expect(page.locator('.vault-row')).toHaveCount(1);
    await expect(page.locator('.vault-row--pending')).toHaveCount(0);

    const dl = page.waitForEvent('download');
    await page.locator('.vault-row__name-btn').click();
    const d = await dl;
    const path = await d.path();
    const fs = await import('node:fs');
    const got = fs.readFileSync(path);
    expect([...got]).toEqual([...bytes]);
  });

  test('deleted file stays deleted after reload', async ({ page }) => {
    await installGithubContentsMock(page);
    await gotoSettings(page);
    await configureGithub(page);
    await page.waitForLoadState('networkidle');
    await enterVault(page);

    await page.locator('#vaultFileInput').setInputFiles({
      name: 'doomed.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('temp'),
    });
    await expect(page.locator('.vault-row')).toHaveCount(1);
    await expect(page.locator('.vault-row--pending')).toHaveCount(0);

    await page.locator('.vault-row__delete').click();
    await expect(page.locator('.vault-row')).toHaveCount(0);

    await page.reload();
    await enterVault(page);
    await expect(page.locator('.vault-row')).toHaveCount(0);
    await expect(page.locator('#vaultEmpty')).toBeVisible();
  });

  test('load error surfaces as a persistent banner in the vault cap', async ({ page }) => {
    const state = await installGithubContentsMock(page);
    await gotoSettings(page);
    await configureGithub(page);
    await page.waitForLoadState('networkidle');
    await enterVault(page);

    await page.locator('#vaultFileInput').setInputFiles({
      name: 'kept.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('persist me'),
    });
    await expect(page.locator('.vault-row')).toHaveCount(1);
    await expect(page.locator('.vault-row--pending')).toHaveCount(0);
    expect([...state.files.keys()]).toContain('coda/vault/log.ndjson');

    await page.unroute(/api\.github\.com/);
    await installGithubContentsMock(page, { failPath: 'coda/vault/log.ndjson', failStatus: 503 });

    await page.reload();
    await enterVault(page);
    const cap = page.locator('#vaultCap');
    await expect(cap).toHaveAttribute('data-error', 'true');
    await expect(cap).toContainText('Could not load saved files');
  });
});
