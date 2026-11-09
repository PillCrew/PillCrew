// What actually goes wrong in the mascot's own pages: it attaches to a running instance, turns the pet on and collects every
// console message and uncaught exception from the main window, the pet and the bubble for a while. Read-only apart from the pet
// switch, which is not money.
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = Number(process.env.PORT) || 9361;
const list = async () => (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();

async function waitFor(pred, ms = 40000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { const t = await list(); const hit = t.find(pred); if (hit) return hit; } catch (_) {}
    await sleep(400);
  }
  throw new Error('no target');
}
function open(target, sink, label) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const send = (method, params) => ws.send(JSON.stringify({ id: ++id, method, params }));
  ws.onopen = () => {
    send('Runtime.enable');
    send('Log.enable');
  };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.consoleAPICalled') {
      const text = (m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ');
      sink.push(`[${label}] ${m.params.type}: ${text}`);
    } else if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      sink.push(`[${label}] UNCAUGHT: ${d.text} ${d.exception && d.exception.description ? d.exception.description.split('\n')[0] : ''} (line ${d.lineNumber})`);
    } else if (m.method === 'Log.entryAdded') {
      const en = m.params.entry;
      sink.push(`[${label}] log(${en.level}): ${en.text}${en.url ? ' @ ' + en.url.split('/').pop() + ':' + en.lineNumber : ''}`);
    }
  };
  return ws;
}

const seen = [];
try {
  const main = await waitFor((t) => /index\.html/.test(t.url));
  const wMain = open(main, seen, 'main');
  await sleep(1200);
  // Turn the pet on through the real preload bridge, exactly as the panel does.
  const ev = (target, expression) => new Promise((res, rej) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    ws.onopen = () => {
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.id !== 1) return;
        ws.close();
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result.result ? m.result.result.value : m.result);
      };
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
    };
    ws.onerror = rej;
  });
  await ev(main, '(async () => await window.api.petToggle())()');
  await ev(main, "(async () => await window.api.petApply({ petDailyBrief: true, petBubbles: true, petQuestions: true }))()");
  const pet = await waitFor((t) => /pet\.html/.test(t.url));
  const wPet = open(pet, seen, 'pet');
  await sleep(4000);
  // Walk him into the left edge and then the top-left corner through the real drag channel, which is what the owner did with
  // his hand: the deltas come from `pet.html` itself, so this is the same path.
  await ev(pet, 'window.pilly.petDrag({ mode: "start" })');
  for (let i = 0; i < 60; i++) {
    await ev(pet, 'window.pilly.petDrag({ mode: "move", dx: -60, dy: 0 })');
    await sleep(30);
  }
  await ev(pet, 'window.pilly.petDrag({ mode: "end" })');
  await sleep(1500);
  for (let i = 0; i < 60; i++) {
    await ev(pet, 'window.pilly.petDrag({ mode: "move", dx: 0, dy: -60 })');
    if (i === 0) await ev(pet, 'window.pilly.petDrag({ mode: "start" })');
    await sleep(30);
  }
  await ev(pet, 'window.pilly.petDrag({ mode: "end" })');
  await sleep(2500);
  const pages = await list();
  const bubble = pages.find((t) => /bubble\.html/.test(t.url));
  let wBubble = null;
  if (bubble) wBubble = open(bubble, seen, 'bubble');
  await sleep(6000);
  try { wMain.close(); wPet.close(); if (wBubble) wBubble.close(); } catch (_) {}
  console.log(seen.length ? seen.join('\n') : 'no console output at all');
} catch (e) {
  console.log('the probe failed: ' + e.message);
  console.log(seen.join('\n'));
  process.exit(1);
}
