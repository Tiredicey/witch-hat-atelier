import { test, expect } from '@playwright/test';

test.describe('store persistence + notes (§5)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('star state persists across reload', async ({ page }) => {
    await page.locator('.article-row').first().click();
    const id = await page.locator('.article-row[aria-selected="true"]').getAttribute('data-id');
    await page.locator('#starBtn').click();
    await expect(page.locator('#starBtn')).toHaveAttribute('data-starred', 'true');
    await expect(page.locator(`.article-row[data-id="${id}"]`)).toHaveAttribute('data-starred', 'true');

    await page.reload();
    await expect(page.locator(`.article-row[data-id="${id}"]`)).toHaveAttribute('data-starred', 'true');
    await page.locator(`.article-row[data-id="${id}"]`).click();
    await expect(page.locator('#starBtn')).toHaveAttribute('data-starred', 'true');
  });

  test('read/unread state persists across reload', async ({ page }) => {
    await page.locator('.article-row').first().click();
    const id = await page.locator('.article-row[aria-selected="true"]').getAttribute('data-id');
    await page.locator('#markBtn').click();
    await expect(page.locator(`.article-row[data-id="${id}"]`)).toHaveAttribute('data-read', 'true');

    await page.reload();
    await expect(page.locator(`.article-row[data-id="${id}"]`)).toHaveAttribute('data-read', 'true');
  });

  test('n keystroke opens the notes form and saves a note that survives reload', async ({ page }) => {
    await page.locator('.article-row').first().click();
    const id = await page.locator('.article-row[aria-selected="true"]').getAttribute('data-id');

    await page.keyboard.press('n');
    await expect(page.locator('#notesPanel')).toHaveAttribute('data-open', 'true');
    await page.locator('#notesTextarea').fill('the §5 event log is the trust argument');
    await page.locator('#notesSave').click();

    await expect(page.locator('.note')).toHaveCount(1);
    await expect(page.locator('.note__body')).toContainText('§5 event log');

    await page.reload();
    await page.locator(`.article-row[data-id="${id}"]`).click();
    await expect(page.locator('.note')).toHaveCount(1);
    await expect(page.locator('.note__body')).toContainText('§5 event log');
  });

  test('multiple notes accumulate and can be deleted individually', async ({ page }) => {
    await page.locator('.article-row').first().click();

    await page.keyboard.press('n');
    await page.locator('#notesTextarea').fill('first note');
    await page.locator('#notesSave').click();

    await page.keyboard.press('n');
    await page.locator('#notesTextarea').fill('second note');
    await page.locator('#notesSave').click();

    await expect(page.locator('.note')).toHaveCount(2);

    await page.locator('.note').first().locator('.note__delete').click();
    await expect(page.locator('.note')).toHaveCount(1);

    await page.reload();
    await page.locator('.article-row').first().click();
    await expect(page.locator('.note')).toHaveCount(1);
  });

  test('Esc closes an open notes form without saving', async ({ page }) => {
    await page.locator('.article-row').first().click();
    await page.keyboard.press('n');
    await expect(page.locator('#notesPanel')).toHaveAttribute('data-open', 'true');
    await page.locator('#notesTextarea').fill('drafted but discarded');
    await page.keyboard.press('Escape');
    await expect(page.locator('#notesPanel')).toHaveAttribute('data-open', 'false');
    await expect(page.locator('.note')).toHaveCount(0);
  });

  test('switching articles binds notes to the new selection', async ({ page }) => {
    await page.locator('.article-row').first().click();
    await page.keyboard.press('n');
    await page.locator('#notesTextarea').fill('belongs to article 1');
    await page.locator('#notesSave').click();

    await page.keyboard.press('j');
    await expect(page.locator('.note')).toHaveCount(0);

    await page.keyboard.press('k');
    await expect(page.locator('.note')).toHaveCount(1);
    await expect(page.locator('.note__body')).toContainText('article 1');
  });
});
