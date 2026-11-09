// How much room the mascot's art actually uses inside his own window: samples the canvas alpha box for a couple of seconds and
// reports the highest and lowest drawn pixel. A hop that reaches row 0 is a hop cut off by the window's top edge.
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = Number(process.env.PORT) || 9373;
const list = async () => (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
async function waitFor(pred, ms = 30000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { const t = await list(); const hit = t.find(pred); if (hit) return hit; } catch (_) {}
    await sleep(300);
  }
  throw new Error('no target');
}
async function evaluator(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const w = new Map();
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); const q = w.get(m.id); if (!q) return; w.delete(m.id); m.error ? q.j(new Error(JSON.stringify(m.error))) : q.r(m.result); };
  return {
    ev: async (expression) => {
      const r = await new Promise((res, rej) => { const i = ++id; w.set(i, { r: res, j: rej }); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } })); });
      if (r.exceptionDetails) throw new Error('eval failed');
      return r.result ? r.result.value : r;
    },
    close: () => ws.close(),
  };
}

const mainTarget = await waitFor((t) => /index\.html/.test(t.url));
const main = await evaluator(mainTarget);
await main.ev(`(async () => { await window.api.petToggle(); return 1; })()`);
await sleep(1200);
await main.ev(`(async () => { await window.api.petApply({ petOn: true, petBubbles: false, petReduceMotion: false }); return 1; })()`);
const petTarget = await waitFor((t) => /pet\.html/.test(t.url));
const pet = await evaluator(petTarget);
await sleep(1200);

const box = await pet.ev(`(() => {
  const c = document.querySelector('#pet');
  return { w: c.width, h: c.height, cssW: c.clientWidth, cssH: c.clientHeight };
})()`);
console.log('canvas', JSON.stringify(box));

const sample = `(() => {
  const c = document.querySelector('#pet');
  const ctx = c.getContext('2d');
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let top = -1, bottom = -1, left = -1, right = -1;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      if (d[(y * c.width + x) * 4 + 3] > 8) {
        if (top < 0) top = y;
        bottom = y;
        if (left < 0 || x < left) left = x;
        if (x > right) right = x;
      }
    }
  }
  return { top, bottom, left, right, h: c.height, w: c.width, state: window.__petState || 'n/a' };
})()`;

let worst = null;
const seen = [];
for (let i = 0; i < 60; i++) {
  const r = await pet.ev(sample);
  seen.push(r.top);
  if (!worst || r.top < worst.top) worst = r;
  await sleep(120);
}
console.log('highest sample', JSON.stringify(worst));
console.log('top rows sampled', JSON.stringify(seen.slice(0, 30)));
main.close();
pet.close();
