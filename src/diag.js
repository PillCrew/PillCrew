const WebSocket = require('ws');

/**
 * Connection doctor. Every endpoint the desk can be pointed at is opened once, answered once, and reported in words a
 * person can act on - before the bot is started, not a week later when the diary finally mentions it.
 *
 * The bug that earned this file: a provider's socket URL (`wss://…`, exactly as its panel prints it) answers 401
 * without the key its HTTP endpoint carries. The desk fell back to public nodes silently, the feed was nineteen seconds
 * behind, and nothing on screen said so. A five second check on the settings screen would have found it in five seconds.
 *
 * Everything here is injectable so it can be tested without a network: `wsFactory` and `rpcCall` are the seams.
 */

const PUMP_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const SOCKET_TIMEOUT = 6000;
const RPC_TIMEOUT = 5000;

/** What a refusal means, in the words that tell somebody what to change. */
function explainSocketFailure(status, text, { hasKeyInRpc = false } = {}) {
  const s = Number(status) || 0;
  const t = String(text || '');
  if (s === 401 || s === 403 || /401|403|unauthor|forbidden/i.test(t)) {
    return hasKeyInRpc
      ? 'Refused without a key. Your RPC URL carries one, so the socket needs it too - the app now adds it automatically; if you edited the URL by hand, put the whole address in, key included.'
      : 'Refused without a key. Copy the socket URL together with the key your provider gives for it (usually ?api-key=… or ?key=…).';
  }
  if (s === 404) return 'That host does not serve this path. A socket is usually on another host than the HTTP endpoint (wss://ws.…, not wss://rpc.…).';
  if (s === 429 || /429|too many requests/i.test(t)) return 'Rate limited. Wait a moment, or use a plan that allows this subscription.';
  if (s === 1006) return 'The connection dropped before the server answered - usually a key or a path the host does not accept.';
  if (/ENOTFOUND|EAI_AGAIN/i.test(t)) return 'The hostname does not resolve. Check the spelling of the address.';
  if (/ECONNREFUSED/i.test(t)) return 'The host refused the connection. Wrong port, or the socket is on a different host.';
  if (/timeout|timed out|no answer/i.test(t)) return 'No answer in six seconds. The endpoint may be down, or blocked by your network or firewall.';
  if (/unexpected server response/i.test(t)) return 'The server answered with something that is not a WebSocket. That address is probably an HTTP endpoint, not a socket.';
  return 'Refused: ' + (t || 'no reason given');
}

/**
 * Open one socket and try one subscription on it. Resolves - never rejects - with
 * `{ ok, ms, url, detail }`, so the caller can draw a table instead of catching errors.
 */
function checkSocket(url, { wsFactory = (u) => new WebSocket(u), method = 'logsSubscribe', params = [{ mentions: [PUMP_PROGRAM] }, { commitment: 'processed' }], timeout = SOCKET_TIMEOUT, hasKeyInRpc = false, label = 'socket' } = {}) {
  return new Promise((resolve) => {
    if (!url) return resolve({ ok: false, label, ms: 0, url: '', detail: 'No address configured.' });
    const started = Date.now();
    let done = false;
    let ws;
    const finish = (row) => {
      if (done) return;
      done = true;
      try { if (ws) ws.terminate(); } catch (_) { /* already gone */ }
      resolve({ label, url, ms: Date.now() - started, ...row });
    };
    try { ws = wsFactory(url); } catch (e) { return finish({ ok: false, detail: explainSocketFailure(0, e.message, { hasKeyInRpc }) }); }
    const timer = setTimeout(() => finish({ ok: false, detail: explainSocketFailure(0, 'no answer in six seconds', { hasKeyInRpc }) }), timeout);
    ws.on('open', () => ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })));
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(String(raw)); } catch (_) { return finish({ ok: false, detail: 'The server answered with something that is not JSON-RPC.' }); }
      if (m.id === 1 && m.error) return finish({ ok: false, detail: explainSocketFailure(0, (m.error && m.error.message) || '', { hasKeyInRpc }) });
      if (m.id === 1 && (typeof m.result === 'number' || (m.result && typeof m.result === 'object'))) {
        clearTimeout(timer);
        return finish({ ok: true, detail: method === 'transactionSubscribe' ? 'Subscribed to the transaction stream.' : 'Subscribed to the Pump.fun program logs.' });
      }
      // A notification before the acknowledgement still proves the stream works.
      if (m.method) { clearTimeout(timer); return finish({ ok: true, detail: 'Streaming.' }); }
    });
    ws.on('error', (e) => finish({ ok: false, detail: explainSocketFailure(0, e.message, { hasKeyInRpc }) }));
    ws.on('close', (code, reason) => finish({ ok: false, detail: explainSocketFailure(code, String(reason || ''), { hasKeyInRpc }) }));
  });
}

