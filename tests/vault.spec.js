import { test, expect } from '@playwright/test';
import fs from 'node:fs';

async function clearAll(page) {
  await page.goto('/');
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();
    if (indexedDB.databases) {
      const dbs = await indexedDB.databases();
      for (const db of dbs) if (db.name) indexedDB.deleteDatabase(db.name);
    } else {
      indexedDB.deleteDatabase('coda-blobs');
    }
  });
  await page.reload();
}

async function enterVault(page) {
  const btn = page.locator('#enterVaultBtn');
  await btn.scrollIntoViewIfNeeded();
  await btn.click();
  await expect(page.locator('#vaultPage')).toBeVisible();
}

test.describe('Vault — file storage (§18)', () => {
  test.beforeEach(async ({ page }) => {
    await clearAll(page);
  });

  test('rail button switches to the vault page in one click', async ({ page }) => {
    await enterVault(page);
    await expect(page.locator('.vault__title')).toHaveText('The Vault');
    await expect(page.locator('.vault__subtitle')).toContainText('any type');
  });

  test('empty state visible on first entry', async ({ page }) => {
    await enterVault(page);
    await expect(page.locator('#vaultEmpty')).toBeVisible();
    await expect(page.locator('.vault-row')).toHaveCount(0);
  });

  test('uploading via the input shows the row and persists across reload', async ({ page }) => {
    await enterVault(page);
    await page.locator('#vaultFileInput').setInputFiles({
      name: 'hello.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('hello vault'),
    });
    await expect(page.locator('.vault-row')).toHaveCount(1);
    await expect(page.locator('.vault-row__name').first()).toContainText('hello.txt');
    await expect(page.locator('#vaultEmpty')).toBeHidden();

    await page.reload();
    await page.locator('#enterVaultBtn').click();
    await expect(page.locator('.vault-row')).toHaveCount(1);
    await expect(page.locator('.vault-row__name').first()).toContainText('hello.txt');
  });

  test('multiple file types upload and surface their content-type pill', async ({ page }) => {
    await enterVault(page);
    await page.locator('#vaultFileInput').setInputFiles([
      { name: 'note.md',   mimeType: 'text/markdown',          buffer: Buffer.from('# hi') },
      { name: 'data.json', mimeType: 'application/json',       buffer: Buffer.from('{}') },
      { name: 'photo.bin', mimeType: 'application/octet-stream', buffer: Buffer.from([0,1,2,3]) },
    ]);
    await expect(page.locator('.vault-row')).toHaveCount(3);
    const types = await page.locator('.vault-row__type').allTextContents();
    expect(types.length).toBe(3);
    expect(types).toContain('markdown');
    expect(types).toContain('json');
    expect(types).toContain('octet-stream');
  });

  test('delete removes a file and the removal survives reload', async ({ page }) => {
    await enterVault(page);
    await page.locator('#vaultFileInput').setInputFiles({
      name: 'temp.txt', mimeType: 'text/plain', buffer: Buffer.from('x'),
    });
    await expect(page.locator('.vault-row')).toHaveCount(1);
    await page.locator('.vault-row__delete').click();
    await expect(page.locator('.vault-row')).toHaveCount(0);
    await page.reload();
    await page.locator('#enterVaultBtn').click();
    await expect(page.locator('.vault-row')).toHaveCount(0);
    await expect(page.locator('#vaultEmpty')).toBeVisible();
  });

  test('exit button returns to the reader in one click', async ({ page }) => {
    await enterVault(page);
    await page.locator('#exitVaultBtn').click();
    await expect(page.locator('.app')).toBeVisible();
    await expect(page.locator('#vaultPage')).toBeHidden();
  });

  test('storage keys are isolated from reader (coda/v1) and DMZ (coda/dmz)', async ({ page }) => {
    await enterVault(page);
    await page.locator('#vaultFileInput').setInputFiles({
      name: 'iso.txt', mimeType: 'text/plain', buffer: Buffer.from('iso'),
    });
    await expect(page.locator('.vault-row')).toHaveCount(1);
    const keys = await page.evaluate(() => Object.keys(localStorage).sort());
    expect(keys).toContain('coda/vault/log.ndjson');
    expect(keys).not.toContain('coda/v1/log.ndjson');
    expect(keys).not.toContain('coda/dmz/log.ndjson');
  });

  test('downloading a file fetches the blob from IndexedDB and matches the original bytes', async ({ page }, testInfo) => {
    await enterVault(page);
    const payload = 'round trip ok ' + testInfo.project.name;
    await page.locator('#vaultFileInput').setInputFiles({
      name: 'download-me.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(payload),
    });
    await expect(page.locator('.vault-row')).toHaveCount(1);

    const downloadPromise = page.waitForEvent('download');
    await page.locator('.vault-row__name-btn').click();
    const dl = await downloadPromise;
    expect(dl.suggestedFilename()).toBe('download-me.txt');
    const path = await dl.path();
    const got = fs.readFileSync(path, 'utf8');
    expect(got).toBe(payload);
  });

  test('over-cap file is refused with a calm inline message', async ({ page }) => {
    await enterVault(page);
    await page.evaluate(() => {
      const input = document.getElementById('vaultFileInput');
      const dt = new DataTransfer();
      const big = new File([new Uint8Array(101 * 1024 * 1024)], 'huge.bin', { type: 'application/octet-stream' });
      dt.items.add(big);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('#vaultCap[data-error="true"]')).toBeVisible();
    await expect(page.locator('#vaultCap')).toContainText('exceeds the 100 MB ceiling');
    await expect(page.locator('.vault-row')).toHaveCount(0);
  });
});
