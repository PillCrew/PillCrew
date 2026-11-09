const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Every scratch directory this suite makes lives under one root that is removed on exit, and roots left by an
// earlier run are swept (see `test/scratch.js`).
const scratchDir = require('./scratch').root;
const { pathToFileURL } = require('url');
const { Keypair, PublicKey, SystemProgram, ComputeBudgetProgram, TransactionMessage, VersionedTransaction } = require('@solana/web3.js');
const { Store } = require('../src/store');
const { Engine, DEFAULTS } = require('../src/engine');
const { WalletManager } = require('../src/wallet');
const { assertCleanupTx, assertSwapTx } = require('../src/txguard');
const { trustedSender } = require('../src/ipcguard');
const { inspectMint, adaptiveExit } = require('../src/risk');
const { SessionRecorder } = require('../src/recorder');
const { replay } = require('../src/backtest');
const { slippageFraction } = require('../src/simulation');

const dir = fs.mkdtempSync(path.join(scratchDir, 'pillcrew-audit-'));
const engines = [];
function engine(settings = {}) {
  const store = new Store(fs.mkdtempSync(path.join(dir, 'case-')), 'settings.json', DEFAULTS);
  store.set({ ...settings, autoReclaim: false });
  const e = new Engine({ exists: () => false, address: () => null }, store);
  engines.push(e);
  e.refreshBalance = async () => {};
  e._log = () => {};
  e._settleMint = () => {};
  e.running = true;
  return e;
}

