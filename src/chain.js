const EventEmitter = require('events');
const WebSocket = require('ws');

/**
 * On-chain Pump.fun feed. No third-party data API: we subscribe to the program's logs over a Solana
 * RPC websocket and decode the Anchor events (CreateEvent / TradeEvent) locally. One subscription
 * delivers every new launch AND every trade on every coin (so trending coins come for free).
 * Market cap is derived from the bonding-curve reserves carried by each trade event.
 *
 * Emits 'event' with objects shaped like the engine's input: { txType, mint, name, symbol,
 * traderPublicKey, solAmount, marketCapSol, fromChain: true }.
 */

const PUMP_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const DISC_CREATE = Buffer.from([27, 114, 169, 77, 222, 235, 99, 118]);
const DISC_TRADE = Buffer.from([189, 219, 127, 211, 78, 230, 97, 238]);
const TOTAL_SUPPLY_TOKENS = 1e9;      // every pump.fun coin has 1B supply
const TOKEN_DECIMALS = 6;
const PUBLIC_WS = ['wss://api.mainnet-beta.solana.com', 'wss://solana-rpc.publicnode.com'];
const STALE_MS = 20000;               // no message for this long -> reconnect

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58(buf) {
  let n = 0n;
  for (const x of buf) n = (n << 8n) | BigInt(x);
  let s = '';
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const x of buf) { if (x === 0) s = '1' + s; else break; }
  return s;
}

/** Market cap in SOL from bonding-curve virtual reserves (lamports / raw token units). */
function marketCapSol(vSol, vTok) {
  if (!(vTok > 0n)) return 0;
  const priceSol = Number(vSol) / 1e9 / (Number(vTok) / 10 ** TOKEN_DECIMALS);
  return priceSol * TOTAL_SUPPLY_TOKENS;
}

function readString(buf, o) {
  const len = buf.readUInt32LE(o.p); o.p += 4;
  if (len > 400 || o.p + len > buf.length) throw new Error('bad string');
  const s = buf.toString('utf8', o.p, o.p + len); o.p += len;
  return s;
}

/** Decode one "Program data: <base64>" payload. Returns an engine event or null. */
function decodeEvent(base64) {
  let b;
  try { b = Buffer.from(base64, 'base64'); } catch (_) { return null; }
  if (b.length < 8) return null;
  const disc = b.subarray(0, 8);
  try {
    if (disc.equals(DISC_TRADE)) {
      if (b.length < 8 + 32 + 8 + 8 + 1 + 32 + 8 + 8 + 8) return null;
      const mint = b58(b.subarray(8, 40));
      const sol = b.readBigUInt64LE(40);
      if (b[56] > 1) return null;
      const isBuy = b[56] === 1;
      const user = b58(b.subarray(57, 89));
      const vSol = b.readBigUInt64LE(97);
      const vTok = b.readBigUInt64LE(105);
      return { txType: isBuy ? 'buy' : 'sell', mint, traderPublicKey: user, solAmount: Number(sol) / 1e9, marketCapSol: marketCapSol(vSol, vTok), fromChain: true };
    }
    if (disc.equals(DISC_CREATE)) {
      const o = { p: 8 };
      const name = readString(b, o);
      const symbol = readString(b, o);
      readString(b, o); // uri
      if (o.p + 96 > b.length) return null;
      const mint = b58(b.subarray(o.p, o.p + 32)); o.p += 32;
      o.p += 32;        // bonding curve
      const user = b58(b.subarray(o.p, o.p + 32));
      const key = b.subarray(o.p + 32, o.p + 64);
      const creator = key.length === 32 && key.some((byte) => byte !== 0) ? b58(key) : null;
      // The current CreateEvent appends quote_mint after the reserve and mode fields.
      const quoteOffset = o.p + 64 + 5 * 8 + 32 + 2;
      const quoteKey = b.subarray(quoteOffset, quoteOffset + 32);
      if (quoteKey.length && quoteKey.length !== 32) return null;
      const quoteMint = quoteKey.length && quoteKey.some((byte) => byte !== 0) ? b58(quoteKey) : null;
      return { txType: 'create', creator, quoteMint, mint, name, symbol, traderPublicKey: user, solAmount: 0, marketCapSol: marketCapSol(30000000000n, 1073000000000000n), fromChain: true };
    }
  } catch (_) { /* malformed / newer layout - ignore */ }
  return null;
}

