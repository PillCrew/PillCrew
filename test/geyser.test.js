// Geyser-class transport: a provider that streams transactions must produce EXACTLY the same events as the public
// program-log feed, because it is the same `Program data:` decoder behind a different envelope. Offline: no socket.
const assert = require('assert');
const { ChainFeed, decodeLogs, decodeEvent, b58, PUMP_PROGRAM } = require('../src/chain');

const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const dec = (s) => { let n = 0n; for (const c of s) n = n * 58n + BigInt(A.indexOf(c)); const out = []; while (n > 0n) { out.unshift(Number(n & 255n)); n >>= 8n; } let z = 0; for (const c of s) { if (c === '1') z++; else break; } return Buffer.from([...Array(z).fill(0), ...out]); };
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const DISC_TRADE = Buffer.from([189, 219, 127, 211, 78, 230, 97, 238]);
const wsol = 'So11111111111111111111111111111111111111112';
const user = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';
const trade = (isBuy, solLamports, vSol, vTok) => Buffer.concat([
  DISC_TRADE, dec(wsol), u64(solLamports), u64(5_000_000), Buffer.from([isBuy ? 1 : 0]), dec(user),
  u64(1700000000), u64(vSol), u64(vTok), u64(1), u64(1), Buffer.alloc(40),
]);
const fillLine = (isBuy = true) => 'Program data: ' + trade(isBuy, 1_500_000_000, 45_000_000_000, 715_000_000_000_000).toString('base64');

// ---- decodeLogs: any log array, the same events ----
{
  const evs = decodeLogs(['Program ' + PUMP_PROGRAM + ' invoke [1]', fillLine(), 'Program ' + PUMP_PROGRAM + ' success']);
  assert.strictEqual(evs.length, 1, 'one trade in the logs is one event');
  assert.strictEqual(evs[0].txType, 'buy');
  assert.strictEqual(evs[0].mint, wsol);
  assert.strictEqual(evs[0].traderPublicKey, user);
  assert.ok(Math.abs(evs[0].marketCapSol - 62.94) < 0.1, 'market cap comes from the curve, as before: ' + evs[0].marketCapSol);
  assert.deepStrictEqual(decodeLogs(null), [], 'no logs is no events');
  assert.deepStrictEqual(decodeLogs(['Program data: %%%', 'unrelated']), [], 'junk is ignored, not thrown');
}

// ---- a Geyser notification with a transaction meta becomes the same event ----
{
  const f = new ChainFeed({ geyser: true });
  const got = [];
  f.on('event', (x) => got.push(x));
  const note = (logs, { sig = 'sig1', err = null } = {}) => JSON.stringify({
    jsonrpc: '2.0',
    method: 'transactionNotification',
    params: {
      subscription: 7,
      result: {
        signature: sig,
        slot: 123,
        transaction: { transaction: { signatures: [sig], message: {} }, meta: { err, logMessages: logs } },
        meta: { err, logMessages: logs },
      },
    },
  });

  f._onMessage(note(['Program ' + PUMP_PROGRAM + ' invoke [1]', fillLine(), 'Program ' + PUMP_PROGRAM + ' success']));
  assert.strictEqual(got.length, 1, 'a transaction notification is decoded into an event');
  assert.ok(Math.abs(got[0].marketCapSol - 62.94) < 0.1, 'and priced from the curve the payload carried');

  // The same signature twice is one event: a reconnect can replay what was already counted.
  f._onMessage(note([fillLine()]));
  assert.strictEqual(got.length, 1, 'a replayed signature is not counted twice');

  // A failed transaction is nobody's trade.
  f._onMessage(note([fillLine()], { sig: 'sig2', err: { InstructionError: [1, 'Custom'] } }));
  assert.strictEqual(got.length, 1, 'a failed transaction is ignored');

  // A payload from a provider that nests differently still works: the logs are found where they are.
  f._onMessage(JSON.stringify({
    jsonrpc: '2.0', method: 'transaction',
    params: { result: { signature: 'sig3', meta: { logMessages: [fillLine(false)] } } },
  }));
  assert.deepStrictEqual(got.map((x) => x.txType), ['buy', 'sell'], 'a sell is decoded as a sell');

  // Nothing usable: no throw, no event.
  f._onMessage(JSON.stringify({ jsonrpc: '2.0', method: 'transactionNotification', params: {} }));
  f._onMessage('not json');
  assert.strictEqual(got.length, 2, 'malformed notifications are dropped quietly');
}

// ---- the endpoint the desk builds: https -> wss, token appended once ----
{
  const { Engine, DEFAULTS } = require('../src/engine');
  const { Store } = require('../src/store');
  const fs = require('fs');
  const os = require('os');
  const path = require('path');

// Every scratch directory this suite makes lives under one root that is removed on exit, and roots left by an
// earlier run are swept (see `test/scratch.js`).
const scratchDir = require('./scratch').root;
  const store = new Store(fs.mkdtempSync(path.join(scratchDir, 'pc-geyser-')), 's.json', { ...DEFAULTS, mode: 'paper' });
  const e = new Engine({ exists: () => true, isUnlocked: () => true, address: () => 'W', keypair: null }, store);
  for (const id of ['_loop', '_ui', '_pxTimer', '_bal', '_marketTimer', '_hotTimer', '_posTimer']) clearInterval(e[id]);
  e.refreshBalance = () => {};

  assert.strictEqual(e._geyserWs(), '', 'no endpoint configured means no Geyser feed');
  store.set({ geyserUrl: 'https://eu.example.com/stream', geyserToken: 'abc123' });
  assert.strictEqual(e._geyserWs(), 'wss://eu.example.com/stream?api-key=abc123', 'https is upgraded and the token appended');
  store.set({ geyserUrl: 'wss://eu.example.com/stream?api-key=already' });
  assert.strictEqual(e._geyserWs(), 'wss://eu.example.com/stream?api-key=already', 'a key already in the URL is not doubled');
  store.set({ geyserUrl: 'https://eu.example.com/stream?a=1', geyserToken: 'abc123' });
  assert.strictEqual(e._geyserWs(), 'wss://eu.example.com/stream?a=1&api-key=abc123', 'and it joins an existing query');

  // Chosen but unconfigured: the desk says so and falls back instead of pretending to be on the fast stream.
  store.set({ geyserUrl: '', geyserToken: '', feedSource: 'geyser' });
  const lines = [];
  e._log = (level, msg) => lines.push(msg);
  e._startChain = (geo) => { lines.push('startChain:' + geo); };
  e._connect();
  assert.ok(lines.some((l) => /Geyser stream is selected but no endpoint/.test(l)), 'a missing endpoint is named');
  assert.ok(lines.includes('startChain:false'), 'and the public feed is used');
  void b58; void decodeEvent;
}

console.log('Geyser tests passed');
process.exit(0);
