// chain-keyvalue.spec.js
//
// Tests for the generic read(key) / write(key, body) methods on ChainAdapter.
// These are the methods js/subscriptions.js calls when committing an imported
// OPML to coda/subs/subscriptions.json. Without them the OPML import path
// throws "this.adapter.write is not a function" for any user on the chain
// adapter, which is the default config for users who set up the failover
// chain in Settings (e.g. Local + GitHub mirror).
//
// Test surface:
//   1. read(key) failover \u2014 first usable adapter wins
//   2. write(key, body) mirror \u2014 every usable adapter that supports the
//      method receives the write
//   3. typeof guard \u2014 an adapter in the chain that lacks read / write
//      (TelegramAdapter shape today) is silently skipped, not crashed past
//   4. error path \u2014 a chain where NO adapter supports write surfaces a
//      clear error instead of "method is not a function"

import { test, expect } from '@playwright/test';

const MODULE_URL = '/js/adapters/chain.js';

test.describe('ChainAdapter \u2014 generic read/write', () => {
  test('read(key) returns the first successful adapter response', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async (moduleUrl) => {
      const { ChainAdapter } = await import(moduleUrl);
      const calls = [];
      const failing = {
        async read(k) { calls.push(['fail', k]); throw new Error('upstream down'); },
        async write(k, b) { calls.push(['fail-w', k]); },
      };
      const ok = {
        async read(k) { calls.push(['ok', k]); return `value-for-${k}`; },
        async write(k, b) { calls.push(['ok-w', k]); },
      };
      const adapter = new ChainAdapter({ chain: [failing, ok], labels: ['fail', 'ok'] });
      const v = await adapter.read('coda/subs/subscriptions.json');
      return { v, calls };
    }, MODULE_URL);
    expect(result.v).toBe('value-for-coda/subs/subscriptions.json');
    expect(result.calls).toEqual([
      ['fail', 'coda/subs/subscriptions.json'],
      ['ok',   'coda/subs/subscriptions.json'],
    ]);
  });

  test('write(key, body) mirrors to every usable adapter that supports write', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async (moduleUrl) => {
      const { ChainAdapter } = await import(moduleUrl);
      const writes = [];
      const a = { async read(){return null;}, async write(k,b){ writes.push(['a', k, b]); } };
      const b = { async read(){return null;}, async write(k,b){ writes.push(['b', k, b]); } };
      const c = { async read(){return null;}, async write(k,b){ writes.push(['c', k, b]); } };
      const adapter = new ChainAdapter({ chain: [a, b, c] });
      await adapter.write('coda/subs/subscriptions.json', '{"feeds":[]}');
      return writes.map(([label, k, body]) => ({ label, k, body }));
    }, MODULE_URL);
    expect(result).toHaveLength(3);
    for (const w of result) {
      expect(w.k).toBe('coda/subs/subscriptions.json');
      expect(w.body).toBe('{"feeds":[]}');
    }
    expect(result.map(w => w.label).sort()).toEqual(['a', 'b', 'c']);
  });

  test('adapter without read/write in the chain is skipped, not crashed past', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async (moduleUrl) => {
      const { ChainAdapter } = await import(moduleUrl);
      const writes = [];
      // Mimics TelegramAdapter today: only the event-log + snapshot methods,
      // no generic read(key) / write(key, body).
      const tg = {
        async readLog(){ return []; },
        async appendLog(){},
        async readSnapshot(){ return null; },
        async writeSnapshot(){},
        async clear(){},
      };
      const local = {
        async read(k){ return null; },
        async write(k, b){ writes.push(['local', k, b]); },
      };
      const adapter = new ChainAdapter({ chain: [tg, local], labels: ['telegram', 'local'] });
      // Should not throw; should write only to the local slot.
      await adapter.write('coda/subs/subscriptions.json', '{"feeds":[]}');
      // Read should also not throw, despite tg lacking read(key).
      const v = await adapter.read('coda/subs/subscriptions.json');
      return { writes, v };
    }, MODULE_URL);
    expect(result.writes).toEqual([
      ['local', 'coda/subs/subscriptions.json', '{"feeds":[]}'],
    ]);
    expect(result.v).toBeNull();
  });

  test('write throws a clear error when no chain member supports write', async ({ page }) => {
    await page.goto('/');
    const err = await page.evaluate(async (moduleUrl) => {
      const { ChainAdapter } = await import(moduleUrl);
      const tg = {
        async readLog(){ return []; },
        async appendLog(){},
        async readSnapshot(){ return null; },
        async writeSnapshot(){},
        async clear(){},
      };
      const adapter = new ChainAdapter({ chain: [tg], labels: ['telegram'] });
      try {
        await adapter.write('coda/subs/subscriptions.json', '{}');
        return null;
      } catch (e) {
        return e.message;
      }
    }, MODULE_URL);
    expect(err).toMatch(/no adapter in the chain supports write/);
  });
});