function decodeLogs(logs) {
  const out = [];
  for (const line of logs || []) {
    const at = String(line).indexOf('Program data: ');
    if (at < 0) continue;
    const ev = decodeEvent(String(line).slice(at + 14).trim());
    if (ev) out.push(ev);
  }
  return out;
}

class ChainFeed extends EventEmitter {
  /** @param {{customRpc?: string, customRpcs?: string[], customWs?: string, geyser?: boolean}} opts */
  constructor(opts = {}) {
    super();
    this.customRpc = opts.customRpc || '';
    // RULE ADDED 2026-11-06 (1.0.8: a Geyser-class stream is the faster door): the same feed can
    // now speak a provider's Geyser-class stream over WebSocket (`transactionSubscribe`) instead of `logsSubscribe`. The
    // DECODER is the same one, unchanged - a Geyser notification carries `meta.logMessages`, so every event still comes
    // from the program's own data, and only the transport (and therefore the latency) is better.
    this.geyser = Boolean(opts.geyser);
    // The desk may hold two private nodes now; either one can serve the subscription, and the explicit socket wins.
    this.customRpcs = (opts.customRpcs || []).filter(Boolean);
    this.customWs = opts.customWs || '';
    if (!this.customRpcs.length && this.customRpc) this.customRpcs = [this.customRpc];
    this.ws = null;
    this.want = false;
    this.idx = 0;
    this.lastMsg = 0;
    this.fails = 0;
    this.count = 0;
    this.rate = 0;
    this.connected = false;
    this.url = '';
    this._timer = null;
    this._rateTimer = null;
    this.seen = new Set();
  }

