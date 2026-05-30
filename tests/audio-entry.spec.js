// audio-entry.spec.js — audio enclosure rendering (prerequisite for §17.2 / §18 transcription).
//
// The worker already parses RSS/Atom enclosures into entry.enclosure. These
// specs cover the client surfacing: a list badge on audio entries and an
// <audio> player in the reader pane, with no badge or player on text entries.

import { test, expect } from '@playwright/test';

const AUDIO_TITLE = 'Audio entry: a silent demo clip';
const TEXT_TITLE = 'Web Feeds in 2026: a quieter conclusion';

test.describe('audio entries', () => {
  test('an audio entry shows the Audio badge in the list', async ({ page }) => {
    await page.goto('/');
    const row = page.locator('.article-row', { hasText: AUDIO_TITLE });
    await expect(row).toBeVisible();
    const badge = row.locator('.article-row__badge');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('Audio');
  });

  test('a text entry shows no Audio badge', async ({ page }) => {
    await page.goto('/');
    const row = page.locator('.article-row', { hasText: TEXT_TITLE });
    await expect(row.locator('.article-row__badge')).toBeHidden();
  });

  test('opening an audio entry renders a player in the reader', async ({ page }) => {
    await page.goto('/');
    await page.locator('.article-row', { hasText: AUDIO_TITLE }).click();
    await expect(page.locator('.reader article h1')).toHaveText(AUDIO_TITLE);
    const audio = page.locator('.reader article audio.reader__audio');
    await expect(audio).toHaveCount(1);
    await expect(audio).toHaveAttribute('src', /^data:audio\/wav/);
    await expect(audio).toHaveAttribute('controls', '');
  });

  test('opening a text entry renders no player', async ({ page }) => {
    await page.goto('/');
    await page.locator('.article-row', { hasText: TEXT_TITLE }).click();
    await expect(page.locator('.reader article h1')).toHaveText(TEXT_TITLE);
    await expect(page.locator('.reader article audio')).toHaveCount(0);
  });
});
