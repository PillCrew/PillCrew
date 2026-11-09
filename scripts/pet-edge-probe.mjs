// Where the bubble really ends up when he is parked against an edge: it drags him there through the page's own channel and
// photographs BOTH windows, so a broken orientation is seen rather than argued about.
import { writeFileSync } from 'node:fs';
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
  const call = async (method, params) => {
    await ready;
    const myId = ++id;
    return new Promise((res, rej) => {
      waiters.set(myId, { res, rej });
      ws.send(JSON.stringify({ id: myId, method, params }));
    });
  };
  const ev = async (expression) => {
    const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    return r.result ? r.result.value : r;
  };
  const shot = async (file) => {
    const r = await call('Page.captureScreenshot', { format: 'png' });
    writeFileSync(file, Buffer.from(r.data, 'base64'));
  };
  return { ev, shot, close: () => ws.close() };
}

async function find(url) {
  const until = Date.now() + 40000;
  while (Date.now() < until) {
    try { const t = await (await list()); const hit = t.find((x) => url.test(x.url)); if (hit) return hit; } catch (_) {}
    await sleep(400);
  }
  throw new Error('no target for ' + url);
}

const main = rpc(await find(/index\.html/));
const before = await main.ev('(async () => await window.api.petState())()');
if (!before || !before.data || before.data.on !== true) await main.ev('(async () => await window.api.petToggle())()');
await new Promise((r) => setTimeout(r, 1500));
await main.ev("(async () => await window.api.petApply({ petBubbles: true, petQuestions: true, petDailyBrief: false, petHotAlerts: false, petSniper: false, petPillyPick: false, petPortfolioMood: false, petReduceMotion: false }))()");
const pet = rpc(await find(/pet\.html/));

async function carry(times, dx, dy) {
  await pet.ev('window.pilly.petDrag({ mode: "start" })');
  for (let i = 0; i < times; i++) {
    await pet.ev(`window.pilly.petDrag({ mode: "move", dx: ${dx}, dy: ${dy} })`);
    await sleep(20);
  }
  await pet.ev('window.pilly.petDrag({ mode: "end" })');
}

async function report(label) {
  const now = await pet.ev('({ x: window.screenX, y: window.screenY })');
  console.log(`${label}: pet right now at ${JSON.stringify(now)}`);
  const at = await pet.ev('({ x: window.screenX, y: window.screenY, w: window.innerWidth, h: window.innerHeight })');
  const pages = await list();
  const b = pages.find((x) => /bubble\.html/.test(x.url));
  if (!b) { console.log(`${label}: pet at ${JSON.stringify(at)}, NO bubble window`); return; }
  const bubble = rpc(b);
  const bp = await bubble.ev('({ x: window.screenX, y: window.screenY, w: window.innerWidth, h: window.innerHeight, cls: document.body.className, text: document.getElementById("bubble").textContent.slice(0, 40), rect: (() => { const r = document.getElementById("bubble").getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) }; })() })');
  console.log(`${label}: pet=${JSON.stringify(at)} bubble=${JSON.stringify(bp)}`);
  await bubble.shot(`.scratch-edge-${label}.png`);
  bubble.close();
}

// Left edge, middle height.
await carry(14, -60, 0);
await sleep(24000);
await report('left');
// Top-left corner.
await carry(14, 0, -60);
await sleep(24000);
await report('topleft');
// Right edge, lower half.
await carry(30, 60, 0);
await sleep(24000);
await report('right');
main.close();
pet.close();