  endpoints() {
    const list = [];
    // An explicit socket first: a provider's WebSocket is often on another host than its HTTP endpoint, and a URL
    // guessed by swapping the scheme never connects (FluxRPC: `wss://ws.eu.fluxrpc.com`).
    if (this.customWs && /^wss?:\/\//.test(this.customWs)) list.push(this.customWs.trim());
    for (const rpc of this.customRpcs || []) {
      if (rpc && /^https:\/\//.test(rpc)) {
        const derived = rpc.replace(/^https:/, 'wss:');
        if (!list.includes(derived)) list.push(derived);
      }
    }
    if (!list.length && this.customRpc && /^https:\/\//.test(this.customRpc)) list.push(this.customRpc.replace(/^https:/, 'wss:'));
    return list.concat(PUBLIC_WS);
  }

  start() {
    if (this.want) return;
    this.want = true; this.fails = 0;
    this._rateTimer = setInterval(() => { this.rate = this.count; this.count = 0; }, 1000);
    this._timer = setInterval(() => this._watchdog(), 5000);
    this._open();
  }

  stop() {
    this.want = false;
    clearTimeout(this._retryTimer);
    clearInterval(this._rateTimer); clearInterval(this._timer);
    if (this.ws) { try { this.ws.terminate(); } catch (_) {} this.ws = null; }
    this.connected = false;
  }

  _open() {
    if (!this.want) return;
    const eps = this.endpoints();
    this.url = eps[this.idx % eps.length];
    let ws;
    try { ws = new WebSocket(this.url); } catch (e) { return this._retry(); }
    this.ws = ws;
    ws.on('open', () => {
      this.lastMsg = Date.now();
      // A Geyser-class endpoint answers `transactionSubscribe`; a plain node answers `logsSubscribe`. Both deliver the
      // program's own `Program data:` lines, which is what the decoder reads.
      ws.send(JSON.stringify(this.geyser
        ? {
          jsonrpc: '2.0', id: 1, method: 'transactionSubscribe',
          params: [
            { accountInclude: [PUMP_PROGRAM], failed: false, vote: false },
            { commitment: 'confirmed', encoding: 'jsonParsed', transactionDetails: 'full', showRewards: false, maxSupportedTransactionVersion: 0 },
          ],
        }
        : { jsonrpc: '2.0', id: 1, method: 'logsSubscribe', params: [{ mentions: [PUMP_PROGRAM] }, { commitment: 'processed' }] }));
    });
    ws.on('message', (d) => { if (ws !== this.ws) return; this.lastMsg = Date.now(); this._onMessage(d.toString()); });
    ws.on('error', () => {});
    ws.on('close', () => {
      if (ws !== this.ws) return;
      const was = this.connected;
      this.connected = false; this.ws = null;
      this.emit('status', { connected: false, url: this.url });
      if (this.want) { if (!was) this.fails++; this._retry(); }
    });
  }

  _retry() {
    this.idx++;
    if (this.fails >= 4) this.emit('giveup');
    clearTimeout(this._retryTimer);
    if (this.want) this._retryTimer = setTimeout(() => this._open(), Math.min(5000, 400 * (this.fails + 1)));
  }

  _watchdog() {
    if (this.want && this.ws && Date.now() - this.lastMsg > STALE_MS) { try { this.ws.terminate(); } catch (_) {} }
  }

  _onMessage(raw) {
    let m; try { m = JSON.parse(raw); } catch (_) { return; }
    if (m.id === 1 && m.error) { this.fails = 99; this.emit('error', new Error(m.error.message || 'subscribe failed')); try { this.ws.terminate(); } catch (_) {} return; }
    if (m.id === 1 && typeof m.result === 'number') { this.connected = true; this.fails = 0; this.emit('status', { connected: true, url: this.url }); return; }
    // A Geyser-class notification: the whole transaction with its meta. The decode path is still the program's own
    // `Program data:` lines, so a provider that streams transactions needs no second decoder and no second set of rules -
    // only a different envelope, and that is the whole point of the faster transport.
    if (m.method === 'transactionNotification' || m.method === 'transaction' || m.method === 'blockNotification') {
      const res = (m.params && m.params.result) || {};
      const tx = res.transaction && res.transaction.transaction ? res.transaction.transaction : null;
      const meta = res.meta || (res.transaction && res.transaction.meta) || {};
      if (meta.err) return;
      const sig = res.signature || (tx && Array.isArray(tx.signatures) ? tx.signatures[0] : null);
      if (sig && this.seen.has(sig)) return;
      const events = decodeLogs(meta.logMessages);
      if (!events.length) return;
      if (sig) {
        if (this.seen.size >= 4096) this.seen.delete(this.seen.values().next().value);
        this.seen.add(sig);
      }
      for (const event of events) { this.count++; event.sig = sig || undefined; this.emit('event', event); }
      return;
    }
    if (m.method !== 'logsNotification') return;
    const v = m.params && m.params.result && m.params.result.value;
    if (!v || v.err || !Array.isArray(v.logs)) return;
    if (!v.signature || this.seen.has(v.signature)) return;
    const frames = [];
    const accepted = [];
    for (const line of v.logs) {
      if (typeof line !== 'string') return;
      const invoke = /^Program (\w+) invoke \[(\d+)\]$/.exec(line);
      if (invoke) {
        if (Number(invoke[2]) !== frames.length + 1) return;
        frames.push({ program: invoke[1], events: [] });
        continue;
      }
      const frame = frames.at(-1);
      if (!frame) continue;
      const end = /^Program (\w+) (success|failed:.*)$/.exec(line);
      if (end) {
        if (end[1] !== frame.program) return;
        frames.pop();
        if (end[2] === 'success') (frames.at(-1)?.events || accepted).push(...frame.events);
      } else if (frame.program === PUMP_PROGRAM && line.startsWith('Program data: ')) {
        const event = decodeEvent(line.slice(14));
        if (event) frame.events.push(event);
      }
    }
    if (frames.length || !accepted.length) return;
    if (this.seen.size >= 4096) this.seen.delete(this.seen.values().next().value);
    this.seen.add(v.signature);
    for (const event of accepted) { this.count++; event.sig = v.signature; this.emit('event', event); }
  }
}

module.exports = { ChainFeed, decodeEvent, decodeLogs, marketCapSol, b58, PUMP_PROGRAM };
