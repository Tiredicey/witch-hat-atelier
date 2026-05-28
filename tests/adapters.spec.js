import { test, expect } from '@playwright/test';

async function gotoSettings(page) {
  const btn = page.locator('#enterSettingsBtn');
  await btn.scrollIntoViewIfNeeded();
  await btn.click();
  await expect(page.locator('#settingsPage')).toBeVisible();
}

async function configure(page, kind, fields) {
  await page.locator('#settingsKind').selectOption(kind);
  for (const [id, value] of Object.entries(fields)) {
    await page.locator(`#${id}`).fill(value);
  }
  await page.locator('#plaintextConfirm').fill('PLAINTEXT');
  await expect(page.locator('#saveSettingsBtn')).toBeEnabled();
  await page.locator('#saveSettingsBtn').click();
}

test.describe('storage adapters + settings page (§5 + §8.2)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.reload();
  });

  test('boots into local adapter by default and settings shelf opens the page', async ({ page }) => {
    await gotoSettings(page);
    await expect(page.locator('#settingsActiveBanner')).toContainText('Local');
    await expect(page.locator('#settingsKind')).toHaveValue('local');
    await expect(page.locator('#plaintextGate')).toBeHidden();
    await expect(page.locator('#testSettingsBtn')).toBeDisabled();
  });

  test('exit button returns to reader in one click', async ({ page }) => {
    await gotoSettings(page);
    await page.locator('#exitSettingsBtn').click();
    await expect(page.locator('.app')).toBeVisible();
    await expect(page.locator('#settingsPage')).toBeHidden();
  });

  test('plaintext gate blocks save for cloud adapters until acknowledged', async ({ page }) => {
    await gotoSettings(page);
    await page.locator('#settingsKind').selectOption('webdav');
    await page.locator('#webdav-url').fill('https://nx.example.com/dav');
    await expect(page.locator('#saveSettingsBtn')).toBeDisabled();
    await page.locator('#plaintextConfirm').fill('plaintext');
    await expect(page.locator('#saveSettingsBtn')).toBeDisabled();
    await page.locator('#plaintextConfirm').fill('PLAINTEXT');
    await expect(page.locator('#saveSettingsBtn')).toBeEnabled();
    await page.locator('#plaintextConfirm').fill('');
    await expect(page.locator('#saveSettingsBtn')).toBeDisabled();
  });

  test('WebDAV adapter persists events to the configured server', async ({ page }) => {
    const requests = [];
    await page.route('**/nx.example.com/**', async (route, request) => {
      requests.push({
        method: request.method(),
        url: request.url(),
        body: request.postData(),
        headers: request.headers(),
      });
      const m = request.method();
      if (m === 'GET' || m === 'HEAD') return route.fulfill({ status: 404 });
      return route.fulfill({ status: 201 });
    });

    await gotoSettings(page);
    await configure(page, 'webdav', {
      'webdav-url': 'https://nx.example.com/remote.php/dav/files/me',
      'webdav-username': 'me',
      'webdav-password': 'app-token',
    });

    await page.locator('.article-row').first().click();
    await page.locator('#starBtn').click();

    await expect.poll(() => requests.filter(r => r.method === 'PUT').length).toBeGreaterThan(0);
    const put = requests.find(r => r.method === 'PUT');
    expect(put.url).toContain('/coda/v1/log.ndjson');
    expect(put.headers['authorization']).toMatch(/^Basic /);
    expect(put.body).toContain('item.star');
  });

  test('S3 adapter signs requests with AWS SigV4', async ({ page }) => {
    const requests = [];
    await page.route('**/r2.example.com/**', async (route, request) => {
      requests.push({
        method: request.method(),
        url: request.url(),
        body: request.postData(),
        headers: request.headers(),
      });
      const m = request.method();
      if (m === 'GET' || m === 'HEAD') return route.fulfill({ status: 404 });
      return route.fulfill({ status: 200 });
    });

    await gotoSettings(page);
    await configure(page, 's3', {
      's3-endpoint': 'https://r2.example.com',
      's3-accessKey': 'AKIAEXAMPLE',
      's3-secretKey': 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      's3-bucket': 'coda-test',
    });

    await page.locator('.article-row').first().click();
    await page.locator('#starBtn').click();

    await expect.poll(() => requests.filter(r => r.method === 'PUT').length).toBeGreaterThan(0);
    const put = requests.find(r => r.method === 'PUT');
    expect(put.url).toBe('https://r2.example.com/coda-test/coda/v1/log.ndjson');
    expect(put.headers['authorization']).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\//);
    expect(put.headers['authorization']).toContain('SignedHeaders=host;x-amz-content-sha256;x-amz-date');
    expect(put.headers['authorization']).toMatch(/Signature=[0-9a-f]{64}$/);
    expect(put.headers['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/);
    expect(put.headers['x-amz-content-sha256']).toMatch(/^[0-9a-f]{64}$/);
  });

  test('Dropbox adapter uploads via content API with Bearer token', async ({ page }) => {
    const requests = [];
    await page.route(/dropboxapi\.com/, async (route, request) => {
      requests.push({
        method: request.method(),
        url: request.url(),
        body: request.postData(),
        headers: request.headers(),
      });
      if (request.url().includes('files/download')) return route.fulfill({ status: 409 });
      if (request.url().includes('check/user')) {
        return route.fulfill({ status: 200, body: '{"result":"ping"}', contentType: 'application/json' });
      }
      return route.fulfill({ status: 200 });
    });

    await gotoSettings(page);
    await configure(page, 'dropbox', {
      'dropbox-token': 'sl.testtoken',
    });

    await page.locator('.article-row').first().click();
    await page.locator('#starBtn').click();

    await expect.poll(() => requests.filter(r => r.url.includes('files/upload')).length).toBeGreaterThan(0);
    const upload = requests.find(r => r.url.includes('files/upload'));
    expect(upload.headers['authorization']).toBe('Bearer sl.testtoken');
    expect(upload.headers['dropbox-api-arg']).toContain('"path":"/Apps/CODA/coda/v1/log.ndjson"');
    expect(upload.body).toContain('item.star');
  });

  test('Test connection runs adapter.test() and surfaces the result', async ({ page }) => {
    await page.route('**/nx.example.com/**', async (route) => route.fulfill({ status: 404 }));

    await gotoSettings(page);
    await page.locator('#settingsKind').selectOption('webdav');
    await page.locator('#webdav-url').fill('https://nx.example.com/dav');
    await expect(page.locator('#testSettingsBtn')).toBeEnabled();
    await page.locator('#testSettingsBtn').click();
    await expect(page.locator('#settingsTestOutput')).toHaveAttribute('data-status', 'ok');
    await expect(page.locator('#settingsTestOutput')).toContainText('ok');
  });

  test('Test connection surfaces auth rejection', async ({ page }) => {
    await page.route('**/nx.example.com/**', async (route) => route.fulfill({ status: 401 }));

    await gotoSettings(page);
    await page.locator('#settingsKind').selectOption('webdav');
    await page.locator('#webdav-url').fill('https://nx.example.com/dav');
    await page.locator('#testSettingsBtn').click();
    await expect(page.locator('#settingsTestOutput')).toHaveAttribute('data-status', 'fail');
    await expect(page.locator('#settingsTestOutput')).toContainText('auth rejected');
  });

  test('Reset to local clears saved settings and reloads', async ({ page }) => {
    await page.evaluate(() => localStorage.setItem('coda/settings', JSON.stringify({
      kind: 'webdav', url: 'https://nx.example.com/dav', username: 'u', password: 'p',
    })));
    await page.reload();
    await gotoSettings(page);
    await expect(page.locator('#settingsActiveBanner')).toContainText('WebDAV');
    await page.locator('#resetSettingsBtn').click();
    await page.waitForLoadState('domcontentloaded');
    const stored = await page.evaluate(() => localStorage.getItem('coda/settings'));
    expect(stored).toBeNull();
  });

  test('Boot falls back to local if cloud config is invalid', async ({ page }) => {
    await page.evaluate(() => localStorage.setItem('coda/settings', JSON.stringify({
      kind: 'webdav',
    })));
    await page.reload();
    await expect(page.locator('.app')).toBeVisible();
    await page.locator('.article-row').first().click();
    await page.locator('#starBtn').click();
    const localLog = await page.evaluate(() => localStorage.getItem('coda/v1/log.ndjson'));
    expect(localLog).toContain('item.star');
  });
});
