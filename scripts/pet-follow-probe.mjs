// Does the bubble actually travel with him? Samples both windows while a bubble is up, and prints the screen metrics the clamp
// uses, so a stale anchor and a wrong work area are told apart.
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = Number(process.env.PORT) || 9361;
const list = async () => (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();

function rpc(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const waiters = new Map();
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    const w = waiters.get(m.id);
    if (!w) return;
    waiters.delete(m.id);
    m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result);
  };
  const ev = async (expression) => {
    await ready;
    const myId = ++id;
    return new Promise((res, rej) => {
      waiters.set(myId, { res: (r) => res(r.result ? r.result.value : r), rej });
      ws.send(JSON.stringify({ id: myId, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
    });
  };
  return { ev, close: () => ws.close() };
}
async function find(url) {
  const until = Date.now() + 30000;
  while (Date.now() < until) {
    try { const t = await list(); const hit = t.find((x) => url.test(x.url)); if (hit) return hit; } catch (_) {}
    await sleep(300);
  }
  throw new Error('no target');
}

const main = rpc(await find(/index\.html/));
console.log('screen:', JSON.stringify(await main.ev('({ availW: screen.availWidth, availH: screen.availHeight, w: screen.width, h: screen.height, dpr: devicePixelRatio })')));
const before = await main.ev('(async () => await window.api.petState())()');
if (!before || !before.data || before.data.on !== true) await main.ev('(async () => await window.api.petToggle())()');
await main.ev("(async () => await window.api.petApply({ petBubbles: true, petQuestions: true, petDailyBrief: true }))()");
const pet = rpc(await find(/pet\.html/));
let bubbleTarget = null;
const samples = [];
for (let i = 0; i < 140; i++) {
  const p = await pet.ev('({ x: window.screenX, y: window.screenY })');
  if (!bubbleTarget) {
    const pages = await list();
    bubbleTarget = pages.find((x) => /bubble\.html/.test(x.url)) || null;
  }
  if (bubbleTarget) {
    const b = rpc(bubbleTarget);
    const s = await b.ev('({ x: window.screenX, y: window.screenY, w: window.innerWidth, h: window.innerHeight, shown: document.getElementById("bubble").classList.contains("show"), text: document.getElementById("bubble").textContent.slice(0, 24) })');
    b.close();
    samples.push({ pet: p, bubble: s });
  } else {
    samples.push({ pet: p, bubble: null });
  }
  await sleep(250);
}
const shown = samples.filter((s) => s.bubble && s.bubble.shown);
console.log('samples:', samples.length, 'with a bubble showing:', shown.length);
if (shown.length) {
  const first = shown[0];
  const last = shown[shown.length - 1];
  console.log('first shown:', JSON.stringify(first));
  console.log('last shown :', JSON.stringify(last));
  const petMoved = Math.abs(last.pet.x - first.pet.x);
  const bubbleMoved = Math.abs(last.bubble.x - first.bubble.x);
  console.log(`pet moved ${petMoved}px, bubble followed ${bubbleMoved}px`);
  const offscreen = shown.filter((s) => s.bubble.x + s.bubble.w > samples[0].bubble ? 0 : 0);
  const bad = shown.filter((s) => s.bubble.x < -4 || s.bubble.y < -4);
  console.log('samples with the bubble off the screen:', bad.length);
} else {
  console.log('no bubble was visible in the window sampled — the tick may not be firing');
}
main.close();
pet.close();
