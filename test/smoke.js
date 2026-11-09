// Smoke test: wallet (create / lock / export / wrong password / import) and engine paper-mode trade cycle.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Every scratch directory this suite makes lives under one root that is removed on exit, and roots left by an
// earlier run are swept (see `test/scratch.js`).
const scratchDir = require('./scratch').root;
const { WalletManager } = require('../src/wallet');
const { Store } = require('../src/store');
const { Engine, DEFAULTS } = require('../src/engine');

(async () => {
  const dir = fs.mkdtempSync(path.join(scratchDir, 'pcs-'));

  // wallet
  const w = new WalletManager(dir);
  assert.throws(() => w.create('short'), /8 characters/);
  const { address } = w.create('correct horse battery');
  assert.ok(w.isUnlocked());
  const key = w.exportPrivateKey('correct horse battery');
  assert.throws(() => w.exportPrivateKey('wrong password!!'), /Wrong password/);
  assert.ok(!fs.readFileSync(path.join(dir, 'wallet.json'), 'utf8').includes(key), 'key must not be stored in plain text');
  const w2 = new WalletManager(dir);
  assert.strictEqual(w2.address(), address);
  assert.throws(() => w2.unlock('nope nope nope'), /Wrong password/);
  w2.unlock('correct horse battery');
  const dir2 = fs.mkdtempSync(path.join(scratchDir, 'pcs-'));
  const w3 = new WalletManager(dir2);
  assert.strictEqual(w3.importKey(key, 'another password').address, address);
  assert.throws(() => new WalletManager(fs.mkdtempSync(path.join(scratchDir, 'pcs-'))).importKey('garbage', 'password123'), /private key/i);

  // A wallet can be replaced or removed, but only on purpose: the plain call refuses while one exists.
  assert.throws(() => w3.create('another password'), /already exists/);
  const replaced = w3.create('a fresh password', { replace: true });
  assert.notStrictEqual(replaced.address, address, 'a replace really makes a new key');
  const afterReplace = new WalletManager(dir2);
  assert.strictEqual(afterReplace.address(), replaced.address);
  afterReplace.reset();
  assert.strictEqual(new WalletManager(dir2).exists(), false, 'reset deletes the key file');
  assert.throws(() => new WalletManager(dir2).unlock('a fresh password'), /No wallet found/);

  // A wallet file that exists but cannot be read is damage, not an empty slot: the old code answered "no wallet"
  // for a truncated file and the create screen then wrote a brand-new key over it.
  const dir3 = fs.mkdtempSync(path.join(scratchDir, 'pcs-'));
  const broken = new WalletManager(dir3);
  broken.create('damaged file test');
  fs.writeFileSync(path.join(dir3, 'wallet.json'), '{"version":1,"address":"abc"');
  const damaged = new WalletManager(dir3);
  assert.strictEqual(damaged.exists(), false);
  assert.ok(/damaged/i.test(damaged.damaged || ''), 'damage is reported, not hidden');
  assert.throws(() => damaged.create('another password'), /damaged/i);
  assert.throws(() => damaged.reset(), /damaged/i, 'a damaged file is never deleted by accident');
  const goodFile = fs.readFileSync(path.join(dir3, 'wallet.json'), 'utf8');
  assert.strictEqual(goodFile.length > 0, true);

  // A wallet file with no usable cipher block is damage too, not a wrong password.
  fs.writeFileSync(path.join(dir3, 'wallet.json'), JSON.stringify({ version: 1, address: 'abc', enc: { salt: 'zz' } }));
  const halfMeta = new WalletManager(dir3);
  assert.ok(/damaged/i.test(halfMeta.damaged || ''), 'a broken cipher block is reported as damage');

  // A withdrawal is signed ONCE. The old code fetched the blockhash, signed and sent inside the retried callback,
  // so one timeout produced a second, different transaction and could pay the same withdrawal twice.
  const dir4 = fs.mkdtempSync(path.join(scratchDir, 'pcs-'));
  const wd = new WalletManager(dir4);
  wd.create('withdraw test password');
  const sent = [];
  let blockhashCalls = 0;
  const fakeRpc = async (fn) => {
    const conn = {
      getBalance: async () => 10_000_000,
      getLatestBlockhash: async () => { blockhashCalls++; return { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 1 }; },
      sendRawTransaction: async (raw) => {
        sent.push(Buffer.from(raw).toString('hex'));
        if (sent.length === 1) throw new Error('RPC timeout');       // the first attempt is lost in the network
        return 'SIGNATURE';
      },
      getSignatureStatuses: async () => ({ value: [{ err: null, confirmationStatus: 'confirmed' }] }),
    };
    try { return await fn(conn); } catch (e) { if (/timeout/i.test(e.message)) return fn(conn); throw e; }
  };
  const rec = await wd.withdraw(fakeRpc, 'So11111111111111111111111111111111111111112', 0.001, 'withdraw test password');
  assert.strictEqual(rec.signature, 'SIGNATURE');
  assert.strictEqual(blockhashCalls, 1, 'the transfer is built and signed once');
  assert.strictEqual(sent.length, 2);
  assert.strictEqual(sent[0], sent[1], 'the retry re-broadcasts the same signed bytes, never a new transfer');

  // engine, practice mode, no network
  const store = new Store(dir, 'settings.json', DEFAULTS);
  // A settings file is written beside the real one and renamed over it, so a crash or a sync client cannot leave a
  // half-written file - and a half-written file is a book with no positions and a plan nobody chose.
  assert.strictEqual(store.damaged, null, 'a missing file is a first run, not damage');
  store.set({ watchSec: 0 });
  assert.ok(!fs.existsSync(path.join(dir, 'settings.json.tmp')), 'no temporary file is left behind');
  assert.strictEqual(new Store(dir, 'settings.json', DEFAULTS).get().watchSec, 0, 'and the file is readable');
  // A damaged file is kept aside and reported: silently falling back to defaults would trade somebody else's plan.
  fs.writeFileSync(path.join(dir, 'settings.json'), '{"watchSec":0,');
  const brokenStore = new Store(dir, 'settings.json', DEFAULTS);
  assert.ok(/damaged/i.test(brokenStore.damaged || ''), 'damage is reported');
  assert.ok(fs.existsSync(path.join(dir, 'settings.json.broken')), 'and the damaged file is kept for the user');
  fs.rmSync(path.join(dir, 'settings.json.broken'), { force: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ watchSec: 0, minBuyers: 3, minNetFlowSol: 0.5, maxHoldSec: 600 }));
  store.set({ watchSec: 0, minBuyers: 3, minNetFlowSol: 0.5, maxHoldSec: 600 });
  // A key the app no longer uses must not survive an upgrade forever.
  store.set({ useJupiter: true });
  store.unset(['useJupiter']);
  assert.strictEqual('useJupiter' in JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')), false);
  // RULE CHANGED 2026-11-05: the shipped defaults are now the MEASURED profit plan (30 buyers, a 60-500 SOL band, a
  // five minute band and 78 score), and a 30 SOL coin with six buyers is deliberately not it. This test is about the
  // wiring - a launch arrives, is judged, is bought - so it supplies its own permissive plan.
  store.set({
    minTokenAgeSec: 0, paperLatencyMs: 0, minScore: 0, minBuyers: 3, minNetFlowSol: 0.5, minMcSol: 10, maxMcSol: 200, minLiqUsd: 0,
    minChange5mPct: 0, maxChange5mPct: 0, simpleMode: false, deepEntry: false, minHolders: 0,
    takeProfitPct: 90, stopLossPct: 9, maxHoldSec: 600, buyAmountSol: 0.02,
  });
  const e = new Engine(w, store);
  clearInterval(e._bal);
  e.refreshBalance = () => {};
  await e.start({ offline: true });
  const mint = 'So11111111111111111111111111111111111111112';
  e.ingest({ txType: 'create', mint, name: 'Test', symbol: 'TST', traderPublicKey: 'dev', marketCapSol: 30 });
  for (let i = 0; i < 6; i++) e.ingest({ txType: 'buy', mint, traderPublicKey: 'b' + i, solAmount: 0.6, marketCapSol: 31 + i });
  e._tick();
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(e.positions.size, 1, 'bot should buy a strong coin');
  assert.ok(e.paper.balance < 5);
  e.ingest({ txType: 'sell', mint, traderPublicKey: 'dev', solAmount: 1, marketCapSol: 20 }); // creator dumps
  e._tick();
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(e.positions.size, 0, 'creator sell must trigger exit');
  assert.strictEqual(e.history[0].reason, 'Creator sold');

  // on-chain style events: hot coin we never saw launch gets adopted, with a stricter score bar
  const hot = 'Hot1111111111111111111111111111111111111111';
  e.ingest({ txType: 'buy', mint: hot, traderPublicKey: 'x1', solAmount: 1.2, marketCapSol: 40, fromChain: true });
  assert.ok(e.tokens.get(hot) && e.tokens.get(hot).creatorUnknown, 'hot coin adopted');
  e.ingest({ txType: 'buy', mint: 'Tiny111111111111111111111111111111111111111', traderPublicKey: 'x2', solAmount: 0.01, marketCapSol: 40, fromChain: true });
  assert.ok(!e.tokens.has('Tiny111111111111111111111111111111111111111'), 'dust trades are ignored');

  // creator bought a huge bag at launch -> skipped
  const bag = 'Bag1111111111111111111111111111111111111111';
  e.ingest({ txType: 'create', mint: bag, name: 'Bag', symbol: 'BAG', creator: 'devwallet', traderPublicKey: 'devwallet', marketCapSol: 30, fromChain: true });
  // RULE CHANGED 2026-11-05 (1.0.2): the shipped plan allows a creator bag of 12 SOL (maxDevBuySol), so this case spends
  // 15 to be over it - the rule it tests is unchanged.
  e.ingest({ txType: 'buy', mint: bag, traderPublicKey: 'devwallet', solAmount: 15, marketCapSol: 45, fromChain: true });
  for (let i = 0; i < 6; i++) e.ingest({ txType: 'buy', mint: bag, traderPublicKey: 'u' + i, solAmount: 0.7, marketCapSol: 46 + i, fromChain: true });
  e._evalOne(e.tokens.get(bag), Date.now());
  assert.strictEqual(e.tokens.get(bag).reason, 'Creator holds too much');

  // one wallet makes almost all the buying -> skipped
  const wash = 'Wash111111111111111111111111111111111111111';
  e.ingest({ txType: 'create', mint: wash, name: 'Wash', symbol: 'WSH', traderPublicKey: 'dev2', marketCapSol: 30, fromChain: true });
  for (let i = 0; i < 4; i++) e.ingest({ txType: 'buy', mint: wash, traderPublicKey: 'bot', solAmount: 2, marketCapSol: 40 + i, fromChain: true });
  e.ingest({ txType: 'buy', mint: wash, traderPublicKey: 'small', solAmount: 0.1, marketCapSol: 45, fromChain: true });
  e._evalOne(e.tokens.get(wash), Date.now());
  assert.strictEqual(e.tokens.get(wash).reason, 'One wallet dominates buying');

  // smart fees: a calm coin gets a tighter entry than the ceiling, and the ceiling itself is a promise
  assert.ok(e._slippageFor(wash, false) <= e.s.slippagePct && e._slippageFor(wash, false) >= 3);
  // RULE CHANGED (measured live, 2026-11-04): an exit used to be held to the same ceiling, and a refused stop then
  // cost 1.2 s of re-quoting ("SAGAS moved while the sell was in flight") while the coin fell. An urgent exit now
  // has a floor of 20% and a hard roof of 40%: the tolerance on an exit is not a promise about the price, it is the
  // promise that the coins leave. Entries still obey the ceiling exactly.
  assert.ok(e._slippageFor(wash, true) >= Math.min(e.s.slippagePct, 20), 'an urgent exit is never tighter than 20%');
  assert.ok(e._slippageFor(wash, true) <= 40, 'and never above 40%');
  assert.strictEqual(e._slippageFor(wash, true), Math.min(40, Math.max(e.s.slippagePct, 20)), 'the exit tolerance');
  // RULE ADDED: an exit that is still in profit is never handed that wide tolerance. A 40% order on a coin that is +8%
  // may fill at -32%, which is exactly the "it was up and it sold me a loss" report; a losing exit keeps the room it
  // needs to fill at all.
  assert.strictEqual(e._slippageFor(wash, true, 8), 15, 'a profit exit gets 15%, not the whole ceiling');
  e.stop();
  clearInterval(e._ui);
  console.log('Smoke test passed');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
