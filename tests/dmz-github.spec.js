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

async function enterDmz(page) {
  const btn = page.locator('#enterDmzBtn');
  await btn.scrollIntoViewIfNeeded();
  await btn.click();
  await expect(page.locator('#dmzPage')).toBeVisible();
}

function contentsPath(url) {
  const m = url.match(/\/repos\/me\/coda-state\/contents\/([^?]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

async function installGithubContentsMock(page) {
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

test.describe('DMZ \u2014 GitHub adapter cross-device sync (\u00a75 + \u00a715)', () => {
  test.beforeEach(async ({ page }) => {
    await clearLocal(page);
  });

  test('note posted on GitHub adapter survives a full reload', async ({ page }) => {
    const state = await installGithubContentsMock(page);
    await gotoSettings(page);
    await configureGithub(page);
    await page.waitForLoadState('networkidle');
    await enterDmz(page);

    await page.locator('#dmzTextarea').fill('family movie night, saturday 8pm');
    await page.locator('#dmzSubmit').click();
    await expect(page.locator('.dmz-note')).toHaveCount(1);
    await expect(page.locator('.dmz-note__body')).toContainText('movie night');

    expect([...state.files.keys()]).toContain('coda/dmz/log.ndjson');

    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#dmzPage')).toBeVisible();
    await expect(page.locator('.dmz-note')).toHaveCount(1);
    await expect(page.locator('.dmz-note__body')).toContainText('movie night');
  });

  test('second device reading the same coda/dmz log sees the first device\u2019s notes', async ({ context }) => {
    const deviceA = await context.newPage();
    const stateA = await installGithubContentsMock(deviceA);
    await clearLocal(deviceA);
    await gotoSettings(deviceA);
    await configureGithub(deviceA);
    await deviceA.waitForLoadState('networkidle');
    await enterDmz(deviceA);
    await deviceA.locator('#dmzTextarea').fill('grocery list: oat milk, lemons');
    await deviceA.locator('#dmzSubmit').click();
    await expect(deviceA.locator('.dmz-note')).toHaveCount(1);
    expect([...stateA.files.keys()]).toContain('coda/dmz/log.ndjson');

    const sharedLog = stateA.files.get('coda/dmz/log.ndjson');
    const sharedSha = stateA.shas.get('coda/dmz/log.ndjson');

    const deviceB = await context.newPage();
    await deviceB.route(/api\.github\.com/, async (route, request) => {
      const url = request.url();
      const method = request.method();
      if (method === 'GET' && !url.includes('/contents/')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ full_name: 'me/coda-state' }) });
      }
      const path = contentsPath(url);
      if (method === 'GET' && path === 'coda/dmz/log.ndjson') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ path, sha: sharedSha, content: sharedLog, encoding: 'base64', size: Buffer.from(sharedLog, 'base64').length }),
        });
      }
      if (method === 'GET') {
        return route.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"Not Found"}' });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await deviceB.goto('/');
    await deviceB.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem('coda/settings', JSON.stringify({ kind: 'github', token: 'ghp_testtoken', owner: 'me', repo: 'coda-state', branch: 'main' }));
    });
    await deviceB.reload();
    await deviceB.locator('#enterDmzBtn').click();
    await expect(deviceB.locator('#dmzPage')).toBeVisible();
    await expect(deviceB.locator('.dmz-note')).toHaveCount(1);
    await expect(deviceB.locator('.dmz-note__body')).toContainText('oat milk');
  });

  test('LocalAdapter shows "stored on this device only" status', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.reload();
    await enterDmz(page);
    const status = page.locator('#dmzStatus');
    await expect(status).toContainText('Stored on this device only');
    await expect(status).not.toHaveAttribute('data-error', 'true');
  });

  test('GitHub adapter shows "synced to your GitHub repository" status', async ({ page }) => {
    await installGithubContentsMock(page);
    await gotoSettings(page);
    await configureGithub(page);
    await page.waitForLoadState('networkidle');
    await enterDmz(page);
    const status = page.locator('#dmzStatus');
    await expect(status).toContainText('Synced to your GitHub repository');
    await expect(status).not.toHaveAttribute('data-error', 'true');
  });

  test('load failure on reload surfaces as a persistent error banner', async ({ page }) => {
    const state = await installGithubContentsMock(page);
    await gotoSettings(page);
    await configureGithub(page);
    await page.waitForLoadState('networkidle');
    await enterDmz(page);
    await page.locator('#dmzTextarea').fill('keep this around');
    await page.locator('#dmzSubmit').click();
    await expect(page.locator('.dmz-note')).toHaveCount(1);
    expect([...state.files.keys()]).toContain('coda/dmz/log.ndjson');

    await page.unroute(/api\.github\.com/);
    await page.route(/api\.github\.com/, async (route, request) => {
      const url = request.url();
      if (url.includes('/contents/coda/dmz/log.ndjson')) {
        return route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"Service unavailable"}' });
      }
      if (request.method() === 'GET' && !url.includes('/contents/')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ full_name: 'me/coda-state' }) });
      }
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"Not Found"}' });
    });

    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#dmzPage')).toBeVisible();
    const status = page.locator('#dmzStatus');
    await expect(status).toHaveAttribute('data-error', 'true');
    await expect(status).toContainText('Could not load shared notes');
  });
});
