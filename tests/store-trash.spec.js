// store-trash.spec.js — trashing an article (event-log store).
//
// Unit-tests the trashed state in js/store.js: materialise applies
// item.trash / item.untrash, the flag is independent of read/starred, and
// Store.toggleTrashed round-trips through an in-memory adapter.

import { test, expect } from '@playwright/test';

test.describe('store: article trash', () => {
  test('materialise applies trash and untrash without touching read/starred', async ({ page }) => {
    await page.goto('/');
    const out = await page.evaluate(async () => {
      const { materialise } = await import('/js/store.js');
      const s1 = materialise(null, [
        { t: 'item.trash', itemId: 'x' },
        { t: 'item.read', itemId: 'x' },
        { t: 'item.star', itemId: 'x', on: true },
      ]);
      const a = s1.items.find(i => i.id === 'x');
      const s2 = materialise(s1, [{ t: 'item.untrash', itemId: 'x' }]);
      const b = s2.items.find(i => i.id === 'x');
      return { a: { trashed: a.trashed, read: a.read, starred: a.starred }, b: { trashed: b.trashed, read: b.read, starred: b.starred } };
    });
    expect(out.a).toEqual({ trashed: true, read: true, starred: true });
    expect(out.b).toEqual({ trashed: false, read: true, starred: true });
  });

  test('Store.toggleTrashed round-trips and persists an event', async ({ page }) => {
    await page.goto('/');
    const out = await page.evaluate(async () => {
      const { Store } = await import('/js/store.js');
      const log = [];
      const adapter = {
        readSnapshot: async () => null,
        readLog: async () => [],
        appendLog: async (evs) => { for (const e of evs) log.push(e); },
        writeSnapshot: async () => {},
      };
      const s = new Store({ adapter });
      const before = s.isTrashed('a1');
      await s.toggleTrashed('a1');
      const mid = s.isTrashed('a1');
      await s.toggleTrashed('a1');
      const after = s.isTrashed('a1');
      return { before, mid, after, events: log.map(e => e.t) };
    });
    expect(out.before).toBe(false);
    expect(out.mid).toBe(true);
    expect(out.after).toBe(false);
    expect(out.events).toEqual(['item.trash', 'item.untrash']);
  });
});