test.describe('ChainAdapter \u2014 readLog / readSnapshot poll-all (PR fix: starred orphans on chain)', () => {
  test('readLog prefers the populated mirror over an empty primary', async ({ page }) => {
    await page.goto('/');
    const got = await page.evaluate(async (moduleUrl) => {
      const { ChainAdapter } = await import(moduleUrl);
      const primary = { async readLog() { return []; } };
      const mirror  = { async readLog() { return [
        { t: 'item.star', itemId: 'https://a.example/x', on: true, at: 1 },
        { t: 'item.star', itemId: 'https://b.example/y', on: true, at: 2 },
      ]; } };
      const c = new ChainAdapter({ chain: [primary, mirror], labels: ['Primary', 'Mirror'] });
      return await c.readLog();
    }, '/js/adapters/chain.js');
    expect(got).toHaveLength(2);
    expect(got.map(e => e.itemId).sort()).toEqual([
      'https://a.example/x',
      'https://b.example/y',
    ]);
  });

  test('readLog returns the longer populated result when both adapters have events', async ({ page }) => {
    await page.goto('/');
    const got = await page.evaluate(async (moduleUrl) => {
      const { ChainAdapter } = await import(moduleUrl);
      const primary = { async readLog() { return [{ t: 'item.read', itemId: 'a' }]; } };
      const mirror  = { async readLog() { return [
        { t: 'item.read', itemId: 'a' },
        { t: 'item.star', itemId: 'b', on: true },
        { t: 'item.star', itemId: 'c', on: true },
      ]; } };
      const c = new ChainAdapter({ chain: [primary, mirror], labels: ['Primary', 'Mirror'] });
      return await c.readLog();
    }, '/js/adapters/chain.js');
    expect(got).toHaveLength(3);
  });

  test('readLog returns [] when all adapters return empty', async ({ page }) => {
    await page.goto('/');
    const got = await page.evaluate(async (moduleUrl) => {
      const { ChainAdapter } = await import(moduleUrl);
      const a = { async readLog() { return []; } };
      const b = { async readLog() { return []; } };
      const c = new ChainAdapter({ chain: [a, b], labels: ['A', 'B'] });
      return await c.readLog();
    }, '/js/adapters/chain.js');
    expect(got).toEqual([]);
  });

  test('readLog throws only when every adapter throws', async ({ page }) => {
    await page.goto('/');
    const got = await page.evaluate(async (moduleUrl) => {
      const { ChainAdapter } = await import(moduleUrl);
      const a = { async readLog() { throw new Error('a down'); } };
      const b = { async readLog() { return [{ t: 'item.read', itemId: 'x' }]; } };
      const c = new ChainAdapter({ chain: [a, b], labels: ['A', 'B'] });
      return await c.readLog();
    }, '/js/adapters/chain.js');
    expect(got).toHaveLength(1);
    expect(got[0].itemId).toBe('x');
  });

  test('readSnapshot prefers the most recently generated snapshot across adapters', async ({ page }) => {
    await page.goto('/');
    const got = await page.evaluate(async (moduleUrl) => {
      const { ChainAdapter } = await import(moduleUrl);
      const primary = { async readSnapshot() { return { version: 1, items: [], generated: 1000 }; } };
      const mirror  = { async readSnapshot() { return { version: 1, items: [{ id: 'x', starred: true }], generated: 9000 }; } };
      const c = new ChainAdapter({ chain: [primary, mirror], labels: ['Primary', 'Mirror'] });
      return await c.readSnapshot();
    }, '/js/adapters/chain.js');
    expect(got.generated).toBe(9000);
    expect(got.items).toHaveLength(1);
  });

  test('readSnapshot returns null when every adapter returns null', async ({ page }) => {
    await page.goto('/');
    const got = await page.evaluate(async (moduleUrl) => {
      const { ChainAdapter } = await import(moduleUrl);
      const a = { async readSnapshot() { return null; } };
      const b = { async readSnapshot() { return null; } };
      const c = new ChainAdapter({ chain: [a, b], labels: ['A', 'B'] });
      return await c.readSnapshot();
    }, '/js/adapters/chain.js');
    expect(got).toBeNull();
  });
});
