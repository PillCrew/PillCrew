const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Every scratch directory this suite makes lives under one root that is removed on exit, and roots left by an
// earlier run are swept (see `test/scratch.js`).
const scratchDir = require('./scratch').root;
const { Store } = require('../src/store');
const { Engine, DEFAULTS } = require('../src/engine');
const { curveAddress, readCurveAccount, readCurves, MIN_LEN } = require('../src/curve');

/** A curve account as the chain lays it out: 8 bytes of discriminator, five u64, then the flag. */
function account({ vTok, vSol, complete = false, size = 166 }) {
  const B = (x) => (typeof x === 'bigint' ? x : BigInt(Math.round(Number(x))));
  const b = Buffer.alloc(size);
  b.writeBigUInt64LE(B(vTok), 8);
  b.writeBigUInt64LE(B(vSol), 16);
  b.writeBigUInt64LE(B(vTok) / 2n, 24);
  b.writeBigUInt64LE(B(vSol) / 2n, 32);
  b.writeBigUInt64LE(1000000000000000n, 40);
  b[48] = complete ? 1 : 0;
  return { data: b };
}

const LAUNCH_VTOK = 1073000000000000n;
const LAUNCH_VSOL = 30000000000n;

(async () => {
  // A real mainnet pair, read while this was written: if the seeds or the program id ever change, this fails instead
  // of every price quietly going missing.
  assert.strictEqual(curveAddress('KeWKcBQbDLXopTghpa1gmTPnxeECLdoBHhc4Pcipump').toBase58(), 'GUPPeZ5Aukz1Pu35bV2M7BwwUPQ6Hv5qJ5LpzNC3LS8n');
  assert.strictEqual(curveAddress('KeWKcBQbDLXopTghpa1gmTPnxeECLdoBHhc4Pcipump').toBase58(), curveAddress('KeWKcBQbDLXopTghpa1gmTPnxeECLdoBHhc4Pcipump').toBase58(), 'the address is deterministic');
  assert.notStrictEqual(curveAddress('KeWKcBQbDLXopTghpa1gmTPnxeECLdoBHhc4Pcipump').toBase58(), curveAddress('So11111111111111111111111111111111111111112').toBase58(), 'a different mint is a different curve');
  assert.strictEqual(curveAddress('not a mint'), null, 'a mint that is not an address has no curve');

  // The launch curve: 30 SOL against 1.073e15 tokens is a 27.96 SOL market cap, and every real fresh coin reads
  // within a few percent of it (the ones on the board at 28-32 SOL have already taken a few trades). A curve that has
  // traded keeps the same shape further along.
  const fresh = readCurveAccount(account({ vTok: LAUNCH_VTOK, vSol: LAUNCH_VSOL }).data);
  assert.ok(fresh, 'a launch account is a curve');
  assert.ok(Math.abs(fresh.mcSol - 27.96) < 0.2, `a launch curve is about 27.96 SOL, got ${fresh.mcSol}`);
  assert.strictEqual(fresh.complete, false);

  // Half the tokens sold: the same product, twice the price per token, so about twice the market cap.
  const half = readCurveAccount(account({ vTok: LAUNCH_VTOK / 2n, vSol: LAUNCH_VSOL * 2n }).data);
  assert.ok(Math.abs(half.mcSol - fresh.mcSol * 4) < 1, `half the curve left is four times the cap, got ${half.mcSol}`);
  // Anything that is not a launch curve is not a price: a short buffer, a zero reserve, and an account whose reserves
  // are three orders of magnitude off (measured on a real stale account, which read a 27 971 SOL cap for a dead coin).
  assert.strictEqual(readCurveAccount(null), null);
  assert.strictEqual(readCurveAccount(Buffer.alloc(MIN_LEN - 1)), null, 'a short account is not a curve');
  assert.strictEqual(readCurveAccount(account({ vTok: 0n, vSol: LAUNCH_VSOL }).data), null, 'no tokens, no price');
  assert.strictEqual(readCurveAccount(account({ vTok: LAUNCH_VTOK, vSol: 30013507496196n }).data), null, 'a foreign account is refused');
  assert.strictEqual(readCurveAccount(account({ vTok: 1n, vSol: 1n }).data), null, 'an empty pool is refused');

  // One request for many coins, and a missing account is simply absent rather than a zero. The read asks for
  // `processed`: the freshest state a node serves, because a price read at `confirmed` is a slot or two older than
  // the pool really is.
  const a = 'KeWKcBQbDLXopTghpa1gmTPnxeECLdoBHhc4Pcipump';
  const b = 'So11111111111111111111111111111111111111112';
  const calls = [];
  const commitments = [];
  const curves = await readCurves(async (fn) => {
    calls.push(1);
    const out = await fn({
      getMultipleAccountsInfo: async (keys, commitment) => {
        commitments.push(commitment);
        return keys.map((k, i) => (i === 0 ? account({ vTok: LAUNCH_VTOK, vSol: LAUNCH_VSOL }) : null));
      },
    });
    return out;
  }, [a, b]);
  assert.strictEqual(calls.length, 1, 'one request for both coins');
  assert.strictEqual(commitments[0], 'processed', 'the read asks for the freshest state');
  assert.ok(curves.has(a), 'the curve that answered is there');
  assert.ok(!curves.has(b), 'the one that did not is absent, not zero');

  // The engine prices a coin it is holding from the curve when nothing else can: no stream, no price service, no board.
  {
    const store = new Store(fs.mkdtempSync(path.join(scratchDir, 'curve-')), 's.json', DEFAULTS);
    store.set({ mode: 'paper' });
    const e = new Engine({ exists: () => true, isUnlocked: () => true, address: () => 'W', keypair: null }, store);
    clearInterval(e._bal);
    clearInterval(e._ui);
    e._log = () => {};
    e.refreshBalance = () => {};
    e.market.prices = async () => new Map();
    e.market.enrich = async () => new Map();
    e.rpcCall = async (fn, opts) => fn({
      getMultipleAccountsInfo: async (keys) => keys.map(() => account({ vTok: LAUNCH_VTOK, vSol: LAUNCH_VSOL * 2n })),
    }, opts);
    const mint = 'KeWKcBQbDLXopTghpa1gmTPnxeECLdoBHhc4Pcipump';
    e.positions.set(mint, {
      mint, symbol: 'BLIND', entryMc: 27.96, mc: 27.96, peakMc: 27.96, solIn: 0.02, feeBuy: 0.0002,
      openedAt: Date.now(), status: 'open', closing: false, paper: true,
    });
    e.tokens.set(mint, { mint, symbol: 'BLIND', mc: 27.96, mcHist: [], trades: [], status: 'bought' });
    const before = e._pnlPct(e.positions.get(mint));
    await e._pollPositions();
    const p = e.positions.get(mint);
    assert.ok(Math.abs(p.mc - 55.9) < 1, `the curve price is the position's price now, got ${p.mc}`);
    assert.ok(e._pnlPct(p) > before + 80, `the move is visible: ${before} -> ${e._pnlPct(p)}`);
    assert.strictEqual(p.pxSource, 'curve');
    // A price the stream already gave is not overridden: the curve is the fallback, not the authority.
    e.tokens.get(mint).lastStreamAt = Date.now();
    e.tokens.get(mint).mc = 60;
    e._curveAt = 0;
    await e._pollPositions();
    assert.ok(Math.abs(e.positions.get(mint).mc - 60) < 0.01, 'a live stream still wins');
  }

  // The ENTRY is priced at the pool, and refused when the board behind the decision is behind a fall. Measured in
  // paper on the live market, entries booked at the board's price showed -18% to -31% on the very first pool reading,
  // which booked a stop loss 0 to 16 s after the buy on a coin that had not fallen that far: the entry was blind, not
  // the exit late.
  {
    const store = new Store(fs.mkdtempSync(path.join(scratchDir, 'curve-')), 's.json', DEFAULTS);
    store.set({ mode: 'paper' });
    const e = new Engine({ exists: () => true, isUnlocked: () => true, address: () => 'W', keypair: null }, store);
    clearInterval(e._bal);
    clearInterval(e._ui);
    e._log = () => {};
    e.refreshBalance = () => {};
    const mint = 'KeWKcBQbDLXopTghpa1gmTPnxeECLdoBHhc4Pcipump';
    const withPool = (vSol) => {
      const v = typeof vSol === 'bigint' ? vSol : BigInt(Math.round(vSol));
      e.rpcCall = async (fn, opts) => fn({
        getMultipleAccountsInfo: async (keys) => keys.map(() => account({ vTok: LAUNCH_VTOK, vSol: v })),
      }, opts);
    };
    const tok = (mc) => ({ mint, symbol: 'P', mc, mcHist: [], trades: [], status: 'watching', lastActivity: Date.now() });

    // The pool IS the entry price, even when the board agrees with it.
    withPool(LAUNCH_VSOL);
    let p = await e._entryPrice(tok(27.96));
    assert.ok(!p.refuse, 'a fresh coin is buyable');
    assert.strictEqual(p.src, 'curve');
    assert.ok(Math.abs(p.mc - 27.96) < 0.2, `the entry price is the pool's own number, got ${p.mc}`);

    // The board says 100, the pool says 60: the coin fell while it was being judged, and it is not bought.
    withPool(Number(LAUNCH_VSOL) * (60 / 27.96));
    p = await e._entryPrice(tok(100));
    assert.match(String(p.refuse), /dropped 40%/, `the refusal names the fall, got ${p.refuse}`);

    // A coin running away from a slow row is still buyable, at the pool's price.
    withPool(Number(LAUNCH_VSOL) * (40 / 27.96));
    p = await e._entryPrice(tok(30));
    assert.ok(!p.refuse, 'a coin above the board is a coin in demand');
    assert.ok(Math.abs(p.mc - 40) < 0.5, `and it costs what the pool says, got ${p.mc}`);

    // A pool three times the board is not the same coin: the board is the safer number there.
    withPool(Number(LAUNCH_VSOL) * (81 / 27.96));
    p = await e._entryPrice(tok(20));
    assert.ok(!p.refuse);
    assert.strictEqual(p.mc, 20, 'a suspicious pool is ignored rather than trusted');

    // A board with NO price at all cannot veto the pool: a launch the board has not seen yet still has reserves, and
    // the pool is the number the order fills at. Passing the board's zero through opened the position at 0, so every
    // percentage was measured from the first price seen *after* the buy instead of from what was paid.
    withPool(Number(LAUNCH_VSOL) * (33 / 27.96));
    p = await e._entryPrice(tok(0));
    assert.ok(!p.refuse, 'a coin whose board price is missing is priced from its pool');
    assert.ok(Math.abs(p.mc - 33) < 0.5, `the pool is the entry price when the board has none, got ${p.mc}`);

    // RULE CHANGED 2026-11-05 (replaced "a live stream is a price on its own"): no pool price, no entry - the board is
    // somebody else's number, and every wrong percentage of the day was an entry on it. The offline harness still falls
    // back, because there is no money and no pool to ask.
    e.rpcCall = async () => { throw new Error('no node'); };
    p = await e._entryPrice(tok(25));
    assert.ok(p.refuse, 'no pool price means no entry, whatever the board says');
    assert.match(String(p.refuse), /No pool price to buy on/);
    e.offline = true;
    p = await e._entryPrice(tok(25));
    assert.ok(!p.refuse, 'the offline harness still prices from the board');
    assert.strictEqual(p.src, 'board');
    assert.ok(Math.abs(p.mc - 25) < 0.5, `offline the board is the entry, got ${p.mc}`);
    e.offline = false;
    const old = tok(25);
    old.lastActivity = Date.now() - 60000;
    e.offline = true;
    p = await e._entryPrice(old);
    e.offline = false;
    assert.match(String(p.refuse), /No fresh price/, 'a row nobody refreshed in a minute is not a price');

    // RULE ADDED 2026-11-05 (1.0.4: the scan and the tick were too slow for a sniper): a coin whose own tape
    // printed within the last 1.2 s already carries the POOL's price (`t.mc` is written straight from the curve by the trade
    // handler), so the entry does not wait 300-500 ms for an RPC read of the same number. Proven by making the read throw:
    // a fresh coin is still priced, a quiet one is not.
    const fresh = { mint, symbol: 'F', mc: 42, mcHist: [], trades: [], status: 'watching', lastActivity: Date.now(), lastStreamAt: Date.now() };
    let asked = 0;
    e.rpcCall = async () => { asked++; throw new Error('no node'); };
    p = await e._entryPrice(fresh);
    assert.ok(!p.refuse, 'a coin that just traded is priced without asking the pool again');
    assert.strictEqual(p.mc, 42, 'and at the price its own trade printed');
    assert.strictEqual(p.src, 'curve', 'a stream price IS a pool price, so the exit ladder keeps treating it as one');
    assert.strictEqual(asked, 0, 'nothing was asked of the node');
    const quiet = { ...fresh, lastStreamAt: Date.now() - 5000 };
    p = await e._entryPrice(quiet);
    assert.strictEqual(asked, 1, 'a quiet coin still gets the pool read');
    assert.ok(p.refuse, 'and with no node to answer it is refused rather than bought blind');
  }

  // A FINISHED curve is a fossil, not a price. Measured in a paper run on the live market: two coins were entered at a
  // frozen curve figure and then "ran" +264% and +308% within a second - the graduation number read as a market.
  {
    const store = new Store(fs.mkdtempSync(path.join(scratchDir, 'curve-')), 's.json', DEFAULTS);
    store.set({ mode: 'paper' });
    const e = new Engine({ exists: () => true, isUnlocked: () => true, address: () => 'W', keypair: null }, store);
    clearInterval(e._bal); clearInterval(e._ui);
    e._log = () => {}; e.refreshBalance = () => {};
    e.market.prices = async () => new Map();
    e.market.enrich = async () => new Map();
    const mint = 'KeWKcBQbDLXopTghpa1gmTPnxeECLdoBHhc4Pcipump';
    const fossil = () => account({ vTok: LAUNCH_VTOK, vSol: LAUNCH_VSOL * 3n, complete: true });
    e.rpcCall = async (fn, opts) => fn({ getMultipleAccountsInfo: async (keys) => keys.map(fossil) }, opts);

    // The entry: a graduated coin is priced by its market, never by the curve that stopped at graduation - and that
    // market must be the POOL the order fills against, which the graduated coin's PumpSwap row is. RULE CHANGED
    // 2026-11-05: a plain board number (foreign pool, or no row at all) is no longer a buy price; the row has to be
    // the graduated coin's own PumpSwap pair.
    const p1 = await e._entryPrice({ mint, symbol: 'G', mc: 300, mcHist: [], trades: [], status: 'watching', lastActivity: Date.now(), ext: { dexId: 'pumpswap', at: Date.now() } });
    assert.ok(!p1.refuse, 'a graduated coin with a live PumpSwap row is still buyable');
    assert.strictEqual(p1.mc, 300, 'and it costs that pool price, not the frozen curve');
    const pNone = await e._entryPrice({ mint, symbol: 'G2', mc: 300, mcHist: [], trades: [], status: 'watching', lastActivity: Date.now() });
    assert.ok(pNone.refuse, 'a graduated coin with no pool row is refused, not priced from a guess');

    // And a held one is not repriced by it.
    e.positions.set(mint, {
      mint, symbol: 'GRAD', entryMc: 300, mc: 300, peakMc: 300, solIn: 0.02, feeBuy: 0.0002,
      openedAt: Date.now(), status: 'open', closing: false, paper: true,
    });
    e.tokens.set(mint, { mint, symbol: 'GRAD', mc: 300, mcHist: [], trades: [], status: 'bought' });
    await e._pollPositions();
    const held = e.positions.get(mint);
    assert.strictEqual(held.mc, 300, 'the frozen curve does not move a graduated position');
    assert.notStrictEqual(held.pxSource, 'curve');
  }

  // A jump UP in the curve is two numbers from two sources until it is seen twice; a FALL is taken at once, because a
  // stop must fire on it.
  {
    const store = new Store(fs.mkdtempSync(path.join(scratchDir, 'curve-')), 's.json', DEFAULTS);
    store.set({ mode: 'paper' });
    const e = new Engine({ exists: () => true, isUnlocked: () => true, address: () => 'W', keypair: null }, store);
    clearInterval(e._bal); clearInterval(e._ui);
    e._log = () => {}; e.refreshBalance = () => {};
    e.market.prices = async () => new Map();
    e.market.enrich = async () => new Map();
    const mint = 'KeWKcBQbDLXopTghpa1gmTPnxeECLdoBHhc4Pcipump';
    let vSol = LAUNCH_VSOL;
    e.rpcCall = async (fn, opts) => fn({
      getMultipleAccountsInfo: async (keys) => keys.map(() => account({ vTok: LAUNCH_VTOK, vSol, complete: false })),
    }, opts);
    const put = (mc) => {
      e.positions.set(mint, {
        mint, symbol: 'J', entryMc: 27.96, mc, peakMc: mc, solIn: 0.02, feeBuy: 0.0002,
        openedAt: Date.now(), status: 'open', closing: false, paper: true,
      });
      e.tokens.set(mint, { mint, symbol: 'J', mc, mcHist: [], trades: [], status: 'bought' });
      e._curveAt = 0;
    };
    const curveMc = (vs) => (Number(vs) * 1e6) / Number(LAUNCH_VTOK);

    // A 4x jump: refused on the first reading, accepted on the second one that agrees with it.
    vSol = Number(LAUNCH_VSOL) * 2.14;                 // about 60 SOL of market cap, against a position priced at 15
    put(15);
    await e._pollPositions();
    assert.ok(Math.abs(e.positions.get(mint).mc - 15) < 0.5, 'one wild reading does not move the position');
    e._curveAt = 0;
    await e._pollPositions();
    assert.ok(Math.abs(e.positions.get(mint).mc - curveMc(vSol)) < 2, 'two readings that agree are the price');
    assert.strictEqual(e.positions.get(mint).pxSource, 'curve');

    // A fall is taken immediately: a stop has to be able to fire on the first reading.
    vSol = Number(LAUNCH_VSOL) * 0.6;
    put(curveMc(Number(LAUNCH_VSOL) * 2.14));
    await e._pollPositions();
    assert.ok(Math.abs(e.positions.get(mint).mc - curveMc(vSol)) < 1, 'a curve that falls is the price at once');
  }

  console.log('Curve tests passed');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
