// The four edges, one at a time: drag him there, hold him still, wait for a bubble and check where it landed and which way its
// tail points. Prints a line per edge; anything off the screen or pointing the wrong way shows up here.
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
const st = await main.ev('(async () => await window.api.petState())()');
if (!st || !st.data || st.data.on !== true) await main.ev('(async () => await window.api.petToggle())()');
await main.ev("(async () => await window.api.petApply({ petBubbles: true, petQuestions: true, petDailyBrief: false, petHotAlerts: false, petSniper: false, petPillyPick: false, petPortfolioMood: false, petReduceMotion: true, petBubbleStyle: 'neon', petSize: 'md' }))()");
const pet = rpc(await find(/pet\.html/));

async function carryTo(dx, dy, steps) {
  await pet.ev('window.pilly.petDrag({ mode: "start" })');
  for (let i = 0; i < steps; i++) {
    await pet.ev(`window.pilly.petDrag({ mode: "move", dx: ${dx}, dy: ${dy} })`);
    await sleep(15);
  }
  await pet.ev('window.pilly.petDrag({ mode: "end" })');
}

async function inspect(label) {
  const at = await pet.ev('({ x: window.screenX, y: window.screenY, w: window.innerWidth, h: window.innerHeight })');
  const pages = await list();
  const b = pages.find((x) => /bubble\.html/.test(x.url));
  if (!b) return console.log(`${label}: pet=${JSON.stringify(at)} no bubble window`);
  const bubble = rpc(b);
  const s = await bubble.ev('({ x: window.screenX, y: window.screenY, w: window.innerWidth, h: window.innerHeight, cls: document.body.className, shown: document.getElementById("bubble").classList.contains("show"), rect: (() => { const r = document.getElementById("bubble").getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) }; })() })');
  bubble.close();
  const sw = await main.ev('({ w: screen.availWidth, h: screen.availHeight })');
  const off = s.x < 0 || s.y < 0 || s.x + s.w > sw.w || s.y + s.h > sw.h;
  const overPet = !(s.x + s.rect.r < at.x || s.x + s.rect.l > at.x + at.w);
  console.log(`${label}: pet=${JSON.stringify(at)} bubble=${JSON.stringify({ x: s.x, y: s.y, cls: s.cls, shown: s.shown, rect: s.rect })} ${off ? 'OFF-SCREEN' : 'on screen'}${overPet ? ' (over him horizontally, expected for above/below)' : ''}`);
}

await carryTo(-90, 0, 30);   // hard left
await sleep(23000);
await inspect('left edge');
await carryTo(0, -90, 30);   // top
await sleep(23000);
await inspect('top edge');
await carryTo(90, 0, 40);    // hard right
await sleep(23000);
await inspect('right edge');
await carryTo(0, 90, 30);    // bottom
await sleep(23000);
await inspect('bottom edge');
main.close();
pet.close();
