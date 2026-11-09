// Photographs the panels the owner is testing, so a layout that is broken is seen rather than guessed at.
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
const shot = async (file) => {
  const r = await call('Page.captureScreenshot', { format: 'png' });
  writeFileSync(file, Buffer.from(r.data, 'base64'));
};

await call('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
await ev('document.querySelector("#nav [data-tab=chat]").click()');
await sleep(700);
await ev('document.querySelector("#tab-chat").scrollIntoView({ block: "start" })');
await shot('.scratch-ui-chat.png');
await ev('document.querySelector("#nav [data-tab=settings]").click()');
await sleep(700);
await ev('document.querySelector("#petCard").scrollIntoView({ block: "start" })');
await sleep(300);
await shot('.scratch-ui-pet.png');
await ev('document.querySelector("#petCard").scrollIntoView({ block: "end" })');
await sleep(300);
await shot('.scratch-ui-pet2.png');
await ev('document.querySelector("#nav [data-tab=crew]").click()');
await sleep(900);
await shot('.scratch-ui-crew.png');
console.log('shots taken');
ws.close();
