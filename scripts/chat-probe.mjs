// A behavioural test of the chat, offline: a stub provider that speaks the OpenAI shape serves /v1/models and /v1/chat/completions,
// and the panel is driven through CDP exactly as a hand would - type, click Ask, click chips, break the endpoint on purpose.
import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = Number(process.env.PORT) || 9366;
const seen = [];
let mode = 'ok';
const server = createServer((req, res) => {
  const body = [];
  req.on('data', (c) => body.push(c));
  req.on('end', () => {
    const text = Buffer.concat(body).toString('utf8');
    if (req.url.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [
        { id: 'stub/chat:free', pricing: { prompt: '0' }, context_length: 64000 },
        { id: 'stub/small:free', pricing: { prompt: '0' }, context_length: 8000 },
        { id: 'stub/paid-model', pricing: { prompt: '0.000001' }, context_length: 128000 },
      ] }));
      return;
    }
    if (mode === 'fail') {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'invalid api key' } }));
      return;
    }
    let parsed = null;
    try { parsed = JSON.parse(text); } catch (_) { /* ignore */ }
    seen.push(parsed);
    const msgs = (parsed && parsed.messages) || [];
    const systemText = msgs.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    const userText = (msgs.filter((m) => m.role === 'user').slice(-1)[0] || {}).content || '';
    if (mode === 'empty') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: '' } }] }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: `STUB ANSWER to "${String(userText).slice(0, 40)}" | data=${/DATA/.test(systemText) ? 'yes' : 'no'} | system=${msgs.filter((m) => m.role === 'system').length}` } }] }));
  });
});
await new Promise((r) => server.listen(8799, '127.0.0.1', r));

const list = async () => (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const target = (await list()).find((t) => /index\.html/.test(t.url));
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const waiters = new Map();
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  const w = waiters.get(m.id);
  if (!w) return;
  waiters.delete(m.id);
  m.error ? w.j(new Error(JSON.stringify(m.error))) : w.r(m.result);
};
const call = (method, params) => new Promise((res, rej) => { const i = ++id; waiters.set(i, { r: res, j: rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => {
  const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('eval failed: ' + expression.slice(0, 80));
  return r.result ? r.result.value : r;
};
let bad = 0;
const check = (ok, what, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra ? ' -> ' + extra : ''}`); if (!ok) bad++; };

try {
  await call('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  await ev(`(() => { const b = [...document.querySelectorAll('#modalBox button')].find((x) => /skip/i.test(x.textContent)); if (b) b.click(); return true; })()`);
  await ev(`document.querySelector('#nav [data-tab=chat]').click()`);
  await sleep(800);

  // 1. Point the first tier at the stub through the real inputs.
  // By placeholder: a tier's fields are SIBLINGS of its header row, so a query inside that row finds nothing.
  await ev(`(() => {
    const set = (sel, v) => { const el = document.querySelector(sel); if (!el) return; el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); };
    set('#chatTiers input[placeholder="deepseek-chat"]', 'stub/chat:free');
    set('#chatTiers input[placeholder^="https"]', 'http://127.0.0.1:8799/v1/chat/completions');
    set('#chatTiers input[type=password]', 'sk-stub-key');
    return true;
  })()`);
  await sleep(700);
  check(/1 endpoint/.test(await ev(`document.querySelector('#chatTierNote').textContent`)), 'the panel counts the stub as a usable endpoint', await ev(`document.querySelector('#chatTierNote').textContent`));

  // 2. Ask a question the way a person does.
  await ev(`(() => { document.querySelector('#chatInput').value = 'what is moving?'; document.querySelector('#chatSend').click(); })()`);
  await sleep(1500);
  const log1 = await ev(`document.querySelector('#chatLog').textContent`);
  check(/STUB ANSWER to "what is moving\?"/.test(log1), 'the answer reaches the panel', log1.slice(-160));
  check(/data=yes/.test(log1), 'and the desk data block travelled with it as a system message');
  check(/system=2/.test(log1), 'two system messages: the rules and the data', log1.slice(-160));

  // 3. A chip: the question is the app's own, and the numbers ride along.
  await ev(`document.querySelector('#chatChips [data-action=trending]').click()`);
  await sleep(1500);
  const log2 = await ev(`document.querySelector('#chatLog').textContent`);
  check(/What is moving right now\?/.test(log2), "the chip asked the app's own question", log2.slice(-120));
  check(!/no data available/i.test(log2), 'and never "no data available"');

  // 4. The provider's own model list.
  await ev(`document.querySelector('#chatTiers .find-models').click()`);
  await sleep(1200);
  const sel = await ev(`(() => { const all = [...document.querySelectorAll('#chatTiers select')]; const s = all[0]; return { shown: Boolean(s) && !s.hidden, count: s ? s.options.length : 0, selects: all.length, model: document.querySelectorAll('#chatTiers input')[1].value, toast: (document.querySelector('#toast') || {}).textContent }; })()`);
  check(sel.shown && sel.count === 3, 'the model list is drawn on the panel', JSON.stringify(sel));
  check(sel.model === 'stub/chat:free', 'and the best free one was chosen', sel.model);

  // 5. A broken endpoint says what the provider said.
  mode = 'fail';
  await ev(`(() => { document.querySelector('#chatInput').value = 'and now?'; document.querySelector('#chatSend').click(); })()`);
  await sleep(1500);
  const log3 = await ev(`document.querySelector('#chatLog').textContent`);
  check(/HTTP 401/.test(log3) && /invalid api key/.test(log3), "an error carries the provider's own words", log3.slice(-200));

  // 6. An empty answer names the cause.
  mode = 'empty';
  await ev(`(() => { document.querySelector('#chatInput').value = 'empty one'; document.querySelector('#chatSend').click(); })()`);
  await sleep(1500);
  const log4 = await ev(`document.querySelector('#chatLog').textContent`);
  check(/returned no text/.test(log4), 'an empty answer explains itself', log4.slice(-200));

  // 7. The watchlist on the PillCrew tab.
  mode = 'ok';
  await ev(`document.querySelector('#nav [data-tab=crew]').click()`);
  await sleep(800);
  await ev(`(() => { document.querySelector('#watchMint').value = 'GxWqJbWPxMseev7WXYNPLEG8K59v2fAhJ5m5o7Yepump'; document.querySelector('#watchPct').value = '12'; document.querySelector('#watchAddBtn').click(); })()`);
  await sleep(1200);
  const watch = await ev(`({ rows: document.querySelectorAll('#watchList .rec').length, text: document.querySelector('#watchList').textContent.slice(0, 80) })`);
  check(watch.rows >= 1, 'a watched coin appears on the list', JSON.stringify(watch));

  // 8. The chat's look is applied as it is saved.
  await ev(`document.querySelector('#nav [data-tab=chat]').click()`);
  await sleep(600);
  await ev(`(() => { document.querySelector('#chatBubbleStyle').value = 'neon'; document.querySelector('#chatFontSize').value = 'lg'; document.querySelector('#chatSaveLook').click(); })()`);
  await sleep(900);
  const cls = await ev(`document.querySelector('#chatLog').className`);
  check(/bs-neon/.test(cls) && /fs-lg/.test(cls), 'the look applies to the log at once', cls);
} catch (e) {
  check(false, 'the probe ran', e.message);
}
console.log(bad ? `${bad} check(s) failed` : 'the chat works end to end');
ws.close();
server.close();
process.exit(bad ? 1 : 0);
