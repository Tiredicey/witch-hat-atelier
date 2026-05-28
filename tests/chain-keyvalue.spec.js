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
