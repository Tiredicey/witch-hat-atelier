// voice-loop.spec.js — ROADMAP §18.3 rung 7 / §18.2.13 (hands-free loop).
//
// The loop auto-sends a transcribed question and the answer is spoken. Tests:
// VoiceIO routes a transcript to onLoopQuestion (auto-send) only when the loop
// surface is on, else to onDictation (review); and CopilotSurface.submitQuestion
// actually fires the provider (auto-send), unlike fillQuestion.

import { test, expect } from '@playwright/test';

async function runVoice(page, { loop }) {
  return page.evaluate(async (loop) => {
    const { VoiceIO } = await import('/js/intelligence/voice.js');
    document.body.innerHTML = `
      <div id="mount"></div>
      <div id="wrap" hidden><button id="read"></button><button id="mic"></button><span id="status"></span>
        <div id="disc" hidden><span id="dtext"></span><button id="ok"></button><button id="no"></button></div></div>`;
    const surfaces = { 'voice-ondevice-stt': true };
    if (loop) surfaces['voice-loop'] = true;
    const intel = {
      isEnabled: () => true,
      isSurfaceEnabled: (s) => !!surfaces[s],
      setSurfaceEnabled: (s, v) => { surfaces[s] = v; },
      mountTarget: () => document.getElementById('mount'),
      snapshot: () => ({ surfaces }),
      subscribe: () => {},
    };
    const log = { loop: [], dictation: [] };
    let onResult = null;
    const whisperFactory = (o) => { onResult = o.onResult; return { start: async () => true, stop: async () => { onResult('what is the latest on the bill'); }, abort: () => {} }; };
    const v = new VoiceIO({
      intelligence: intel, reader: { currentArticle: null }, whisperFactory,
      onLoopQuestion: (t) => { log.loop.push(t); return true; },
      onDictation: (t) => { log.dictation.push(t); return true; },
      wrapEl: document.getElementById('wrap'), readBtn: document.getElementById('read'), micBtn: document.getElementById('mic'),
      statusEl: document.getElementById('status'), disclosureEl: document.getElementById('disc'),
      disclosureTextEl: document.getElementById('dtext'), confirmBtn: document.getElementById('ok'), cancelBtn: document.getElementById('no'),
    });
    void v;
    const mic = document.getElementById('mic');
    mic.click();                       // disclosure
    document.getElementById('ok').click();  // confirm -> start
    await new Promise(r => setTimeout(r, 20));
    mic.click();                       // stop -> transcript
    await new Promise(r => setTimeout(r, 20));
    return log;
  }, loop);
}