(async () => {
  const store = new Store(dir, 'settings.json', { size: 1 });
  const rename = fs.renameSync;
  try {
    fs.renameSync = () => { throw new Error('disk fault'); };
    assert.throws(() => store.set({ size: 5 }), /disk fault/);
    assert.equal(store.get().size, 1, 'a failed save cannot silently change runtime risk settings');
  } finally { fs.renameSync = rename; }
  fs.writeFileSync(path.join(dir, 'bad.json'), 'null');
  assert.ok(new Store(dir, 'bad.json', {}).damaged);

  const frame = { url: pathToFileURL(__filename).href };
  const contents = { mainFrame: frame };
  const win = { isDestroyed: () => false, webContents: contents };
  assert.ok(trustedSender({ sender: contents, senderFrame: frame }, win, __filename));
  assert.equal(trustedSender({ sender: contents, senderFrame: { ...frame } }, win, __filename), false);
  assert.equal(trustedSender({ sender: {}, senderFrame: frame }, win, __filename), false);

  const kp = Keypair.generate(), other = Keypair.generate().publicKey;
  const build = (instructions) => new VersionedTransaction(new TransactionMessage({ payerKey: kp.publicKey,
    recentBlockhash: other.toBase58(), instructions }).compileToV0Message());
  const transfer = () => SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: other, lamports: 6000000 });
  assert.throws(() => assertCleanupTx(build([transfer(), transfer()]), kp.publicKey.toBase58()), /moves SOL out/);
  const expensive = build([ComputeBudgetProgram.setComputeUnitLimit({ units: 1400000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000000000 })]);
  assert.throws(() => assertSwapTx(expensive, kp.publicKey.toBase58()), /fee budget/);

  const mint = Buffer.alloc(82); mint[45] = 1;
  const info = { owner: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'), data: mint };
  assert.equal(inspectMint(info), null);
  mint.writeUInt32LE(1, 46);
  assert.match(inspectMint(info), /frozen/);
  assert.match(inspectMint(null), /unavailable/);
  const now = Date.now();
  const flow = { trades: Array.from({ length: 8 }, () => ({ side: 'sell', sol: 1, ts: now })) };
  assert.equal(adaptiveExit({}, flow, { adaptiveExits: false }, now), null);
  assert.equal(adaptiveExit({}, flow, { adaptiveExits: true }, now), 'Sustained sell pressure');
  assert.equal(adaptiveExit({}, flow, { adaptiveExits: true }, now + 4000), null, 'stale flow cannot trigger an adaptive exit');
  const recorder = new SessionRecorder(path.join(dir, 'recordings'));
  recorder.record({ ts: now, mint: 'A', mcSol: 100, signal: true, traderPublicKey: 'PRIVATE' });
  await recorder.close();
  const recording = fs.readFileSync(recorder.file, 'utf8');
  assert.equal(JSON.parse(recording).signal, true);
  assert.ok(!recording.includes('PRIVATE'), 'recordings do not include trader or wallet keys');

  const e = engine();
  const p = { mint: 'PAPER', symbol: 'P', paper: true, solIn: 1, entryMc: 100, mc: 130,
    feeBuy: 0.001, feesPaid: 0.001, openedAt: Date.now(), fails: 0 };
  const initial = e.paper.balance;
  e.paper.balance -= 1.0175 + p.feeBuy;
  e.positions.set(p.mint, p);
  e._finishSell(p, 'Manual sell', 0.002);
  assert.ok(Math.abs(e.paper.balance - initial - e.books.paper.pnl) < 1e-12, 'cash and realized paper PnL reconcile exactly');
  assert.ok(slippageFraction(1, 1) > slippageFraction(0.01, 1), 'larger tickets have more price impact');
  assert.ok(slippageFraction(0.01, 0) > 0.01, 'missing depth does not mean zero impact');

  // RULE ADDED 2026-11-05 (1.0.1): the live mint check is a gate, so when its data source cannot answer it blocks
  // EVERY real entry - and a silent block reads as a quiet market. The holder bar cost hours that way; this one has to
  // say so in words, once, and never pretend practice is affected.
  const blind = engine({ mode: 'live', simpleMode: true });
  blind.walletBalance = 5;
  blind._freeSol = () => 5;
  blind._cashNeeded = () => 0.01;
  blind.risk.check = async () => 'Mint risk could not be verified';
  const said = [];
  blind._log = (level, msg) => said.push(level + ': ' + msg);
  const coin = (i) => {
    const t = { mint: 'RISK' + i, symbol: 'R' + i, mc: 120, mcHist: [], trades: [], devSold: false, devBuySol: 0,
      status: 'watching', score: 90, reason: '', lastActivity: Date.now(), lastStreamAt: Date.now(), createdAt: Date.now() - 60000 };
    blind.tokens.set(t.mint, t);
    return t;
  };
  for (let i = 0; i < 6; i++) await blind._buy(coin(i), { score: 90, m: { buyers: 40, net: 5 }, pass: true });
  assert.equal(blind.positions.size, 0, 'nothing is bought when the mint cannot be checked');
  const blocked = said.filter((l) => /Live entries are blocked/.test(l));
  assert.equal(blocked.length, 1, 'and it is said once, not once per coin');
  assert.match(blocked[0], /Practice mode is not affected/);

  const late = engine({ mode: 'live' });
  late.walletBalance = 5;
  late._tokenBalanceRaw = async () => 1000n;
  late._confirm = async () => ({ state: 'unknown' });
  let submissions = 0;
  late._tradeLive = async () => { submissions++; return { sig: 'SELL', raw: null }; };
  const position = { mint: 'LATE', symbol: 'L', paper: false, solIn: 1, entryMc: 100, mc: 100,
    feeBuy: 0.001, tokIn: 1000n, openedAt: Date.now(), fails: 0, nextTry: 0, status: 'open' };
  late.positions.set(position.mint, position);
  await late._sell(position, 'Time limit');
  position.nextTry = 0;
  await late._sell(position, 'Time limit');
  assert.equal(submissions, 1, 'an unknown sale is checked by signature instead of creating another order');
  assert.equal(late.store.get().openPositions[0].pendingSellSig, 'SELL');

  late._confirm = async () => ({ state: 'confirmed' });
  late._measureProceeds = async () => null;
  late._measuredPct = async () => null;
  position.nextTry = 0;
  await late._sell(position, 'Time limit');
  assert.equal(position.pendingSell.sig, 'SELL', 'a confirmed sale stays pending while its fill is unreadable');
  position.nextTry = 0;
  await late._sell(position, 'Time limit');
  assert.equal(submissions, 1);

  const wallet = new WalletManager(path.join(dir, 'wallet'));
  wallet.create('audit password');
  await assert.rejects(wallet.withdraw(() => { throw new Error('RPC should not be reached'); }, other.toBase58(), Infinity, 'audit password'), /finite/);
  await assert.rejects(wallet.withdraw(() => { throw new Error('RPC should not be reached'); }, other.toBase58(), 1e-12, 'audit password'), /lamport/);
  assert.throws(() => wallet.importKey('[256,-1]', 'audit password', { replace: true }), /valid private key/);

  const rows = [{ ts: 0, mint: 'A', mcSol: 100, liquiditySol: 20, signal: true },
    { ts: 300, mint: 'A', mcSol: 101, liquiditySol: 20 },
    { ts: 1000, mint: 'A', mcSol: 150, liquiditySol: 20 },
    { ts: 1300, mint: 'A', mcSol: 140, liquiditySol: 20 }];
  const report = replay(rows);
  assert.equal(report.trades, 1);
  assert.equal(report.history[0].exitedAt, 1300, 'fills use the next observation after latency');
  assert.equal(report.history[0].exitMc, 140, 'a signal at 150 does not fill at that past price');
  assert.ok(Math.abs(report.balance - report.settings.initialBalance - report.pnlSol) < 1e-12);
  assert.deepEqual(report, replay(rows), 'replays are deterministic');
  const expired = replay([{ ...rows[0], mint: 'VANISHED' }, ...rows.map(r => ({ ...r, ts: r.ts + 10000 }))]);
  assert.equal(expired.trades, 1, 'a silent mint cannot occupy the only entry slot forever');
  assert.equal(expired.failures, 1);
  assert.equal(replay(rows.slice(0, 2)).openPositions, 1, 'end of input does not fabricate an exit');
  const failed = replay(rows, { failurePct: 100 });
  assert.equal(failed.trades, 0);
  assert.ok(failed.pnlSol < 0, 'fees from failed submitted orders remain in realized PnL');
  assert.throws(() => replay([...rows].reverse()), /ordered/);
  console.log('Audit regression tests passed');
})().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
