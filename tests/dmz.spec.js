import { test, expect } from '@playwright/test';

async function enterDmz(page) {
  const btn = page.locator('#enterDmzBtn');
  await btn.scrollIntoViewIfNeeded();
  await btn.click();
  await expect(page.locator('#dmzPage')).toBeVisible();
}

test.describe('DMZ — shared free space (§15)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.reload();
  });

  test('boots into the private reader by default', async ({ page }) => {
    await expect(page.locator('.app')).toBeVisible();
    await expect(page.locator('#dmzPage')).toBeHidden();
    await expect(page.locator('#enterDmzBtn')).toBeVisible();
  });

  test('rail DMZ button switches to the DMZ page in one click', async ({ page }) => {
    await enterDmz(page);
    await expect(page.locator('.app')).toBeHidden();
    await expect(page.locator('.dmz__title')).toHaveText('The DMZ');
    await expect(page.locator('.dmz__subtitle')).toContainText('unencrypted');
  });

  test('exit button returns to the reader in one click', async ({ page }) => {
    await enterDmz(page);
    await page.locator('#exitDmzBtn').click();
    await expect(page.locator('.app')).toBeVisible();
    await expect(page.locator('#dmzPage')).toBeHidden();
  });

  test('pinned board note persists across reload', async ({ page }) => {
    await enterDmz(page);
    await expect(page.locator('.dmz__empty')).toBeVisible();
    await page.locator('#dmzTextarea').fill('family movie night, saturday 8pm');
    await expect(page.locator('#dmzSubmit')).toBeEnabled();
    await page.locator('#dmzSubmit').click();
    await expect(page.locator('.dmz-note')).toHaveCount(1);
    await expect(page.locator('.dmz-note__body')).toContainText('movie night');

    await page.reload();
    await expect(page.locator('#dmzPage')).toBeVisible();
    await expect(page.locator('.dmz-note')).toHaveCount(1);
    await expect(page.locator('.dmz-note__body')).toContainText('movie night');
  });

  test('reader-view session is restored on reload when not in DMZ', async ({ page }) => {
    await expect(page.locator('.app')).toBeVisible();
    await page.reload();
    await expect(page.locator('.app')).toBeVisible();
    await expect(page.locator('#dmzPage')).toBeHidden();
  });

  test('DMZ board is isolated from private notes (§5 vs §15 storage paths)', async ({ page }) => {
    await page.locator('.article-row').first().click();
    await page.keyboard.press('n');
    await page.locator('#notesTextarea').fill('private: budget thoughts');
    await page.locator('#notesSave').click();
    await expect(page.locator('.note')).toHaveCount(1);

    await enterDmz(page);
    await expect(page.locator('.dmz__empty')).toBeVisible();
    await expect(page.locator('.dmz-note')).toHaveCount(0);

    await page.locator('#dmzTextarea').fill('public: holiday photo album link');
    await page.locator('#dmzSubmit').click();
    await expect(page.locator('.dmz-note')).toHaveCount(1);

    await page.locator('#exitDmzBtn').click();
    await expect(page.locator('.app')).toBeVisible();
    await expect(page.locator('.note')).toHaveCount(1);
    await expect(page.locator('.note__body')).toContainText('budget thoughts');
  });

  test('board notes can be removed individually and removal survives reload', async ({ page }) => {
    await enterDmz(page);
    for (const text of ['first', 'second', 'third']) {
      await page.locator('#dmzTextarea').fill(text);
      await page.locator('#dmzSubmit').click();
    }
    await expect(page.locator('.dmz-note')).toHaveCount(3);

    await page.locator('.dmz-note').first().locator('.dmz-note__delete').click();
    await expect(page.locator('.dmz-note')).toHaveCount(2);

    await page.reload();
    await expect(page.locator('#dmzPage')).toBeVisible();
    await expect(page.locator('.dmz-note')).toHaveCount(2);
  });

  test('storage keys are separate (coda/v1 for private, coda/dmz for board)', async ({ page }) => {
    await page.locator('.article-row').first().click();
    await page.keyboard.press('n');
    await page.locator('#notesTextarea').fill('private one');
    await page.locator('#notesSave').click();

    await enterDmz(page);
    await page.locator('#dmzTextarea').fill('board one');
    await page.locator('#dmzSubmit').click();

    const keys = await page.evaluate(() => Object.keys(localStorage).sort());
    expect(keys).toContain('coda/v1/log.ndjson');
    expect(keys).toContain('coda/dmz/log.ndjson');

    const privateLog = await page.evaluate(() => localStorage.getItem('coda/v1/log.ndjson'));
    const dmzLog     = await page.evaluate(() => localStorage.getItem('coda/dmz/log.ndjson'));
    expect(privateLog).toContain('private one');
    expect(privateLog).not.toContain('board one');
    expect(dmzLog).toContain('board one');
    expect(dmzLog).not.toContain('private one');
  });
});
