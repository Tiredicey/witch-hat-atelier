import { test, expect } from '@playwright/test';

const BOT_TOKEN = '12345:test-token';
const CHAT_ID   = '-1001234567890';

async function gotoSettings(page) {
  await page.locator('#enterSettingsBtn').scrollIntoViewIfNeeded();
  await page.locator('#enterSettingsBtn').click();
  await expect(page.locator('#settingsPage')).toBeVisible();
}

async function saveTelegram(page, { token, chatId }) {
  await page.locator('#settingsKind').selectOption('telegram');
  await page.locator('#telegram-token').fill(token);
  await page.locator('#telegram-chatId').fill(chatId);
  await page.locator('#plaintextConfirm').fill('PLAINTEXT');
  await expect(page.locator('#saveSettingsBtn')).toBeEnabled();
  await page.locator('#saveSettingsBtn').click();
}

function installTelegramMock(page) {
  const state = { manifestMsgId: null, manifestText: null, sentDocs: [], requests: [] };
  page.route(/api\.telegram\.org\/bot[^/]+\/(\w+)/, async (route, request) => {
    const url = new URL(request.url());
    const method = url.pathname.split('/').pop();
    state.requests.push({ method, body: request.postData(), url: request.url() });
    if (method === 'getMe') {
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, result: { id: 1, is_bot: true, username: 'coda_bot' } }) });
    }
    if (method === 'getChat') {
      const pinned = state.manifestMsgId
        ? { message_id: state.manifestMsgId, text: state.manifestText }
        : undefined;
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, result: { id: -100, type: 'channel', pinned_message: pinned } }) });
    }
    if (method === 'sendDocument') {
      const id = state.sentDocs.length + 1;
      const fileId = `BAACAgQAAxk-DOC${id}`;
      state.sentDocs.push({ id, fileId, body: request.postData() });
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, result: {
          message_id: 100 + id,
          document: { file_id: fileId, file_unique_id: `u${id}`, file_size: 50 },
        } }) });
    }
    if (method === 'sendMessage') {
      const body = JSON.parse(request.postData() || '{}');
      state.manifestMsgId = 999;
      state.manifestText = body.text;
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, result: { message_id: 999, text: body.text } }) });
    }
    if (method === 'pinChatMessage') {
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, result: true }) });
    }
    if (method === 'editMessageText') {
      const body = JSON.parse(request.postData() || '{}');
      state.manifestText = body.text;
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, result: { message_id: state.manifestMsgId, text: body.text } }) });
    }
    if (method === 'getFile') {
      const body = JSON.parse(request.postData() || '{}');
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, result: { file_id: body.file_id, file_path: `documents/${body.file_id}.dat` } }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"result":true}' });
  });
  page.route(/api\.telegram\.org\/file\/bot/, async (route, request) => {
    const url = new URL(request.url());
    const fileId = url.pathname.split('/').pop().split('.')[0];
    const doc = state.sentDocs.find(d => d.fileId.startsWith(fileId) || fileId.includes(d.fileId));
    const target = doc || state.sentDocs[state.sentDocs.length - 1];
    const body = target ? extractDocumentBody(target.body || '') : '';
    return route.fulfill({ status: 200, contentType: 'application/octet-stream', body });
  });
  return state;
}

function extractDocumentBody(multipart) {
  if (!multipart) return '';
  const m = multipart.match(/name="document"[^]*?\r\n\r\n([^]*?)\r\n--/);
  return m ? m[1] : '';
}

const STARS_FIXTURE = JSON.stringify({
  items: [{
    id: 'tag:example.com,2026:imported-from-telegram-cache',
    title: 'Cached star survives reload',
    canonical: [{ href: 'https://example.com/imported-keep-me' }],
    categories: ['user/-/state/com.google/starred'],
    timestampUsec: '1730000000000000',
  }],
});

