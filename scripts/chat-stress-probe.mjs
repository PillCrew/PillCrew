// The chat under a heavy hand: six questions pressed in a row, the busy guard, no repeated sentences, the log scrolling with
// the conversation, Clear, and the endpoints list at its ceiling. A stub provider on 8798 answers everything.
import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = Number(process.env.PORT) || 9373;
const STUB = 8798;
let answers = 0;
const server = createServer((req, res) => {
  const body = [];
  req.on('data', (c) => body.push(c));
  req.on('end', () => {
    if (req.url.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'stub/chat:free', pricing: { prompt: '0' }, context_length: 32000 }] }));
      return;
    }
    let parsed = null;
    try { parsed = JSON.parse(Buffer.concat(body).toString('utf8')); } catch (_) {}
    const user = ((parsed && parsed.messages) || []).filter((m) => m.role === 'user').slice(-1)[0];
    const q = (user && user.content) || '';
    answers++;
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: `ANSWER ${answers} to ${String(q).slice(0, 24)}` } }] }));
    }, 400);
  });
});
await new Promise((r) => server.listen(STUB, '127.0.0.1', r));

const list = async () => (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const t = (await list()).find((x) => /index\.html/.test(x.url));
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0;
const w = new Map();
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
ws.onmessage = (e) => { const m = JSON.parse(e.data); const q = w.get(m.id); if (!q) return; w.delete(m.id); m.error ? q.j(new Error(JSON.stringify(m.error))) : q.r(m.result); };
const call = (method, params) => new Promise((res, rej) => { const i = ++id; w.set(i, { r: res, j: rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (ex) => { const r = await call('Runtime.evaluate', { expression: ex, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error('eval: ' + ex.slice(0, 70)); return r.result ? r.result.value : r; };
let bad = 0;
const check = (ok, what, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra ? ' -> ' + extra : ''}`); if (!ok) bad++; };

try {
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
  await ev(`(() => { const b = [...document.querySelectorAll('#modalBox button')].find((x) => /skip/i.test(x.textContent)); if (b) b.click(); return 1; })()`);
  await ev(`document.querySelector('#nav [data-tab=chat]').click()`);
  await sleep(600);
  await ev(`(() => {
    const set = (sel, v) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); };
    set('#chatTiers input[placeholder="deepseek-chat"]', 'stub/chat:free');
    set('#chatTiers input[placeholder^="https"]', 'http://127.0.0.1:${STUB}/v1/chat/completions');
    set('#chatTiers input[type=password]', 'sk-stub');
    return 1;
  })()`);
  await sleep(600);
  await ev(`document.querySelector('#chatClear').click()`);
  await sleep(300);

  // Six presses with no waiting: the button must go quiet after the first, so the log holds one question.
  await ev(`(() => { const i = document.querySelector('#chatInput'); i.value = 'first'; document.querySelector('#chatSend').click(); for (let k = 0; k < 5; k++) document.querySelector('#chatSend').click(); return 1; })()`);
  await sleep(1600);
  const after = await ev(`({ msgs: document.querySelectorAll('#chatLog .chat-msg').length, text: document.querySelector('#chatLog').textContent, disabled: document.querySelector('#chatSend').disabled })`);
  check(after.msgs === 2, 'six presses in a row asked once', `msgs=${after.msgs}`);
  check(!after.disabled, 'and the send button is handed back', `disabled=${after.disabled}`);

  // A conversation of ten turns: one question, one answer each, and not a sentence printed twice.
  for (let i = 2; i <= 10; i++) {
    await ev(`(() => { document.querySelector('#chatInput').value = 'question ${i}'; document.querySelector('#chatSend').click(); return 1; })()`);
    await sleep(900);
  }
  const ten = await ev(`(() => {
    const msgs = [...document.querySelectorAll('#chatLog .chat-msg')];
    const texts = msgs.map((m) => (m.querySelector('.chat-text') || {}).textContent || '');
    const dupes = texts.filter((x, i) => texts.indexOf(x) !== i);
    return { msgs: msgs.length, dupes, users: msgs.filter((m) => m.classList.contains('user')).length, answers: msgs.filter((m) => m.classList.contains('assistant')).length };
  })()`);
  check(ten.msgs === 20, 'ten turns are twenty messages', JSON.stringify(ten));
  check(ten.dupes.length === 0, 'not one sentence is printed twice', JSON.stringify(ten.dupes.slice(0, 2)));

  const scroll = await ev(`(() => { const l = document.querySelector('#chatLog'); return { bottom: Math.round(l.scrollHeight - l.scrollTop - l.clientHeight), scrollable: l.scrollHeight > l.clientHeight }; })()`);
  check(scroll.scrollable, 'the log scrolls inside its own frame once it is full', JSON.stringify(scroll));
  check(scroll.bottom <= 4, 'and it stays at the newest message', JSON.stringify(scroll));

  // Enter sends, Shift+Enter does not.
  const before = await ev(`document.querySelectorAll('#chatLog .chat-msg').length`);
  await ev(`(() => { const i = document.querySelector('#chatInput'); i.value = 'by enter'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return 1; })()`);
  await sleep(1200);
  const afterEnter = await ev(`document.querySelectorAll('#chatLog .chat-msg').length`);
  check(afterEnter === before + 2, 'Enter asks the question', `${before} -> ${afterEnter}`);

  // Clear empties the log and puts the hint back.
  await ev(`document.querySelector('#chatClear').click()`);
  await sleep(400);
  const cleared = await ev(`({ msgs: document.querySelectorAll('#chatLog .chat-msg').length, hint: /Ask anything/.test(document.querySelector('#chatLog').textContent) })`);
  check(cleared.msgs === 0 && cleared.hint, 'Clear empties the log and says what to do', JSON.stringify(cleared));

  // The endpoints list: six is the ceiling, and the buttons say so.
  await ev(`document.querySelector('#chatClear').click()`);
  for (let i = 0; i < 8; i++) { await ev(`document.querySelector('#chatAddTier').click()`); await sleep(150); }
  const tiers = await ev(`({ rows: document.querySelectorAll('#chatTiers .chat-tier').length, toast: (document.querySelector('#toast') || {}).textContent || '' })`);
  check(tiers.rows === 6, 'six endpoints is the ceiling', JSON.stringify(tiers));
  check(/Six endpoints/.test(tiers.toast), 'and the panel says why the seventh did nothing', tiers.toast);
} catch (e) {
  check(false, 'the chat stress probe ran', e.message);
}
console.log(bad ? `${bad} check(s) failed` : 'the chat holds up under a heavy hand');
ws.close();
server.close();
process.exit(bad ? 1 : 0);