test.describe('hands-free voice loop (§18.2.13)', () => {
  test('with the loop on, a transcript auto-sends (onLoopQuestion), not review', async ({ page }) => {
    await page.goto('/');
    const log = await runVoice(page, { loop: true });
    expect(log.loop).toEqual(['what is the latest on the bill']);
    expect(log.dictation).toEqual([]);
  });

  test('with the loop off, a transcript fills for review (onDictation)', async ({ page }) => {
    await page.goto('/');
    const log = await runVoice(page, { loop: false });
    expect(log.dictation).toEqual(['what is the latest on the bill']);
    expect(log.loop).toEqual([]);
  });

  test('CopilotSurface.submitQuestion auto-sends to the provider', async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(async () => {
      const { CopilotSurface } = await import('/js/intelligence/copilot-surface.js');
      const { GROQ_PROVIDER } = await import('/js/intelligence/groq.js');
      const { ackDisclosure } = await import('/js/intelligence/index.js');
      document.body.innerHTML = `<div id="c" hidden><span id="sc"></span>
        <form id="f"><input id="i"><button id="s" type="submit">x</button></form>
        <div id="d" hidden><span id="dt"></span><button id="ok"></button><button id="no"></button></div>
        <button id="t"></button><div id="l" hidden></div></div>`;
      const sent = [];
      const answers = [];
      const fetchImpl = async (u, init) => { sent.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ model: 'm', choices: [{ message: { content: 'Spoken answer.' } }] }), text: async () => '' }; };
      const intel = { isEnabled: () => true, isSurfaceEnabled: () => true, getProviderKey: () => 'k', subscribe: () => {} };
      const cop = new CopilotSurface({
        intelligence: intel, reader: { currentArticle: { id: 'a', title: 'T', source: 's', body: ['Body.'] } }, providers: [GROQ_PROVIDER],
        getUnread: () => [], getShelf: () => 'all', fetchImpl, onAnswer: (t) => answers.push(t),
        wrapEl: document.getElementById('c'), scopeEl: document.getElementById('sc'),
        formEl: document.getElementById('f'), inputEl: document.getElementById('i'), sendBtn: document.getElementById('s'),
        statusEl: document.createElement('span'), logEl: document.getElementById('l'), toggleBtn: document.getElementById('t'),
        disclosureEl: document.getElementById('d'), disclosureTextEl: document.getElementById('dt'),
        confirmBtn: document.getElementById('ok'), cancelBtn: document.getElementById('no'),
      });
      ackDisclosure(GROQ_PROVIDER.hostname);
      const ret = cop.submitQuestion('summarise the day for me');
      for (let k = 0; k < 50; k++) { await new Promise(r => setTimeout(r, 10)); if (sent.length) break; }
      return { ret, sentCount: sent.length, question: sent[0] ? sent[0].messages.map(m => m.content).join('\n') : '', answers };
    });
    expect(r.ret).toBe(true);
    expect(r.sentCount).toBe(1);
    expect(r.question).toContain('summarise the day for me');
    expect(r.answers).toEqual(['Spoken answer.']);
  });

  test('startTurn begins a listen turn when an STT is ready, and no-ops without one', async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(async () => {
      const { VoiceIO } = await import('/js/intelligence/voice.js');
      const { ackDisclosure } = await import('/js/intelligence/index.js');
      ackDisclosure('voice-ondevice-stt');
      document.body.innerHTML = `
        <div id="mount"></div>
        <div id="wrap" hidden><button id="read"></button><button id="mic"></button><span id="status"></span>
          <div id="disc" hidden><span id="dtext"></span><button id="ok"></button><button id="no"></button></div></div>`;
      const surfaces = { 'voice-ondevice-stt': true, 'voice-loop': true };
      const intel = {
        isEnabled: () => true, isSurfaceEnabled: (s) => !!surfaces[s], setSurfaceEnabled: (s, v) => { surfaces[s] = v; },
        mountTarget: () => document.getElementById('mount'), snapshot: () => ({ surfaces }), subscribe: () => {},
      };
      let starts = 0;
      const whisperFactory = () => ({ start: async () => { starts += 1; return true; }, stop: async () => {}, abort: () => {} });
      const make = (intelObj) => new VoiceIO({
        intelligence: intelObj, reader: { currentArticle: null }, whisperFactory,
        wrapEl: document.getElementById('wrap'), readBtn: document.getElementById('read'), micBtn: document.getElementById('mic'),
        statusEl: document.getElementById('status'), disclosureEl: document.getElementById('disc'),
        disclosureTextEl: document.getElementById('dtext'), confirmBtn: document.getElementById('ok'), cancelBtn: document.getElementById('no'),
      });

      const v = make(intel);
      const ret = v.startTurn();
      await new Promise(r => setTimeout(r, 20));

      const offSurfaces = {};
      const offIntel = { isEnabled: () => true, isSurfaceEnabled: (s) => !!offSurfaces[s], setSurfaceEnabled: () => {}, mountTarget: () => document.getElementById('mount'), snapshot: () => ({ surfaces: offSurfaces }), subscribe: () => {} };
      const vOff = make(offIntel);
      const retOff = vOff.startTurn();

      return { ret, starts, retOff };
    });
    expect(r.ret).toBe(true);
    expect(r.starts).toBe(1);
    expect(r.retOff).toBe(false);
  });
});
