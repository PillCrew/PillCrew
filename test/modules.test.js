const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Every scratch directory this suite makes lives under one root that is removed on exit, and roots left by an
// earlier run are swept (see `test/scratch.js`).
const scratchDir = require('./scratch').root;
const reclaim = require('../src/reclaim');
const { Jupiter } = require('../src/jupiter');
const { Market } = require('../src/market');
const { Incinerator } = require('../src/incinerator');
const { Store } = require('../src/store');
const { Engine, DEFAULTS } = require('../src/engine');
const WSOL = 'So11111111111111111111111111111111111111112';

const fakeFetch = (handler) => { global.fetch = async (url, opts) => handler(url, opts || {}); };
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

(async () => {
  // ---- reclaim (pure logic) ----
  const parsed = (pub, amount, state = 'initialized', lamports = 2039280) => ({ pubkey: pub, account: { lamports, data: { parsed: { info: { mint: 'M' + pub, state, tokenAmount: { amount, uiAmount: Number(amount), decimals: 6 } } } } } });
  const accts = reclaim.normalise(reclaim.TOKEN_PROGRAM, [parsed('a', '0'), parsed('b', '500'), parsed('c', '0', 'frozen'), parsed('d', '0')]);
  const sum = reclaim.summarise(accts);
  assert.strictEqual(sum.empty.length, 2); assert.strictEqual(sum.dust.length, 1); assert.strictEqual(sum.frozen.length, 1);
  assert.ok(Math.abs(sum.emptyRentSol - 0.00407856) < 1e-9);
  const ix = reclaim.closeInstruction('acc', 'dest', 'own', 'prog');
  assert.deepStrictEqual([...ix.data], [9]); assert.strictEqual(ix.keys[2].isSigner, true); assert.strictEqual(ix.keys[0].isWritable, true);
  const sent = [];
  const many = Array.from({ length: 30 }, (_, i) => ({ pubkey: 'p' + i, amount: '0', frozen: false, lamports: 2039280, program: 'x' }));
  many.push({ pubkey: 'full', amount: '9', frozen: false, lamports: 1, program: 'x' }, { pubkey: 'frz', amount: '0', frozen: true, lamports: 1, program: 'x' });
  const r = await reclaim.closeEmpty({ accounts: many, sendChunk: async (g) => { sent.push(g.map((a) => a.pubkey)); if (sent.length === 2) throw new Error('boom'); return 'sig' + sent.length; } });
  assert.strictEqual(sent.length, 3);                              // 30 accounts, 12 per tx
  assert.ok(!sent.flat().includes('full') && !sent.flat().includes('frz'), 'never closes funded or frozen accounts');
  assert.strictEqual(r.closed, 18); assert.strictEqual(r.errors.length, 1); // failed batch does not stop the others

  // ---- Jupiter hint mapping ----
  // RULE CHANGED: the app reads Jupiter through the market scanner, so the dead trending() client is gone. What
  // still matters is that the hint maps the fields the API really returns: priceChange is already a percentage, the
  // audit block is the only safety signal, and there is no liquidity figure at all.
  const mkt = new Market();
  const hint = mkt._hintOf({
    id: 'AAAA1111111111111111111111111111111111111', name: 'Hot', symbol: 'HOT', dev: 'DEV111',
    mcap: 42000, stats5m: { priceChange: 12.5, numBuys: 40, numSells: 10, buyVolume: 900, sellVolume: 300 },
    audit: { mintAuthorityDisabled: false, freezeAuthorityDisabled: true, devBalancePercentage: 12.5 },
  });
  assert.strictEqual(hint.change5m, 12.5, 'a percentage stays a percentage');
  assert.strictEqual(hint.netUsd, 600);
  assert.strictEqual(hint.creator, 'DEV111');
  assert.strictEqual(hint.mintRisk, true, 'a live mint authority is a real risk');
  assert.strictEqual(hint.freezeRisk, false);
  assert.strictEqual(hint.liqUsd, 0, 'Jupiter publishes no pool depth');
  assert.strictEqual(hint.devHoldPct, 12.5);
  const safe = mkt._hintOf({ id: 'B', symbol: 'B', audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true } });
  assert.strictEqual(safe.mintRisk, false);
  assert.strictEqual(safe.freezeRisk, false);

  // The swap client still has its own failure handling, and it refuses a route it did not get.
  const swapArgs = { keypair: { publicKey: { toBase58: () => 'x' } }, inputMint: 'a', outputMint: 'b', amountRaw: '1', slippageBps: 100 };
  const jup = new Jupiter();
  fakeFetch(() => res(401, {})); await assert.rejects(jup.swap(swapArgs), (e) => e.kind === 'auth');
  fakeFetch(() => res(429, {})); await assert.rejects(jup.swap(swapArgs), /rate limit/i);
  fakeFetch(() => res(200, { transaction: null }));
  await assert.rejects(jup.swap(swapArgs), /no route/i);
  // RULE CHANGED 2026-11-05: Jupiter needs no key, but a key can be given - and the operator's own key is what the
  // app now sends. Measured on 2026-11-04 the order endpoint answered without one in about 120 ms; measured on
  // 2026-11-05 the same host refused this machine's IP for minutes at a time, which is what a key fixes.
  let sawKeyHeader = false;
  fakeFetch((u, o) => { if (o.headers['x-api-key']) sawKeyHeader = true; return res(200, { transaction: null }); });
  await assert.rejects(jup.swap(swapArgs), /no route/i);
  assert.strictEqual(sawKeyHeader, false, 'without a key, no key header is sent');
  let seen = null;
  const jupKeyed = new Jupiter({ getKey: () => 'JUPKEY123' });
  fakeFetch((u, o) => { seen = o.headers['x-api-key']; return res(200, { transaction: null }); });
  await assert.rejects(jupKeyed.swap(swapArgs), /no route/i);
  assert.strictEqual(seen, 'JUPKEY123', 'with one, every Jupiter call carries it');
  // A quote for a different amount is refused before anything is signed.
  fakeFetch(() => res(200, { transaction: 'AA==', inAmount: '999' }));
  await assert.rejects(jup.swap(swapArgs), /different amount/i);

  // ---- Sol Incinerator client ----
  let call;
  fakeFetch((url, o) => { call = { url, o }; return res(200, { transactions: ['t'], accountsClosed: 3 }); });
  const inc = new Incinerator(() => 'INCKEY');
  const out = await inc.batchCloseAll('Wallet1', 100);
  assert.strictEqual(call.url, 'https://v2.api.sol-incinerator.com/batch/close-all');
  assert.strictEqual(call.o.headers['x-api-key'], 'INCKEY');
  assert.deepStrictEqual(JSON.parse(call.o.body), { userPublicKey: 'Wallet1', limit: 100, offset: 0 });
  assert.strictEqual(out.accountsClosed, 3);
  await inc.burn('Wallet1', 'Mint1'); assert.deepStrictEqual(JSON.parse(call.o.body), { userPublicKey: 'Wallet1', assetId: 'Mint1', autoCloseTokenAccounts: true });
  fakeFetch(() => res(401, { error: 'bad' })); await assert.rejects(inc.burn('w', 'm'), /rejected the API key/);
  fakeFetch(() => res(429, {})); await assert.rejects(inc.burn('w', 'm'), /rate limit/);
  await assert.rejects(new Incinerator(() => '').burn('w', 'm'), /Add your Sol Incinerator API key/);

  // ---- engine: feed choice, retries, late landing, Jupiter backup ----
  const dir = fs.mkdtempSync(path.join(scratchDir, 'pcm-'));
  const wallet = { exists: () => true, isUnlocked: () => true, address: () => 'W', keypair: { publicKey: { toBase58: () => 'W' } } };
  const store = new Store(dir, 's.json', DEFAULTS);
  // RULE CHANGED 2026-11-05: the shipped profile now runs three positions at a time (the measured profit plan), and
  // this harness opens one position per scenario without ever closing it. Room to spare keeps each case testing its
  // own rule instead of the third slot filling up.
  store.set({ minTokenAgeSec: 0, paperLatencyMs: 0, maxPositions: 8, maxBuysPerMin: 60 });
  const e = new Engine(wallet, store);
  e.risk.check = async () => null;
  clearInterval(e._bal); clearInterval(e._ui); e.refreshBalance = () => {};
  let used = null; e._connectPortal = () => { used = 'portal'; }; e._startChain = () => { used = 'chain'; };
  e.wantWs = false; e._connect(); assert.strictEqual(used, 'chain', 'auto without credentials uses public program logs');
  store.set({ rpcUrl: 'https://private.example/key' }); e._connect(); assert.strictEqual(used, 'chain', 'auto with private RPC uses the blockchain feed');
  store.set({ rpcUrl: '', feedSource: 'chain' }); e._connect(); assert.strictEqual(used, 'chain');
  store.set({ feedSource: 'auto' });

  store.set({ mode: 'live', rpcUrl: '' });
  e.running = true; e.walletBalance = 5;
  const mk = (mint) => { const t = { mint, name: 'T', symbol: 'T', creator: 'c', createdAt: Date.now() - 60000, mc: 40, mcHist: [], trades: [], devSold: false, status: 'watching', score: 70, reason: '', lastActivity: Date.now() }; e.tokens.set(mint, t); return t; };
  const ev = { score: 80, m: { buyers: 6 } };

  // The backup route answers without a key now, so a build failure goes there first. Here it is made to fail as
  // well, which is what a coin with no Jupiter route looks like.
  e._jupiterSwap = async () => { throw Object.assign(new Error('Jupiter has no route'), { phase: 'build', definite: true }); };
  let attempts = 0;
  e._execLive = async () => { attempts++; if (attempts === 1) { const err = new Error('Trade API timed out'); err.phase = 'build'; throw err; } return { sig: 's', raw: null }; };
  // RULE CHANGED: confirmation now has three outcomes ('confirmed' / 'failed' / 'unknown'), because "the RPC could
  // not tell me" must never be read as "it failed".
  e._confirm = async () => ({ state: 'confirmed', err: '' }); e._tokenBalanceRaw = async () => 0n;
  // RULE CHANGED 2026-11-05: a live entry now REQUIRES the pool's own price (`_entryPrice` refuses a board-only coin),
  // and this harness has no node to read one from. The test is about the retry ladder, not about pricing, so the pool
  // number is supplied directly.
  e._entryPrice = async () => ({ mc: 40, src: 'curve' });
  const t1 = mk('M1'); await e._buy(t1, ev);
  assert.strictEqual(e.positions.size, 0); assert.strictEqual(t1.status, 'watching'); assert.ok(t1.retryAt > Date.now(), 'failed buy is retried, not abandoned');
  e._evalOne(t1, Date.now()); assert.strictEqual(e.positions.size, 0, 'retry waits for its cooldown');
  t1.retryAt = 0; await e._buy(t1, ev);
  assert.strictEqual(e.positions.get('M1').status, 'open');

  e._execLive = async () => { throw new Error('sendRawTransaction timed out'); }; e._confirm = async () => ({ state: 'unknown', err: '' }); e._tokenBalanceRaw = async () => 5n;
  const t2 = mk('M2'); await e._buy(t2, ev);
  assert.strictEqual(e.positions.get('M2').status, 'open', 'a buy that landed late is adopted, not orphaned');

  e._tokenBalanceRaw = async () => 0n;
  e._jupiterSwap = async () => 'jsig';
  e._execLive = async () => { const err = new Error('Trade API timed out'); err.phase = 'build'; throw err; };
  const t3 = mk('M3'); await e._buy(t3, ev);
  assert.strictEqual(e.positions.get('M3').sig, 'jsig', 'the backup route is used when the order could not be built');

  // A failure AFTER the send is a different animal: the transaction may already be on chain, so the backup route
  // must never fire, or the same coin is bought twice with real money.
  let jupiterCalled = false;
  e._jupiterSwap = async () => { jupiterCalled = true; return 'jsig2'; };
  e._execLive = async () => { throw new Error('sendRawTransaction timed out'); };
  e._tokenBalanceRaw = async () => 0n;
  const t4 = mk('M4'); await e._buy(t4, ev);
  assert.strictEqual(jupiterCalled, false, 'a send failure never starts a second purchase');
  assert.ok(!e.positions.has('M4'), 'and no phantom position is booked');
  assert.strictEqual(t4.status, 'skipped', 'a send whose outcome the RPC cannot confirm is skipped, never re-bought');

  // Extra entry filters: the holder bar. While the switch is on, a coin under the bar is refused before any order,
  // and a coin whose holder count cannot be read is refused too - a filter that silently passes when its data
  // source is down is not a filter.
  // RULE CHANGED 2026-11-05: the shipped profile is the simple one, and the simple mode deliberately turns the extra
  // entry filters off - so the holder bar is only live with the simple mode off, exactly as the app does it when the
  // user opens those filters.
  store.set({ simpleMode: false, deepEntry: true, minHolders: 20 });
  e.market.holders = async () => ({ holders: 7 });
  const t5 = mk('M5'); await e._buy(t5, ev);
  assert.ok(!e.positions.has('M5'), 'a coin under the holder bar is not bought');
  assert.match(t5.reason, /Needs 20 holders \(has 7\)/, 'and the reason names the bar and the count');
  assert.strictEqual(t5.status, 'watching', 'the coin stays on the list');

  e.market.holders = async () => null;
  const t6 = mk('M6'); await e._buy(t6, ev);
  assert.ok(!e.positions.has('M6'), 'an unknown holder count is not bought');
  assert.match(t6.reason, /Holder count unknown/);

  // Once the count is known it is the evaluator that refuses the coin, with no request at all.
  // RULE CHANGED 2026-11-05: the shipped profile is the measured plan (60-500 SOL, 30 buyers, a 78 score), and this
  // 44 SOL coin with eight buyers is deliberately not it. What this block tests is the ORDER of the gates - a count
  // already on the cache must refuse the coin before any other rule is consulted - so it supplies its own bars and
  // puts the shipped ones back afterwards.
  store.set({ minScore: 0, minBuyers: 5, minNetFlowSol: 0.5, minMcSol: 10, maxMcSol: 500, minChange5mPct: 0, maxChange5mPct: 0 });
  const nowH = Date.now();
  const t7 = mk('M7');
  t7.holders = 7;
  t7.mc = 44;
  t7.trades = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ ts: nowH - 1000, side: 'buy', sol: 0.5, trader: 'w' + n }));
  t7.mcHist = [[nowH - 2000, 40], [nowH, 44]];
  t7.lastStreamAt = nowH;
  let holderCalls = 0;
  e.market.holders = async () => { holderCalls++; return { holders: 40 }; };
  assert.match(e._eval(t7, nowH).reason, /current pool liquidity/);
  t7.ext = { at: nowH, liqUsd: 9000 };
  const held = e._eval(t7, nowH);
  assert.match(held.reason, /Needs 20 holders \(has 7\)/, `the cached gate refuses before any other rule, got "${held.reason}"`);
  t7.holders = 40;
  assert.strictEqual(e._eval(t7, nowH).reason, 'Looks strong', 'a coin over the bar passes as before');
  assert.strictEqual(holderCalls, 0, 'the evaluator never asks for a count it already has');
  // The rest of this harness exercises the FULL desk (audits, dev bags, the five minute band), so it is put back on
  // the shipped numbers with the simple mode off - the shipped default is the simple one.
  store.set({ ...DEFAULTS, paperLatencyMs: 0, minTokenAgeSec: 0, simpleMode: false, deepEntry: false, minHolders: 0 });

  // sell: confirmation timed out but tokens are gone -> treated as sold
  e._execLive = async () => ({ sig: 's', raw: null }); e._confirm = async () => ({ state: 'unknown', err: '' }); e._tokenBalanceRaw = async () => 0n; e._scheduleReclaim = () => {};
  await e._sell(e.positions.get('M1'), 'Time limit');
  assert.ok(!e.positions.has('M1') && e.history[0].symbol === 'T', 'late-landing sell is detected');

  // RULE CHANGED (v2 rewrite): the Jupiter-only "trending" feeder became the market sweep, so the tracker is fed
  // through _adopt() with a source tag and a hint. The market module now marks a coin it knows came from
  // Pump.fun, and the engine trusts that flag instead of guessing from the door name.
  e.positions.clear(); e.tokens.clear();
  assert.ok(e._adopt({ mint: 'TR1', source: 'trending', launched: true, hint: { name: 'N', symbol: 'S', mintRisk: true, mcapUsd: 6000, liqUsd: 9000, change5m: 12, buys: 40, sells: 10, creator: 'DEV' } }));
  assert.ok(!e._adopt({ mint: 'TR1', source: 'callout' }), 'no duplicates');
  assert.strictEqual(e.tokens.get('TR1').launched, true, 'a Jupiter pump.fun coin counts as launched');
  assert.strictEqual(e.tokens.get('TR1').creator, 'DEV', 'the dev is known from the hint, so the coin is not judged blind');
  assert.strictEqual(e.tokens.get('TR1').creatorUnknown, false);
  assert.strictEqual(e._adopt({ mint: 'BLIND1', source: 'callout' }), true);
  assert.strictEqual(e.tokens.get('BLIND1').launched, false, 'a boosted coin has no launch proof until its pair is priced');
  assert.strictEqual(e.tokens.get('BLIND1').creatorUnknown, true);

  const tt = e.tokens.get('TR1');
  // RULE CHANGED: the reason names a fact from the token audit instead of a field Jupiter does not publish.
  assert.strictEqual(e._eval(tt, Date.now()).reason, 'Creator can still mint more');
  delete tt.ext.mintRisk;
  tt.ext.freezeRisk = true;
  assert.strictEqual(e._eval(tt, Date.now()).reason, 'Token can be frozen');
  delete tt.ext.freezeRisk;
  tt.ext.devHoldPct = 55;
  assert.strictEqual(e._eval(tt, Date.now()).reason, 'Creator holds too much');
  delete tt.ext.devHoldPct;

  // A coin from a callout has no launch history: it is judged on market data alone, and a non-pump pair is dropped.
  e._adopt({ mint: 'CL1', source: 'callout' });
  assert.ok(e.tokens.get('CL1'), 'adopted');
  e._applyMarket('CL1', { mint: 'CL1', dexId: 'raydium', mcapUsd: 12000, liqUsd: 20000, priceNative: 0.000012, priceUsd: 1, buys: 30, sells: 5, change5m: 20, netUsd: 500 });
  assert.strictEqual(e.tokens.get('CL1').status, 'skipped', 'a coin that is not on Pump.fun is dropped');
  e._adopt({ mint: 'CL2', source: 'callout' });
  e._applyMarket('CL2', { mint: 'CL2', dexId: 'pumpfun', mcapUsd: 12000, liqUsd: 20000, priceNative: 0.000012, priceUsd: 1, buys: 30, sells: 5, change5m: 20, netUsd: 500 });
  assert.strictEqual(e.tokens.get('CL2').status, 'watching', 'a pump.fun pair is kept');
  assert.ok(e.tokens.get('CL2').mc > 0, 'and it gets a price from the market');

  // Market metrics replace the stream when there are no live trades: the coin can now be scored at all.
  const cm = e._metrics(e.tokens.get('CL2'), Date.now(), 20);
  assert.strictEqual(cm.source, 'market');
  assert.strictEqual(cm.buys, 30);
  assert.ok(cm.growth > 0.1, 'the 5m move is read as growth');

  // RULE ADDED: a dollar figure cannot be turned into SOL without an exchange rate. It used to be divided by a
  // made-up 1, which booked thousands of SOL of net buying and handed every scanned coin full marks on the strongest
  // entry rule. Without a rate the honest reading is zero - no evidence of buying - so the coin does not pass.
  const wasRate = e.market.solUsd;
  e.market.solUsd = 0;
  assert.strictEqual(e._metrics(e.tokens.get('CL2'), Date.now(), 20).net, 0, 'no exchange rate, no invented net flow');
  e.market.solUsd = 150;
  assert.ok(e._metrics(e.tokens.get('CL2'), Date.now(), 20).net > 0, 'with a rate the net flow is real again');
  e.market.solUsd = wasRate;

  // A position with no live stream is priced from the quote the market gives, so it can hit its target or its stop.
  e.market.solUsd = 100;
  const pos = { mint: 'CL2', symbol: 'S', entryMc: 120, mc: 120, solIn: 0.02, feeBuy: 0.0001, openedAt: Date.now(), status: 'open', paper: false };
  e.positions.set('CL2', pos);
  // RULE CHANGED: the market board no longer moves the price a position is measured at - on a fresh coin its quote is
  // an aggregate of every pool, not the one the order fills against. It only supplies the fallback quote, which is what
  // the price service also does, and the arithmetic is asserted through that path.
  // RULE ADDED: a quote is only a price while it is recent (`pxPullAt`). A held position whose curve is silent, whose
  // price service answer stopped coming back and whose board row is gone used to keep trading on the last number it
  // ever saw - and a rule firing on that is a sale at a price that no longer exists.
  pos.pxPull = 1;
  pos.pxPullAt = Date.now();
  e._pricePosition(pos, Date.now());
  assert.strictEqual(pos.mc, 120, 'the baseline is the entry');
  pos.pxPull = 1.3;
  pos.pxPullAt = Date.now();
  e._pricePosition(pos, Date.now());
  assert.ok(Math.abs(e._pnlPct(pos) - (30 - e._costPct(pos))) < 0.01, `a +30% price move must show net of every cost, got ${e._pnlPct(pos)}`);
  {
    const frozen = pos.mc;
    pos.pxPull = 2.2;
    pos.pxPullAt = Date.now() - 30000;
    e._pricePosition(pos, Date.now());
    assert.strictEqual(pos.mc, frozen, 'a quote nobody refreshed for 30 s is not a price');
    pos.pxPullAt = Date.now();
    pos.pxPull = 1.3;
    e._pricePosition(pos, Date.now());
  }
  // RULE CHANGED: the percentage is net of the tips too, and the tips are the ones the trade really pays - the entry
  // tip recorded on the position and what an exit would cost right now - not the configured ceiling. On a 0.02 SOL
  // ticket with a 0.0001 entry tip and a 0.0002 exit tip that is 1.5% of the round trip, where a fixed-amount tip of
  // 0.0002 both ways on a 0.004 ticket is 10%. That is exactly why the old defaults looked like they lost money: a
  // "break even" that fired at 0% was really booked at -2% (and at -10% on a 0.004 ticket).
  assert.ok(Math.abs(e._costPct(pos) - (3.5 + 1.525)) < 0.01, `protocol, priority and base network fees are included, got ${e._costPct(pos)}`);

  // A quote that jumps further than anything believable in one tick does not drag the price: the anchor stays put, so
  // one wild print on a thin pool cannot show +135% and then -70% a second later.
  const before = pos.mc;
  pos.pxPull = 4;
  pos.pxPullAt = Date.now();
  e._pricePosition(pos, Date.now());
  assert.strictEqual(pos.mc, before, 'an implausible quote is not believed');

  // The stream, when it is alive, is the price: it comes from the bonding curve the order itself fills against.
  // RULE CHANGED: a position used to keep the stream price for the rest of its life once a single trade had been seen,
  // so a coin whose stream went quiet froze at its last stream price and its stop could never fire.
  pos.extRef = null;
  e.tokens.get('CL2').lastStreamAt = Date.now();
  e.tokens.get('CL2').mc = 156;
  e._pricePosition(pos, Date.now());
  assert.ok(Math.abs(pos.mc - 156) < 0.01, 'a fresh stream sets the price');
  e.tokens.get('CL2').lastStreamAt = Date.now() - 30000;
  pos.extRef = null;
  pos.pxPull = 2;
  pos.pxPullAt = Date.now();
  e._pricePosition(pos, Date.now());
  assert.ok(Math.abs(pos.mc - 156) < 0.01, 'a silent stream hands the price to the quote, anchored where it left off');
  pos.pxPull = 2.6;
  pos.pxPullAt = Date.now();
  e._pricePosition(pos, Date.now());
  assert.ok(Math.abs(pos.mc - 202.8) < 0.01, `and then it follows it, got ${pos.mc}`);

  // A free trade stream caps live token subscriptions (PumpDev: 25) and control messages (40 per 10 s). The app
  // used to subscribe to every scanned coin, which broke both caps and dropped the stream; it now sends one
  // batched call for the best candidates plus every open position.
  e.positions.clear(); e.tokens.clear(); e._subbed = new Set();
  const wire = [];
  e.ws = { readyState: 1, send: (raw) => wire.push(JSON.parse(raw)) };
  const { WebSocket: WS } = require('ws');
  e.ws.readyState = WS.OPEN;
  // RULE ADDED: the token-trade verbs only exist on the PumpDev stream, so a PumpPortal socket must never be sent
  // them - it would read them as a launch filter and the feed would go quiet.
  e._feedLabel = 'pumpportal';
  e._syncSubscriptions();
  assert.strictEqual(wire.length, 0, 'no token subscription went to a launches-only socket');
  e._feedLabel = 'pumpdev';
  for (let i = 0; i < 40; i++) {
    e._adopt({ mint: 'S' + i, source: 'callout' });
    const t = e.tokens.get('S' + i);
    t.mc = 40;
    t.score = i;
  }
  e._syncSubscriptions();
  assert.strictEqual(wire.length, 1, 'one batched control message, not one per coin');
  assert.strictEqual(wire[0].method, 'subscribeTokenTrade');
  assert.strictEqual(wire[0].keys.length, 20, 'the subscription budget is respected');
  assert.ok(wire[0].keys.includes('S39'), 'the highest score is watched');

  e.positions.set('POS1', { mint: 'POS1', entryMc: 40, mc: 40 });
  wire.length = 0;
  e._syncSubscriptions();
  assert.ok(wire.some((m) => m.keys.includes('POS1')), 'an open position is always watched');
  assert.strictEqual(e._subbed.size, 20, 'the budget still holds after adding a position');

  // RULE ADDED: the watched set is sticky. Re-ranking alone must not swap coins in and out - every swap is a control
  // message and the plan counts the subscribe and the unsubscribe, which is what tripped "25 subscriptions per IP"
  // while only twenty were ever wanted.
  const flip = () => {
    for (let i = 0; i < 40; i++) e.tokens.get('S' + i).score = i < 20 ? 100 - i : 1;
  };
  flip();
  wire.length = 0;
  e._syncSubscriptions();
  assert.strictEqual(wire.length, 0, 'a re-rank alone changes nothing while the watched coins are active');

  // A newcomer does take a slot - but only from a coin that has been quiet, and only by a clear margin.
  for (const mint of e._subbed) { const t = e.tokens.get(mint); if (t) t.lastActivity = Date.now() - 120000; }
  e._syncSubscriptions();
  assert.ok(wire.some((m) => m.method === 'subscribeTokenTrade'), 'the better candidates get in once the others are quiet');
  assert.strictEqual(e._subbed.size, 20, 'and the budget is still respected');

  // RULE ADDED 2026-11-05: the plan itself reports the IP's allowance is gone (measured live while the app only ever
  // asked for twenty). The desk cannot add to somebody else's budget, so it makes room for its own: the budget drops,
  // the candidates are released, and an open position keeps its stream.
  wire.length = 0;
  e._onMessage(JSON.stringify({ type: 'error', message: 'your free plan allows 25 live subscriptions per IP and this IP has reached it' }));
  assert.strictEqual(e._subBudget, 12, 'the desk shrinks its own budget when the plan reports the limit');
  assert.ok(e._subbed.size <= 12, 'and the extra candidates are released');
  assert.ok(e._subbed.has('POS1'), 'the open position keeps its stream');
  assert.ok(wire.every((m) => m.keys.length > 0), 'nothing empty is sent');

  // The smaller budget is temporary: ten quiet minutes later the desk asks for its usual set again, so a limit that
  // belonged to somebody else on the same address does not leave this desk crippled for the rest of the session.
  e._subLimitAt = Date.now() - 11 * 60 * 1000;
  e._syncSubscriptions();
  assert.strictEqual(e._subBudget, 20, 'the budget comes back after ten quiet minutes');
  e._subBudget = 12;
  e._subLimitAt = Date.now();

  wire.length = 0;
  e.tokens.clear(); e.positions.clear();
  e._syncSubscriptions();
  assert.strictEqual(wire[0].method, 'unsubscribeTokenTrade', 'coins that were dropped are released in one call');
  assert.strictEqual(e._subbed.size, 0);
  e.ws = null;

  // A fresh buy on the stream must never make a coin that fell hard look alive: the entry is judged on the worse
  // of the stream window and the market's five minute change. Measured on the live feed: a coin down 84% in five
  // minutes was offered to the desk with a score of 92 because one trade had ticked up.
  e.tokens.clear();
  e._adopt({ mint: 'DUMP1', source: 'curve', launched: true, hint: { symbol: 'DUMP', name: 'Dump', priceNative: 0.00000003, liqUsd: 9000, change5m: -84, buys: 24, sells: 40 } });
  const dump = e.tokens.get('DUMP1');
  for (let i = 0; i < 6; i++) dump.trades.push({ ts: Date.now(), side: 'buy', sol: 1, trader: 'w' + i });
  dump.lastStreamAt = Date.now();
  dump.score = 0;
  assert.match(e._eval(dump, Date.now()).reason, /Dumping hard/, 'a crashed coin is refused even when a trade ticks up');

  e._adopt({ mint: 'SELL1', source: 'curve', launched: true, hint: { symbol: 'SELL', name: 'Sell', priceNative: 0.00000003, liqUsd: 9000, change5m: 8, buys: 6, sells: 30 } });
  const sellers = e.tokens.get('SELL1');
  assert.match(e._eval(sellers, Date.now()).reason, /Sellers in control/, 'a market dominated by sellers is refused');

  // ---- simple settings: only the basic numbers decide ----
  // RULE ADDED: the simple mode gates the entry on the market cap band, the buyer floor and ceiling, and a price that
  // is not falling. The score, the net flow, the depth, the dev bags and the five minute band are advanced rules, and
  // while the simple mode is on they stop deciding.
  store.set({ simpleMode: true, maxBuyers: 5, minBuyers: 3, minNetFlowSol: 1, minMcSol: 20, maxMcSol: 100 });
  e.tokens.clear();
  const simp = (mint, traders) => {
    const t = { mint, name: 'T', symbol: 'T', creator: 'c', createdAt: Date.now() - 5000, mc: 40, mcHist: [], trades: [], devSold: false, devBuySol: 0, status: 'watching', score: 70, reason: '', lastActivity: Date.now(), lastStreamAt: Date.now() };
    for (let i = 0; i < traders; i++) t.trades.push({ ts: Date.now(), side: 'buy', sol: 0.2, trader: 'w' + i });
    e.tokens.set(mint, t);
    return t;
  };
  const tFine = simp('SIMOK', 4); // 0.8 SOL of net buying - under the desk's 1 SOL bar, above the simple floor
  assert.strictEqual(e._eval(tFine, Date.now()).pass, true, 'the simple gate asks only for the band, the buyers and a price that is not falling');
  const tCrowd = simp('SIMCROWD', 6);
  assert.match(e._eval(tCrowd, Date.now()).reason, /Too many buyers \(6, cap 5\)/, 'the buyer ceiling fires in simple mode');
  // RULE ADDED 2026-11-05 (measured: `$SAFU` peaked at +3.5% and was stopped at -101.4%, and one rug like that takes the
  // whole session): the four checks that only REFUSE a rug-shaped coin are protection, not tuning, so they stay on in
  // the simple plan. None of them costs a request - they read the row the entry was already judged on.
  const tFat = simp('SIMFAT', 4);
  tFat.ext = { at: Date.now(), devHoldPct: 60, liqUsd: 9000, buys: 4, sells: 1 };
  assert.match(e._eval(tFat, Date.now()).reason, /Creator holds too much/, 'a creator holding most of the supply is refused in simple mode');
  const tThin = simp('SIMTHIN', 4);
  tThin.ext = { at: Date.now(), devHoldPct: 2, liqUsd: 300, buys: 4, sells: 1 };
  assert.match(e._eval(tThin, Date.now()).reason, /Pool too thin/, 'a pool that cannot absorb an exit is refused too');
  const tDom = simp('SIMDOM', 4);
  tDom.trades = [8, 1, 1, 1].map((sol, i) => ({ ts: Date.now(), side: 'buy', sol, trader: 'whale' + (i === 0 ? '' : i) }));
  tDom.ext = { at: Date.now(), devHoldPct: 2, liqUsd: 9000, buys: 4, sells: 1 };
  assert.match(e._eval(tDom, Date.now()).reason, /One wallet dominates buying/, 'one wallet buying the whole tape is refused');
  store.set({ simpleMode: false });
  assert.match(e._eval(tCrowd, Date.now()).reason, /Too many buyers/, 'and the same ceiling also gates the full desk');

  // RULE ADDED: the exit ladder keeps only the plain rules in the simple mode - the target, the stop and the time
  // limit. The first rung, the trail and the break even are advanced rules and are off while the mode is on, exactly
  // as the panel promises.
  // RULE CHANGED 2026-11-05: the shipped stop is the measured plan's 20%, so this simulation names the stop it is
  // actually testing rather than inheriting a number that moved.
  store.set({ simpleMode: true, takeProfitPct: 25, stopLossPct: 12, tp1Pct: 12, tp1SellPct: 50, trailArmPct: 8, breakEvenPct: 5, maxHoldSec: 600 });
  e.running = false; e.tokens.clear(); e.positions.clear();
  const realPnl = e._pnlPct;
  const realSell = e._sell;
  const realFee = e._refreshFee;
  e._refreshFee = () => {};
  const sold = []; e._sell = (p, why) => { sold.push(why); p.status = 'closed'; };
  const pSim = { mint: 'PTICK', status: 'open', entryMc: 100, mc: 115, peakMc: 130, tp1Done: false, openedAt: Date.now() - 20000, pxAt: Date.now() - 1000, trigger: null };
  e.positions.set('PTICK', pSim);
  e._pnlPct = () => 15; // past tp1 (12), under the target (25): the full desk would bank the first rung
  e._tick();
  assert.strictEqual(pSim.trigger, null, 'simple mode has no first rung');
  assert.strictEqual(sold.length, 0);
  store.set({ simpleMode: false });
  e._tick();
  assert.strictEqual(pSim.trigger && pSim.trigger.rule, 'Take profit part 1', 'the full desk still uses the first rung');
  store.set({ simpleMode: true });
  pSim.trigger = null;
  e._pnlPct = () => 30;
  e._tick();
  assert.strictEqual(pSim.trigger && pSim.trigger.rule, 'Take profit', 'the target still fires in simple mode');
  pSim.trigger = null;
  e._pnlPct = () => -15;
  e._tick();
  assert.strictEqual(pSim.trigger && pSim.trigger.rule, 'Stop loss', 'and the stop still fires in simple mode');
  e._pnlPct = realPnl; e.positions.clear(); e._sell = realSell; e._refreshFee = realFee;
  // RULE CHANGED: the settings touched above are put back exactly, so the store the rest of the suite shares is clean.
  store.set({ simpleMode: false, maxBuyers: 0, minBuyers: DEFAULTS.minBuyers, minNetFlowSol: DEFAULTS.minNetFlowSol, minMcSol: DEFAULTS.minMcSol, maxMcSol: DEFAULTS.maxMcSol, takeProfitPct: DEFAULTS.takeProfitPct, stopLossPct: DEFAULTS.stopLossPct, tp1Pct: DEFAULTS.tp1Pct, tp1SellPct: DEFAULTS.tp1SellPct, trailArmPct: DEFAULTS.trailArmPct, breakEvenPct: DEFAULTS.breakEvenPct, maxHoldSec: DEFAULTS.maxHoldSec });

  // RULE ADDED 2026-11-05: a handled failure is reported once a minute with a count, not once per failure. Ten
  // identical "rate limited" lines in six minutes on the live diary is noise, and noise is how a real warning is
  // missed.
  {
    const lines = [];
    const realLog = e._log;
    e._marketWarnAt = 0; e._marketFailsSeen = 0; e._hostDown = {}; e._hostFails = {};
    e._log = (level, msg) => lines.push(level + ': ' + msg);
    e._marketError(new Error('rate limited'));
    e._marketError(new Error('rate limited'));
    e._marketError(new Error('rate limited'));
    assert.strictEqual(lines.length, 1, 'the first failure is one line, and the rest are swallowed for a minute');
    assert.match(lines[0], /rate limited/, 'the same sentence the operator knows');
    assert.match(lines[0], /Every other door keeps working/, 'and it says the desk is still working, not broken');
    e._marketWarnAt = Date.now() - 61000;
    e._marketError(new Error('rate limited'));
    assert.strictEqual(lines.length, 2, 'a minute later the desk says it is still happening');
    assert.match(lines[1], /3 calls refused in the last minute/, 'and says how often, so the size of it is visible');
    e._marketWarnAt = Date.now() - 61000;
    e._marketError(new Error('rate limited'));
    assert.match(lines[2], /1 call refused/, 'one refusal reads as one call, not one calls');
    // RULE ADDED 2026-11-05: the line names the door, and the count belongs to THAT door. A shared counter printed
    // beside whichever source failed last claimed "jup-price: 28 calls" when most of them were somebody else's.
    const withHost = Object.assign(new Error('rate limited'), { host: 'jupiter' });
    e._marketWarnAt = Date.now() - 61000;
    e._marketError(withHost);
    assert.match(lines[lines.length - 1], /jupiter: rate limited/, 'the refused source is named');
    e._marketWarnAt = Date.now();
    e._marketError(withHost);                        // counted, not printed: inside the minute
    e._marketWarnAt = Date.now() - 61000;
    e._marketError(withHost);
    assert.match(lines[lines.length - 1], /jupiter: rate limited \(2 calls refused/, 'and it counts only its own refusals');
    e._log = realLog;
  }

  // RULE ADDED 2026-11-05: a FULL map must make room for a newcomer. Measured live: the tracked set sat at 400, the
  // board refreshed `lastActivity` for every coin on it, the pruner therefore found nothing idle, and no new launch was
  // ever tracked again - the desk went blind while the log kept saying how many it had "found".
  {
    const e2 = new Engine(wallet, new Store(fs.mkdtempSync(path.join(scratchDir, 'pcm-room-')), 's.json', DEFAULTS));
    clearInterval(e2._bal); clearInterval(e2._ui); e2.refreshBalance = () => {};
    for (let i = 0; i < 400; i++) {
      const t = { mint: 'OLD' + i, symbol: 'OLD', createdAt: Date.now() - 60000, lastActivity: Date.now(), mc: 40, mcHist: [], trades: [], status: 'watching', score: 50, reason: '', sources: new Set(['x']) };
      e2.tokens.set(t.mint, t);
    }
    assert.strictEqual(e2._adopt({ mint: 'NEWCOIN', source: 'launch' }), true, 'a newcomer is tracked even when the map is full');
    assert.ok(e2.tokens.has('NEWCOIN'), 'and it is the newcomer');
    assert.ok(e2.tokens.size <= 400, 'while the map stays inside its cap');
    // A coin that is actually held is never evicted to make room.
    e2._adopt({ mint: 'HELD1', source: 'launch' });
    e2.positions.set('HELD1', { mint: 'HELD1', symbol: 'HELD1', mc: 40, entryMc: 40 });
    for (let i = 0; i < 400; i++) e2._adopt({ mint: 'FILL' + i, source: 'launch' });
    assert.ok(e2.tokens.has('HELD1'), 'a held coin keeps its place');
  }

  // RULE ADDED 2026-11-05: the board answering is not the coin doing something. Refreshing `lastActivity` from the
  // market board kept every tracked coin "alive", which is what clogged the map in the first place.
  {
    const e3 = new Engine(wallet, new Store(fs.mkdtempSync(path.join(scratchDir, 'pcm-clock-')), 's.json', DEFAULTS));
    clearInterval(e3._bal); clearInterval(e3._ui); e3.refreshBalance = () => {};
    e3.market.solUsd = 150;
    e3._adopt({ mint: 'CLOCK', source: 'launch' });
    const c = e3.tokens.get('CLOCK');
    const quietAt = Date.now() - 100000;                      // nothing has happened for a hundred seconds
    c.lastActivity = quietAt;
    c.lastStreamAt = quietAt;
    e3._applyMarket('CLOCK', { mint: 'CLOCK', symbol: 'CLOCK', priceNative: 0.00000004, priceUsd: 0.000004, mcapUsd: 400, dexId: 'pumpfun', quoteMint: WSOL, buys: 5, sells: 2 });
    // FLAKE FIXED 2026-11-05: this compared against a SECOND `Date.now()`, so the assertion failed whenever a millisecond
    // ticked between the two - it passed for weeks and then failed at random inside `npm test`.
    assert.strictEqual(c.lastActivity, quietAt, 'the board does not pretend the coin traded');
    assert.ok(c.lastBoardAt > 0, 'it stamps its own clock instead');
    // RULE CHANGED 2026-11-05 (replaced "a board price counts as heard, so a young coin can still be bought"): the
    // board is no longer a buy price at all. Every wrong percentage of the day came from entering on somebody else's
    // number while the order filled against the pool, so a live entry now REQUIRES the pool's own price; a board-only
    // coin is refused in words. The clock split below is still true - the board stamping its own clock is what keeps
    // the freshness checks honest.
    c.mc = 0;
    c.lastActivity = 0; c.lastStreamAt = 0;
    const px = await e3._entryPrice(c);
    assert.ok(px && px.refuse, 'a live entry without a pool price is refused');
    assert.match(String(px.refuse), /No pool price to buy on/);
  }

  // RULE ADDED 2026-11-05 (measured in a paper run on the shipped plan): the dex flag was only set from the market
  // BOARD, so a coin that arrived through a discovery HINT - which carries the same `dexId` - was never marked as
  // graduated, and its entry price then treated the PumpSwap row as a pool to buy on. $BURNIT opened and stopped out
  // 32.9% down six seconds later, $Microduck at -93.6%. One place decides it now (`_markMarket`), at both doors.
  {
    // RULE CHANGED 2026-11-05 (1.0.2): the shipped plan's target is 80%, so this case names the target it is testing -
    // it is about what is net of fees, not about where the shipped target sits.
    const e5 = new Engine(wallet, new Store(fs.mkdtempSync(path.join(scratchDir, 'pcm-dex-')), 's.json', DEFAULTS));
    clearInterval(e5._bal); clearInterval(e5._ui); e5.refreshBalance = () => {};
    e5._adopt({ mint: 'SWAP1', source: 'market', hint: { symbol: 'SW1', dexId: 'pumpswap', priceNative: 0.0000001, buys: 60, sells: 5, change5m: 10 } });
    const g = e5.tokens.get('SWAP1');
    assert.strictEqual(g.graduated, true, 'a hint from PumpSwap is a graduated coin from its first second');
    assert.match(e5._eval(g, Date.now()).reason, /Graduated to PumpSwap/, 'and it is refused like any graduated coin');
    // RULE CHANGED 2026-11-05 (1.0.2): a curve row does NOT clear the flag any more - that is how a frozen fossil got to
    // set the market cap of a graduated coin. The flag is sticky for the life of the coin.
    e5._applyMarket('SWAP1', { mint: 'SWAP1', symbol: 'SW1', priceNative: 0.0000001, priceUsd: 0.00001, mcapUsd: 1000, dexId: 'pumpfun', quoteMint: WSOL, buys: 30, sells: 5 });
    assert.strictEqual(e5.tokens.get('SWAP1').graduated, true, 'a curve row cannot un-graduate a coin that traded on PumpSwap');
    // A coin that was never on PumpSwap is a launch, as before.
    e5._adopt({ mint: 'LAUNCH1', source: 'launch' });
    e5._applyMarket('LAUNCH1', { mint: 'LAUNCH1', symbol: 'L1', priceNative: 0.0000002, priceUsd: 0.00002, mcapUsd: 180, dexId: 'pumpfun', quoteMint: WSOL, buys: 30, sells: 5 });
    assert.strictEqual(e5.tokens.get('LAUNCH1').graduated, false, 'a coin only seen on the curve stays a launch');

    // RULE ADDED 2026-11-05 (1.0.2: a graduated coin's frozen curve was read as a live price, so the take profit fired on a number nobody could trade at):
    // a graduated coin keeps its old pump.fun pair listed, frozen at the graduation figure. That row is not "foreign", so
    // it used to be allowed to set the market cap - a thirty-one-fold peak out of a fossil. The same `_ownPool` rule that
    // guards the position price now guards the market cap.
    const g2 = new Engine(wallet, new Store(fs.mkdtempSync(path.join(scratchDir, 'pcm-fossil-')), 's.json', DEFAULTS));
    clearInterval(g2._bal); clearInterval(g2._ui); g2.refreshBalance = () => {};
    g2._adopt({ mint: 'FOSSIL1', source: 'market', hint: { symbol: 'FOS', priceNative: 0.0000002, dexId: 'pumpswap' } });
    const fossil = g2.tokens.get('FOSSIL1');
    fossil.lastStreamAt = 0;
    const before = fossil.mc;
    g2._applyMarket('FOSSIL1', { mint: 'FOSSIL1', symbol: 'FOS', priceNative: 0.0006, priceUsd: 0.06, mcapUsd: 540000, dexId: 'pumpfun', quoteMint: WSOL, buys: 30, sells: 5 });
    assert.strictEqual(fossil.mc, before, 'the frozen curve of a graduated coin cannot set its market cap');
    g2._applyMarket('FOSSIL1', { mint: 'FOSSIL1', symbol: 'FOS', priceNative: 0.0000002, priceUsd: 0.00002, mcapUsd: 180, dexId: 'pumpswap', quoteMint: WSOL, buys: 30, sells: 5 });
    assert.ok(fossil.mc > 0, 'its own PumpSwap pool still can');
    // And a hint that says nothing leaves the coin a launch, which is the normal case.
    e5._adopt({ mint: 'NOSWAP', source: 'launch', hint: { symbol: 'NS', buys: 5, sells: 1 } });
    assert.ok(!e5.tokens.get('NOSWAP').graduated, 'a hint with no dex is not graduated');
  }

  // RULE ADDED 2026-11-05: a filter whose data source is refusing must SAY so. GeckoTerminal answered 429 for hours
  // that day, and with the holder bar on (the one press preset switches it on) no buy could pass - the only trace was
  // "Holder count unknown" on coin after coin.
  {
    const e4 = new Engine(wallet, new Store(fs.mkdtempSync(path.join(scratchDir, 'pcm-hold-')), 's.json', DEFAULTS));
    clearInterval(e4._bal); clearInterval(e4._ui); e4.refreshBalance = () => {};
    const lines = [];
    e4._log = (level, msg) => lines.push(level + ': ' + msg);
    e4.market.holders = async () => null;                   // the pool list refuses
    const t = { mint: 'HOLD1', holders: 0 };
    assert.strictEqual(await e4._holdersFor(t), 0, 'an unreadable count is still unreadable');
    assert.strictEqual(await e4._holdersFor(t), 0);
    assert.strictEqual(lines.filter((l) => /holder bar/.test(l)).length, 0, 'one refusal is not an outage');
    await e4._holdersFor(t);
    assert.strictEqual(lines.filter((l) => /holder bar/.test(l)).length, 1, 'three in a row is said once, in words');
    assert.match(lines.find((l) => /holder bar/.test(l)), /extra entry filters off/, 'with what the operator can do');
    await e4._holdersFor(t);
    assert.strictEqual(lines.filter((l) => /holder bar/.test(l)).length, 1, 'and not again on the next coin');
    e4.market.holders = async () => ({ holders: 40 });
    assert.strictEqual(await e4._holdersFor(t), 40, 'a working source answers as before');
    assert.strictEqual(e4._holderMisses, 0, 'and the outage counter is cleared');
  }

  // RULE ADDED 2026-11-05 (1.0.4: a half-empty book looked like a stalled bot): a free slot is
  // an entry-bar decision, and the diary must name it instead of leaving the screen looking asleep. One line a minute,
  // counts by reason, the coin's own numbers folded into a placeholder so the tally groups.
  e.tokens.set('m1', { mint: 'm1', status: 'new', reason: 'Needs 50 buyers in 5m' });
  e.tokens.set('m2', { mint: 'm2', status: 'new', reason: 'Needs 22 buyers in 5m' });
  e.tokens.set('m3', { mint: 'm3', status: 'new', reason: 'Market cap out of range (60-15000 SOL)' });
  e.tokens.set('m4', { mint: 'm4', status: 'new', reason: 'Market cap out of range (60-15000 SOL)' });
  e.tokens.set('m5', { mint: 'm5', status: 'new', reason: 'Market cap out of range (60-15000 SOL)' });
  e.tokens.set('m6', { mint: 'm6', status: 'new', reason: 'Pool too thin' });
  e.running = true; e._slotsAt = 0;
  const logAt = e.logs.length;
  e._scan(Date.now());
  const note = e.logs.slice(logAt).map((l) => l.msg).find((m) => /slots busy/.test(m));
  assert.ok(note, 'a free slot is reported');
  assert.ok(/3 × market cap out of range/.test(note), 'the biggest refusal leads: ' + note);
  assert.ok(/2 × needs N buyers in Nm/.test(note), 'even-sized refusals group despite different numbers');
  assert.ok(/1 × pool too thin/.test(note), 'and the tail is kept');
  assert.ok(!/needs 50/.test(note), 'the coin own numbers never appear in the tally');
  assert.ok(/Lower the entry bar/.test(note), 'the line says what to do about it');
  // A second scan inside the minute is silent, and a full book says nothing at all.
  const again = e.logs.length; e._scan(Date.now() + 1000);
  assert.strictEqual(e.logs.length, again, 'at most one line a minute');
  e._slotsAt = 0; e.positions.set('m1', { mint: 'm1', priced: true });
  for (const k of ['m2', 'm3', 'm4', 'm5', 'm6']) e.positions.set(k, { mint: k, priced: true });
  const full = e.logs.length; e._scan(Date.now() + 120000);
  assert.strictEqual(e.logs.length, full, 'a full book has nothing to explain');
  for (const k of ['m1', 'm2', 'm3', 'm4', 'm5', 'm6']) { e.positions.delete(k); e.tokens.delete(k); }

  // RULE ADDED 2026-11-06 (1.1.1): a restart must not silently close a practice trade or reset the bankroll under a
  // restored Profit / Loss. The book and the money are written and read together.
  {
    const dir = fs.mkdtempSync(path.join(scratchDir, 'pcm-restart-'));
    const st1 = new Store(dir, 's.json', DEFAULTS);
    st1.set({ mode: 'paper', paperLatencyMs: 0, paperBaseSlippagePct: 0, paperUnknownImpactPct: 0 });
    const a = new Engine(wallet, st1);
    clearInterval(a._bal); clearInterval(a._ui);
    a.refreshBalance = () => {};
    a._log = () => {};
    a._measureProceeds = async () => null;
    a._entryPrice = async () => ({ mc: 200, src: 'curve' });
    const t = { mint: 'PAPERKEEP', symbol: 'PAPERKEEP', name: 'p', mc: 200, score: 90, status: 'watching', createdAt: Date.now() - 60000, trades: [], mcHist: [], lastActivity: Date.now(), sources: new Set(['launch']) };
    a.tokens.set(t.mint, t);
    a.running = true;
    await a._buy(t, { score: 90, m: { buyers: 20 }, pass: true });
    const spent = a.paper.balance;
    assert.ok(a.positions.has('PAPERKEEP'), 'the practice entry happened (' + (t.reason || 'no reason given') + ')');
    assert.ok(spent < 5, 'and it cost the bankroll something: ' + spent);
    const saved = st1.get();
    assert.ok(Array.isArray(saved.openPositions) && saved.openPositions.some((r) => r.mint === 'PAPERKEEP' && r.paper), 'the paper position is on disk');
    assert.ok(Math.abs(Number(saved.paperBalance) - spent) < 1e-9, `the bankroll is on disk too (${saved.paperBalance} against ${spent})`);

    // A new process on the same store: the position and the money come back together.
    const st2 = new Store(dir, 's.json', DEFAULTS);
    const b = new Engine(wallet, st2);
    clearInterval(b._bal); clearInterval(b._ui);
    b.refreshBalance = () => {};
    b._log = () => {};
    // A practice row has no token in the wallet, so the restore must not ask the chain about it at all: asking is how a
    // paper position used to be mistaken for a closed one.
    let walletReads = 0;
    b._tokenBalanceRaw = async () => { walletReads++; return 0n; };
    await b._restorePositions();
    assert.strictEqual(walletReads, 0, 'a practice position is restored without a wallet check');
    assert.ok(b.positions.has('PAPERKEEP'), 'the practice position survived the restart');
    assert.strictEqual(b.positions.get('PAPERKEEP').paper, true, 'and it is still a practice position');
    assert.ok(Math.abs(b.paper.balance - spent) < 1e-9, `with the same bankroll (${b.paper.balance} against ${spent})`);

    // A restored practice position is not a museum piece: the exit rules manage it exactly like one bought in this
    // window, and its proceeds land back in the restored bankroll.
    const balanceBeforeSale = b.paper.balance;
    b.running = true;
    const rp = b.positions.get('PAPERKEEP');
    const rt = b.tokens.get('PAPERKEEP');
    // A price from the stream, the way a running desk sees one: `_onTrade` prices the position from the tape, and the
    // rules are then read on the next tick. Twice, because a jump up gets a second look before it is believed.
    rt.lastStreamAt = Date.now();
    rt.mc = rp.entryMc * 2;
    b._pricePosition(rp, Date.now());
    b._pricePosition(rp, Date.now());
    b._tick();
    // The shipped plan asks a target to hold for 400 ms AND a fresh print before it fires: the price is printed again,
    // as the stream does four times a second, and the rule is read on that new number.
    await new Promise((r) => setTimeout(r, 450));
    b._pricePosition(rp, Date.now());
    b._tick();
    await new Promise((r) => setTimeout(r, 60));
    assert.ok(!b.positions.has('PAPERKEEP'), 'a restored practice position is closed by its own target (' + (rp.reason || 'still open at ' + Math.round(rp.mc)) + ')');
    assert.ok(b.paper.balance > balanceBeforeSale, 'and the proceeds land in the restored bankroll');

    // Starting the desk is what brings a saved practice row back - not merely building the engine - and it must not
    // touch a real position that is also on disk: the practice desk is not the one managing it.
    {
      const dir2 = fs.mkdtempSync(path.join(scratchDir, 'pcm-start-'));
      const st4 = new Store(dir2, 's.json', DEFAULTS);
      const real = { mint: 'REALROW', symbol: 'REALROW', entryMc: 100, mc: 100, peakMc: 100, solIn: 0.1, feeBuy: 0, openedAt: Date.now(), paper: false };
      const paper = { mint: 'PAPERROW', symbol: 'PAPERROW', entryMc: 100, mc: 100, peakMc: 100, solIn: 0.1, feeBuy: 0, openedAt: Date.now(), paper: true };
      st4.set({ mode: 'paper', openPositions: [real, paper], paperBalance: 4.25 });
      const d = new Engine(wallet, st4);
      clearInterval(d._bal); clearInterval(d._ui);
      d.refreshBalance = () => {}; d._log = () => {};
      d._tokenBalanceRaw = async () => { throw new Error('the practice desk must not ask the chain about anything'); };
      d._connect = () => {}; d._startMarket = () => {};
      const r = await d.start({ offline: true });
      clearInterval(d._loop);
      assert.ok(r && r.ok, 'the practice desk starts');
      assert.ok(d.positions.has('PAPERROW'), 'a saved practice position comes back on Start');
      assert.ok(!d.positions.has('REALROW'), 'and a real position is not restored into the practice desk');
      assert.ok(Math.abs(d.paper.balance - 4.25) < 1e-9, 'with the saved bankroll: ' + d.paper.balance);
      const after = st4.get().openPositions;
      assert.ok(after.some((x) => x.mint === 'REALROW'), 'the real position is still on disk, untouched');
      assert.ok(after.some((x) => x.mint === 'PAPERROW'), 'and the practice row is still there too');
    }

    // A Reset is a decision about the bankroll, so it has to outlive the window as well: reset, then restart, and the
    // desk opens on 5.000 with an empty practice book - not on the money the reset was meant to clear.
    b.resetPractice();
    const st3 = new Store(dir, 's.json', DEFAULTS);
    const c = new Engine(wallet, st3);
    clearInterval(c._bal); clearInterval(c._ui);
    c.refreshBalance = () => {};
    c._log = () => {};
    c._tokenBalanceRaw = async () => 0n;
    await c._restorePositions();
    assert.strictEqual(c.paper.balance, 5, 'the reset bankroll survived the restart');
    assert.strictEqual(c.books.paper.trades, 0, 'and so did the cleared practice book');
  }

  console.log('Modules test passed');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });



