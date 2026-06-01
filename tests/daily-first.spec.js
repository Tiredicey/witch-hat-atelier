// daily-first.spec.js — ROADMAP §18.8, the first-clap-of-the-day ritual.
//
// Unit-tests DailyFirstRitual directly with fake collaborators (intel,
// adapter, history, voice), so the greet-and-speak behaviour is deterministic
// without the mic or speechSynthesis. Verifies:
//   - the first clap of a day greets, shows the saved briefing, and SPEAKS
//   - speaking is attempted even before consent is acked (speakAnswer drives
//     the consent prompt itself — the bug was the ritual pre-gating on it)
//   - a second clap the same day does not greet, but still opens the loop
//   - a new calendar day greets again
//   - with speak-answers off, it does not call speakAnswer

import { test, expect } from '@playwright/test';

async function runRitual(page) {
  return page.evaluate(async () => {
    const { DailyFirstRitual } = await import('/js/intelligence/daily-first.js');

    document.body.innerHTML = `
      <div id="mount"></div>
      <div id="greet" hidden><p id="greetText"></p><span id="greetStatus"></span></div>`;

    const makeIntel = (surfaces) => ({
      isEnabled: () => true,
      isSurfaceEnabled: (s) => !!surfaces[s],
      mountTarget: () => document.getElementById('mount'),
      subscribe: () => {},
      snapshot: () => ({ surfaces }),
      setSurfaceEnabled: () => {},
    });
    const adapter = (() => { let store = {}; return {
      read: async (k) => (k in store ? store[k] : null),
      write: async (k, v) => { store[k] = v; },
    }; })();
    const history = { latestBriefing: () => ({ text: 'Three unread on standards.' }) };

    const spoke = [];
    const voice = {
      isSpeakAnswersReady: () => true,
      speakAnswersConsented: () => false,
      speakAnswer: (t) => { spoke.push(t); return true; },
    };

    let loops = 0;
    let nowStr = '2026-06-01T10:00:00';
    const ritual = new DailyFirstRitual({
      intelligence: makeIntel({ 'clap-daily-first': true }),
      adapter, history, voice,
      getShelf: () => 'standards',
      onLoop: () => { loops += 1; },
      now: () => new Date(nowStr),
      wrapEl: document.getElementById('greet'),
      textEl: document.getElementById('greetText'),
      statusEl: document.getElementById('greetStatus'),
    });
    await ritual.init();

    const r1 = ritual.onClap();
    const after1 = {
      ret: r1, loops, spokeCount: spoke.length, lastSpoke: spoke[spoke.length - 1] || '',
      greetHidden: document.getElementById('greet').hidden,
      greetText: document.getElementById('greetText').textContent,
      status: document.getElementById('greetStatus').textContent,
    };

    const r2 = ritual.onClap();
    const after2 = { ret: r2, loops, spokeCount: spoke.length, greetHidden: document.getElementById('greet').hidden };

    nowStr = '2026-06-02T08:00:00';
    const r3 = ritual.onClap();
    const after3 = { ret: r3, spokeCount: spoke.length };

    // speak-answers off
    document.body.innerHTML += `<div id="g2" hidden><p id="t2"></p><span id="s2"></span></div>`;
    const spoke2 = [];
    const voiceOff = {
      isSpeakAnswersReady: () => false,
      speakAnswersConsented: () => false,
      speakAnswer: (t) => { spoke2.push(t); return true; },
    };
    const r2adapter = (() => { let s = {}; return { read: async (k) => (k in s ? s[k] : null), write: async (k, v) => { s[k] = v; } }; })();
    const ritualOff = new DailyFirstRitual({
      intelligence: makeIntel({ 'clap-daily-first': true }),
      adapter: r2adapter, history, voice: voiceOff,
      getShelf: () => 'all',
      onLoop: () => {},
      now: () => new Date('2026-06-01T10:00:00'),
      wrapEl: document.getElementById('g2'),
      textEl: document.getElementById('t2'),
      statusEl: document.getElementById('s2'),
    });
    await ritualOff.init();
    ritualOff.onClap();
    const off = { spokeCount: spoke2.length, status: document.getElementById('s2').textContent };

    return { after1, after2, after3, off };
  });
}

test.describe('daily-first clap ritual (§18.8)', () => {
  test('first clap greets and speaks; same day stays quiet; next day greets again', async ({ page }) => {
    await page.goto('/');
    const { after1, after2, after3, off } = await runRitual(page);

    // First clap: greets, opens the loop, speaks the greeting + briefing.
    expect(after1.ret).toBe(true);
    expect(after1.loops).toBe(1);
    expect(after1.greetHidden).toBe(false);
    expect(after1.greetText).toContain('Three unread on standards.');
    expect(after1.spokeCount).toBe(1);
    expect(after1.lastSpoke).toContain('Three unread on standards.');
    // Spoke even though consent was not pre-acked (the fix).
    expect(after1.status).toContain('Confirm');

    // Second clap same day: no new greeting/speech, loop still opens.
    expect(after2.ret).toBe(false);
    expect(after2.loops).toBe(2);
    expect(after2.spokeCount).toBe(1);
    expect(after2.greetHidden).toBe(true);

    // New calendar day: greets and speaks again.
    expect(after3.ret).toBe(true);
    expect(after3.spokeCount).toBe(2);

    // Speak-answers off: never calls speakAnswer.
    expect(off.spokeCount).toBe(0);
    expect(off.status).toContain('Speak answers aloud');
  });
});
