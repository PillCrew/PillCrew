// Guards around foreign transactions, and the wallet-measured sale accounting.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Every scratch directory this suite makes lives under one root that is removed on exit, and roots left by an
// earlier run are swept (see `test/scratch.js`).
const scratchDir = require('./scratch').root;
const {
  Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, VersionedTransaction, TransactionMessage,
} = require('@solana/web3.js');
const {
  assertCleanupTx, assertSwapTx, lamportsOut, readTx, TOKEN,
} = require('../src/txguard');

const kp = Keypair.generate();
const owner = kp.publicKey.toBase58();
const ATTACKER = Keypair.generate().publicKey;

function build(instructions, feePayer = kp.publicKey, signers = [kp]) {
  const msg = new TransactionMessage({
    payerKey: feePayer, recentBlockhash: Keypair.generate().publicKey.toBase58(), instructions,
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign(signers);
  return tx;
}

const closeOwnAccount = (dest = kp.publicKey) => new TransactionInstruction({
  programId: new PublicKey(TOKEN), keys: [{ pubkey: kp.publicKey, isSigner: false, isWritable: true }, { pubkey: dest, isSigner: false, isWritable: true }],
  data: Buffer.from([9]),
});
const tokenOp = (tag) => new TransactionInstruction({
  programId: new PublicKey(TOKEN), keys: [{ pubkey: kp.publicKey, isSigner: false, isWritable: true }], data: Buffer.from([tag]),
});

(async () => {
  // A cleanup transaction may close our own empty accounts and pay a small protocol fee.
  assertCleanupTx(build([closeOwnAccount()]), owner);
  assertCleanupTx(build([closeOwnAccount(), SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: ATTACKER, lamports: 5_000_000 })]), owner);
  // ...but never send the rent somewhere else, drain the wallet, or hand over tokens.
  assert.throws(() => assertCleanupTx(build([closeOwnAccount(ATTACKER)]), owner), /rent goes somewhere else/);
  assert.throws(() => assertCleanupTx(build([SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: ATTACKER, lamports: 900_000_000 })]), owner), /moves SOL out/);
  assert.throws(() => assertCleanupTx(build([tokenOp(3)]), owner), /token transfer/);
  assert.throws(() => assertCleanupTx(build([tokenOp(4)]), owner), /token approval/);
  assert.throws(() => assertCleanupTx(build([tokenOp(6)]), owner), /authority change/);
  // A burn is only allowed when a token was selected for burning, and only for that token.
  assert.throws(() => assertCleanupTx(build([tokenOp(8)]), owner), /no token was selected/);
  const SOL_MINT = 'So11111111111111111111111111111111111111112';
  const burnOf = (mint) => new TransactionInstruction({
    programId: new PublicKey(TOKEN),
    keys: [
      { pubkey: kp.publicKey, isSigner: false, isWritable: true },
      { pubkey: new PublicKey(mint), isSigner: false, isWritable: true },
      { pubkey: kp.publicKey, isSigner: true, isWritable: false },
    ],
    data: Buffer.from([8, 0, 0, 0, 0, 0, 0, 0, 0]),
  });
  assertCleanupTx(build([burnOf(SOL_MINT)]), owner, { burnMint: SOL_MINT });
  assert.throws(() => assertCleanupTx(build([burnOf(SOL_MINT)]), owner, { burnMint: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' }), /not the one selected/);
  // Someone else's signature is never signed here.
  const other = Keypair.generate();
  const wantsTwoSigners = new TransactionInstruction({
    programId: new PublicKey(TOKEN),
    keys: [
      { pubkey: kp.publicKey, isSigner: false, isWritable: true },
      { pubkey: kp.publicKey, isSigner: false, isWritable: true },
      { pubkey: other.publicKey, isSigner: true, isWritable: false },
    ],
    data: Buffer.from([9]),
  });
  const twoSigners = build([wantsTwoSigners], kp.publicKey, [kp, other]);
  assert.throws(() => assertCleanupTx(twoSigners, owner), /another signature/);
  const otherPayer = build([closeOwnAccount()], other.publicKey, [other]);
  assert.throws(() => assertCleanupTx(otherPayer, owner), /paid by another wallet/);

  // A swap may talk to any program, but never approve, never change an authority, never move more SOL than the
  // ticket it is buying with.
  assertSwapTx(build([tokenOp(3)]), owner, { maxSolOut: 0.02 });
  assert.throws(() => assertSwapTx(build([tokenOp(4)]), owner, {}), /approval/);
  assert.throws(() => assertSwapTx(build([SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: ATTACKER, lamports: 500_000_000 })]), owner, { maxSolOut: 0.02 }), /too much SOL/);
  assertSwapTx(build([SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: ATTACKER, lamports: 20_000_000 })]), owner, { maxSolOut: 0.02 });

  // The trade the desk signs from the PRIMARY route gets the same two rules. The README has promised since the first
  // release that a third-party transaction cannot ask for a token approval or send the rent of a closed account
  // somewhere else; only the backup route enforced it, so a hostile answer from the main API was signed as it came.
  {
    const { Store } = require('../src/store');
    const { Engine, DEFAULTS } = require('../src/engine');
    const gdir = fs.mkdtempSync(path.join(scratchDir, 'guardtx-'));
    const gwallet = { exists: () => true, isUnlocked: () => true, address: () => owner, keypair: kp };
    const ge = new Engine(gwallet, new Store(gdir, 's.json', DEFAULTS));
    clearInterval(ge._bal); clearInterval(ge._ui);
    ge.refreshBalance = () => {};
    ge._guardTx(build([tokenOp(3)]), 0.02);                       // a plain token transfer is what a swap does
    assert.throws(() => ge._guardTx(build([tokenOp(4)]), 0.02), /token approval/, 'an approval is refused on the trade route too');
    assert.throws(() => ge._guardTx(build([tokenOp(6)]), 0.02), /token authority/, 'an authority change is refused');
    assert.throws(() => ge._guardTx(build([closeOwnAccount(ATTACKER)]), 0.02), /rent going elsewhere/, 'a close that pays a stranger is refused');
    ge._guardTx(build([closeOwnAccount()]), 0.02);                // the route's own wSOL account closes back to us
    assert.throws(() => ge._guardTx(build([SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: ATTACKER, lamports: 900_000_000 })]), 0.02), /suspicious/, 'the SOL ceiling still applies');
    fs.rmSync(gdir, { recursive: true, force: true });
  }

  // The guard reads the whole message, so an unresolved program id is refused instead of skipped.
  const legacy = new Transaction().add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: ATTACKER, lamports: 1_000 }));
  legacy.recentBlockhash = Keypair.generate().publicKey.toBase58();
  legacy.feePayer = kp.publicKey;
  legacy.sign(kp);
  const vtx = new VersionedTransaction(legacy.compileMessage());
  assert.strictEqual(lamportsOut(readTx(vtx).instructions), 1_000n);

  // ---- the sale book follows the wallet, not the request ----
  const { Store } = require('../src/store');
  const { Engine, DEFAULTS } = require('../src/engine');
  const dir = fs.mkdtempSync(path.join(scratchDir, 'guards-'));
  const store = new Store(dir, 's.json', DEFAULTS);
  const wallet = { exists: () => true, isUnlocked: () => true, address: () => owner, keypair: kp };
  const e = new Engine(wallet, store);
  clearInterval(e._bal); clearInterval(e._ui);
  e.refreshBalance = () => {};
  e._log = () => {};
  e._scheduleReclaim = () => {};
  e.running = true;

  const pos = (tokIn) => {
    const p = { mint: 'MINT', symbol: 'M', entryMc: 100, mc: 130, peakMc: 130, solIn: 1, feeBuy: 0.0001, openedAt: Date.now(), status: 'open', closing: false, paper: false, fails: 0, nextTry: 0, tokIn };
    e.positions.set('MINT', p);
    return p;
  };

  // The route says it sold half; the wallet proves it sold half.
  let p = pos(1000n);
  e._execLive = async () => ({ sig: 's', raw: null });
  e._confirm = async () => 'confirmed';
  e._tokenBalanceRaw = async () => 500n;
  await e._sell(p, 'Take profit part 1', 50);
  assert.ok(Math.abs(p.solIn - 0.5) < 1e-9, 'half the size is left on the book');
  assert.strictEqual(p.tp1Done, true);
  assert.strictEqual(e.positions.size, 1, 'the position stays open');

  // The route claims a full exit but the wallet still holds half: the book must not close the position.
  p = pos(1000n);
  e._tokenBalanceRaw = async () => 500n;
  await e._sell(p, 'Take profit', 100);
  assert.strictEqual(e.positions.size, 1, 'a half fill never closes a position');
  assert.ok(Math.abs(p.solIn - 0.5) < 1e-9, 'and it books exactly what left');

  // A full fill empties the wallet and closes the position once.
  p = pos(1000n);
  e._tokenBalanceRaw = async () => 0n;
  await e._sell(p, 'Take profit', 100);
  assert.strictEqual(e.positions.size, 0, 'nothing left means the position is closed');
  assert.strictEqual(e.books.live.trades, 1);

  // Dust left after a full exit is still a full exit, not a position nobody can sell.
  // RULE CHANGED: a "Stop loss" at a profit is refused now (a stop cannot sell a winner), so this uses the rule that
  // can legitimately fire at any price - the clock.
  p = pos(1_000_000_000_000n);
  e._tokenBalanceRaw = async () => 1n;
  await e._sell(p, 'Time limit', 100);
  assert.strictEqual(e.positions.size, 0, 'dust is not a position');

  // A sell that sold nothing measurable is retried instead of being booked as a sale.
  p = pos(1000n);
  e._tokenBalanceRaw = async () => 1000n;
  const before = e.books.live.trades;
  await e._sell(p, 'Time limit', 100);
  assert.strictEqual(e.positions.size, 1, 'the position is kept');
  assert.strictEqual(e.books.live.trades, before, 'and nothing is booked');
  assert.ok(p.nextTry > Date.now(), 'the retry is scheduled');

  // openPositions is saved on every change, so a restart can rebuild the book.
  p = pos(1000n);
  e._persistPositions();
  const saved = store.get().openPositions;
  assert.strictEqual(saved.length, 1);
  assert.strictEqual(saved[0].mint, 'MINT');
  assert.ok(saved[0].solIn > 0);
  e.positions.clear();
  e._tokenBalanceRaw = async () => 42n;
  store.set({ mode: 'live', openPositions: [{ mint: 'KEPT', symbol: 'K', entryMc: 100, mc: 120, solIn: 0.5, openedAt: Date.now() }, { mint: 'GONE', symbol: 'G', entryMc: 10, mc: 10, solIn: 0.5, openedAt: Date.now() }] });
  e._tokenBalanceRaw = async (mint) => (mint === 'KEPT' ? 42n : 0n);
  await e._restorePositions();
  assert.deepStrictEqual([...e.positions.keys()], ['KEPT'], 'a position with tokens is restored, an empty one is dropped');
  assert.strictEqual(e.positions.get('KEPT').solIn, 0.5);
  assert.strictEqual(store.get().openPositions.length, 1, 'the file matches the book after the restore');

  fs.rmSync(dir, { recursive: true, force: true });
  // RULE ADDED 2026-11-05: Profit / Loss must not invent money. Two ways it did, both measured on the wallet:
  // coins already held at Start were added to the equity but not to the baseline (three restored tickets plus their
  // rent read as +0.035 SOL of profit the second the bot started), and a deposit read as profit because the wallet is
  // one of the two numbers in the subtraction.
  {
    const dir2 = fs.mkdtempSync(path.join(scratchDir, 'pcs-pnl-'));
    const wallet2 = { exists: () => true, isUnlocked: () => true, address: () => 'W', keypair: null };
    const store2 = new Store(dir2, 's.json', DEFAULTS);
    store2.set({ mode: 'live', buyAmountSol: 0.01 });
    const en = new Engine(wallet2, store2);
    clearInterval(en._bal); clearInterval(en._ui);
    en.rpcCall = async () => 50_000_000;                       // 0.05 SOL in the wallet
    en.walletBalance = 0.05;
    // A coin already held when the session starts: bought in an earlier session, so its tokens were in the wallet then.
    en.positions.set('HELD', { mint: 'HELD', symbol: 'HELD', entryMc: 100, mc: 100, solIn: 0.01, paper: false, status: 'open' });
    en._markSession();
    const view = () => en._walletDelta();
    assert.ok(Math.abs(view()) < 1e-9, `a position held at Start is not profit, got ${view()}`);
    // It moves only when the coin moves.
    en.positions.get('HELD').mc = 130;
    assert.ok(view() > 0.0025 && view() < 0.0035, `a +30% coin is its own profit, got ${view()}`);
    // ...and an unpriced coin is marked at what was paid, never at zero.
    en.positions.get('HELD').mc = 0;
    assert.ok(Math.abs(view()) < 1e-9, `a coin with no reading yet is not a total loss, got ${view()}`);
    en.positions.get('HELD').mc = 100;

    // A deposit is not profit either: 0.05 SOL arrives while nothing is being sold.
    en.wallet.address = () => Keypair.generate().publicKey.toBase58();
    let bal = 0.05;
    en.walletBalance = 0.05;
    en.rpcCall = async () => Math.round(bal * 1e9);
    bal = 0.10;
    en._lastSettleAt = 0; en._lastReclaimAt = 0; en._spends = [];
    await en.refreshBalance();
    assert.ok(Math.abs(view()) < 1e-9, `a deposit is not profit, got ${view()}`);
    // ...and a sale landing right after a sale is NOT treated as a deposit.
    bal = 0.13;
    en._lastSettleAt = Date.now();
    await en.refreshBalance();
    assert.ok(view() > 0.02, `a sale that just landed stays profit, got ${view()}`);
    fs.rmSync(dir2, { recursive: true, force: true });
  }

  console.log('Guards test passed');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
