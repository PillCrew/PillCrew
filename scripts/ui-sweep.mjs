// A sweep of every tab: what it shows, whether anything overflows, and every console error the renderer produced along the way.
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = Number(process.env.PORT) || 9365;
const list = async () => (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const target = (await list()).find((t) => /index\.html/.test(t.url));
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const waiters = new Map();
const problems = [];
const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    problems.push(`UNCAUGHT: ${d.text} ${d.exception && d.exception.description ? d.exception.description.split('\n')[0] : ''}`);
    return;
  }
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'assert'].includes(m.params.type)) {
    const text = (m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ');
    if (!/Electron Security Warning/.test(text)) problems.push(`${m.params.type}: ${text.slice(0, 200)}`);
    return;
  }
  const w = waiters.get(m.id);
  if (!w) return;
  waiters.delete(m.id);
  m.error ? w.j(new Error(JSON.stringify(m.error))) : w.r(m.result);
};
const call = (method, params) => new Promise((res, rej) => { const i = ++id; waiters.set(i, { r: res, j: rej }); ws.send(JSON.stringify({ id: i, method, params })); });
await ready;
await call('Runtime.enable');
await call('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
const ev = async (expression) => { const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) problems.push('EVAL: ' + expression.slice(0, 60)); return r.result ? r.result.value : r; };

const TABS = ['dashboard', 'feed', 'bump', 'chat', 'wallet', 'settings', 'guide', 'crew'];
for (const tab of TABS) {
  await ev(`document.querySelector('#nav [data-tab=${tab}]').click()`);
  await sleep(900);
  const info = await ev(`(() => {
    const c = document.querySelector('.content');
    const sec = document.querySelector('#tab-${tab}');
    const wide = [...document.querySelectorAll('#tab-${tab} *')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > window.innerWidth + 2 || r.left < -2); }).slice(0, 4).map((el) => el.tagName + '.' + String(el.className).slice(0, 30));
    return { active: sec && sec.classList.contains('active'), height: sec ? Math.round(sec.getBoundingClientRect().height) : 0, scrollH: c.scrollHeight, clientH: c.clientHeight, overflowing: wide };
  })()`);
  const shot = await call('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`.scratch-tab-${tab}.png`, Buffer.from(shot.data, 'base64'));
  console.log(tab.padEnd(10), JSON.stringify(info));
}
console.log('problems:', problems.length ? '\n  ' + problems.join('\n  ') : 'none');
ws.close();
