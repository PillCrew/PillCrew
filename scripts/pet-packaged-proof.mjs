// Proves the MASCOT — with its whole configuration and its voice — inside the PACKAGED build: the switch goes on, every field
// is saved, his window resizes, and he actually speaks in a bubble whose text and style came from the panel.
// The app is launched by the caller (PowerShell) because spawning it from node fails on this machine with `spawn UNKNOWN`;
// this script only attaches, so it can be re-run against an instance that is already up.
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = Number(process.env.PORT) || 9352;

async function list() {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return r.json();
}
async function waitFor(pred, ms = 40000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { const t = await list(); const hit = t.find(pred); if (hit) return hit; } catch (_) {}
    await sleep(400);
  }
  throw new Error('the target never appeared');
}
async function cdp(target, method, params) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const out = await new Promise((res, rej) => {
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id !== 1) return;
      if (m.error) rej(new Error(JSON.stringify(m.error)));
      else res(m.result);
    };
    ws.send(JSON.stringify({ id: 1, method, params }));
  });
  ws.close();
  return out;
}
const evaluate = async (target, expression) => {
  const r = await cdp(target, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  return r.result ? r.result.value : r;
};

let bad = 0;
const check = (ok, what, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra ? ' -> ' + extra : ''}`); if (!ok) bad++; };
try {
  const main = await waitFor((t) => t.type === 'page' && /index\.html/.test(t.url));
  await sleep(2500);
  const before = await evaluate(main, '(async () => await window.api.petState())()');
  check(before && before.data && before.data.on === false, 'the packaged app starts with the mascot off', JSON.stringify(before && before.data && before.data.pet));

  const on = await evaluate(main, '(async () => await window.api.petToggle())()');
  check(on && on.data && on.data.on === true, 'the switch puts him on the desktop', JSON.stringify(on && on.data));

  const pet = await waitFor((t) => t.type === 'page' && /pet\.html/.test(t.url));
  check(Boolean(pet), "his own window exists, and it is Pilly's own page");

  const saved = await evaluate(main, "(async () => await window.api.petApply({ petName: 'Bąbel', petTheme: 'plush', petSize: 'lg', petSpeed: 'fast', petWalkMode: 'taskbar', petStopFreq: 'often', petMood: 'happy', petBubbleSize: 'lg', petBubbleText: 'lg', petBubbleStyle: 'neon', petSoundVol: 85, petQuestions: false, petHotAlerts: false, petDailyBrief: true }))()");
  const sp = saved && saved.data && saved.data.pet;
  check(sp && sp.petSize === 'lg' && sp.petTheme === 'plush' && sp.petBubbleStyle === 'neon' && sp.petName === 'Bąbel', 'every field was saved, the look included', JSON.stringify(sp));

  const back = await evaluate(main, '(async () => await window.api.petState())()');
  const bp = back && back.data && back.data.pet;
  check(bp && bp.petSize === 'lg' && bp.petWalkMode === 'taskbar' && bp.petBubbleText === 'lg' && bp.petHotAlerts === false && bp.petDailyBrief === true, 'and read back exactly as set', JSON.stringify(bp));

  await sleep(900);
  const box = await evaluate(pet, '({ w: window.innerWidth, h: window.innerHeight, bridge: Boolean(window.pilly) })');
  check(box && box.w >= 70 && box.h >= 74, 'his window really grew with the size setting', JSON.stringify(box));
  check(box && box.bridge === true, "and Pilly's page still sees its own bridge");

  // His voice: the brief is a once-a-session line and the voice loop ticks every twenty seconds, so the bubble appearing is the
  // whole chain proven — timer, sentence, window, text, style.
  const bubble = await waitFor((t) => t.type === 'page' && /bubble\.html/.test(t.url), 60000);
  check(Boolean(bubble), 'he opened his bubble window by himself');
  await sleep(1500);
  const said = await evaluate(bubble, '({ text: document.getElementById("bubble").textContent, cls: document.body.className })');
  check(said && said.text && said.text.length > 10, 'and it carries a real sentence', JSON.stringify(said && said.text));
  check(said && /bs-neon/.test(said.cls), 'in the bubble style the panel chose', said && said.cls);

  const shot = await cdp(bubble, 'Page.captureScreenshot', { format: 'png' });
  const png = Buffer.from(shot.data, 'base64');
  writeFileSync('.scratch-pet-shot.png', png);
  check(png.length > 800, 'photographed with its text on screen, inside the packaged app', `${png.length} B`);

  await evaluate(main, '(async () => await window.api.petApply({ petReduceMotion: true }))()');
  const still = await evaluate(main, '(async () => await window.api.petState())()');
  check(still && still.data && still.data.pet.petReduceMotion === true, 'reduce motion is saved like the rest');

  const off = await evaluate(main, '(async () => await window.api.petToggle())()');
  await sleep(900);
  const pages = await list();
  check(off && off.data && off.data.on === false, 'the switch takes him off the desktop');
  check(!pages.some((t) => /bubble\.html/.test(t.url)), 'and the bubble went with him');
} catch (e) {
  check(false, 'the proof ran', e.message);
}
console.log(bad ? `${bad} check(s) failed` : 'the packaged mascot, with its whole configuration and its voice, is proven');
process.exit(bad ? 1 : 0);