/** One JSON-RPC call against an HTTP endpoint, timed. */
async function checkRpc(url, { fetchJson, timeout = RPC_TIMEOUT, label = 'node' } = {}) {
  if (!url) return { ok: false, label, ms: 0, url: '', detail: 'No address configured.' };
  const started = Date.now();
  const call = fetchJson || (async (u, ms) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(u, {
        method: 'POST', signal: ctrl.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getVersion', params: [] }),
      });
      return { status: r.status, body: await r.json() };
    } finally { clearTimeout(t); }
  });
  try {
    const res = await call(url, timeout);
    const body = res && res.body;
    if (res && res.status === 401 || res && res.status === 403) return { ok: false, label, ms: Date.now() - started, url, detail: 'Refused without a key (401/403). Put the key in the URL exactly as the provider shows it.' };
    if (res && res.status === 429) return { ok: false, label, ms: Date.now() - started, url, detail: 'Rate limited (429). The desk will keep working, but this node is throttling you.' };
    if (body && body.error) return { ok: false, label, ms: Date.now() - started, url, detail: 'The node answered with an error: ' + (body.error.message || JSON.stringify(body.error)).slice(0, 120) };
    if (!body || !body.result) return { ok: false, label, ms: Date.now() - started, url, detail: 'No answer from the node.' };
    const v = body.result['solana-core'] || body.result;
    return { ok: true, label, ms: Date.now() - started, url, detail: 'Answered in ' + (Date.now() - started) + ' ms' + (v ? ` (solana-core ${String(v).slice(0, 20)})` : '') + '.' };
  } catch (e) {
    const msg = /abort/i.test(e.name + e.message) ? `no answer in ${Math.round(timeout / 1000)} seconds` : e.message;
    return { ok: false, label, ms: Date.now() - started, url, detail: explainSocketFailure(0, msg) };
  }
}

/**
 * The whole panel: every configured door, checked in parallel, plus the one thing a person can act on - whether the
 * socket carries the key its RPC URL uses.
 */
async function checkAll(settings, opts = {}) {
  const keyInRpc = /[?&](api-key|key|token)=[^&\s]+/.test(String(settings.rpcUrl || ''));
  const socketKeyed = /[?&](api-key|key|token)=/.test(String(settings.rpcWsUrl || ''));
  // RULE CHANGED 2026-11-06 (1.1.1): a provider's own node IS a socket. With only an RPC URL configured the desk derives
  // the socket from it (`https://…` → `wss://…`, which Helius serves), so telling the user "no private socket, the feed
  // will read public nodes" was a false alarm contradicted by the feed itself. The derived address is checked now.
  const derivedWs = opts.resolvedWs && /^wss?:\/\//.test(opts.resolvedWs)
    ? opts.resolvedWs
    : (/^https:\/\//.test(String(settings.rpcUrl || '')) ? String(settings.rpcUrl).replace(/^https:/, 'wss:') : '');
  const socketUrl = settings.rpcWsUrl ? (opts.resolvedWs || settings.rpcWsUrl) : derivedWs;
  const socketNote = settings.rpcWsUrl ? '' : ' (derived from your node address)';
  const jobs = [
    checkRpc(settings.rpcUrl, { ...opts, label: 'Main node' }),
    settings.rpcBackupUrl ? checkRpc(settings.rpcBackupUrl, { ...opts, label: 'Backup node' }) : Promise.resolve({ ok: false, label: 'Backup node', ms: 0, url: '', detail: 'Not configured (optional).' }),
    socketUrl
      ? checkSocket(socketUrl, { ...opts, label: 'Your socket' + socketNote, hasKeyInRpc: keyInRpc })
      : Promise.resolve({ ok: false, label: 'Your socket', ms: 0, url: '', detail: 'Not configured - the desk will use public nodes, which are slower.' }),
    settings.geyserUrl
      ? checkSocket(String(settings.geyserUrl).replace(/^https:/, 'wss:').replace(/^http:/, 'ws:'), { ...opts, label: 'Geyser stream', method: 'transactionSubscribe', params: [{ accountInclude: [PUMP_PROGRAM], failed: false, vote: false }, { commitment: 'confirmed' }] })
      : Promise.resolve({ ok: false, label: 'Geyser stream', ms: 0, url: '', detail: 'Not configured (optional).' }),
  ];
  const rows = await Promise.all(jobs);
  const notes = [];
  if (settings.rpcWsUrl && keyInRpc && !socketKeyed) notes.push('Your socket address carries no key while the node address does - the app adds it automatically, and this check used that address.');
  if (!socketUrl && !settings.geyserUrl) notes.push('No private socket or Geyser endpoint: the feed will read public nodes, which measured nineteen seconds behind on this machine.');
  if (settings.feedSource === 'geyser' && !settings.geyserUrl) notes.push('The Geyser feed is selected but no endpoint is set, so the desk falls back to the chain feed.');
  const node = rows.find((r) => r.label === 'Main node');
  if (node && !node.ok && /429|rate limit/i.test(String(node.detail))) notes.push('Your node is rate limiting the desk (429). Everything keeps working on the public pool, but prices and exits are slower until the limit is lifted: a higher plan, or a second endpoint to spread the calls over.');
  // RULE ADDED 2026-11-06 (1.1.1): the live view from the desk itself. A node can look healthy in a single call and still be
  // in a penalty box from the traffic of the last minute, and that is the difference between "the bot is slow" and "the plan
  // is too small for the request rate" - the one thing a reader can act on.
  const live = opts.rpcStatus;
  if (live && Array.isArray(live.nodes)) {
    const main = live.nodes.find((n) => n.url === settings.rpcUrl) || live.nodes[0];
    const cooling = live.nodes.find((n) => n.coolingDown);
    if (cooling) {
      notes.push(`${cooling.host} is in a penalty box right now (${cooling.lastError || 'HTTP 429 or a timeout'}), so the desk is calling ${(() => { try { return new URL(live.current).hostname; } catch (_) { return 'another node'; } })()} instead. Prices and exits are slower until it recovers - that is the plan limit, not the bot.`);
    } else if (main && main.fails > 0) {
      notes.push(`${main.host} has refused ${main.fails} call${main.fails === 1 ? '' : 's'} in this session (last: ${main.lastError || 'unknown'}). The desk keeps working on the other nodes.`);
    }
  }
  return { rows, notes };
}

module.exports = { checkSocket, checkRpc, checkAll, explainSocketFailure, PUMP_PROGRAM };
