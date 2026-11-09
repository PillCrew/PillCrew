// Where the page dies at load: attaches to a running instance, pauses on the first uncaught exception, reloads the window and
// prints the call frames (file, line, column) that produced it. Read-only.
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = Number(process.env.PORT) || 9366;
const list = async () => (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();

async function waitFor(pred, ms = 30000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { const t = await list(); const hit = t.find(pred); if (hit) return hit; } catch (_) {}
    await sleep(400);
  }
  throw new Error('no target');
}

const target = await waitFor((t) => /index\.html/.test(t.url));
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const send = (method, params) => ws.send(JSON.stringify({ id: ++id, method, params }));
const paused = [];
ws.onopen = () => {
  send('Debugger.enable');
  send('Runtime.enable');
  sleep(500).then(() => send('Debugger.setPauseOnExceptions', { state: 'uncaught' }));
  sleep(800).then(() => send('Page.enable'));
  sleep(1200).then(() => send('Page.reload', { ignoreCache: true }));
};
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Debugger.paused') {
    const top = (m.params.callFrames || []).slice(0, 6).map((f) => `${(f.url || '').split('/').pop()}:${f.location.lineNumber + 1}:${f.location.columnNumber + 1} ${f.functionName || '(anon)'}`);
    paused.push(top.join('\n   <- '));
    send('Debugger.resume');
  } else if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    paused.push(`EXCEPTION: ${d.text}`);
  }
};
await sleep(6000);
ws.close();
console.log(paused.length ? paused.join('\n---\n') : 'no exception during reload');
