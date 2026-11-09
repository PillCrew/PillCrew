// Copy trading / dev-wallet sniping: a followed wallet's BUY enters a coin past the judgement bars, and never past the
// money guards. Everything here is offline: no network, no wallet, no real money.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Every scratch directory this suite makes lives under one root that is removed on exit, and roots left by an
// earlier run are swept (see `test/scratch.js`).
const scratchDir = require('./scratch').root;
const { Engine, DEFAULTS } = require('../src/engine');
const { Store } = require('../src/store');

const WATCHED = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const OTHER = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';

function engine(extra = {}) {
  const dir = fs.mkdtempSync(path.join(scratchDir, 'pc-copy-'));
  const store = new Store(dir, 's.json', { ...DEFAULTS, mode: 'paper', ...extra });
  const e = new Engine({ exists: () => true, isUnlocked: () => true, address: () => 'W', keypair: { publicKey: { toBase58: () => 'W' } } }, store);
  for (const id of ['_loop', '_ui', '_pxTimer', '_bal', '_marketTimer', '_hotTimer', '_posTimer']) clearInterval(e[id]);
  e.refreshBalance = () => {};
  e.logs = [];
  e._log = (level, msg) => { e.logs.push(msg); };
  e.bought = [];
  e._buy = (t, ev) => { e.bought.push({ mint: t.mint, reason: ev.reason }); };
  return e;
}

function coin(mint, extra = {}) {
  const now = Date.now();
  return {
    mint, symbol: 'COPY' + mint.slice(-2), name: 'Copy coin', status: 'watching', mc: 40, buyers: 1, net: 0, growth: 0,
    trades: [], mcHist: [[now, 40]], lastActivity: now, createdAt: now - 60000, sources: new Set(['chain']),
    launched: false, score: 0, ...extra,
  };
}

const trade = (mint, trader, side = 'buy', sol = 0.5, mc = 40) =>
  ({ mint, traderPublicKey: trader, txType: side, solAmount: sol, marketCapSol: mc });

// ---- the roster ----
{
  const e = engine({ copyWallets: `  ${WATCHED} ,\n ${OTHER}\n` });
  const set = e._copySet();
  assert.strictEqual(set.size, 2, 'commas, spaces and new lines all separate addresses');
  assert.ok(set.has(WATCHED) && set.has(OTHER));
  assert.ok(e._isCopyWallet(WATCHED), 'a listed wallet is followed');
  assert.ok(!e._isCopyWallet('Fake'), 'a stranger is not');
  assert.ok(!e._isCopyWallet(''), 'an empty trader is not a wallet');

  // A roster of junk follows nobody, and a half-typed address is dropped instead of being watched by accident.
  const junk = engine({ copyWallets: 'my friend, 7xKX, https://example.com' });
  assert.strictEqual(junk._copySet().size, 0, 'nothing usable in that list');
  assert.ok(!junk._isCopyWallet('my friend'));

  // The cache follows the setting, so a saved change takes effect without a restart.
  e.s.copyWallets = OTHER;
  assert.strictEqual(e._copySet().size, 1);
  assert.ok(!e._isCopyWallet(WATCHED) && e._isCopyWallet(OTHER), 'the roster is re-read when it changes');
}

// ---- a followed wallet buys: the coin is entered past the judgement bars ----
{
  const e = engine({ copyWallets: WATCHED, minScore: 90, minBuyers: 80, minNetFlowSol: 40, minMcSol: 500, maxMcSol: 900 });
  e.running = true;
  // The REAL judgement runs here: one buyer, no net buying, a market cap eight times below the band, so every bar
  // refuses this coin. The copy signal is what gets it in - and the refusal it overrode is still on the record.
  const t = coin('MintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  e.tokens.set(t.mint, t);
  e._onTrade(trade(t.mint, WATCHED));
  assert.match(String(t.reason), /^(Needs|Market cap out of range|Price falling|Too new|Not pumping)/, `the bars did refuse it: ${t.reason}`);
  assert.strictEqual(e.bought.length, 1, 'a copied buy is entered');
  assert.match(e.bought[0].reason, /^Copied /, 'and the entry says why it happened');
  assert.ok(e.logs.some((l) => /Copy: 7xKX just bought/.test(l)), 'the diary names the followed wallet');
}

// ---- anybody else, and any sell, changes nothing ----
{
  const e = engine({ copyWallets: WATCHED });
  e.running = true;
  e._evalOne = () => {};
  const t = coin('MintBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');
  e.tokens.set(t.mint, t);
  e._onTrade(trade(t.mint, OTHER));
  assert.strictEqual(e.bought.length, 0, 'a stranger buying is not a copy signal');
  e._onTrade(trade(t.mint, WATCHED, 'sell'));
  assert.strictEqual(e.bought.length, 0, 'their SELL is never mirrored - the exit ladder here is our own');
  assert.ok(e._isCopyWallet(WATCHED), 'the wallet is still followed after selling');
}

// ---- a stopped desk copies nothing, and two unsafe coins are refused out loud ----
{
  const e = engine({ copyWallets: WATCHED });
  e.running = false;
  e._evalOne = () => {};
  const idle = coin('MintCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC');
  e.tokens.set(idle.mint, idle);
  e._onTrade(trade(idle.mint, WATCHED));
  assert.strictEqual(e.bought.length, 0, 'a copy is still an entry, and entries need a running desk');

  e.running = true;
  const quoted = coin('MintDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD', { unsupported: true });
  e.tokens.set(quoted.mint, quoted);
  e._copyBuy(quoted, Date.now(), WATCHED);
  assert.strictEqual(e.bought.length, 0, 'a mint quoted in another token is refused whatever the followed wallet does');
  assert.match(quoted.reason, /quoted in another token/i);

  const rugged = coin('MintEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE', { devSold: true });
  e.tokens.set(rugged.mint, rugged);
  e._copyBuy(rugged, Date.now(), WATCHED);
  assert.strictEqual(e.bought.length, 0, 'the creator selling his own launch is a refusal, not an opportunity');
  assert.match(rugged.reason, /creator already sold/i);

  // A coin already held is not bought twice by the same signal: `_buy` owns that rule, so the stub proves the call
  // still goes through `_buy` instead of a second entry path of its own.
  const again = coin('MintFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF');
  e.tokens.set(again.mint, again);
  e._copyBuy(again, Date.now(), WATCHED);
  assert.strictEqual(e.bought.length, 1, 'the copy path hands the decision to _buy, the one entry point');
}

// ---- the shipped default follows nobody ----
{
  const e = engine();
  assert.strictEqual(e._copySet().size, 0, 'copy trading is off until an address is typed in');
  assert.strictEqual(DEFAULTS.copyWallets, '', 'and the shipped default is empty');
}

console.log('Copy trading tests passed');
process.exit(0);
