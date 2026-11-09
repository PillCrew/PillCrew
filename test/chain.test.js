const assert = require('assert');
const { ChainFeed, decodeEvent, marketCapSol, b58, PUMP_PROGRAM } = require('../src/chain');

const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const dec = (s) => { let n = 0n; for (const c of s) n = n * 58n + BigInt(A.indexOf(c)); const out = []; while (n > 0n) { out.unshift(Number(n & 255n)); n >>= 8n; } let z = 0; for (const c of s) { if (c === '1') z++; else break; } return Buffer.from([...Array(z).fill(0), ...out]); };

// base58 round trip + known value
assert.strictEqual(b58(Buffer.alloc(32)), '1'.repeat(32));
const wsol = 'So11111111111111111111111111111111111111112';
assert.strictEqual(b58(dec(wsol)), wsol);
assert.strictEqual(dec(wsol).length, 32);

// market cap formula: pump.fun launch state (30 SOL / 1.073B tokens) is ~27.96 SOL cap
assert.ok(Math.abs(marketCapSol(30000000000n, 1073000000000000n) - 27.96) < 0.05);

const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const DISC_TRADE = Buffer.from([189, 219, 127, 211, 78, 230, 97, 238]);
const DISC_CREATE = Buffer.from([27, 114, 169, 77, 222, 235, 99, 118]);
const user = dec('9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin');
const str = (s) => { const t = Buffer.from(s); const l = Buffer.alloc(4); l.writeUInt32LE(t.length); return Buffer.concat([l, t]); };

function trade(isBuy, solLamports, vSol, vTok) {
  return Buffer.concat([DISC_TRADE, dec(wsol), u64(solLamports), u64(5_000_000), Buffer.from([isBuy ? 1 : 0]), user, u64(1700000000), u64(vSol), u64(vTok), u64(1), u64(1), Buffer.alloc(40)]);
}
const e = decodeEvent(trade(true, 1_500_000_000, 45_000_000_000, 715_000_000_000_000).toString('base64'));
assert.strictEqual(e.txType, 'buy'); assert.strictEqual(e.mint, wsol);
assert.strictEqual(e.traderPublicKey, '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin');
assert.strictEqual(e.solAmount, 1.5);
assert.ok(Math.abs(e.marketCapSol - 62.94) < 0.1, 'mc ' + e.marketCapSol);
assert.strictEqual(decodeEvent(trade(false, 1, 1, 1).toString('base64')).txType, 'sell');

const create = Buffer.concat([DISC_CREATE, str('Pill Coin'), str('PILL'), str('https://ipfs.io/x'), dec(wsol), dec(wsol), user, Buffer.alloc(60)]);
const c = decodeEvent(create.toString('base64'));
assert.deepStrictEqual([c.txType, c.name, c.symbol, c.mint, c.traderPublicKey], ['create', 'Pill Coin', 'PILL', wsol, '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin']);
assert.strictEqual(decodeEvent(Buffer.alloc(40).toString('base64')), null);
assert.strictEqual(decodeEvent('%%%'), null);

// websocket notification handling (no network)
const f = new ChainFeed(); const got = []; f.on('event', (x) => got.push(x));
const note = (logs, err = null) => JSON.stringify({ jsonrpc: '2.0', method: 'logsNotification', params: { result: { context: { slot: 1 }, value: { signature: 's', err, logs } } } });
const launch = 'Program data: ' + create.toString('base64');
const fill = 'Program data: ' + trade(true, 1e9, 3e10, 1e15).toString('base64');
const invoke = 'Program ' + PUMP_PROGRAM + ' invoke [1]';
const done = 'Program ' + PUMP_PROGRAM + ' success';
f._onMessage(note([invoke, fill, done], { InstructionError: 1 }));
f._onMessage(note([invoke, fill]));
f._onMessage(note(['Program Outer invoke [1]', 'Program ' + PUMP_PROGRAM + ' invoke [2]', fill, done, 'Program Outer failed: reverted']));
assert.equal(got.length, 0);
const valid = note([invoke, launch, 'Program Foreign invoke [2]', fill, 'Program Foreign success', fill, done]);
f._onMessage(valid);
f._onMessage(valid);
assert.deepStrictEqual(got.map((x) => x.txType), ['create', 'buy']);
f._onMessage(JSON.stringify({ id: 1, result: 77 })); assert.ok(f.connected);
assert.ok(f.endpoints().length >= 2);
f.customRpc = 'https://mainnet.helius-rpc.com/?api-key=k';
assert.strictEqual(f.endpoints()[0], 'wss://mainnet.helius-rpc.com/?api-key=k');
// RULE ADDED 2026-11-05: an explicit socket wins, because a provider's WebSocket is often on another host than its
// HTTP endpoint - FluxRPC serves `https://eu.fluxrpc.com` and `wss://ws.eu.fluxrpc.com`, and a URL guessed by
// swapping the scheme never connects.
f.customWs = 'wss://ws.eu.fluxrpc.com';
assert.strictEqual(f.endpoints()[0], 'wss://ws.eu.fluxrpc.com', 'the socket the operator named is tried first');
const g = new ChainFeed({ customRpcs: ['https://a.example/rpc', 'https://b.example/rpc'] });
assert.deepStrictEqual(g.endpoints().slice(0, 2), ['wss://a.example/rpc', 'wss://b.example/rpc'],
  'both private nodes are offered a socket, in order');
assert.ok(g.endpoints().some((u) => u.startsWith('wss://api.mainnet-beta')), 'and the public ones stay as a fallback');
console.log('ChainFeed tests passed');
