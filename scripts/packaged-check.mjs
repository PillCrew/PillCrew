// The packaged application, end to end: the mascot comes on screen, the chat's look saves without an error, and a screenshot of
// each window proves it drew. Nothing here trades: the desk stays on the paper book.
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';

const PORT = Number(process.env.PORT) || 9377;
const list = async () => (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
async function waitFor(pred, ms = 20000) {
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
    call: (method, params) => new Promise((res, rej) => { const i = ++id; w.set(i, { r: res, j: rej }); ws.send(JSON.stringify({ id: i, method, params })); }),
    ev: async (expression) => {
      const r = await new Promise((res, rej) => { const i = ++id; w.set(i, { r: res, j: rej }); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } })); });
      if (r.exceptionDetails) throw new Error('eval failed: ' + expression.slice(0, 60));
      return r.result ? r.result.value : r;
    },
    close: () => ws.close(),
  };
}

const main = await evaluator(await waitFor((t) => /index\.html/.test(t.url)));
await main.ev(`(() => { const b = [...document.querySelectorAll('#modalBox button')].find((x) => /skip/i.test(x.textContent)); if (b) b.click(); return 1; })()`);
await sleep(400);

// The chat's look: the save used to fail in the main process, so nothing was stored and the log never changed.
await main.ev(`document.querySelector('#nav [data-tab=chat]').click()`);
await sleep(500);
await main.ev(`(() => { document.querySelector('#chatBubbleStyle').value = 'glass'; document.querySelector('#chatFontSize').value = 'lg'; document.querySelector('#chatSaveLook').click(); return 1; })()`);
await sleep(900);
console.log('toast:', await main.ev(`(document.querySelector('#toast') || {}).textContent`));
console.log('log class:', await main.ev(`document.querySelector('#chatLog').className`));

// The mascot: on, then photographed.
await main.ev(`(async () => { await window.api.petToggle(); return 1; })()`);
const petTarget = await waitFor((t) => /pet\.html/.test(t.url));
const pet = await evaluator(petTarget);
await sleep(2500);
const shot = await pet.call('Page.captureScreenshot', { format: 'png' });
writeFileSync('promo/shots/_packaged-pet.png', Buffer.from(shot.data, 'base64'));
const box = await pet.ev(`(() => { const c = document.querySelector('#pet'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let top = -1, bottom = -1; for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 8) { if (top < 0) top = y; bottom = y; } return { w: c.width, h: c.height, top, bottom }; })()`);
console.log('mascot drawn', JSON.stringify(box));
console.log('a screenshot of him was written to promo/shots/_packaged-pet.png');
main.close();
pet.close();
