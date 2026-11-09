// A clip screenshot of one element, after scrolling whatever ancestor actually scrolls. `scrollIntoView` alone did nothing here.
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = Number(process.env.PORT) || 9361;
const list = async () => (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = (await list()).find((t) => /index\.html/.test(t.url));
const ws = new WebSocket(page.webSocketDebuggerUrl);
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
  return new Promise((res, rej) => { waiters.set(myId, { res, rej }); ws.send(JSON.stringify({ id: myId, method, params })); });
};
const ev = async (expression) => {
  const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  return r.result ? r.result.value : r;
};

const target = process.env.SELECTOR || '#petCard';
const file = process.env.OUT || '.scratch-clip.png';
await call('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
const info = await ev(`(() => {
  const el = document.querySelector(${JSON.stringify(target)});
  if (!el) return { error: 'not found' };
  el.scrollIntoView({ block: 'start' });
  let p = el.parentElement, scrolled = [];
  while (p) { if (p.scrollHeight > p.clientHeight + 4) { scrolled.push(p.tagName + '.' + p.className); } p = p.parentElement; }
  const r = el.getBoundingClientRect();
  return { top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height), scrolled };
})()`);
await sleep(400);
const info2 = await ev(`(() => { const r = document.querySelector(${JSON.stringify(target)}).getBoundingClientRect(); return { top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) }; })()`);
console.log(JSON.stringify({ first: info, after: info2 }));
const clip = { x: Math.max(0, info2.left), y: Math.max(0, info2.top), width: Math.min(info2.w, 1400), height: Math.min(info2.h, 900), scale: 1 };
const r = await call('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: true });
writeFileSync(file, Buffer.from(r.data, 'base64'));
console.log('wrote ' + file + ' from ' + JSON.stringify(clip));
ws.close();