test.describe('telegram bot storage adapter (§5 + 2026 unlimited-file path)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.reload();
  });

  test('appendLog uploads document via sendDocument and creates pinned manifest on first write', async ({ page }) => {
    const state = installTelegramMock(page);
    await gotoSettings(page);
    await saveTelegram(page, { token: BOT_TOKEN, chatId: CHAT_ID });

    await page.locator('.article-row').first().click();
    await page.locator('#starBtn').click();

    await expect.poll(() => state.requests.filter(r => r.method === 'sendDocument').length).toBeGreaterThan(0);
    const sendDoc = state.requests.find(r => r.method === 'sendDocument');
    expect(sendDoc.url).toContain(`/bot${BOT_TOKEN}/sendDocument`);
    expect(sendDoc.body).toContain('item.star');
    expect(sendDoc.body).toContain(`name="chat_id"\r\n\r\n${CHAT_ID}`);

    await expect.poll(() => state.requests.filter(r => r.method === 'sendMessage').length).toBeGreaterThan(0);
    await expect.poll(() => state.requests.filter(r => r.method === 'pinChatMessage').length).toBeGreaterThan(0);
    const manifest = JSON.parse(state.manifestText);
    expect(manifest.coda).toBe('coda/v1');
    expect(manifest.log.fileId).toMatch(/^BAACAgQAAxk-DOC/);
  });

  test('subsequent appendLog edits the existing pinned manifest instead of pinning again', async ({ page }) => {
    const state = installTelegramMock(page);
    await gotoSettings(page);
    await saveTelegram(page, { token: BOT_TOKEN, chatId: CHAT_ID });

    await page.locator('.article-row').first().click();
    await page.locator('#starBtn').click();
    await expect.poll(() => state.requests.filter(r => r.method === 'pinChatMessage').length).toBe(1);

    await page.locator('#starBtn').click();
    await expect.poll(() => state.requests.filter(r => r.method === 'sendDocument').length).toBeGreaterThanOrEqual(2);
    await expect.poll(() => state.requests.filter(r => r.method === 'editMessageText').length).toBeGreaterThan(0);
    expect(state.requests.filter(r => r.method === 'pinChatMessage').length).toBe(1);
  });

  test('Test connection: getMe ok + getChat ok reports green', async ({ page }) => {
    installTelegramMock(page);
    await gotoSettings(page);
    await page.locator('#settingsKind').selectOption('telegram');
    await page.locator('#telegram-token').fill(BOT_TOKEN);
    await page.locator('#telegram-chatId').fill(CHAT_ID);
    await expect(page.locator('#testSettingsBtn')).toBeEnabled();
    await page.locator('#testSettingsBtn').click();
    await expect(page.locator('#settingsTestOutput')).toHaveAttribute('data-status', 'ok');
  });

  test('Test connection: 401 on getMe is surfaced as auth rejected', async ({ page }) => {
    await page.route(/api\.telegram\.org\/bot/, async (route) => route.fulfill({
      status: 401, contentType: 'application/json',
      body: JSON.stringify({ ok: false, error_code: 401, description: 'Unauthorized' }),
    }));
    await gotoSettings(page);
    await page.locator('#settingsKind').selectOption('telegram');
    await page.locator('#telegram-token').fill('bad');
    await page.locator('#telegram-chatId').fill(CHAT_ID);
    await page.locator('#testSettingsBtn').click();
    await expect(page.locator('#settingsTestOutput')).toHaveAttribute('data-status', 'fail');
    await expect(page.locator('#settingsTestOutput')).toContainText('auth rejected');
  });

  test('Test connection: getMe ok but getChat 400 reports chat-not-found', async ({ page }) => {
    await page.route(/api\.telegram\.org\/bot[^/]+\/getMe/, async (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, result: { id: 1, is_bot: true, username: 'b' } }),
    }));
    await page.route(/api\.telegram\.org\/bot[^/]+\/getChat/, async (route) => route.fulfill({
      status: 400, contentType: 'application/json',
      body: JSON.stringify({ ok: false, error_code: 400, description: 'chat not found' }),
    }));
    await gotoSettings(page);
    await page.locator('#settingsKind').selectOption('telegram');
    await page.locator('#telegram-token').fill(BOT_TOKEN);
    await page.locator('#telegram-chatId').fill('@missing');
    await page.locator('#testSettingsBtn').click();
    await expect(page.locator('#settingsTestOutput')).toHaveAttribute('data-status', 'fail');
    await expect(page.locator('#settingsTestOutput')).toContainText('chat not found');
  });

  test('imported stars survive reload when getChat returns 400 (manifest cache fallback)', async ({ page }) => {
    const state = installTelegramMock(page);
    await gotoSettings(page);
    await saveTelegram(page, { token: BOT_TOKEN, chatId: CHAT_ID });
    await expect(page.locator('.article-row').first()).toBeVisible();
    await gotoSettings(page);

    await page.setInputFiles('#inoreader-stars-file', {
      name: 'stars.json',
      mimeType: 'application/json',
      buffer: Buffer.from(STARS_FIXTURE),
    });
    await expect(page.locator('#inoreader-stars-status')).toHaveAttribute('data-status', 'ok');
    await expect.poll(() => state.requests.filter(r => r.method === 'sendDocument').length).toBeGreaterThan(0);
    await expect.poll(() => state.requests.filter(r => r.method === 'pinChatMessage').length).toBe(1);

    const cacheKey = `coda/telegram-manifest/coda/v1/${CHAT_ID}`;
    const cached = await page.evaluate(k => localStorage.getItem(k), cacheKey);
    expect(cached).toBeTruthy();
    const parsed = JSON.parse(cached);
    expect(parsed.manifestMsgId).toBe(999);
    expect(parsed.log && parsed.log.fileId).toMatch(/^BAACAgQAAxk-DOC/);

    await page.unroute(/api\.telegram\.org\/bot[^/]+\/(\w+)/);
    await page.unroute(/api\.telegram\.org\/file\/bot/);
    await page.route(/api\.telegram\.org\/bot[^/]+\/getChat/, route => route.fulfill({
      status: 400, contentType: 'application/json',
      body: JSON.stringify({ ok: false, error_code: 400, description: 'chat not found' }),
    }));
    await page.route(/api\.telegram\.org\/bot[^/]+\/getMe/, route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, result: { id: 1, is_bot: true, username: 'b' } }),
    }));
    await page.route(/api\.telegram\.org\/bot[^/]+\/getFile/, async (route, request) => {
      const body = JSON.parse(request.postData() || '{}');
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, result: { file_id: body.file_id, file_path: `documents/${body.file_id}.dat` } }) });
    });
    await page.route(/api\.telegram\.org\/file\/bot[^/]+\/documents\/(.+)\.dat/, async (route, request) => {
      const url = new URL(request.url());
      const fileId = url.pathname.split('/').pop().split('.')[0];
      const doc = state.sentDocs.find(d => d.fileId.startsWith(fileId) || fileId.includes(d.fileId)) || state.sentDocs[state.sentDocs.length - 1];
      const body = doc ? extractDocumentBody(doc.body || '') : '';
      return route.fulfill({ status: 200, contentType: 'application/octet-stream', body });
    });

    await page.reload();
    await expect(page.locator('.article-row').first()).toBeVisible();
    await page.locator('.shelf[data-shelf="starred"]').click();
    await expect(page.locator('.article-row[data-orphan="true"]').first()).toBeVisible();
    await expect(page.locator('.article-row[data-orphan="true"]').first()).toContainText('Cached star survives reload');
  });

  test('first-time star import surfaces chat-misconfig error when getChat 400 and no cache exists', async ({ page }) => {
    await page.route(/api\.telegram\.org\/bot[^/]+\/getMe/, route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, result: { id: 1, is_bot: true, username: 'b' } }),
    }));
    await page.route(/api\.telegram\.org\/bot[^/]+\/getChat/, route => route.fulfill({
      status: 400, contentType: 'application/json',
      body: JSON.stringify({ ok: false, error_code: 400, description: 'chat not found' }),
    }));
    await gotoSettings(page);
    await saveTelegram(page, { token: BOT_TOKEN, chatId: '99999' });
    await expect(page.locator('.article-row').first()).toBeVisible();
    await gotoSettings(page);

    await page.setInputFiles('#inoreader-stars-file', {
      name: 'stars.json',
      mimeType: 'application/json',
      buffer: Buffer.from(STARS_FIXTURE),
    });
    await expect(page.locator('#inoreader-stars-status')).toHaveAttribute('data-status', 'fail', { timeout: 10000 });
    await expect(page.locator('#inoreader-stars-status')).toContainText(/-100/);
  });
});
