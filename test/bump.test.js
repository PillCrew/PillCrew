// The bump desk: the money arithmetic, the schedule, and the guards that stand between a generated key and a
// transaction it did not build. No network, no real keys - every door and every RPC answer is injected.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  Keypair, PublicKey, SystemProgram, SystemInstruction, TransactionInstruction, TransactionMessage, VersionedTransaction, Transaction,
} = require('@solana/web3.js');
const { BumpBot, Roster, bumpConfig, estimate, BUMP_DEFAULTS, MAX_WALLETS, MAX_PER_TX_SOL, MAX_BUDGET_SOL, BUNDLE_SENDS, JITO_MISS_LIMIT } = require('../src/bump');
const { planBudget: planOf, fitPlan: fitTo } = require('../src/bump');
const { WSOL } = require('../src/jupiter');
const { DEFAULTS } = require('../src/engine');
const { seededRandom } = require('../src/simulation');
const Share = require('../src/share');
const scratch = require('./scratch');

const MINT = Keypair.generate().publicKey.toBase58();
const PUMP = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');

const store = (patch = {}) => {
  let data = { ...DEFAULTS, bumpMint: MINT, ...patch };
  return { get: () => data, set: (p) => { data = { ...data, ...p }; return data; } };
};

const mainKp = Keypair.generate();
const wallet = () => ({
  exists: () => true,
  isUnlocked: () => true,
  verify: (pw) => { if (pw !== 'password123') throw new Error('Wrong password.'); return true; },
  address: () => mainKp.publicKey.toBase58(),
  keypair: mainKp,
});

/** One fake transaction, built the way the trade door builds one: a pump-program instruction, and lamports out. */
function fakeSwap(owner, lamportsOut = 0) {
  const instructions = [];
  if (lamportsOut) {
    instructions.push(SystemProgram.transfer({
      fromPubkey: new PublicKey(owner), toPubkey: Keypair.generate().publicKey, lamports: Math.round(lamportsOut * 1e9),
    }));
  }
  instructions.push(new TransactionInstruction({ programId: PUMP, keys: [], data: Buffer.from([0xa1, 0x02, 0x03]) }));
  const msg = new TransactionMessage({
    payerKey: new PublicKey(owner), recentBlockhash: Keypair.generate().publicKey.toBase58(), instructions,
  }).compileToV0Message();
  return new VersionedTransaction(msg).serialize();
}

function fakeRpc({ balances = {}, mainBalance = 5 } = {}) {
  const conn = {
    getMultipleAccountsInfo: async (keys) => keys.map((k) => {
      const b = balances[k.toBase58()];
      return b == null ? null : { lamports: Math.round(b * 1e9) };
    }),
    getBalance: async (pk) => Math.round((balances[pk.toBase58()] ?? mainBalance) * 1e9),
    getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 9e6 }),
    getParsedTokenAccountsByOwner: async () => { throw new Error('this host cannot list token accounts'); },
    sendRawTransaction: async () => 'CLOSESIG',
    getSignatureStatuses: async () => ({ value: [{ confirmationStatus: 'confirmed' }] }),
  };
  const sent = [];
  return {
    sent,
    balances,
    async call(fn) { return fn(conn); },
    async broadcast(raw) { sent.push(Buffer.from(raw)); return 'SIG' + sent.length; },
    // The chain is the witness: a test that wants a rejected transfer overrides this to throw, exactly like a real
    // transaction that landed with an error.
    confirm: async (sig) => ({ signature: sig, slot: 1 }),
  };
}

function bot(opts = {}) {
  const dir = fs.mkdtempSync(path.join(scratch.root, 'bump-'));
  const clock = { t: 1_000_000 };
  const doors = [];
  const instance = new BumpBot({
    wallet: wallet(),
    store: store(opts.settings),
    rpc: opts.rpc || fakeRpc(),
    jito: opts.jito || null,
    jupiter: opts.jupiter || null,
    sleep: opts.sleep || (async (ms) => { clock.t += ms; }),
    dir,
    now: () => clock.t,
    rand: seededRandom(opts.seed || 7),
    door: async (body) => {
      doors.push(body);
      if (opts.door) return opts.door(body);
      return fakeSwap(body.publicKey, body.action === 'buy' ? Number(body.amount) + 0.00204 : 0);
    },
  });
  instance.clock = clock;
  instance.doors = doors;
  instance.dir = dir;
  return instance;
}

/** Advance the fake clock and run one tick, then stop the timer it armed (the schedule is measured, not waited on). */
async function step(b, ms = 1000) {
  b._clearTimer();
  b.clock.t += ms;
  await b._tick();
  b._clearTimer();
}

(async () => {
  // ── 1. the settings are clamped to what can actually run ──
  {
    // RULE CHANGED 2026-11-08 (1.1.2): the band is DERIVED from the budget unless `bumpAutoAmount` is off, so the clamps
    // are checked in manual mode where the numbers are the operator's, and the derivation has its own case below.
    const c = bumpConfig({
      bumpAutoAmount: false,
      bumpWallets: 999, bumpBudgetSol: 9999, bumpSlippagePct: 0, bumpPriorityFeeSol: 0,
      bumpMinSol: 0.5, bumpMaxSol: 0.1, bumpHoldMinSec: 60, bumpHoldMaxSec: 10, bumpJitoBundle: 99, bumpPerMinute: 9999,
    });
    assert.strictEqual(c.wallets, MAX_WALLETS, 'a wallet count is capped');
    assert.strictEqual(c.budgetSol, MAX_BUDGET_SOL, 'a budget is capped');
    assert.strictEqual(c.maxSol, Math.min(MAX_PER_TX_SOL, 0.5), 'a band that is upside down becomes a point, not a negative range');
    assert.strictEqual(c.minSol, 0.5);
    assert.strictEqual(c.slippagePct, 1, 'slippage cannot go below the floor every route accepts');
    assert.strictEqual(c.priorityFeeSol, 0.000001, 'the cheapest tip that still lands is the floor');
    assert.strictEqual(c.holdMaxSec, 60, 'a hold band that is upside down becomes a point');
    assert.strictEqual(c.perMinute, 600, 'the pace is capped');
    assert.strictEqual(c.jitoBundle, 4, 'a bundle is capped at what Jito accepts');
    const cheapest = bumpConfig({ ...DEFAULTS });
    assert.strictEqual(cheapest.slippagePct, 1);
    assert.strictEqual(cheapest.priorityFeeSol, 0.000001);
    // RULE CHANGED 2026-11-11 (1.1.5): Jito is ON by default again. The 2026-11-09 measurement (the engine accepted every
    // bundle of the owner's coin and none landed) was a reason to fear a bundle, and the fear was in the wrong place: a
    // single miss used to retire Jito AND fail the bump. A bundle is now a first try - offered a few times, then sent the
    // normal way with the same signature - so Jito on cannot cost a bump, and its tip is only paid by a bundle that lands.
    assert.strictEqual(cheapest.useJito, true, 'Jito is on by default: a bundle is a first try, not the wire');
    assert.strictEqual(cheapest.sellBack, true, 'stopping sells the bags back by default');
    assert.strictEqual(cheapest.autoAmount, true, 'the ticket is worked out from the budget by default');
    // The sliders decide the ticket: same budget, a longer run, smaller bumps.
    const shortRun = bumpConfig({ ...DEFAULTS, bumpBudgetSol: 0.3, bumpMinutes: 15, bumpPerMinute: 18 });
    const longRun = bumpConfig({ ...DEFAULTS, bumpBudgetSol: 0.3, bumpMinutes: 120, bumpPerMinute: 18 });
    assert.ok(longRun.minSol < shortRun.minSol, `a longer run makes smaller bumps (${longRun.minSol} < ${shortRun.minSol})`);
    // RULE CHANGED 2026-11-08 (1.1.2): the pool is the number the operator typed, not what the budget silently allows.
    // Six wallets with 0.02 SOL used to run two and show two rows; now six means six, and the plan says whether the money
    // can carry them.
    const six = bumpConfig({ ...DEFAULTS, bumpWallets: 6, bumpBudgetSol: 0.02 });
    assert.strictEqual(six.wallets, 6, 'six typed wallets are six wallets');
    const sixShort = planOf(bumpConfig({ ...DEFAULTS, bumpWallets: 6, bumpBudgetSol: 0.02, bumpMinutes: 5, bumpPerMinute: 5 }));
    assert.strictEqual(sixShort.wallets, 6);
    assert.strictEqual(sixShort.fits, true, '0.02 SOL does carry six wallets over a short run: ' + sixShort.note);
    const sixTooBig = planOf(bumpConfig({ ...DEFAULTS, bumpWallets: 6, bumpBudgetSol: 0.012, bumpMinutes: 5, bumpPerMinute: 5 }));
    assert.strictEqual(sixTooBig.fits, false, '0.012 SOL cannot park the rent for six wallets');
    assert.strictEqual(sixTooBig.suggestedWallets, 2, 'and the panel names the pool the money can carry');
    assert.strictEqual(fitTo({ ...DEFAULTS, bumpWallets: 6, bumpBudgetSol: 0.012, bumpMinutes: 5, bumpPerMinute: 5 }).patch.bumpWallets, 2, 'the fitter is what lowers the pool, and only when pressed');
  }

  // ── 2. the cost model, before a lamport moves ──
  {
    const e = estimate({ ...DEFAULTS, bumpAutoAmount: false, bumpMinSol: 0.004, bumpMaxSol: 0.012, bumpWallets: 6, bumpBudgetSol: 0.3, bumpPerMinute: 18, bumpMinutes: 15 });
    assert.ok(Math.abs(e.avgAmountSol - 0.008) < 1e-12, 'the average of the band: ' + e.avgAmountSol);
    // 0.008 SOL a side at 1.75% is 0.00028, and two transactions at a 1000 lamport tip plus the base fee is 0.000012 -
    // and with Jito on by default the tip (0.00001) and its own signature (0.000005) are added to that line.
    // RULE CHANGED 2026-11-08 (1.1.2): one transaction pays the curve ONCE (1.75% of what it moves) and ONE signature. The old
    // line priced every bump as a whole round trip - two signatures and 3.5% - which is the cost of two bumps, and it
    // overstated every plan by about double.
    assert.ok(Math.abs(e.perBumpCurveSol - 0.00014) < 1e-9, 'one transaction pays the curve once: ' + e.perBumpCurveSol);
    const noJito = estimate({ ...DEFAULTS, bumpAutoAmount: false, bumpUseJito: false, bumpMinSol: 0.004, bumpMaxSol: 0.012, bumpWallets: 6, bumpBudgetSol: 0.3, bumpPerMinute: 18, bumpMinutes: 15 });
    assert.ok(Math.abs(noJito.perBumpNetworkSol - 0.000006) < 1e-9, 'one signature at the cheapest tip: ' + noJito.perBumpNetworkSol);
    // RULE CHANGED 2026-11-08 (1.1.2): the tip is paid once per transaction, in its own transaction, so it is priced whole - the
    // model used to divide it by `bumpJitoBundle` and understate a Jito run by half. (Jito is off by default now, so this is
    // asked for explicitly.)
    const withJito = estimate({ ...DEFAULTS, bumpUseJito: true, bumpAutoAmount: false, bumpMinSol: 0.004, bumpMaxSol: 0.012, bumpWallets: 6, bumpBudgetSol: 0.3, bumpPerMinute: 18, bumpMinutes: 15 });
    assert.ok(Math.abs(withJito.perBumpNetworkSol - (0.000006 + 0.00001 + 0.000005)) < 1e-9, 'a Jito bump costs its tip and its signature too: ' + withJito.perBumpNetworkSol);
    assert.strictEqual(e.bumps, 270, 'the configured run is priced as configured');
    assert.ok(Math.abs(e.runFeesSol - 270 * e.perBumpFeesSol) < 1e-9, 'the run costs what the bumps cost');
    assert.ok(Math.abs(e.walletRentSol - 6 * 0.00204) < 1e-12, 'every wallet parks the rent for its token account');
    // One buy and one sell per round: each transaction moves one ticket, so 270 transactions move 270 tickets.
    assert.ok(Math.abs(e.runVolumeSol - 270 * 0.008) < 1e-9, 'volume is one ticket per transaction: ' + e.runVolumeSol);
    // The competitor's own price list charges 0.18 SOL for 500 bumps; this desk's curve fee on the same run is the
    // number that matters, and it is smaller precisely because nothing here is a markup.
    assert.ok(e.runFeesSol < 0.1, 'a 270-bump run costs under a tenth of a SOL in fees: ' + e.runFeesSol.toFixed(4));
    // RULE ADDED 2026-11-08 (1.1.2): a budget that cannot pay for the run says what it CAN pay for, with numbers.
    const tight = estimate({ ...DEFAULTS, bumpBudgetSol: 0.05, bumpMinutes: 180, bumpPerMinute: 60 });
    assert.strictEqual(tight.fits, false, 'a 0.05 SOL budget cannot run three hours at sixty a minute');
    assert.ok(/minutes at 60\/min|not 10800/.test(tight.planNote), 'and the panel names what it can do instead: ' + tight.planNote);
    assert.ok(tight.maxMinutes > 0 && tight.maxMinutes < 180, 'with a real number of minutes: ' + tight.maxMinutes);
    // RULE ADDED 2026-11-08 (1.1.2): a budget under the floor says the floor, and - now that the pool is the operator's
    // number - it also names how many wallets the money CAN carry.
    const tiny = estimate({ ...DEFAULTS, bumpBudgetSol: 0.005, bumpWallets: 6, bumpMinutes: 5, bumpPerMinute: 0.5 });
    assert.strictEqual(tiny.fits, false, '0.005 SOL cannot run a desk');
    assert.strictEqual(tiny.wallets, 6, 'the pool the operator asked for is the pool in the plan');
    assert.ok(/least 6 wallets can run on/.test(tiny.planNote), 'the panel names the smallest budget: ' + tiny.planNote);
    assert.ok(/2 fit this budget/.test(tiny.planNote), 'and the pool that would fit: ' + tiny.planNote);
    const atFloor = estimate({ ...DEFAULTS, bumpBudgetSol: 0.005, bumpWallets: 2, bumpMinutes: 5, bumpPerMinute: 0.5 });
    assert.ok(/budget has to be bigger/.test(atFloor.planNote), 'at the floor of two there is no smaller pool to suggest: ' + atFloor.planNote);
    const jito = estimate({ ...DEFAULTS, bumpUseJito: true, bumpJitoTipSol: 0.0001, bumpJitoBundle: 2 });
    assert.ok(jito.perBumpNetworkSol > e.perBumpNetworkSol, 'a bundle costs its tip');
  }

  // ── 3. the roster: keys sealed, addresses readable, wrong password refused ──
  {
    const dir = fs.mkdtempSync(path.join(scratch.root, 'roster-'));
    const roster = new Roster(dir);
    assert.strictEqual(roster.exists(), false);
    const made = roster.create(4, 'password123');
    assert.strictEqual(made.addresses.length, 4);
    const raw = fs.readFileSync(path.join(dir, 'bump-wallets.json'), 'utf8');
    for (const kp of made.keypairs) {
      const b58 = require('bs58').encode(kp.secretKey);
      assert.ok(!raw.includes(b58), 'a secret key is never in the file in the clear');
      assert.ok(!raw.includes(Buffer.from(kp.secretKey).toString('hex')), 'and not as hex either');
    }
    assert.throws(() => roster.unlock('not the password'), /Wrong password/, 'a wrong password is refused');
    const opened = roster.unlock('password123');
    assert.deepStrictEqual(opened.map((k) => k.publicKey.toBase58()), made.addresses, 'the same wallets come back');
    assert.throws(() => roster.create(2, 'password123'), /already exist/, 'creating over live wallets is refused');
    // A damaged file is an error, never "no wallets": silently offering to create new ones over keys holding money is
    // the mistake the main wallet file already taught this app.
    fs.writeFileSync(path.join(dir, 'bump-wallets.json'), '{"version":1}');
    assert.throws(() => new Roster(dir), /damaged/, 'a damaged roster is refused, not replaced');
  }

  // ── 4. a settings code can never carry the desk's wallets or its budget ──
  {
    const code = Share.encode({ ...DEFAULTS, bumpMint: MINT, bumpBudgetSol: 3.5, bumpWallets: 12 });
    const back = Share.decode(code);
    assert.ok(!('bumpMint' in back.values) && !('bumpBudgetSol' in back.values), 'a shared plan carries no bump settings');
    assert.ok(!code.includes(MINT.slice(0, 8)), 'and not the token address either');
  }

  // ── 5. funding: one address, one transaction, every transfer planned, nothing to a stranger ──
  {
    // RULE CHANGED 2026-11-08 (1.1.2): the money now leaves the desk address - the one address an operator tops up - and
    // the desk splits it by itself. The main wallet is not in the funding path at all.
    const rpc = fakeRpc({ mainBalance: 5 });
    const b = bot({ rpc, settings: { bumpAutoAmount: false, bumpWalletCount: 3, bumpWallets: 3, bumpBudgetSol: 0.3, bumpMaxSol: 0.012, bumpMinSol: 0.004 } });
    b.createWallets(3, 'password123');
    const vaultPub = new PublicKey(b.vaultAddress());
    assert.ok(vaultPub, 'the desk address exists as soon as the wallets do');
    const before = rpc.sent.length;
    const out = await b.fund();
    assert.strictEqual(rpc.sent.length - before, 1, 'the pool is funded in ONE transaction, not one per wallet');
    assert.strictEqual(out.funded, 3);
    const tx = Transaction.from(rpc.sent[rpc.sent.length - 1]);
    assert.strictEqual(tx.instructions.length, 3, 'one transfer per wallet');
    const total = tx.instructions.reduce((n, ix) => n + Number(ix.data.readBigUInt64LE(4)), 0);
    assert.ok(Math.abs(total / 1e9 - 0.3) < 1e-6, 'the pool receives exactly the budget: ' + total / 1e9);
    const owned = new Set(b.addresses());
    for (const ix of tx.instructions) {
      const { SystemInstruction } = require('@solana/web3.js');
      const d = SystemInstruction.decodeTransfer(ix);
      assert.ok(d.fromPubkey.equals(vaultPub), 'every transfer leaves the desk address');
      assert.ok(owned.has(d.toPubkey.toBase58()), 'and lands in a wallet this desk owns');
    }
    // Funded again: the chain now holds what was sent, so there is nothing to do and no transaction for it.
    for (const a of b.addresses()) rpc.balances[a] = 0.1;
    const again = await b.fund();
    assert.strictEqual(again.funded, 0);
    assert.strictEqual(rpc.sent.length - before, 1, 'a second press sends nothing');
  }

  // ── 5b. the deposit: one transfer, wallet to desk address, for the amount asked ──
  {
    const rpc = fakeRpc({ mainBalance: 1 });
    const b = bot({ rpc, settings: { bumpBudgetSol: 0.02 } });
    b.createWallets(2, 'password123');
    const before = rpc.sent.length;
    const out = await b.depositFromMain(0.02);
    assert.strictEqual(rpc.sent.length - before, 1);
    assert.strictEqual(out.address, b.vaultAddress());
    const tx = Transaction.from(rpc.sent[rpc.sent.length - 1]);
    const { SystemInstruction } = require('@solana/web3.js');
    const d = SystemInstruction.decodeTransfer(tx.instructions[0]);
    assert.ok(d.fromPubkey.equals(mainKp.publicKey), 'the deposit leaves your wallet');
    assert.strictEqual(d.toPubkey.toBase58(), b.vaultAddress(), 'and lands in the desk address');
    assert.strictEqual(Number(d.lamports), 20_000_000, 'for exactly 0.02 SOL');
    await assert.rejects(() => b.depositFromMain(5), /does not cover/, 'a deposit bigger than the wallet is refused');
  }

  // ── 6. funding and starting refuse in words, before anything is signed ──
  {
    const poor = bot({ rpc: fakeRpc({ mainBalance: 0.005 }) });
    poor.createWallets(2, 'password123');
    await assert.rejects(() => poor.fund(), /Send .* SOL more to/, 'an empty desk address and an empty wallet says how much to send and where');
    // RULE ADDED 2026-11-08 (1.1.2): one press. A short desk address with a funded wallet moves the difference itself.
    const rpc = fakeRpc({ mainBalance: 1 });
    const selfFilling = bot({ rpc, settings: { bumpAutoAmount: false, bumpWallets: 2, bumpBudgetSol: 0.1, bumpMinSol: 0.004, bumpMaxSol: 0.01 } });
    selfFilling.createWallets(2, 'password123');
    rpc.balances[selfFilling.vaultAddress()] = 0;      // the desk address starts empty
    const before = rpc.sent.length;
    const out = await selfFilling.fund();
    assert.strictEqual(out.funded, 2, 'the pool is funded in one press');
    assert.strictEqual(rpc.sent.length - before, 2, 'one transfer into the desk address, then one split');
    const tiny = bot({ settings: { bumpAutoAmount: false, bumpWallets: 20, bumpBudgetSol: 0.05, bumpMaxSol: 0.02 } });
    tiny.createWallets(20, 'password123');
    await assert.rejects(() => tiny.fund(), /needs 0\.\d+/, 'a budget smaller than one trade is refused with the numbers');
    // The sliders' plan is enforced at Start too: a run the money cannot pay for never begins.
    const over = bot({ settings: { bumpBudgetSol: 0.02, bumpMinutes: 180, bumpPerMinute: 20, bumpSimulate: false } });
    over.createWallets(2, 'password123');
    over.addresses().forEach((a) => { over.rpc.balances[a] = 0.01; });
    await assert.rejects(() => over.start(), /minutes at 20\/min/, 'a plan the budget cannot pay is refused at Start, with numbers');
  }

  // ── 7. the schedule: the pace is what was asked for, the wallets are not a metronome ──
  {
    const b = bot({ settings: { bumpSimulate: true, bumpPerMinute: 60, bumpMinutes: 10, bumpHoldMinSec: 1, bumpHoldMaxSec: 2, bumpWallets: 6 } });
    b.createWallets(6, 'password123');
    await b.start();
    assert.strictEqual(b.state().simulate, true);
    for (let i = 0; i < 10; i++) await step(b, 1000);
    const s = b.state();
    assert.ok(s.stats.bumps >= 8 && s.stats.bumps <= 12, 'sixty a minute over ten seconds is about ten bumps: ' + s.stats.bumps);
    assert.ok(b.doors.length === 0, 'a dry run sends nothing');
    // The amounts are the band, and no two are the same number.
    const seeds = new Set();
    const seen = [];
    for (let i = 0; i < 40; i++) seen.push(Number((0.004 + b.rand() * 0.008).toFixed(9)));
    seen.forEach((x) => seeds.add(x));
    assert.ok(seeds.size >= 30, 'forty draws differ from each other: ' + seeds.size);
    await b.stop({ sellBack: false });
  }

  // ── 8. a ROUND is N buys and then one sell of the whole bag ──
  {
    // RULE CHANGED 2026-11-08 (1.1.2): the buy share is no longer a setting that fights the schedule; it is what a round
    // produces. Three buys and one sell is 75% buys, and the sell takes the whole bag - never part of it.
    const b = bot({ settings: { bumpSimulate: true, bumpPerMinute: 120, bumpMinutes: 10, bumpHoldMinSec: 1, bumpHoldMaxSec: 1, bumpWallets: 2, bumpBuysPerRound: 3 } });
    b.createWallets(2, 'password123');
    await b.start();
    for (let i = 0; i < 40; i++) await step(b, 500);
    const s = b.state();
    assert.ok(s.stats.buys >= 3, 'it buys in rounds of three: ' + JSON.stringify({ buys: s.stats.buys, sells: s.stats.sells }));
    assert.ok(s.stats.sells >= 1, 'and then sells the round');
    // Three buys for every sell: the share is what the round makes it.
    assert.ok(Math.abs(s.stats.buySharePct - 75) <= 12, 'a round of three buys and one sell lands near 75%: ' + s.stats.buySharePct + '%');
    await b.stop({ sellBack: false });

    // One buy and one sell is the default, and it is a 50/50 tape.
    const one = bot({ settings: { bumpSimulate: true, bumpPerMinute: 120, bumpMinutes: 10, bumpHoldMinSec: 1, bumpHoldMaxSec: 1, bumpWallets: 2 } });
    one.createWallets(2, 'password123');
    await one.start();
    for (let i = 0; i < 40; i++) await step(one, 500);
    const s1 = one.state();
    assert.ok(Math.abs(s1.stats.buySharePct - 50) <= 12, 'the default is one buy and one sell: ' + s1.stats.buySharePct + '%');
    await one.stop({ sellBack: false });

    // A random round draws its own count, between one and the maximum the operator set.
    const rnd = bot({ settings: { bumpSimulate: true, bumpPerMinute: 120, bumpMinutes: 10, bumpHoldMinSec: 1, bumpHoldMaxSec: 1, bumpWallets: 3, bumpBuysPerRound: 5, bumpBuysRandom: true }, seed: 3 });
    rnd.createWallets(3, 'password123');
    await rnd.start();
    const targets = new Set();
    for (let i = 0; i < 120; i++) { await step(rnd, 500); rnd.rows.forEach((r) => { if (r.roundTarget) targets.add(r.roundTarget); }); }
    const drawn = [...targets];
    assert.ok(drawn.length >= 2, 'random rounds are not all the same length: ' + JSON.stringify(drawn));
    assert.ok(drawn.every((n) => n >= 1 && n <= 5), 'and every one is between one and the maximum: ' + JSON.stringify(drawn));
    await rnd.stop({ sellBack: false });
  }

  // ── 9. no wallet ever spends past its own budget ──
  {
    const b = bot({
      rpc: fakeRpc(),
      settings: { bumpAutoAmount: false, bumpWallets: 4, bumpBudgetSol: 0.2, bumpMinSol: 0.004, bumpMaxSol: 0.012, bumpPerMinute: 50, bumpMinutes: 10, bumpHoldMinSec: 1, bumpHoldMaxSec: 1, bumpBuyRatio: 50 },
    });
    b.createWallets(4, 'password123');
    // The chain holds each wallet's share before the run: this is what funding would have done.
    b.addresses().forEach((a) => { b.rpc.balances[a] = 0.05; });
    await b.start();
    // Long steps: a budget ceiling is only reached by spending, and a hundred bumps take minutes of clock.
    for (let i = 0; i < 200; i++) await step(b, 2000);
    const per = 0.2 / 4;
    // RULE CHANGED 2026-11-08 (1.1.2): the per-wallet budget is no longer a ceiling on `spentSol`, because the ticket comes
    // back on every sell - it is volume, not money gone. What must hold is that no wallet trades more than it can pay for:
    // every row's live balance covers one trade plus its rent, and the figure the panel shows is the sum of the rows.
    for (const row of b.rows) {
      assert.ok(row.balanceSol >= 0.004 + 0.00226, `${row.short} can pay for one more trade (${row.balanceSol} SOL)`);
    }
    const spent = b.rows.reduce((n, r) => n + r.spentSol, 0);
    assert.ok(Math.abs(spent - b.state().stats.spentSol) < 1e-9, 'the panel\'s volume is the sum of the wallets: ' + spent);
    assert.ok(b.state().stats.bumps > 20, 'and the desk keeps working instead of stopping at a budget it did not exceed: ' + b.state().stats.bumps);
    assert.ok(spent > per, 'a budget of 0.05 SOL per wallet pushes more than 0.05 of volume, because the tickets return: ' + spent);
    await b.stop({ sellBack: false });
  }

  // ── 10. the door's transaction is inspected before the key touches it ──
  {
    const stranger = Keypair.generate().publicKey.toBase58();
    const b = bot({ settings: { bumpSimulate: false, bumpWallets: 2, bumpBudgetSol: 0.2, bumpMaxSol: 0.01, bumpMinSol: 0.004 }, door: () => fakeSwap(stranger, 0) });
    b.createWallets(2, 'password123');
    const rpc = b.rpc;
    const before = rpc.sent.length;
    await assert.rejects(
      () => b._swap(b.rows[0] || b._rows(b._cfg())[0], 'buy', 0.005),
      /paid by another wallet/,
      'a transaction built for another wallet is refused',
    );
    assert.strictEqual(rpc.sent.length, before, 'and nothing was broadcast');
    const greedy = bot({ door: (body) => fakeSwap(body.publicKey, 4) });
    greedy.createWallets(2, 'password123');
    await assert.rejects(() => greedy._swap(greedy.wallets()[0], 'buy', 0.005), /moves too much SOL/, 'a swap that drains the wallet is refused');
  }

  // ── 11. a sell sends 100% of the bag, and a wallet that cannot sell is parked ──
  {
    const b = bot({ settings: { bumpWallets: 2, bumpBudgetSol: 0.2, bumpMaxSol: 0.01, bumpMinSol: 0.004 } });
    b.createWallets(2, 'password123');
    const row = b.wallets()[0];
    row.holdingSol = 0.006;
    await b._swap(row, 'sell', '100%');
    const body = b.doors[b.doors.length - 1];
    assert.strictEqual(body.action, 'sell');
    assert.strictEqual(body.amount, '100%', 'a bag is sold whole');
    assert.strictEqual(body.denominatedInSol, 'false', 'and the amount is a share of the tokens, not SOL');
    assert.ok(body.priorityFee >= 0.000001 * 0.9 && body.priorityFee <= 0.000001 * 1.1, 'the tip is minimal and jittered: ' + body.priorityFee);

    const failing = bot({ settings: { bumpWallets: 2, bumpBudgetSol: 0.2 }, door: () => { throw new Error('the trade door refused it (429)'); } });
    failing.createWallets(2, 'password123');
    const stuckRow = failing.wallets()[0];
    stuckRow.holdingSol = 0.006;
    for (let i = 0; i < 3; i++) await assert.rejects(() => failing._run({ kind: 'sell', row: stuckRow }));
    assert.strictEqual(stuckRow.stuck, true, 'three refusals park the wallet instead of retrying for ever');
    assert.ok(/parked/i.test(failing.lastLine), 'and the panel says why: ' + failing.lastLine);
  }

  // ── 12. stopping sells the bags back unless told otherwise, and a pause does not eat the run ──
  {
    const b = bot({ settings: { bumpWallets: 2, bumpBudgetSol: 0.2, bumpMinutes: 5 } });
    b.createWallets(2, 'password123');
    b.addresses().forEach((a) => { b.rpc.balances[a] = 0.09; });
    await b.start();
    await b.pause();
    const endsBefore = b.endsAt;
    await step(b, 60000);
    b.resume();
    assert.strictEqual(b.endsAt, endsBefore + 60000, 'paused time is given back: ' + (b.endsAt - endsBefore) + ' ms');
    b.rows[0].holdingSol = 0.007;
    const out = await b.stop();
    assert.strictEqual(out.soldBack, 1, 'the open bag is sold on the way out');
    assert.strictEqual(b.doors[b.doors.length - 1].action, 'sell');
    assert.strictEqual(b.running, false);

    const keep = bot({ settings: { bumpWallets: 2, bumpBudgetSol: 0.2, bumpSellBack: false } });
    keep.createWallets(2, 'password123');
    keep.addresses().forEach((a) => { keep.rpc.balances[a] = 0.09; });
    await keep.start();
    keep.rows[0].holdingSol = 0.007;
    const kept = await keep.stop();
    assert.strictEqual(kept.soldBack, 0, 'when the operator says keep the bags, they are kept');
    assert.strictEqual(kept.leftHolding, 1, 'and the panel says how many are holding');
  }

  // ── 13. the sweep takes the money back to the one address, and then home ──
  {
    const b = bot({ settings: { bumpWallets: 3, bumpBudgetSol: 0.3 } });
    b.createWallets(3, 'password123');
    const addresses = b.addresses();
    const vaultPub = new PublicKey(b.vaultAddress());
    addresses.forEach((a) => { b.rpc.balances[a] = 0.09; });
    const before = b.rpc.sent.length;
    const out = await b.sweep({ includeTokens: false, toMain: false });
    assert.ok(out.returnedSol > 0.26 && out.returnedSol < 0.28, 'all three wallets came home: ' + out.returnedSol.toFixed(4));
    assert.strictEqual(b.rpc.sent.length - before, 1, 'three wallets sweep in one transaction');
    const tx = Transaction.from(b.rpc.sent[b.rpc.sent.length - 1]);
    const { SystemInstruction } = require('@solana/web3.js');
    for (const ix of tx.instructions) {
      const d = SystemInstruction.decodeTransfer(ix);
      assert.ok(d.toPubkey.equals(vaultPub), 'every lamport lands in the desk address first');
      assert.ok(addresses.includes(d.fromPubkey.toBase58()), 'and comes out of a bump wallet');
    }
    // The token accounts cannot be listed by this fake host: the sweep still returns the SOL and does not pretend it
    // closed anything.
    assert.strictEqual(out.closed, 0);
    // Asked to go home, it does that too - one more transfer, out of the desk address, into the wallet.
    const before2 = b.rpc.sent.length;
    const home = await b.sweep({ includeTokens: false, toMain: true });
    assert.ok(b.rpc.sent.length - before2 >= 1, 'the desk address sends what it holds back to the wallet');
    assert.ok(home.toWalletSol >= 0, 'and reports how much went home');
  }

  // ── 13b. a withdrawal that the chain rejects is not reported as money returned ──
  {
    // RULE ADDED 2026-11-08 (1.1.2): Solana refuses a transaction that would leave an account between zero and its
    // rent-exempt minimum. The desk used to send "everything minus 0.00002", the chain answered InsufficientFundsForRent,
    // and the panel still said the SOL was home - the owner's own 0.02 SOL sat in the desk address while three cheerful
    // "0.0200 SOL home to your wallet" lines were written. Two things hold it now: the floor stays behind, and a transfer
    // counts only once the chain confirms it.
    const b = bot({ settings: { bumpWallets: 2, bumpBudgetSol: 0.02 } });
    b.createWallets(2, 'password123');
    const vault = b.vaultAddress();
    b.rpc.balances[vault] = 0.01998;
    const out = await b.sweep({ includeTokens: false, toMain: true });
    assert.ok(out.toWalletSol > 0.018 && out.toWalletSol < 0.0198, 'the transfer sends what the wallet can send: ' + out.toWalletSol);
    const left = 0.01998 - out.toWalletSol;
    assert.ok(left >= 0.00089088, `and leaves at least the rent-exempt floor behind (${left.toFixed(8)})`);
    assert.ok(out.dustSol >= 0.00089088, 'the desk says how much stays in its own address: ' + out.dustSol);
    assert.ok(/stays in the desk address/.test(b.lastLine), 'and names it in the line the operator reads: ' + b.lastLine);
    assert.strictEqual(out.stuck.length, 0, 'nothing went wrong');

    // The same withdrawal when the chain rejects it: no money claimed, the refusal named.
    const c = bot({ settings: { bumpWallets: 2, bumpBudgetSol: 0.02 } });
    c.createWallets(2, 'password123');
    c.rpc.balances[c.vaultAddress()] = 0.01998;
    c.rpc.confirm = async () => { throw new Error('The transaction landed and FAILED on chain ({"InsufficientFundsForRent":{"account_index":0}}). Nothing moved.'); };
    const refused = await c.sweep({ includeTokens: false, toMain: true });
    assert.strictEqual(refused.toWalletSol, 0, 'a rejected transfer is not counted as returned');
    assert.strictEqual(refused.stuck.length, 1, 'it is reported as stuck, with the chain’s own reason');
    assert.ok(/did not go through/.test(c.lastLine) && /InsufficientFundsForRent/.test(c.lastLine), 'and the operator is told why: ' + c.lastLine);
  }

  // ── 13c. a pool that is only partly funded still sweeps ──
  {
    // RULE FIXED 2026-11-08 (1.1.2): the sweep signed its transaction with every wallet in the chunk, including the empty
    // ones that put no instruction in it - `unknown signer`, and the money stayed where it was. Six wallets in the pool and
    // two funded is the normal case now that the wallet count is the operator's.
    const b = bot({ settings: { bumpWallets: 2, bumpBudgetSol: 0.02, bumpMinutes: 10, bumpPerMinute: 10 } });
    b.createWallets(6, 'password123');
    const [first, second] = b.addresses();
    b.rpc.balances[first] = 0.0099;
    b.rpc.balances[second] = 0.0099;
    b.rpc.balances[b.vaultAddress()] = 0.0019;
    b.rpc.balances[b.wallet.keypair.publicKey.toBase58()] = 0.0009;
    const out = await b.sweep({ includeTokens: false, toMain: false });
    assert.ok(out.returnedSol > 0.019 && out.returnedSol < 0.021, 'both funded wallets come back: ' + out.returnedSol);
    assert.strictEqual(out.stuck.length, 0, 'and nothing is left stuck: ' + JSON.stringify(out.stuck));
    const tx = Transaction.from(b.rpc.sent[b.rpc.sent.length - 1]);
    assert.strictEqual(tx.instructions.length, 2, 'the transaction carries exactly the two funded wallets');
  }

  // ── 13d. a bag the book never saw is still sold on withdrawal ──
  {
    // RULE ADDED 2026-11-08 (1.1.2): a buy whose confirmation timed out can land late. The wallet then holds tokens the run
    // never booked, and a sweep that sells only what it remembers leaves them in the pool wallet for ever.
    const MINT = 'GxWqJbWPxMseev7WXYNPLEG8K59v2fAhJ5m5o7Yepump';
    const rpc = fakeRpc({ mainBalance: 1 });
    const conn = {
      ...rpc,
      async call(fn) { return fn({
        getMultipleAccountsInfo: async (keys) => keys.map((k) => ({ lamports: 8_000_000 })),
        getBalance: async () => 2_000_000,
        getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 9e6 }),
        getSignatureStatuses: async () => ({ value: [{ confirmationStatus: 'confirmed' }] }),
        // Only the first wallet reports tokens; the desk never booked them.
        getParsedTokenAccountsByOwner: async () => ({ value: [{ account: { data: { parsed: { info: { tokenAmount: { amount: '11867261451' } } } } } }] }),
      }); },
    };
    rpc.call = conn.call;
    const b = bot({ rpc, settings: { bumpMint: MINT, bumpWallets: 2, bumpBudgetSol: 0.06, bumpMinutes: 5, bumpPerMinute: 5 } });
    b.createWallets(2, 'password123');
    b.addresses().forEach((a) => { rpc.balances[a] = 0.008; });
    const out = await b.sweep({ includeTokens: true, toMain: false });
    assert.strictEqual(out.sold, 2, 'both wallets are checked, and the one holding tokens is sold: ' + JSON.stringify({ sold: out.sold, stuck: out.stuck }));
  }

  // ── 14. starting refuses when it cannot work, and says why ──
  {
    const noMint = bot({ settings: { bumpMint: '', bumpSimulate: true } });
    noMint.createWallets(2, 'password123');
    await assert.rejects(() => noMint.start(), /token address/, 'no coin, no run');
    const locked = bot({ settings: { bumpSimulate: true } });
    locked.createWallets(2, 'password123');
    locked.lockWallets();
    await assert.rejects(() => locked.start(), /Unlock the bump wallets/, 'locked keys, no run');
    const unfunded = bot({ settings: { bumpSimulate: false } });
    unfunded.createWallets(2, 'password123');
    await assert.rejects(() => unfunded.start(), /Fund the pool/, 'unfunded wallets, no run');
    const wrongPw = bot({});
    assert.throws(() => wrongPw.createWallets(3, 'wrong-password'), /Wrong password/, 'the wallet password is the door');
    const tooShort = bot({});
    assert.throws(() => tooShort.createWallets(3, 'short'), /at least 8/, 'a short password is refused before any key is made');
  }

  // ── 15. the panel payload is honest numbers, and carries no key ──
  {
    const b = bot({ settings: { ...DEFAULTS, bumpMint: MINT, bumpSimulate: true, bumpWallets: 3 } });
    b.createWallets(3, 'password123');
    const s = b.state();
    assert.strictEqual(s.wallets.length, 3);
    assert.strictEqual(s.unlocked, true);
    assert.ok(s.estimate && s.estimate.perBumpFeesSol > 0);
    const json = JSON.stringify(s);
    for (const kp of [...b.keys.values()]) {
      assert.ok(!json.includes(require('bs58').encode(kp.secretKey)), 'the panel never carries a secret key');
      assert.ok(!json.includes(Buffer.from(kp.secretKey).toString('hex')), 'not even as hex');
    }
    assert.ok(json.includes(MINT), 'but it does name the coin being bumped');
  }

  // ── 16. the schedule never picks a wallet that cannot pay for a trade ──
  {
    const b = bot({ settings: { bumpAutoAmount: false, bumpWallets: 3, bumpBudgetSol: 0.3, bumpMinSol: 0.004, bumpMaxSol: 0.012 } });
    b.createWallets(3, 'password123');
    const rows = b.wallets();
    rows.forEach((r) => { r.balanceSol = 0.1; });
    // RULE CHANGED 2026-11-08 (1.1.2): the ceiling is the money ON CHAIN, not a counter of everything the wallet ever bought
    // (`spentSol`), because the ticket comes back on the sell. A wallet with 0.001 SOL cannot pay for one trade plus its rent.
    rows[0].balanceSol = 0.001;
    rows[2].stuck = true;
    b.rows = rows;
    const job = b._choose(b.clock.t);
    assert.ok(job && job.row, 'there is still work: ' + JSON.stringify(job && job.row && job.row.short));
    assert.strictEqual(job.row.address, rows[1].address, 'the wallet that can pay is chosen, never the one without the money');
  }

  // ── 17. the two guards that stand between a plan and the money, tested directly ──
  {
    const { guardFunding, guardSweep, guardDeposit } = require('../src/bump');
    const from = mainKp.publicKey;
    const dest = Keypair.generate().publicKey;
    const mk = (list) => {
      const tx = new Transaction();
      for (const [to, lamports] of list) tx.add(SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports }));
      return tx;
    };
    guardFunding(mk([[dest, 1000]]), from, new Map([[dest.toBase58(), 1000]]));
    assert.throws(() => guardFunding(mk([[dest, 1001]]), from, new Map([[dest.toBase58(), 1000]])), /not planned/, 'an amount that was not agreed is refused');
    assert.throws(() => guardFunding(mk([[dest, 1000]]), from, new Map()), /not planned/, 'an address that was not agreed is refused');
    const other = Keypair.generate();
    const wrongFrom = new Transaction().add(SystemProgram.transfer({ fromPubkey: other.publicKey, toPubkey: dest, lamports: 1000 }));
    assert.throws(() => guardFunding(wrongFrom, from, new Map([[dest.toBase58(), 1000]])), /leave another wallet/, 'a funding transfer that leaves another wallet is refused');
    assert.throws(() => guardFunding(new Transaction(), from, new Map()), /nothing in it/, 'an empty funding transaction is refused');

    const ours = [dest.toBase58()];
    const back = (to, lamports) => new Transaction().add(SystemProgram.transfer({ fromPubkey: dest, toPubkey: to, lamports }));
    guardSweep(back(mainKp.publicKey, 1000), mainKp.publicKey, ours);
    assert.throws(() => guardSweep(back(Keypair.generate().publicKey, 1000), mainKp.publicKey, ours), /other than your wallet/, 'a sweep that pays a stranger is refused');
    const stranger = Keypair.generate();
    const fromStranger = new Transaction().add(SystemProgram.transfer({ fromPubkey: stranger.publicKey, toPubkey: mainKp.publicKey, lamports: 1000 }));
    assert.throws(() => guardSweep(fromStranger, mainKp.publicKey, ours), /does not own/, 'a sweep out of a wallet this desk does not own is refused');

    // The deposit: one transfer, this wallet, the desk address, the amount asked for.
    const desk = Keypair.generate().publicKey;
    const dep = (to, lamports) => new Transaction().add(SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports }));
    guardDeposit(dep(desk, 20_000_000), from, desk, 20_000_000);
    assert.throws(() => guardDeposit(dep(desk, 20_000_000), from, desk, 30_000_000), /did not match/, 'a deposit of another amount is refused');
    assert.throws(() => guardDeposit(dep(stranger.publicKey, 20_000_000), from, desk, 20_000_000), /did not match/, 'a deposit to another address is refused');
    assert.throws(() => guardDeposit(new Transaction(), from, desk, 1), /nothing in it/, 'an empty deposit is refused');
  }

  // ── 17b. the Jito bundle: its tip comes from the wallet that trades, and it counts only once it is on chain ──
  {
    const MINT = 'GxWqJbWPxMseev7WXYNPLEG8K59v2fAhJ5m5o7Yepump';
    const TIP = Keypair.generate().publicKey.toBase58();
    const bundles = [];
    const jito = { tipAccounts: async () => [TIP], sendBundle: async (txs) => { bundles.push(txs); return 'BUNDLEID'; } };
    const b = bot({ jito, settings: { bumpMint: MINT, bumpWallets: 2, bumpBudgetSol: 0.06, bumpMinutes: 5, bumpPerMinute: 60, bumpUseJito: true, bumpJitoTipSol: 0.00001, bumpSimulate: false } });
    b.createWallets(2, 'password123');
    b.addresses().forEach((a) => { b.rpc.balances[a] = 0.03; });
    await b.start();
    await step(b, 1000);
    assert.strictEqual(bundles.length, 1, 'the bump went out as one bundle');
    assert.strictEqual(bundles[0].length, 2, 'the trade and its tip');
    const tipTx = Transaction.from(bundles[0][1]);
    const { SystemInstruction } = require('@solana/web3.js');
    const tipIx = SystemInstruction.decodeTransfer(tipTx.instructions[0]);
    // RULE ADDED 2026-11-08 (1.1.2): the tip used to be paid by the MAIN wallet, so a run quietly spent the operator's own
    // SOL while the pool showed a full balance.
    assert.ok(b.addresses().includes(tipIx.fromPubkey.toBase58()), 'the tip is paid by a pool wallet: ' + tipIx.fromPubkey.toBase58());
    assert.ok(!tipIx.fromPubkey.equals(b.wallet.keypair.publicKey), 'and never by the main wallet');
    assert.strictEqual(tipIx.toPubkey.toBase58(), TIP, 'to the account Jito named');
    assert.strictEqual(Number(tipIx.lamports), 10000, 'for the configured tip');
    assert.strictEqual(b.state().stats.bumps, 1, 'and the bump counts');

    // A bundle that was rejected by Jito is not on chain: the same trade goes out the normal way.
    const refused = bot({ jito: { tipAccounts: async () => [TIP], sendBundle: async () => { throw new Error('bundle rejected'); } }, settings: { bumpMint: MINT, bumpWallets: 2, bumpBudgetSol: 0.06, bumpMinutes: 5, bumpPerMinute: 60, bumpUseJito: true, bumpSimulate: false } });
    refused.createWallets(2, 'password123');
    refused.addresses().forEach((a) => { refused.rpc.balances[a] = 0.03; });
    await refused.start();
    const sentBefore = refused.rpc.sent.length;
    await step(refused, 1000);
    assert.strictEqual(refused.rpc.sent.length - sentBefore, 1, 'a refused bundle falls back to the normal door');
    assert.strictEqual(refused.state().stats.bumps, 1, 'and the trade still counts, because the chain confirmed it');

    // RULE CHANGED 2026-11-11 (1.1.5): a bundle that does not land no longer fails the bump. The SAME signed bytes are
    // offered BUNDLE_SENDS times and then broadcast through the normal route - one signature can execute at most once on
    // Solana, so the second path can never trade twice, and the desk is never left with a bump it cannot account for.
    const sent = [];
    const unknown = bot({ jito: { tipAccounts: async () => [TIP], sendBundle: async (t) => { sent.push(t); return 'BUNDLEID'; } }, settings: { bumpMint: MINT, bumpWallets: 2, bumpBudgetSol: 0.06, bumpMinutes: 5, bumpPerMinute: 60, bumpUseJito: true, bumpSimulate: false } });    unknown.createWallets(2, 'password123');
    unknown.addresses().forEach((a) => { unknown.rpc.balances[a] = 0.03; });
    await unknown.start();
    unknown.rpc.confirm = async () => { throw new Error('not on chain after 15 s'); };
    const before = unknown.rpc.sent.length;
    await step(unknown, 1000);
    assert.strictEqual(sent.length, BUNDLE_SENDS, 'the same trade is offered a few times before the desk gives up on the auction: ' + sent.length);
    assert.ok(sent.every((t) => Buffer.compare(t[0], sent[0][0]) === 0), 'every offer is the same signed transaction, never a new trade');
    assert.strictEqual(unknown.rpc.sent.length - before, 1, 'and then the identical bytes go out through the door - one signature, so never a second trade');
    assert.strictEqual(Buffer.compare(Buffer.from(unknown.rpc.sent[before]), Buffer.from(sent[0][0])), 0, 'byte for byte the bundled transaction: ' + unknown.rpc.sent.length);
    assert.strictEqual(unknown.state().stats.bumps, 0, 'and it is not counted as a bump');
    assert.strictEqual(unknown.state().stats.errors, 1, 'it is counted as an error');
  }

  // ── 17c. a top-up cannot leave the main wallet under the rent-free floor ──
  {
    const b = bot();
    b.createWallets(2, 'password123');
    b.rpc.balances[b.wallet.keypair.publicKey.toBase58()] = 0.0055;
    // RULE ADDED 2026-11-08 (1.1.2): Solana rejects a transfer that would leave a wallet between zero and its rent-exempt
    // minimum. Sending 0.005 out of 0.0055 is exactly that, so it is refused here with the amount that would work.
    await assert.rejects(() => b.depositFromMain(0.005), /must keep 0\.0009|most you can send/, 'a top-up that would strand the wallet is refused');
    assert.strictEqual(b.rpc.sent.length, 0, 'and nothing was signed');
    b.rpc.balances[b.wallet.keypair.publicKey.toBase58()] = 0.05;
    const ok = await b.depositFromMain(0.02);
    assert.ok(ok.signature, 'a top-up with room behind it goes through');
  }

  // ── 17d. funding follows the plan, not the roster ──
  {
    // Six wallets in the pool, a budget that carries two: only two are funded. Funding all six asked for 0.06 SOL to run a
    // 0.02 SOL plan, which is what refused the owner's own money.
    // RULE CHANGED 2026-11-09 (1.1.3): the money in the desk address IS the budget. This case used to split only the 0.02 the
    // slider said while the pool held 0.03, leaving a third of the owner's deposit stranded - so the split is now the pool's
    // balance minus the fee that moves it.
    const b = bot({ settings: { bumpMint: 'GxWqJbWPxMseev7WXYNPLEG8K59v2fAhJ5m5o7Yepump', bumpWallets: 2, bumpBudgetSol: 0.02, bumpMinutes: 10, bumpPerMinute: 10 } });
    b.createWallets(6, 'password123');
    b.rpc.balances[b.vaultAddress()] = 0.03;
    b.rpc.balances[b.wallet.keypair.publicKey.toBase58()] = 0;
    const funded = await b.fund();
    assert.strictEqual(funded.funded, 2, 'only the wallets the plan uses are funded: ' + JSON.stringify(funded));
    const tx = Transaction.from(b.rpc.sent[b.rpc.sent.length - 1]);
    const { SystemInstruction } = require('@solana/web3.js');
    const destinations = tx.instructions.map((ix) => SystemInstruction.decodeTransfer(ix).toPubkey.toBase58());
    assert.strictEqual(destinations.length, 2, 'and the split has exactly that many transfers');
    assert.deepStrictEqual(destinations, b.addresses().slice(0, 2), 'the first two of the pool, which is the order the plan uses');
    assert.ok(funded.sol > 0.025 && funded.sol < 0.031, 'the split is the money in the pool (0.03 minus the fee that moves it), not six shares: ' + funded.sol);
  }

  // ── 17e. a trade the pump door provably could not make goes through Jupiter ──
  {
    const MINT = 'GxWqJbWPxMseev7WXYNPLEPump1111111111111111111';
    const calls = [];
    const jupiter = {
      swap: async (o) => { calls.push({ in: o.inputMint, out: o.outputMint, amount: o.amountRaw, bps: o.slippageBps }); return 'JUPSIG'; },
    };
    const b = bot({ jupiter, settings: { bumpMint: 'GxWqJbWPxMseev7WXYNPLEG8K59v2fAhJ5m5o7Yepump', bumpWallets: 2, bumpBudgetSol: 0.06, bumpMinutes: 5, bumpPerMinute: 60, bumpUseJito: false, bumpSimulate: false } });
    b.createWallets(2, 'password123');
    b.addresses().forEach((a) => { b.rpc.balances[a] = 0.03; });
    // The door's transaction lands and FAILS on chain, which is what a migrated coin does.
    b.rpc.confirm = async () => { throw new Error('The transaction landed and FAILED on chain ({"InstructionError":[4,{"Custom":6004}]}). Nothing moved.'); };
    await b.start();
    await step(b, 1000);
    assert.strictEqual(calls.length, 1, 'Jupiter was asked for the same trade');
    assert.strictEqual(calls[0].in, WSOL, 'a buy spends wrapped SOL');
    assert.strictEqual(calls[0].out, 'GxWqJbWPxMseev7WXYNPLEG8K59v2fAhJ5m5o7Yepump', 'and buys the configured coin');
    assert.strictEqual(calls[0].bps, 100, 'at the configured slippage, in basis points');
    assert.strictEqual(b.state().stats.bumps, 1, 'and the bump counts, because Jupiter says it landed');

    // An UNKNOWN outcome is never retried - the trade may be on chain, and a second one would buy twice.
    const calls2 = [];
    const c = bot({ jupiter: { swap: async (o) => { calls2.push(o); return 'JUPAGAIN'; } }, settings: { bumpMint: 'GxWqJbWPxMseev7WXYNPLEG8K59v2fAhJ5m5o7Yepump', bumpWallets: 2, bumpBudgetSol: 0.06, bumpMinutes: 5, bumpPerMinute: 60, bumpUseJito: false, bumpSimulate: false } });
    c.createWallets(2, 'password123');
    c.addresses().forEach((a) => { c.rpc.balances[a] = 0.03; });
    c.rpc.confirm = async () => { throw new Error('The transaction was sent but is not on chain after 15 s. Check signature ABC before doing anything with the money again.'); };
    await c.start();
    await step(c, 1000);
    assert.strictEqual(calls2.length, 0, 'an unknown outcome is not handed to Jupiter');
    assert.strictEqual(c.state().stats.errors, 1, 'it is reported as an error instead');
  }

  // ── 17f. a wallet is not "spent" once its tickets come back on the sell ──
  {
    // RULE FIXED 2026-11-08 (1.1.2): `spentSol` only ever grew, so a 0.01 SOL wallet looked spent after four bumps and the
    // owner's own run ended at twelve bumps with 0.0198 SOL still in the pool. The live balance is the gate now.
    const b = bot({ settings: { bumpMint: 'GxWqJbWPxMseev7WXYNPLEG8K59v2fAhJ5m5o7Yepump', bumpWallets: 2, bumpBudgetSol: 0.3, bumpMinutes: 30, bumpPerMinute: 60, bumpBuyRatio: 50, bumpHoldMinSec: 1, bumpHoldMaxSec: 1, bumpSimulate: false } });
    b.createWallets(2, 'password123');
    b.addresses().forEach((a) => { b.rpc.balances[a] = 0.15; });
    await b.start();
    for (let i = 0; i < 40; i++) await step(b, 500);
    const s = b.state();
    assert.ok(s.stats.bumps >= 10, 'the desk keeps bumping long past four per wallet: ' + JSON.stringify(s.stats));
    assert.ok(s.stats.sells > 0, 'and sells as well as buys');
    assert.strictEqual(b.rows.filter((r) => r.stuck).length, 0, 'no wallet is wrongly marked as spent');
    await b.stop({ sellBack: false });

    // The sharp version of the same rule, at the scheduler: a wallet that has already bought and sold 0.05 SOL worth and has
    // 0.05 SOL on chain is a wallet with plenty of money, not a spent one.
    const c = bot({ settings: { bumpAutoAmount: false, bumpWallets: 2, bumpBudgetSol: 0.2, bumpMinSol: 0.004, bumpMaxSol: 0.012 } });
    c.createWallets(2, 'password123');
    const pool = c.wallets();
    pool.forEach((r) => { r.balanceSol = 0.05; r.spentSol = 0.05; });
    c.rows = pool;
    const job = c._choose(c.clock.t);
    assert.ok(job && job.row, 'a wallet whose tickets came back can still trade');
  }

  // ── 17g. ten addresses created, the plan asks for two ──
  {
    // The owner's own question: "10 addresses, then I change it to 2 - does it split across those two and start?" Yes - and
    // the eight outside the plan must not trade, even if an earlier, larger pool left money in them.
    const b = bot({ settings: { bumpMint: 'GxWqJbWPxMseev7WXYNPLEG8K59v2fAhJ5m5o7Yepump', bumpWallets: 2, bumpBudgetSol: 0.02, bumpMinutes: 10, bumpPerMinute: 10 } });
    b.createWallets(10, 'password123');
    assert.strictEqual(b.addresses().length, 10, 'ten addresses exist');
    const rows = b.wallets();
    assert.strictEqual(rows.filter((r) => r.active).length, 2, 'the plan carries two of them');
    assert.ok(rows.slice(2).every((r) => r.budgetSol === 0), 'and the other eight are given no share of the budget');

    // Fund: only the two are funded, and the eight that hold money from an earlier pool are named.
    b.rpc.balances[b.vaultAddress()] = 0.03;
    b.rpc.balances[b.addresses()[5]] = 0.01;                 // money left in a wallet outside the plan
    const funded = await b.fund();
    assert.strictEqual(funded.funded, 2, 'only the plan wallets are funded: ' + JSON.stringify(funded));
    assert.ok(funded.idleSol > 0.009, 'the money outside the plan is reported: ' + funded.idleSol);
    assert.ok(/will not trade/.test(b.lastLine), 'and named in the panel line: ' + b.lastLine);

    // The scheduler never picks an address outside the plan, even when it is the only one with money.
    b.rows.forEach((r, i) => { r.balanceSol = i >= 2 ? 0.05 : 0; r.roundBuys = 0; r.holdingSol = 0; });
    assert.strictEqual(b._choose(b.clock.t), null, 'with no money in the plan wallets there is nothing to buy, and an idle wallet is not a candidate');

    // Growing the pool KEEPS the wallets that exist (and the money in them) instead of refusing or replacing them.
    const grow = bot({ settings: { bumpWallets: 2, bumpBudgetSol: 0.02 } });
    grow.createWallets(2, 'password123');
    const first = grow.addresses().slice();
    grow.rpc.balances[first[0]] = 0.01;
    const more = grow.createWallets(5, 'password123');
    assert.strictEqual(more.addresses.length, 5, 'the roster grew to five');
    assert.strictEqual(more.kept, 2, 'and says how many were already there');
    assert.strictEqual(more.created, 3, 'with three new keys');
    // RULE FIXED 2026-11-09 (1.1.2): growing used to hand back only the new keypairs, so the wallets that already held the
    // money fell out of memory and could not sign until the next unlock.
    assert.strictEqual(grow.keys.size, 5, 'every wallet in the pool can sign after growing: ' + grow.keys.size);
    assert.deepStrictEqual(more.addresses.slice(0, 2), first, 'the first two addresses are untouched - their money is still theirs');
    assert.strictEqual(grow.rpc.balances[first[0]], 0.01, 'nothing moved');
    // A smaller number deletes nothing: the plan just carries fewer.
    const shrink = grow.createWallets(2, 'password123');
    assert.strictEqual(shrink.addresses.length, 5, 'asking for two keeps the five keys');
    assert.strictEqual(grow.wallets().filter((r) => r.active).length, 2, 'and the plan carries two of them');
  }

  // ── 17h. "unknown" is not "did nothing": the chain is asked before a trade is written off ──
  {
    const MINT = 'GxWqJbWPxMseev7WXYNPLEG8K59v2fAhJ5m5o7Yepump';
    const withTokens = (tokens) => {
      const rpc = fakeRpc({ mainBalance: 1 });
      rpc.call = async (fn) => fn({
        getMultipleAccountsInfo: async (keys) => keys.map(() => ({ lamports: 30_000_000 })),
        getBalance: async () => 30_000_000,
        getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 9e6 }),
        getSignatureStatuses: async () => ({ value: [{ confirmationStatus: 'confirmed' }] }),
        getParsedTokenAccountsByOwner: async () => (tokens > 0
          ? { value: [{ account: { data: { parsed: { info: { tokenAmount: { amount: String(tokens) } } } } } }] }
          : { value: [] }),
      });
      return rpc;
    };
    const settings = { bumpMint: MINT, bumpWallets: 2, bumpBudgetSol: 0.06, bumpMinutes: 5, bumpPerMinute: 60, bumpHoldMinSec: 1, bumpHoldMaxSec: 1, bumpSimulate: false };

    // A buy whose confirmation timed out but which LANDED (tokens are there) is booked, not written off.
    const rpcA = withTokens(5000);
    const a = bot({ rpc: rpcA, settings });
    a.createWallets(2, 'password123');
    a.addresses().forEach((x) => { rpcA.balances[x] = 0.03; });
    await a.start();
    a._clearTimer();   // the run's own timer must not add a tick of its own to this test
    a.rpc.confirm = async () => { throw new Error('The transaction was sent but is not on chain after 15 s. Check signature ABC.'); };
    const rowA = a.rows.find((r) => r.active);
    await a._run({ kind: 'buy', row: rowA });
    assert.ok(rowA.holdingSol > 0, 'a buy that landed late is booked as a bag: ' + rowA.holdingSol);
    assert.strictEqual(rowA.roundBuys, 1, 'and the round counts it');
    await a.stop({ sellBack: false });

    // A sell that left tokens behind is not the end of the round: the bag stays and the sell is retried.
    const rpcB = withTokens(4000);
    const b = bot({ rpc: rpcB, settings });
    b.createWallets(2, 'password123');
    b.addresses().forEach((x) => { rpcB.balances[x] = 0.03; });
    await b.start();
    b._clearTimer();
    const rowB = b.rows.find((r) => r.active);
    rowB.holdingSol = 0.002;
    rowB.roundBuys = 1;
    rowB.roundTarget = 1;
    rowB.sellAt = 0;
    const before = b.clock.t;
    await b._run({ kind: 'sell', row: rowB });
    assert.strictEqual(rowB.holdingSol, 0.002, 'a partial fill keeps the bag booked');
    assert.ok(rowB.sellAt > before, 'and the sell is scheduled again');
    assert.ok(/partial fill/i.test(b.lastLine), 'with a line that says so: ' + b.lastLine);
    await b.stop({ sellBack: false });
  }

  // ── 17i. Stop wins over a trade that has not been sent yet ──
  {
    const MINT = 'GxWqJbWPxMseev7WXYNPLEG8K59v2fAhJ5m5o7Yepump';
    const b = bot({ settings: { bumpMint: MINT, bumpWallets: 2, bumpBudgetSol: 0.06, bumpMinutes: 30, bumpPerMinute: 60, bumpHoldMinSec: 1, bumpHoldMaxSec: 1, bumpSimulate: false } });
    b.createWallets(2, 'password123');
    b.addresses().forEach((a) => { b.rpc.balances[a] = 0.03; });
    await b.start();
    const row = b.rows.find((r) => r.active);
    // The operator pressed Stop between the schedule and the trade: nothing may be sent.
    b.running = false;
    const before = b.rpc.sent.length;
    await b._run({ kind: 'buy', row });
    assert.strictEqual(b.rpc.sent.length, before, 'a stopped desk sends no trade');
    assert.strictEqual(row.holdingSol, 0, 'and books nothing');

    // Stop waits for a trade that is already in the air instead of selling into it.
    b.running = true;
    b._busy = true;
    setTimeout(() => { b._busy = false; }, 150);
    const began = Date.now();
    await b.stop({ sellBack: false });
    assert.ok(Date.now() - began >= 100, 'stop waited for the trade in flight (waited ' + (Date.now() - began) + ' ms)');
    assert.ok(/Waiting for the trade in flight/.test(String(b.lastLine)) || !b._busy, 'and said so: ' + b.lastLine);
  }

  // ── 17j. Jito stands down only after JITO_MISS_LIMIT trades in a row whose bundle did not land ──
  {
    const MINT = 'GxWqJbWPxMseev7WXYNPLEG8K59v2fAhJ5m5o7Yepump';
    const TIP = Keypair.generate().publicKey.toBase58();
    let bundles = 0;
    const jito = { tipAccounts: async () => [TIP], sendBundle: async () => { bundles++; return 'BUNDLEID'; } };
    const b = bot({ jito, settings: { bumpMint: MINT, bumpWallets: 2, bumpBudgetSol: 0.3, bumpMinutes: 30, bumpPerMinute: 60, bumpUseJito: true, bumpSimulate: false } });
    b.createWallets(2, 'password123');
    b.addresses().forEach((a) => { b.rpc.balances[a] = 0.15; });
    await b.start();
    // RULE CHANGED 2026-11-11 (1.1.5): ONE unlanded bundle no longer retires Jito - it used to, and that is why the switch
    // looked like it did nothing ("TO POWINNO z jito zapierdalac"). A miss now costs nothing but a moment: the trade goes out
    // the normal way, and the engine is asked again next time. Only JITO_MISS_LIMIT misses in a row stand it down.
    b.rpc.confirm = async () => { throw new Error('The transaction was sent but is not on chain after 15 s. Check signature ABC.'); };
    const row = b.rows.find((r) => r.active);
    const sentBefore = b.rpc.sent.length;
    await assert.rejects(() => b._run({ kind: 'buy', row }), /not on chain/);
    assert.strictEqual(bundles, BUNDLE_SENDS, 'the bundle was offered a few times before the normal route took over');
    assert.strictEqual(b._jitoBroken, false, 'one miss does not retire Jito');
    assert.ok(b.rpc.sent.length > sentBefore, 'and the trade went out the normal way, so the bump was not lost');
    assert.ok(/went out the normal way/.test(b.lastLine), 'and says so: ' + b.lastLine);
    // Two more misses in a row: that is the limit, and now the engine really is stood down for the rest of the run.
    await assert.rejects(() => b._run({ kind: 'buy', row }));
    await assert.rejects(() => b._run({ kind: 'buy', row }));
    assert.strictEqual(b._jitoBroken, true, `${JITO_MISS_LIMIT} misses in a row retire Jito for the run`);
    assert.ok(/offered 3 trades in a row and none landed/.test(b.lastLine), 'and says so: ' + b.lastLine);
    const bundlesNow = bundles;
    const sentThen = b.rpc.sent.length;
    b.rpc.confirm = async (sig) => ({ signature: sig, slot: 1 });   // the normal route's confirmation is healthy again
    await b._run({ kind: 'buy', row });
    assert.strictEqual(bundles, bundlesNow, 'the engine is not asked again');
    assert.ok(b.rpc.sent.length > sentThen, 'and the trade goes out the normal way');
    await b.stop({ sellBack: false });
  }

  // ── 17k. a slow confirmation costs a slot, never a burst ──
  {
    const MINT = 'GxWqJbWPxMseev7WXYNPLEG8K59v2fAhJ5m5o7Yepump';
    const b = bot({
      settings: { bumpMint: MINT, bumpWallets: 2, bumpBudgetSol: 0.3, bumpMinutes: 30, bumpPerMinute: 8.5, bumpBuysPerRound: 4, bumpHoldMinSec: 20, bumpHoldMaxSec: 20, bumpSimulate: false },
      // A real door round trip costs about a second, and that is what made the old rule fire three ticks back to back.
      door: (body) => { b.clock.t += 900; return fakeSwap(body.publicKey, body.action === 'buy' ? Number(body.amount) + 0.00204 : 0); },
    });
    b.createWallets(2, 'password123');
    b.addresses().forEach((a) => { b.rpc.balances[a] = 0.15; });
    // One confirmation takes 15 s of real time: the clock is the desk's own, so the stall is real to it.
    let confirms = 0;
    b.rpc.confirm = async (sig) => {
      confirms++;
      if (confirms === 2) { b.clock.t += 15000; throw new Error('The transaction was sent but is not on chain after 15 s. Check signature ABC.'); }
      return { signature: sig };
    };
    const stamps = [];
    // Successful trades only: a REFUSED buy logs a line too, and counting those would measure the retries instead of the pace.
    b.on('log', (line) => { if (/^(Buy \d|Sell back from)/.test(line)) stamps.push(b.clock.t); });
    await b.start();
    for (let i = 0; i < 250; i++) await step(b, 100);
    const gaps = stamps.slice(1).map((t, i) => t - stamps[i]);
    const base = 60000 / 8.5;
    const short = gaps.filter((g) => g < 500);
    assert.ok(stamps.length >= 5, 'the run kept going after the stall: ' + stamps.length + ' trades');
    // RULE: never two trades inside half a second, whatever happened before. A burst (three buys 1 s apart, which the old
    // `next < now - base` test produced after a slow confirmation) is the one pattern an onlooker reads as a bot.
    assert.strictEqual(short.length, 0, 'no two trades inside 500 ms, not even after a stall: ' + JSON.stringify(gaps));
    await b.stop({ sellBack: false });
  }

  // ── 17l. the panel's balances are the chain's, not a snapshot from Start ──
  {
    const MINT = 'GxWqJbWPxMseev7WXYNPLEG8K59v2fAhJ5m5o7Yepump';
    const b = bot({ settings: { bumpMint: MINT, bumpWallets: 2, bumpBudgetSol: 0.3, bumpMinutes: 30, bumpPerMinute: 60, bumpHoldMinSec: 1, bumpHoldMaxSec: 1, bumpSimulate: false } });
    b.createWallets(2, 'password123');
    b.addresses().forEach((a) => { b.rpc.balances[a] = 0.15; });
    await b.start();
    // The chain moves on: every wallet loses SOL (fees and tickets out, nothing back yet).
    b.addresses().forEach((a) => { b.rpc.balances[a] = 0.10; });
    b.clock.t += 11000;
    await step(b, 100);
    const row = b.rows.find((r) => r.active);
    assert.ok(Math.abs(row.balanceSol - 0.10) < 1e-9, 'the panel read the chain again during the run: ' + row.balanceSol);
    await b.stop({ sellBack: false });
  }

  // ── 17m. a definite "no route" is asked for once more ──
  {
    const MINT = 'GxWqJbWPxMseev7WXYNPLEG8K59v2fAhJ5m5o7Yepump';
    let calls = 0;
    const jupiter = {
      swap: async (o) => {
        calls++;
        if (calls === 1) throw Object.assign(new Error('Jupiter has no route: 400 Failed to get quotes'), { phase: 'build', definite: true });
        return 'JUP2';
      },
    };
    const b = bot({ jupiter, settings: { bumpMint: MINT, bumpWallets: 2, bumpBudgetSol: 0.3, bumpMinutes: 30, bumpPerMinute: 60, bumpUseJito: false, bumpSimulate: false } });
    b.createWallets(2, 'password123');
    b.addresses().forEach((a) => { b.rpc.balances[a] = 0.15; });
    await b.start();
    b._clearTimer();          // the run's own timer must not add a second tick to this test
    b.rpc.confirm = async () => { throw new Error('The transaction landed and FAILED on chain ({"InstructionError":[3,{"Custom":6004}]}). Nothing moved.'); };
    const row = b.rows.find((r) => r.active);
    await b._run({ kind: 'buy', row });
    assert.strictEqual(calls, 2, 'a definite "no route" is retried once: ' + calls);
    assert.ok(row.holdingSol > 0, 'and the bump lands');
    await b.stop({ sellBack: false });
  }

  // ── 17x. one wallet can be rescued on its own, and a parked one is not abandoned ──
  {
    const MINT = 'GxWqJbWPxMseev7WXYNPLEG8K59v2fAhJ5m5o7Yepump';
    const rpc = fakeRpc({ mainBalance: 1 });
    rpc.call = async (fn) => fn({
      getMultipleAccountsInfo: async (k) => k.map(() => ({ lamports: 8_000_000 })),
      getBalance: async () => 8_000_000,
      getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 9e6 }),
      getSignatureStatuses: async () => ({ value: [{ confirmationStatus: 'confirmed' }] }),
      getParsedTokenAccountsByOwner: async () => ({ value: [{ account: { data: { parsed: { info: { tokenAmount: { amount: '7000000000' } } } } } }] }),
    });
    const b = bot({ rpc, settings: { bumpMint: MINT, bumpWallets: 2, bumpBudgetSol: 0.06, bumpMinutes: 5, bumpPerMinute: 5 } });
    b.createWallets(2, 'password123');
    b.rows = b.wallets();                       // the LIVE rows - a rescue must change what the desk believes
    const row = b.rows.find((r) => r.active);
    row.stuck = true;
    row.stuckUntil = b.clock.t + 60000;
    // The chain says it holds tokens and the book says nothing: the rescue sells them and unparks the wallet.
    const out = await b.rescueWallet(row.address);
    assert.strictEqual(out.sold, true, 'the wallet is sold: ' + JSON.stringify(out));
    assert.strictEqual(out.unparked, true, 'and unparked');
    assert.ok(/Rescued/.test(b.lastLine), 'with one line the operator can read: ' + b.lastLine);

    // A wallet whose rescue found nothing to sell still unparks and closes what it can.
    const rpc2 = fakeRpc({ mainBalance: 1 });
    rpc2.call = async (fn) => fn({
      getMultipleAccountsInfo: async (k) => k.map(() => ({ lamports: 8_000_000 })),
      getBalance: async () => 8_000_000,
      getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 9e6 }),
      getSignatureStatuses: async () => ({ value: [{ confirmationStatus: 'confirmed' }] }),
      getParsedTokenAccountsByOwner: async () => ({ value: [] }),
    });
    const c = bot({ rpc: rpc2, settings: { bumpMint: MINT, bumpWallets: 2, bumpBudgetSol: 0.06, bumpMinutes: 5, bumpPerMinute: 5 } });
    c.createWallets(2, 'password123');
    c.rows = c.wallets();
    const rowC = c.rows.find((r) => r.active);
    rowC.stuck = true;
    const outC = await c.rescueWallet(rowC.address);
    assert.strictEqual(outC.sold, false, 'nothing held, nothing sold');
    assert.strictEqual(outC.unparked, true, 'but the wallet is free again');
    assert.ok(/nothing held/.test(c.lastLine), 'and the line says so: ' + c.lastLine);

    // A parking spell ENDS: the desk retries the wallet instead of leaving it out of the run for ever.
    const d = bot({ settings: { bumpMint: MINT, bumpWallets: 2, bumpBudgetSol: 0.06, bumpMinutes: 30, bumpPerMinute: 5 } });
    d.createWallets(2, 'password123');
    d.rows = d.wallets().map((r) => ({ ...r, balanceSol: 0.02, stuck: true, stuckUntil: d.clock.t + 120000 }));
    assert.strictEqual(d._choose(d.clock.t), null, 'both parked wallets sit out while their spell runs');
    d.clock.t += 121000;
    const job = d._choose(d.clock.t);
    assert.ok(job && job.row, 'and are eligible again when the spell is over');
  }

  // ── 17o. a rescue gets the bag OUT: never through a bundle, and only the chain is allowed to say whether it is out ──
  {
    const MINT = 'GxWqJbWPxMseev7WXYNPLEG8K59v2fAhJ5m5o7Yepump';
    const holdingRpc = () => {
      const rpc = fakeRpc({ mainBalance: 1 });
      rpc.call = async (fn) => fn({
        getMultipleAccountsInfo: async (k) => k.map(() => ({ lamports: 8_000_000 })),
        getBalance: async () => 8_000_000,
        getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 9e6 }),
        getSignatureStatuses: async () => ({ value: [{ confirmationStatus: 'confirmed' }] }),
        getParsedTokenAccountsByOwner: async () => ({ value: [{ account: { data: { parsed: { info: { tokenAmount: { amount: '7000000000' } } } } } }] }),
      });
      return rpc;
    };

    // (a) The Rescue button on a desk that has bundling ON still trades the ordinary way: a bundle that does not land is
    // exactly the jam this button exists for (the owner's own HoQr…2wJb sat on a bag behind an unlanded bundle).
    const bundles = [];
    const a = bot({
      rpc: holdingRpc(),
      jito: { tipAccounts: async () => [Keypair.generate().publicKey.toBase58()], sendBundle: async (t) => { bundles.push(t); return 'ID'; } },
      settings: { bumpMint: MINT, bumpWallets: 2, bumpBudgetSol: 0.06, bumpMinutes: 5, bumpPerMinute: 5, bumpUseJito: true },
    });
    a.createWallets(2, 'password123');
    a.rows = a.wallets();
    const outA = await a.rescueWallet(a.rows[0].address);
    assert.strictEqual(outA.sold, true, 'the bag is sold by a rescue');
    assert.strictEqual(bundles.length, 0, 'a rescue never asks the block engine: ' + bundles.length);
    assert.ok(/bag sold/.test(a.lastLine), 'and the line says sold: ' + a.lastLine);

    // (b) The sell goes out and is never confirmed - but the chain then shows the wallet empty, so it DID sell. The rescue
    // asks the chain instead of believing the timeout, and does not send a second sell.
    let reads = 0;
    const rpcB = fakeRpc({ mainBalance: 1 });
    rpcB.call = async (fn) => fn({
      getMultipleAccountsInfo: async (k) => k.map(() => ({ lamports: 8_000_000 })),
      getBalance: async () => 8_000_000,
      getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 9e6 }),
      getSignatureStatuses: async () => ({ value: [{ confirmationStatus: 'confirmed' }] }),
      // first look: the bag is there; every look after it: gone (the sell landed inside the window)
      getParsedTokenAccountsByOwner: async () => {
        reads += 1;
        return reads === 1
          ? { value: [{ account: { data: { parsed: { info: { tokenAmount: { amount: '7000000000' } } } } } }] }
          : { value: [] };
      },
    });
    const b = bot({ rpc: rpcB, settings: { bumpMint: MINT, bumpWallets: 2, bumpBudgetSol: 0.06, bumpMinutes: 5, bumpPerMinute: 5 } });
    b.createWallets(2, 'password123');
    b.rows = b.wallets();
    b.rpc.confirm = async () => { throw new Error('The transaction was sent but is not on chain after 15 s.'); };
    const outB = await b.rescueWallet(b.rows[0].address);
    assert.strictEqual(outB.sold, true, 'the chain overrules the timeout: ' + JSON.stringify(outB));
    assert.strictEqual(b.rpc.sent.length, 1, 'and no second sell was sent: ' + b.rpc.sent.length);
    assert.ok(/bag sold/.test(b.lastLine), 'the line is honest: ' + b.lastLine);
    assert.ok(!/nothing held/.test(b.lastLine), 'and never claims nothing was held: ' + b.lastLine);

    // (c) The sell really did not go through: the tokens are still on chain, the line says so, and it says the bag is still
    // there instead of the old lie ("nothing held")
    const c = bot({ rpc: holdingRpc(), settings: { bumpMint: MINT, bumpWallets: 2, bumpBudgetSol: 0.06, bumpMinutes: 5, bumpPerMinute: 5 } });
    c.createWallets(2, 'password123');
    c.rows = c.wallets();
    c.rpc.confirm = async () => { throw new Error('The transaction was sent but is not on chain after 15 s.'); };
    const before = c.clock.t;
    const outC = await c.rescueWallet(c.rows[0].address);
    assert.strictEqual(outC.sold, false, 'nothing was sold');
    assert.strictEqual(outC.attempted, true, 'but the rescue tried');
    assert.ok(/the bag is still there, nothing was sold/.test(c.lastLine), 'and says exactly that: ' + c.lastLine);
    assert.ok(!/nothing held/.test(c.lastLine), 'never "nothing held" about a bag it just failed to sell: ' + c.lastLine);
    assert.strictEqual(c.rpc.sent.length, 2, 'it tried twice before giving up: ' + c.rpc.sent.length);
    assert.ok(c.clock.t - before >= 6000, 'and gave the first sell time to land before trying again: ' + (c.clock.t - before));
    assert.strictEqual(c.rows[0].holdingSol > 0, true, 'and the book still holds the bag, so the run knows');
  }

  // ── 17p. a sell that comes back unconfirmed is settled by the token balance, not believed either way ──
  {
    const MINT = 'GxWqJbWPxMseev7WXYNPLEG8K59v2fAhJ5m5o7Yepump';
    const emptyChain = () => {
      const rpc = fakeRpc({ mainBalance: 1 });
      rpc.call = async (fn) => fn({
        getMultipleAccountsInfo: async (k) => k.map(() => ({ lamports: 150_000_000 })),
        getBalance: async () => 150_000_000,
        getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 9e6 }),
        getSignatureStatuses: async () => ({ value: [{ confirmationStatus: 'confirmed' }] }),
        getParsedTokenAccountsByOwner: async () => ({ value: [] }),          // the wallet holds no tokens of this mint
      });
      return rpc;
    };
    const b = bot({ rpc: emptyChain(), settings: { bumpMint: MINT, bumpWallets: 2, bumpBudgetSol: 0.06, bumpMinutes: 5, bumpPerMinute: 60 } });
    b.createWallets(2, 'password123');
    await b.start();
    b._clearTimer();
    for (const r of b.rows) { r.holdingSol = 0.01; r.roundBuys = 1; r.roundTarget = 1; r.sellAt = 0; }
    // Stop sells the bags back; this sell can NEVER confirm, yet the chain says the wallet is empty.
    b.rpc.confirm = async () => { throw new Error('The transaction was sent but is not on chain after 20 s.'); };
    await b.stop({ sellBack: true });
    assert.ok(!/Could not sell back/.test(b.lastLine), 'a bag that is provably gone is not reported as stuck: ' + b.lastLine);
    assert.ok(/2 bags sold back/.test(b.lastLine), 'both count as sold: ' + b.lastLine);
    assert.ok(b.rows.every((r) => !r.holdingSol), 'and the book lets go of them');

    // The same sell where the RPC could not answer the first time: the trade inside the swap cannot settle itself, so the
    // sell-back asks the chain once more before it gives up on a bag that is not there any more.
    let readsD = 0;
    const rpcD = fakeRpc({ mainBalance: 1 });
    rpcD.call = async (fn) => fn({
      getMultipleAccountsInfo: async (k) => k.map(() => ({ lamports: 150_000_000 })),
      getBalance: async () => 150_000_000,
      getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 9e6 }),
      getSignatureStatuses: async () => ({ value: [{ confirmationStatus: 'confirmed' }] }),
      getParsedTokenAccountsByOwner: async () => {
        readsD += 1;
        if (readsD === 1) throw new Error('rpc timeout');                    // the swap's own look cannot answer
        return { value: [] };                                                // and the sell-back's look says: empty
      },
    });
    const d = bot({ rpc: rpcD, settings: { bumpMint: MINT, bumpWallets: 2, bumpBudgetSol: 0.06, bumpMinutes: 5, bumpPerMinute: 60 } });
    d.createWallets(2, 'password123');
    await d.start();
    d._clearTimer();
    for (const r of d.rows) { r.holdingSol = 0.01; r.roundBuys = 1; r.roundTarget = 1; r.sellAt = 0; }
    d.rpc.confirm = async () => { throw new Error('The transaction was sent but is not on chain after 20 s.'); };
    await d.stop({ sellBack: true });
    assert.ok(/2 bags sold back/.test(d.lastLine), 'the sell-back settles it even when the first look failed: ' + d.lastLine);
    assert.ok(d.rows.every((r) => !r.holdingSol), 'and lets the bags go');
  }

  // ── 17q. the round's own sell: an unanswered sell that the chain proves is settled ends the round, it does not poison it ──
  {
    const MINT = 'GxWqJbWPxMseev7WXYNPLEG8K59v2fAhJ5m5o7Yepump';
    const rpc = fakeRpc({ mainBalance: 1 });
    rpc.call = async (fn) => fn({
      getMultipleAccountsInfo: async (k) => k.map(() => ({ lamports: 150_000_000 })),
      getBalance: async () => 150_000_000,
      getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 9e6 }),
      getSignatureStatuses: async () => ({ value: [{ confirmationStatus: 'confirmed' }] }),
      getParsedTokenAccountsByOwner: async () => ({ value: [] }),        // the whole bag really is gone
    });
    const b = bot({ rpc, settings: { bumpMint: MINT, bumpWallets: 2, bumpBudgetSol: 0.06, bumpMinutes: 5, bumpPerMinute: 60 } });
    b.createWallets(2, 'password123');
    await b.start();
    b._clearTimer();
    const row = b.rows[0];
    row.holdingSol = 0.01; row.roundBuys = 1; row.roundTarget = 1; row.sellAt = b.clock.t - 1;
    // The sell's confirmation never arrives, but the wallet is empty: the round is over, and the wallet is not blamed.
    b.rpc.confirm = async () => { throw new Error('The transaction was sent but is not on chain after 20 s.'); };
    await b._run({ kind: 'sell', row });
    assert.strictEqual(row.holdingSol, 0, 'the round is closed, not left holding a bag that is gone');
    assert.strictEqual(row.roundBuys, 0, 'and the next round starts from scratch');
    assert.strictEqual(row.fails, 0, 'a wallet that sold is not blamed for a slow confirmation: ' + row.fails);
    assert.ok(/Sell back/.test(b.lastLine), 'the desk says what happened: ' + b.lastLine);
    await b.stop({ sellBack: false });
  }

  // ── 17r. the Jupiter route settles an unanswered sell the same way: the chain decides, not the silence ──
  {
    const MINT = 'GxWqJbWPxMseev7WXYNPLEG8K59v2fAhJ5m5o7Yepump';
    const make = (emptyFrom) => {
      let reads = 0;
      const rpc = fakeRpc({ mainBalance: 1 });
      rpc.call = async (fn) => fn({
        getMultipleAccountsInfo: async (k) => k.map(() => ({ lamports: 150_000_000 })),
        getBalance: async () => 150_000_000,
        getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 9e6 }),
        getSignatureStatuses: async () => ({ value: [{ confirmationStatus: 'confirmed' }] }),
        getParsedTokenAccountsByOwner: async () => {
          reads += 1;
          const held = reads < emptyFrom;              // from `emptyFrom` on, the wallet holds nothing
          return held ? { value: [{ account: { data: { parsed: { info: { tokenAmount: { amount: '7000000000' } } } } } }] } : { value: [] };
        },
      });
      const b = bot({
        rpc,
        jupiter: { swap: async () => { throw Object.assign(new Error('jupiter: the sell was not confirmed'), { definite: false }); } },
        settings: { bumpMint: MINT, bumpWallets: 2, bumpBudgetSol: 0.06, bumpMinutes: 5, bumpPerMinute: 60 },
      });
      b.createWallets(2, 'password123');
      b.rows = b.wallets();
      b._doorBroken.add(MINT);                          // the pump door is out of the picture, as it is on a migrated coin
      return b;
    };
    const sold = make(2);
    const res = await sold._swap(sold.rows[0], 'sell', '100%');
    assert.strictEqual(res.settledByBalance, true, 'an empty wallet means the sell happened: ' + JSON.stringify(res));

    const stuck = make(99);
    await assert.rejects(() => stuck._swap(stuck.rows[0], 'sell', '100%'), /not confirmed/, 'a wallet that still holds the bag is not called sold');

    // A wallet an earlier sell already emptied: the route goes looking, finds nothing, and that is a finished sell - not the
    // "Nothing to sell" error that used to poison the round that had in fact sold.
    const gone = make(1);
    const resGone = await gone._swap(gone.rows[0], 'sell', '100%');
    assert.strictEqual(resGone.settledByBalance, true, 'a 100% sell of an already-empty wallet has already happened: ' + JSON.stringify(resGone));
  }

  // ── 17s. a wallet that still holds a bag is not swept out of existence, and a dry one is given its fee back ──
  {
    const MINT = 'GxWqJbWPxMseev7WXYNPLEG8K59v2fAhJ5m5o7Yepump';
    // The sweep's sell cannot go through (the coin is closed to trading), so the bag stays - and the wallet must stay a
    // wallet. The owner's own HoQr…2wJb was swept to zero lamports while holding 39 018 tokens, and a wallet whose account
    // has been destroyed cannot sign the sell that would get its bag out.
    const rpc = fakeRpc({ mainBalance: 1 });
    rpc.call = async (fn) => fn({
      getMultipleAccountsInfo: async (k) => k.map(() => ({ lamports: 5_000_000 })),      // 0.005 SOL each
      getBalance: async () => 50_000_000,
      getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 9e6 }),
      getSignatureStatuses: async () => ({ value: [{ confirmationStatus: 'confirmed' }] }),
      getParsedTokenAccountsByOwner: async () => ({ value: [{ account: { data: { parsed: { info: { tokenAmount: { amount: '39018746966' } } } } } }] }),
    });
    const b = bot({ rpc, settings: { bumpMint: MINT, bumpWallets: 2, bumpBudgetSol: 0.06, bumpMinutes: 5, bumpPerMinute: 5 } });
    b.createWallets(2, 'password123');
    b.rpc.confirm = async () => { throw new Error('The transaction landed and FAILED on chain ({"InstructionError":[3,{"Custom":6004}]}). Nothing moved.'); };
    const out = await b.sweep({ includeTokens: true, toMain: false });
    assert.ok(out.stuck.length, 'the bag really could not be sold in this test: ' + JSON.stringify(out.stuck));
    // Every transfer the sweep built must leave the rent-exempt floor behind in the wallets that still hold tokens.
    const moved = [];
    b.rpc.sent.forEach((raw) => {
      let tx;
      try { tx = Transaction.from(raw); } catch (_) { tx = VersionedTransaction.deserialize(new Uint8Array(raw)); }
      if (!tx.instructions) return;
      for (const ix of tx.instructions) {
        if (!ix.programId.equals(SystemProgram.programId)) continue;
        const msg = SystemInstruction.decodeTransfer(ix);
        moved.push({ from: msg.fromPubkey.toBase58(), lamports: Number(msg.lamports) });
      }
    });
    const floor = 890880;
    assert.ok(moved.length > 0, 'the sweep did send something');
    for (const t of moved) {
      assert.ok(t.lamports <= 5_000_000 - floor, 'a wallet still holding its bag keeps the rent floor: ' + JSON.stringify(t));
    }

    // And a wallet with no lamports at all is given the smallest float before its sell is attempted.
    let reads = 0;
    let mainPk = null;
    const rpc2 = fakeRpc({ mainBalance: 1 });
    rpc2.call = async (fn) => fn({
      getMultipleAccountsInfo: async (k) => k.map((pk) => ({ lamports: mainPk && pk.equals(mainPk) ? 40_000_000 : 0 })),
      getBalance: async (pk) => (mainPk && pk.equals(mainPk) ? 40_000_000 : 0),
      getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 9e6 }),
      getSignatureStatuses: async () => ({ value: [{ confirmationStatus: 'confirmed' }] }),
      getParsedTokenAccountsByOwner: async () => {
        reads += 1;
        return reads === 1
          ? { value: [{ account: { data: { parsed: { info: { tokenAmount: { amount: '39018746966' } } } } } }] }
          : { value: [] };
      },
    });
    const c = bot({ rpc: rpc2, settings: { bumpMint: MINT, bumpWallets: 2, bumpBudgetSol: 0.06, bumpMinutes: 5, bumpPerMinute: 5 } });
    c.createWallets(2, 'password123');
    mainPk = c.wallet.keypair.publicKey;
    c.rows = c.wallets();
    const outC = await c.rescueWallet(c.rows[0].address);
    assert.ok(outC.topUpSol > 0, 'the rescue put the fee float back: ' + JSON.stringify(outC));
    assert.ok(/put back for its fee/.test(c.lastLine), 'and says so: ' + c.lastLine);
    assert.strictEqual(outC.sold, true, 'then the bag is sold');
  }

  // ── 17v. a read that FAILED is not a wallet that holds nothing ──
  {
    // The owner's own line, verbatim: "Rescued HoQr…2wJb: nothing held - Jupiter rate limit reached.; All RPC nodes are busy
    // or unreachable right now. (429 Too Many Requests)". The wallet held 39 018 746 966 tokens. The read was wrapped in
    // `.catch(() => 0n)`, so an unreachable node became "nothing held" - the one answer a rescue must never invent.
    const MINT = 'GxWqJbWPxMseev7WXYNPLEG8K59v2fAhJ5m5o7Yepump';
    const flaky = (failTimes) => {
      let reads = 0;
      const rpc = fakeRpc({ mainBalance: 1 });
      rpc.call = async (fn) => fn({
        getMultipleAccountsInfo: async (k) => k.map(() => ({ lamports: 8_000_000 })),
        getBalance: async () => 8_000_000,
        getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 9e6 }),
        getSignatureStatuses: async () => ({ value: [{ confirmationStatus: 'confirmed' }] }),
        getParsedTokenAccountsByOwner: async () => {
          reads += 1;
          if (reads <= failTimes) throw new Error('All RPC nodes are busy or unreachable right now. (429 Too Many Requests)');
          return { value: [{ account: { lamports: 2_039_280, data: { parsed: { info: { tokenAmount: { amount: '39018746966', uiAmount: 39, decimals: 9 }, mint: MINT, state: 'initialized' } } } } }] };
        },
      });
      return rpc;
    };

    // (a) the node refuses once: the read is RETRIED and the bag is found and sold.
    const a = bot({ rpc: flaky(1), settings: { bumpMint: MINT, bumpWallets: 2, bumpBudgetSol: 0.06 } });
    a.createWallets(2, 'password123');
    a.rows = a.wallets();
    const outA = await a.rescueWallet(a.rows[0].address);
    assert.strictEqual(outA.sold, true, 'one refused read is not a bag left behind: ' + JSON.stringify(outA));
    assert.ok(/bag sold/.test(a.lastLine), 'and the line says so: ' + a.lastLine);

    // (b) the node never answers: the button says the chain could not be asked, which is the truth, and never "nothing held".
    const b = bot({ rpc: flaky(99), settings: { bumpMint: MINT, bumpWallets: 2, bumpBudgetSol: 0.06 } });
    b.createWallets(2, 'password123');
    b.rows = b.wallets();
    const outB = await b.rescueWallet(b.rows[0].address);
    assert.strictEqual(outB.unknown, true, 'an unanswerable chain is its own answer: ' + JSON.stringify(outB));
    assert.strictEqual(outB.sold, false, 'and nothing is claimed sold');
    // (c) the fee float is put in even when the FIRST balance read fails - a node that refuses one call must not leave the
    // wallet too thin to sell (that was the other half of the owner's failed rescue: `lamports != null` meant "skip the
    // float entirely" whenever the read threw).
    let balanceReads = 0;
    const thin = fakeRpc({ mainBalance: 5 });
    thin.call = async (fn) => fn({
      getMultipleAccountsInfo: async (k) => k.map(() => ({ lamports: 1_000_000 })),
      getBalance: async (pk) => {
        balanceReads += 1;
        if (balanceReads <= 2) throw new Error('All RPC nodes are busy or unreachable right now. (429 Too Many Requests)');
        return pk.equals(mainKp.publicKey) ? 5_000_000_000 : 1_000_000;
      },
      getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 9e6 }),
      getSignatureStatuses: async () => ({ value: [{ confirmationStatus: 'confirmed' }] }),
      getParsedTokenAccountsByOwner: async () => ({ value: [{ account: { lamports: 2_039_280, data: { parsed: { info: { tokenAmount: { amount: '39018746966' }, mint: MINT, state: 'initialized' } } } } }] }),
    });
    const c = bot({ rpc: thin, settings: { bumpMint: MINT, bumpWallets: 2, bumpBudgetSol: 0.06 } });
    c.createWallets(2, 'password123');
    c.rows = c.wallets();
    const outC = await c.rescueWallet(c.rows[0].address);
    assert.ok(outC.topUpSol > 0, 'the fee float went in despite the refused read: ' + JSON.stringify(outC));
    assert.strictEqual(outC.sold, true, 'and the bag was sold with it: ' + c.lastLine);
  }

  // ── 17w. the fallback route works from a wallet that holds barely a fee ──
  {
    // Measured on the owner's bag on 2026-11-10: Jupiter's current lane refuses every taker below roughly 0.06 SOL with
    // "Failed to get quotes", which reached the panel as "Jupiter has no route" on a coin that routes perfectly. The legacy
    // lane quotes without a taker and builds the swap, so the ladder uses it - and the current lane is still there behind it.
    const MINT = 'GxWqJbWPxMseev7WXYNPLEG8K59v2fAhJ5m5o7Yepump';
    const holding = () => {
      const rpc = fakeRpc({ mainBalance: 1 });
      rpc.call = async (fn) => fn({
        getMultipleAccountsInfo: async (k) => k.map(() => ({ lamports: 8_000_000 })),
        getBalance: async () => 8_000_000,
        getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 9e6 }),
        getSignatureStatuses: async () => ({ value: [{ confirmationStatus: 'confirmed' }] }),
        getParsedTokenAccountsByOwner: async () => ({ value: [{ account: { lamports: 2_039_280, data: { parsed: { info: { tokenAmount: { amount: '39018746966', uiAmount: 39, decimals: 9 }, mint: MINT, state: 'initialized' } } } } }] }),
      });
      return rpc;
    };
    let v1 = 0;
    let v2 = 0;
    const jupiter = {
      swapV1: async ({ keypair, guard }) => {
        v1 += 1;
        const bytes = fakeSwap(keypair.publicKey.toBase58(), 0);
        const tx = VersionedTransaction.deserialize(new Uint8Array(bytes));
        if (guard) guard(tx, keypair.publicKey.toBase58());
        return { bytes: Buffer.from(bytes), signature: 'V1SIG' };
      },
      swap: async () => { v2 += 1; throw Object.assign(new Error('Jupiter will not quote this wallet'), { kind: 'funds', thin: true, definite: true }); },
    };
    const b = bot({
      rpc: holding(),
      jupiter,
      settings: { bumpMint: MINT, bumpWallets: 2, bumpBudgetSol: 0.06 },
      door: async () => { throw new Error('the trade door refused it (400: no market)'); },
    });
    b.createWallets(2, 'password123');
    b.rows = b.wallets();
    const out = await b.rescueWallet(b.rows[0].address);
    assert.strictEqual(out.sold, true, 'the bag is sold through the lane that works: ' + JSON.stringify(out) + ' ' + b.lastLine);
    assert.strictEqual(v1, 1, 'the legacy lane was asked');
    assert.strictEqual(v2, 0, 'and the lane that cannot price a thin wallet was never asked: ' + v2);

    // And when the legacy lane refuses the market, the current lane is still tried rather than the bag being abandoned.
    let v1b = 0;
    let v2b = 0;
    const jupiter2 = {
      swapV1: async () => { v1b += 1; throw Object.assign(new Error('Jupiter has no route for this trade.'), { kind: 'route', definite: true }); },
      swap: async () => { v2b += 1; return 'V2SIG'; },
    };
    const c = bot({
      rpc: holding(),
      jupiter: jupiter2,
      settings: { bumpMint: MINT, bumpWallets: 2, bumpBudgetSol: 0.06 },
      door: async () => { throw new Error('the trade door refused it (400: no market)'); },
    });
    c.createWallets(2, 'password123');
    c.rows = c.wallets();
    const outC = await c.rescueWallet(c.rows[0].address);
    assert.strictEqual(outC.sold, true, 'a refusal down one lane is not the end of the ladder: ' + JSON.stringify(outC));
    assert.strictEqual(v1b, 1, 'the legacy lane was tried');
    assert.strictEqual(v2b, 1, 'and the current lane carried it: ' + v2b);
  }

  {
    // "I wrote 3 wallets, topped up 0.02 and still get: each wallet would get 0.0025 SOL" - the slider said 0.0075 while the
    // pool held 0.02. The pool's money is the budget, so the same press now funds three wallets of ~0.0063 and starts.
    const MINT = 'GxWqJbWPxMseev7WXYNPLEG8K59v2fAhJ5m5o7Yepump';
    const b = bot({ settings: { bumpMint: MINT, bumpWallets: 3, bumpBudgetSol: 0.0075, bumpMinutes: 20, bumpPerMinute: 8.5 } });
    b.createWallets(3, 'password123');
    b.rpc.balances[b.vaultAddress()] = 0.02;
    b.rpc.balances[b.wallet.keypair.publicKey.toBase58()] = 0;
    const funded = await b.fund();
    assert.strictEqual(funded.funded, 3, 'three wallets are funded, not refused: ' + JSON.stringify(funded));
    assert.ok(funded.sol > 0.017 && funded.sol < 0.021, 'and with the whole deposit: ' + funded.sol);
    assert.strictEqual(b._cfg().budgetSol > 0.0075, true, 'the budget followed the money: ' + b._cfg().budgetSol);
    assert.ok(/across 3 wallets/.test(b.lastLine), 'and the panel says what it did: ' + b.lastLine);
  }

  // ── 18. the panel says why the pace is not the pace ──
  {
    // Three wallets, a long hold band and a high pace: the desk must report that the holds are the ceiling, not the
    // configured rate. This is the difference between a panel that looks broken and one that explains itself. The buy
    // share is 100% so nothing is closed early to chase a ratio - the hold band is the only thing in the way.
    const b = bot({ settings: { bumpWallets: 3, bumpBudgetSol: 0.3, bumpMinSol: 0.004, bumpMaxSol: 0.012, bumpPerMinute: 200, bumpMinutes: 5, bumpBuyRatio: 100, bumpHoldMinSec: 60, bumpHoldMaxSec: 120 } });
    b.createWallets(3, 'password123');
    b.addresses().forEach((a) => { b.rpc.balances[a] = 0.1; });
    await b.start();
    for (let i = 0; i < 10; i++) await step(b, 100);
    const s = b.state();
    assert.strictEqual(s.free, 0, 'every wallet is holding a bag');
    assert.ok(/hold band/.test(s.waiting), 'and the panel says what is limiting the pace: ' + s.waiting);
    // Sells due do not wait for the hold band to be kind: a bag that is due goes first and frees its wallet.
    b.rows.forEach((r) => { if (r.holdingSol) r.sellAt = b.clock.t; });
    b.nextAt = 0;
    await step(b, 100);
    const after = b.state();
    assert.ok(after.stats.sells >= 1, 'a due bag is sold, which frees a wallet (buys ' + after.stats.buys + ', sells ' + after.stats.sells + ')');
    await b.stop({ sellBack: false });
    // And a pool with nothing left to spend says that instead.
    const spent = bot({ settings: { bumpWallets: 2, bumpBudgetSol: 0.1, bumpMinSol: 0.004, bumpMaxSol: 0.01 } });
    spent.createWallets(2, 'password123');
    spent.addresses().forEach((a) => { spent.rpc.balances[a] = 0.05; });
    await spent.start();
    // RULE CHANGED 2026-11-08 (1.1.2): a pool is out of work when its wallets cannot PAY, not when a counter says so.
    spent.rows.forEach((r) => { r.balanceSol = 0.001; });
    assert.ok(/budget or the wallet count/.test(spent.state().waiting), 'a pool without money names the budget: ' + spent.state().waiting);
    await spent.stop({ sellBack: false });
  }

  // ── 19a. the plan is priced for the pool that EXISTS, never for a wallet nobody has ──
  {
    // The owner's own report: he typed 3 wallets, two addresses existed, and the panel went on saying "2 wallets" without
    // ever explaining the difference. Both numbers are now in the plan.
    const ask = { ...DEFAULTS, bumpWallets: 3, bumpBudgetSol: 0.05, bumpMinutes: 20, bumpPerMinute: 2.5, bumpUseJito: false };
    const three = estimate(ask, { have: 3 });
    assert.strictEqual(three.wallets, 3, 'three addresses: the plan is about three');
    assert.strictEqual(three.poolNote, '', 'and there is nothing to explain');
    const two = estimate(ask, { have: 2 });
    assert.strictEqual(two.wallets, 2, 'two addresses: the plan is priced for the two that exist');
    assert.ok(/You asked for 3 wallets and the pool holds 2/.test(two.poolNote), 'and says so: ' + two.poolNote);
    assert.ok(/Press "Create wallets" to add 1 more address/.test(two.poolNote), 'with the button that closes the gap: ' + two.poolNote);
    assert.ok(two.perWalletSol > three.perWalletSol, 'a smaller pool means more money behind each wallet');
    // More addresses than the slider says is not a note: the slider decides how many trade, the rest simply sit it out.
    const six = estimate(ask, { have: 6 });
    assert.strictEqual(six.wallets, 3, 'the slider still decides how many trade');
    assert.strictEqual(six.poolNote, '', 'and there is nothing to explain');
    // No `have` at all (the pure settings view) behaves exactly as it did.
    assert.strictEqual(estimate(ask).wallets, 3);
  }

  // ── 19b. what the panel is told: the pool it really has, and what the Jito switch is doing ──
  {
    const MINT = 'GxWqJbWPxMseev7WXYNPLEG8K59v2fAhJ5m5o7Yepump';
    const b = bot({ settings: { bumpMint: MINT, bumpWallets: 3, bumpBudgetSol: 0.05, bumpMinutes: 20, bumpPerMinute: 2.5, bumpUseJito: true } });
    b.createWallets(2, 'password123');
    const st = b.state();
    assert.strictEqual(st.pool.asked, 3, 'the panel is told what the slider asks for');
    assert.strictEqual(st.pool.have, 2, 'and what the pool holds');
    assert.strictEqual(st.estimate.wallets, 2, 'the plan in the same state is priced for the two that exist');
    assert.ok(/You asked for 3 wallets/.test(st.estimate.poolNote), 'and explains the gap: ' + st.estimate.poolNote);
    assert.strictEqual(st.jito.on, true, 'the switch is reported');
    assert.strictEqual(st.jito.broken, false, 'and it is not stood down');
    assert.strictEqual(st.jito.tipSol, 0.00001, 'with the tip that will be paid if a bundle lands');
    // Pressing Create wallets with the bigger number grows the pool and the panel catches up.
    b.createWallets(3, 'password123');
    const grown = b.state();
    assert.strictEqual(grown.pool.have, 3, 'Create wallets grows the pool to the number asked for');
    assert.strictEqual(grown.estimate.wallets, 3, 'the plan follows it');
    assert.strictEqual(grown.estimate.poolNote, '', 'and the note goes away');
  }

  // ── 19c. a round the money cannot carry is refused, and the desk never starts a run that starves ──
  {
    // The owner's own numbers when the run died two minutes in: 0.0116 SOL, three wallets, four buys a round.
    const ask = { ...DEFAULTS, bumpWallets: 3, bumpBuysPerRound: 4, bumpBudgetSol: 0.0116, bumpMinutes: 20, bumpPerMinute: 8, bumpAutoAmount: true };
    const e = estimate(ask, { have: 3 });
    assert.strictEqual(e.roundFits, false, '0.0116 SOL across three wallets cannot carry a round of four buys');
    assert.strictEqual(e.fits, false, 'so the plan does not fit, and Start will refuse it');
    assert.strictEqual(e.buysThatFit, 2, 'and the model says how many buys do fit: ' + e.buysThatFit);
    assert.ok(/4 buys a round need .* SOL in one wallet, and each of the 3 gets/.test(e.planNote), 'naming both numbers: ' + e.planNote);
    assert.ok(/Set "Buys in one round" to 2/.test(e.planNote), 'and the count that would fit');
    // The same money with a round that fits is a run that finishes.
    const ok = estimate({ ...ask, bumpBuysPerRound: 1 }, { have: 3 });
    assert.strictEqual(ok.roundFits, true, 'one buy a round fits the same money');
    // start() refuses, in one sentence, instead of running for two minutes and dying.
    const b = bot({ settings: { bumpMint: MINT, bumpWallets: 3, bumpBuysPerRound: 4, bumpBudgetSol: 0.0116, bumpMinutes: 20, bumpPerMinute: 8, bumpSimulate: false } });
    b.createWallets(3, 'password123');
    b.rows = b._rows(b._cfg());
    b.addresses().forEach((a) => { b.rpc.balances[a] = 0.004; });
    b.rpc.balances[b.vaultAddress()] = 0.0116;
    const err = await b.start().then(() => null, (er) => er);
    assert.ok(err && /buys a round need/.test(err.message), 'Start refuses the plan that cannot finish a round: ' + (err && err.message));
    assert.strictEqual(b.running, false, 'and nothing was started');
    // fund() refuses too: money is not split into a pool that cannot finish a round.
    const f = bot({ settings: { bumpMint: MINT, bumpWallets: 3, bumpBuysPerRound: 4, bumpBudgetSol: 0.0116, bumpMinutes: 20, bumpPerMinute: 8, bumpSimulate: false } });
    f.createWallets(3, 'password123');
    f.unlockWallets('password123');
    f.vault.keypair = f.vault.unlock('password123');
    f.rpc.balances[f.vaultAddress()] = 0.0116;
    const ferr = await f.fund().then(() => null, (er) => er);
    assert.ok(ferr && /buys a round need/.test(ferr.message), 'fund refuses to split money into a round it cannot carry: ' + (ferr && ferr.message));
    assert.strictEqual(f.rpc.sent.length, 0, 'and no lamport moved');
  }

  // ── 19d. a wallet never opens a round it cannot finish, and closes one early rather than starving ──
  {
    const b = bot({ settings: { bumpMint: MINT, bumpWallets: 2, bumpBuysPerRound: 4, bumpBudgetSol: 0.06, bumpMinutes: 20, bumpPerMinute: 60, bumpHoldMinSec: 90, bumpHoldMaxSec: 90, bumpSimulate: false } });
    b.createWallets(2, 'password123');
    b.addresses().forEach((a) => { b.rpc.balances[a] = 0.03; });
    await b.start();
    const rich = b.rows[0];
    rich.balanceSol = 0.03;
    const poor = b.rows[1];
    poor.balanceSol = 0.0045;                 // enough for one trade, not for a round of four
    const picked = [];
    for (let i = 0; i < 40; i++) { const job = b._choose(b.now()); if (job) picked.push(job.row.short); }
    assert.ok(!picked.includes(poor.short) || poor.sellAt > 0, 'a wallet that cannot pay for its whole round never opens one: ' + picked.join(','));
    // Mid-round and short: the round is CLOSED (its bag goes to market) instead of buying until the wallet is dry.
    rich.roundBuys = 2;
    rich.roundTarget = 4;
    rich.balanceSol = 0.0025;
    rich.holdingSol = 0.002;
    rich.sellAt = 0;
    const job = b._choose(b.now());
    assert.strictEqual(job && job.kind, 'sell', 'the short wallet sells what it holds instead of starving: ' + (job && job.kind));
    assert.strictEqual(job.row.short, rich.short, 'and it is that wallet');
    await b.stop({ sellBack: false });
  }

  // ── 19e. Stop's sell-back walks the ladder and floats the fee: a thin wallet still gets its bag out ──
  {
    const b = bot({ settings: { bumpMint: MINT, bumpWallets: 2, bumpBuysPerRound: 1, bumpBudgetSol: 0.06, bumpMinutes: 5, bumpPerMinute: 5, bumpSimulate: false } });
    b.createWallets(2, 'password123');
    b.addresses().forEach((a) => { b.rpc.balances[a] = 0.03; });
    await b.start();
    const row = b.rows[0];
    row.holdingSol = 0.003;
    // The wallet cannot pay for the swap: 0.0033 SOL against the 0.0034 a sell needs - the owner's own "Could not sell back
    // 8v9m…5nGV: Jupiter has no route" about a wallet that simply could not pay.
    row.balanceSol = 0.0033;
    b.rpc.balances[row.address] = 0.0033;
    b.rpc.balances[mainKp.publicKey.toBase58()] = 1;
    const floats = [];
    const realTopUp = b._topUpFee.bind(b);
    b._topUpFee = async (address, need) => { floats.push(address); return realTopUp(address, need); };
    b.door = async (body) => (body.action === 'sell' ? fakeSwap(body.publicKey, 0) : fakeSwap(body.publicKey, 0.001));
    await b.stop({ sellBack: true });
    assert.ok(floats.includes(row.address), 'the sell-back floats the fee before it sells: ' + floats.join(','));
    assert.strictEqual(row.holdingSol, 0, 'and the bag is gone, so nothing is left behind on Stop');
  }

  // ── 19f. a parked wallet is a PAUSE: its bag still sells, the park has an expiry, and a sale lifts it ──
  {
    const b = bot({ settings: { bumpMint: MINT, bumpWallets: 2, bumpBuysPerRound: 4, bumpBudgetSol: 0.06, bumpMinutes: 20, bumpPerMinute: 60, bumpHoldMinSec: 60, bumpHoldMaxSec: 60, bumpSimulate: false } });
    b.createWallets(2, 'password123');
    b.addresses().forEach((a) => { b.rpc.balances[a] = 0.03; });
    await b.start();
    const row = b.rows[0];
    // The owner's own row: "8v9m…5nGV · 0.0080 SOL · 3 bumps · 3/4 buys · parked · bag". A park used to leave `sellAt` at zero,
    // so the scheduler never looked at the bag again and the wallet was out of the run for good.
    row.stuck = true;
    row.stuckUntil = 0;
    row.holdingSol = 0.0028;
    row.roundBuys = 3;
    row.roundTarget = 4;
    row.sellAt = 0;
    row.balanceSol = 0.008;
    const job = b._choose(b.now());
    assert.strictEqual(job && job.kind, 'sell', 'a parked wallet with a bag still gets its sell: ' + (job && job.kind));
    assert.strictEqual(job.row.short, row.short, 'and it is that wallet');
    // A park for lack of SOL carries an expiry, so the wallet is retried instead of sitting out the whole run.
    const poor = b.rows[1];
    poor.balanceSol = 0.0001;
    poor.roundBuys = 0;
    poor.stuck = false;
    poor.stuckUntil = 0;
    await b._run({ kind: 'buy', row: poor });
    assert.strictEqual(poor.stuck, true, 'a wallet that cannot pay is parked');
    assert.ok(poor.stuckUntil > b.now(), 'with an expiry, not for ever: ' + poor.stuckUntil);
    // A sell that goes through proves the wallet works: the park is lifted with it.
    row.sellAt = b.now() - 1;
    await b._run({ kind: 'sell', row });
    assert.strictEqual(row.holdingSol, 0, 'the bag is gone');
    assert.strictEqual(row.stuck, false, 'and the wallet is unparked, so it trades again');
    assert.strictEqual(row.stuckUntil, 0, 'with a clean park state');
    await b.stop({ sellBack: false });
  }

  // ── 19g. a run that ends by itself winds the desk down: every bag sold, rent closed, money home to the MAIN wallet ──
  {
    const b = bot({ settings: { bumpMint: MINT, bumpWallets: 2, bumpBuysPerRound: 1, bumpBudgetSol: 0.06, bumpMinutes: 5, bumpPerMinute: 5, bumpSimulate: false } });
    b.createWallets(2, 'password123');
    b.addresses().forEach((a) => { b.rpc.balances[a] = 0.03; });
    await b.start();
    b._clearTimer();                       // the scheduler must not race this test
    // One wallet holds a bag the book knows about, the other holds one the book never saw (a trade that landed late).
    b.rows[0].holdingSol = 0.002;
    const swept = [];
    const bags = { [b.rows[1].address]: 12345n, [b.rows[0].address]: 0n };
    b._bagRaw = async (address) => ({ known: true, raw: bags[address] ?? 0n });
    b.sweep = async (opts) => { swept.push(opts); return { sold: 2, closed: 1, rentSol: 0.002, returnedSol: 0.01, toWalletSol: 0.01, signatures: [], stuck: [] }; };
    // The run's own end (the clock, or the money) calls _finish, and that must be the FULL wind-down.
    const out = await b._finish('the configured run time is up');
    assert.strictEqual(out.wound, true, 'the run ends with a wind-down: ' + JSON.stringify(out));
    assert.strictEqual(swept.length, 1, 'exactly one sweep');
    assert.strictEqual(swept[0].includeTokens, true, 'with the bags: the chain is asked what every wallet holds');
    assert.strictEqual(swept[0].toMain, true, 'and the money goes home to the main wallet, not just the desk address');
    assert.strictEqual(b.running, false, 'the desk is stopped');
    assert.strictEqual(b.rows[0].holdingSol, 0, 'the booked bag was sold on the way out');
    assert.ok(/Run finished/.test(b.lastLine) || /Stopped\./.test(b.lastLine), 'and the panel says so: ' + b.lastLine);
    assert.strictEqual(out.wound, true, 'and the wind-down ran: ' + JSON.stringify(out));
    // A run with sell-back switched off leaves the bags alone and does not sweep.
    const c2 = bot({ settings: { bumpMint: MINT, bumpWallets: 2, bumpBuysPerRound: 1, bumpBudgetSol: 0.06, bumpMinutes: 5, bumpPerMinute: 5, bumpSellBack: false, bumpSimulate: false } });
    c2.createWallets(2, 'password123');
    c2.addresses().forEach((a) => { c2.rpc.balances[a] = 0.03; });
    await c2.start();
    c2.rows[0].holdingSol = 0.002;
    const swept2 = [];
    c2.sweep = async (opts) => { swept2.push(opts); return {}; };
    const out2 = await c2._finish('the configured run time is up');
    assert.strictEqual(out2.wound, false, 'sell-back off means no sweep');
    assert.strictEqual(swept2.length, 0, 'nothing was swept behind the switch');
    assert.ok(c2.rows[0].holdingSol > 0, 'and the bag is still in the wallet, as asked');
  }

  // ── 19h. the run's own sell floats the fee, and Jito carries the Jupiter lane too ──
  {
    // (a) A wallet mid-run holding a bag but too little SOL: the sell floats the fee first, exactly as Stop and Rescue do.
    const b = bot({ settings: { bumpMint: MINT, bumpWallets: 2, bumpBuysPerRound: 1, bumpBudgetSol: 0.06, bumpMinutes: 5, bumpPerMinute: 5, bumpSimulate: false } });
    b.createWallets(2, 'password123');
    b.addresses().forEach((a) => { b.rpc.balances[a] = 0.03; });
    await b.start();
    b._clearTimer();
    const row = b.rows[0];
    row.holdingSol = 0.003;
    row.sellAt = b.now() - 1;
    row.balanceSol = 0.002;
    b.rpc.balances[row.address] = 0.002;
    b.rpc.balances[mainKp.publicKey.toBase58()] = 1;
    const floats = [];
    const realTopUp = b._topUpFee.bind(b);
    b._topUpFee = async (address, need) => { floats.push(address); return realTopUp(address, need); };
    await b._run({ kind: 'sell', row });
    assert.ok(floats.includes(row.address), 'the run floats the fee before its sell: ' + floats.join(','));
    assert.strictEqual(row.holdingSol, 0, 'and the bag goes out');
    await b.stop({ sellBack: false });

    // (b) Once the pump door is broken, every trade goes through Jupiter - and it is still offered to Jito. The owner's own
    // run showed 3 bundles for 110 bumps, because this lane never asked the block engine at all.
    const TIP = Keypair.generate().publicKey.toBase58();
    const bundles = [];
    const jupV1 = {
      swapV1: async ({ keypair }) => {
        const msg = new TransactionMessage({
          payerKey: keypair.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58(),
          instructions: [new TransactionInstruction({ programId: PUMP, keys: [], data: Buffer.from([9, 9]) })],
        }).compileToV0Message();
        const tx = new VersionedTransaction(msg);
        tx.sign([keypair]);
        return { bytes: tx.serialize() };
      },
    };
    const jb = bot({ jupiter: jupV1, jito: { tipAccounts: async () => [TIP], sendBundle: async (t) => { bundles.push(t); return 'ID'; } },
      settings: { bumpMint: MINT, bumpWallets: 2, bumpBuysPerRound: 1, bumpBudgetSol: 0.06, bumpMinutes: 5, bumpPerMinute: 5, bumpUseJito: true, bumpSimulate: false } });
    jb.createWallets(2, 'password123');
    jb.addresses().forEach((a) => { jb.rpc.balances[a] = 0.03; });
    await jb.start();
    jb._clearTimer();
    jb._doorBroken.add(MINT);
    const job = await jb._run({ kind: 'buy', row: jb.rows[0] });
    assert.strictEqual(bundles.length, 1, 'the Jupiter lane offered a bundle: ' + bundles.length);
    assert.strictEqual(bundles[0].length, 2, 'the trade and its tip');
    assert.ok(jb.state().stats.bumps >= 1 || job, 'and the trade counted');
    await jb.stop({ sellBack: false });
  }

  // ── 19. the sliders and the fitter: a small budget, worked through ──
  {
    const { fitPlan, planBudget } = require('../src/bump');
    // 0.02 SOL, three hours, twenty a minute: the case the desk has to be honest about.
    const ask = { ...DEFAULTS, bumpBudgetSol: 0.02, bumpMinutes: 180, bumpPerMinute: 20 };
    const e = estimate(ask);
    assert.strictEqual(e.fits, false, 'the money cannot pay for three hours at twenty a minute');
    assert.strictEqual(e.wallets, 6, 'the pool stays the six wallets that were typed, even when the money is short');
    // RULE CHANGED 2026-11-08 (1.1.2): the pool is the six wallets that were typed, so six rents (0.0122 SOL) come out of
    // the 0.02 before a single bump, and with Jito on (the default) each bump also pays its tip: the honest answer is 79
    // bumps - 3.9 minutes at 20/min. The silently-shrunk two-wallet pool used to print 23.2 minutes for a plan the
    // operator never asked for.
    // RULE CHANGED 2026-11-11 (1.1.5): Jito is back ON by default (a bundle is a first try now, not the wire), so each bump
    // also pays its tip and its own signature: 0.02 SOL over six rents buys about 119 bumps - 5.9 minutes at 20/min, or
    // 0.6/min for the three hours asked for. The figure moved with the default; the point of the test did not.
    assert.ok(/5\.9 minutes at 20\/min/.test(e.planNote), 'the panel says exactly what it can do: ' + e.planNote);
    assert.ok(/0\.6\/min for 180 minutes/.test(e.planNote), 'including the alternative that keeps the three hours');
    const plan = planOf(bumpConfig(ask));
    assert.ok(plan.rentSol + plan.runFeesSol + plan.floatSol <= 0.02 + 1e-9, `the fitted plan spends at most the budget (${plan.rentSol + plan.runFeesSol + plan.floatSol})`);
    // "Fit it to my budget" keeps the length the operator asked for and lowers the pace.
    // RULE CHANGED 2026-11-11 (1.1.6): the fitter SCORES candidates, so the thing it gives up is what costs the operator
    // least - the pace first, and the pool before the length. For this ask it keeps the three hours, lowers the pace to a
    // real 1/min and drops one wallet of rent. The old cascade returned a 0.1/min crawl, which is not a run.
    const fit = fitPlan(ask);
    assert.strictEqual(fit.fits, true, 'the fitter finds a plan: ' + fit.note);
    assert.ok(!fit.patch.bumpMinutes || fit.patch.bumpMinutes === 180, 'it tries to keep the three hours: ' + fit.note);
    assert.ok(fit.patch.bumpPerMinute >= 1 && fit.patch.bumpPerMinute < 20, 'and lowers the pace to a real one: ' + fit.patch.bumpPerMinute);
    const after = estimate({ ...ask, ...fit.patch });
    assert.strictEqual(after.fits, true, 'the applied plan fits');
    assert.ok(after.runFeesSol < 0.02, 'and its fees are inside the budget: ' + after.runFeesSol);
    assert.ok(after.roundFits, 'and every wallet can pay for its whole round');
    // RULE ADDED 2026-11-11 (1.1.6): a budget that cannot carry a round at all is refused with the amount it would need.
    const hopeless = fitPlan({ ...DEFAULTS, bumpWallets: 3, bumpBudgetSol: 0.006, bumpMinutes: 20, bumpPerMinute: 8 });
    assert.strictEqual(hopeless.fits, false, 'a budget that cannot carry a round is not fitted');
    assert.ok(/needs about 0\.0\d+ SOL/.test(hopeless.note), 'and the answer names the SOL it would take: ' + hopeless.note);
    // A plan that already fits is left alone.
    const fine = fitPlan({ ...DEFAULTS, bumpBudgetSol: 0.3, bumpMinutes: 15, bumpPerMinute: 18 });
    assert.strictEqual(fine.fits, true);
    assert.deepStrictEqual(fine.patch, {}, 'nothing is changed when nothing needs changing');
  }

  // ── 20. the desk address: one key, sealed, and never deleted while it holds money ──
  {
    const { DeskVault } = require('../src/bump');
    const dir = fs.mkdtempSync(path.join(scratch.root, 'vault-'));
    const v = new DeskVault(dir);
    assert.strictEqual(v.exists(), false);
    const kp = v.create('password123');
    assert.strictEqual(v.address(), kp.publicKey.toBase58());
    const raw = fs.readFileSync(path.join(dir, 'bump-vault.json'), 'utf8');
    assert.ok(!raw.includes(require('bs58').encode(kp.secretKey)), 'the desk key is not in the file in the clear');
    assert.ok(!raw.includes(Buffer.from(kp.secretKey).toString('hex')), 'and not as hex');
    assert.throws(() => v.unlock('wrong password'), /Wrong password/);
    assert.strictEqual(v.unlock('password123').publicKey.toBase58(), v.address(), 'the same key comes back');
    assert.throws(() => v.create('password123'), /already exists/);

    const b = bot({ settings: { bumpWallets: 2, bumpBudgetSol: 0.2 } });
    b.createWallets(2, 'password123');
    assert.ok(b.vaultAddress(), 'creating the wallets creates the address they are paid from');
    // RULE FIXED 2026-11-08 (1.1.2): the guard used to read `vault.empty`, a property nothing ever set - the old test here
    // set it by hand and passed, while the real button deleted keys that still held SOL (the owner's desk address was left
    // with 0.0009 SOL nobody can reach). The balance is now asked of the chain.
    // RULE CHANGED 2026-11-10 (1.1.4): and the button no longer stops at a refusal. It sells what the chain says is there,
    // closes the emptied token accounts, sends every lamport home and only then deletes. The fake chain below keeps a real
    // ledger so the arithmetic is the arithmetic: the drain actually empties the wallets.
    const left = new Map();
    let bag = '0';
    b.rpc.call = async (fn) => fn({
      getMultipleAccountsInfo: async (k) => k.map((pk) => ({ lamports: left.get(pk.toBase58()) ?? 0 })),
      getBalance: async (pk) => left.get(pk.toBase58()) ?? 0,
      getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 9e6 }),
      getSignatureStatuses: async () => ({ value: [{ confirmationStatus: 'confirmed' }] }),
      getParsedTokenAccountsByOwner: async () => (bag === '0' ? { value: [] } : { value: [{ account: { lamports: 2_039_280, data: { parsed: { info: { tokenAmount: { amount: bag }, mint: MINT, state: 'initialized' } } } } }] }),
    });
    b.rpc.broadcast = async (raw) => {
      const tx = Transaction.from(raw);
      for (const ix of tx.instructions) {
        if (!ix.programId.equals(SystemProgram.programId)) continue;
        const d = SystemInstruction.decodeTransfer(ix);
        left.set(d.fromPubkey.toBase58(), (left.get(d.fromPubkey.toBase58()) ?? 0) - Number(d.lamports) - 5000);
        left.set(d.toPubkey.toBase58(), (left.get(d.toPubkey.toBase58()) ?? 0) + Number(d.lamports));
      }
      return 'SIG';
    };
    left.set(b.vaultAddress(), 20_000_000);
    for (const a of b.addresses()) left.set(a, 8_000_000);
    const gone = await b.forgetWallets({ password: 'password123' });
    assert.strictEqual(gone.removed, true, 'the delete brings the money home instead of refusing: ' + JSON.stringify(gone));
    assert.ok(gone.recovered.returnedSol > 0.027, 'and reports what came back: ' + gone.recovered.returnedSol);
    assert.strictEqual(left.get(b.vaultAddress()) ?? 0, 0, 'the desk address is left at zero, so no lamport is thrown away with the key');
    assert.strictEqual(b.vaultAddress(), null, 'and then the keys are gone');

    // And a chain that cannot say what a wallet holds stops the delete instead of deleting a bag it could not see. That is
    // the owner's own rule: "never lose a bag because a node was busy".
    const c = bot({ settings: { bumpWallets: 2, bumpBudgetSol: 0.2 } });
    c.createWallets(2, 'password123');
    const errC = await c.forgetWallets({ password: 'password123' }).then(() => null, (e) => e);
    assert.ok(errC && errC.code === 'DELETE_NEEDS_FORCE', 'an unanswerable chain does not delete keys silently: ' + (errC && errC.code));
    assert.ok(c.addresses().length, 'the keys are still there');
  }

  // ── 17u. delete is the whole job: bags out, rent back, money home - and it never abandons money by accident ──
  {
    const MINT = 'GxWqJbWPxMseev7WXYNPLEG8K59v2fAhJ5m5o7Yepump';
    // (a) A pool holding bags: the delete SELLS them first, then sweeps the SOL home, then deletes. Nothing is left behind.
    // The fake chain is stateful so the arithmetic is real: the sells empty the wallets of tokens, the drain empties them of
    // SOL, and the last check is what the button sees.
    const chain = { sol: 8_000_000, sends: 0 };
    const bags = new Map();
    const bagValue = (n) => (n === '0' || !n ? { value: [] } : { value: [{ account: { lamports: 2_039_280, data: { parsed: { info: { tokenAmount: { amount: n, uiAmount: 39, decimals: 9 }, mint: MINT, state: 'initialized' } } } } }] });
    const rpcA = fakeRpc({ mainBalance: 1 });
    rpcA.call = async (fn) => fn({
      getMultipleAccountsInfo: async (k) => k.map(() => ({ lamports: chain.sol })),
      getBalance: async () => chain.sol,
      getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 9e6 }),
      getSignatureStatuses: async () => ({ value: [{ confirmationStatus: 'confirmed' }] }),
      getParsedTokenAccountsByOwner: async (owner) => bagValue(bags.get(owner.toBase58())),
    });
    rpcA.broadcast = async () => {
      chain.sends += 1;
      if (chain.sends > 2) chain.sol = 0;      // the two sells come first, then the drain takes everything
      return 'SIG' + chain.sends;
    };
    const a = bot({ rpc: rpcA, settings: { bumpMint: MINT, bumpWallets: 2, bumpBudgetSol: 0.06 } });
    a.createWallets(2, 'password123');
    for (const row of a.rows) bags.set(row.address, '39018746966');
    // the door's sell is what gets a bag out, so the chain answers "gone" for that wallet from then on (the push into
    // `doors` is kept, which is what the assertion below counts)
    const origDoor = a.door;
    a.door = async (body) => { if (body.action === 'sell') bags.set(body.publicKey, '0'); return origDoor(body); };
    const outA = await a.forgetWallets({ password: 'password123' });
    assert.strictEqual(outA.removed, true, 'a pool holding bags is deleted, not refused: ' + JSON.stringify(outA.recovered));
    assert.strictEqual(a.doors.filter((d) => d.action === 'sell').length, 2, 'and each bag was sold on the way out: ' + a.doors.length);
    assert.ok(outA.recovered.returnedSol > 0, 'and the money came home first: ' + outA.recovered.returnedSol);

    // (b) A bag that CANNOT be sold: the first press refuses and says what would be abandoned; the second, explicit press
    // deletes anyway and the line names what stays on chain.
    const stuckRpc = fakeRpc({ mainBalance: 1 });
    stuckRpc.call = async (fn) => fn({
      getMultipleAccountsInfo: async (k) => k.map(() => ({ lamports: 0 })),
      getBalance: async () => 0,
      getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 9e6 }),
      getSignatureStatuses: async () => ({ value: [{ confirmationStatus: 'confirmed' }] }),
      getParsedTokenAccountsByOwner: async () => ({ value: [{ account: { lamports: 2_039_280, data: { parsed: { info: { tokenAmount: { amount: '39018746966', uiAmount: 39, decimals: 9 }, mint: MINT, state: 'initialized' } } } } }] }),
    });
    const b = bot({ rpc: stuckRpc, settings: { bumpMint: MINT, bumpWallets: 2, bumpBudgetSol: 0.06 } });
    b.createWallets(2, 'password123');
    b.door = async () => { throw new Error('the trade door refused it (400: no market)'); };
    const err = await b.forgetWallets({ password: 'password123' }).then(() => null, (e) => e);
    assert.ok(err, 'the first press does not delete a bag it could not sell');
    assert.strictEqual(err.code, 'DELETE_NEEDS_FORCE', 'and says that a second, explicit press is needed: ' + err.code);
    assert.ok(/still hold a bag/.test(err.message), 'naming what would be abandoned: ' + err.message);
    assert.ok(b.addresses().length, 'the keys are still there');
    const forced = await b.forgetWallets({ force: true, password: 'password123' });
    assert.strictEqual(forced.removed, true, 'the second press deletes anyway');
    assert.ok(/could not be sold and is abandoned on chain/.test(b.lastLine), 'and the panel says what was abandoned: ' + b.lastLine);
  }

  // ── 17x. deleting keys needs the password, and a wrong one changes nothing ──
  {
    const MINT = 'GxWqJbWPxMseev7WXYNPLEG8K59v2fAhJ5m5o7Yepump';
    const b = bot({ settings: { bumpMint: MINT, bumpWallets: 2, bumpBudgetSol: 0.06, bumpMinutes: 5, bumpPerMinute: 5 } });
    b.createWallets(2, 'password123');
    const before = b.addresses().slice();
    // RULE ADDED 2026-11-11 (1.1.5): this is the one press nothing can undo, and an unlocked roster is not proof of the
    // operator - anything able to reach the app's own channels could press it (it happened: a debugger connection did).
    const noPw = await b.forgetWallets().then(() => null, (e) => e);
    assert.ok(noPw && /Type your wallet password/.test(noPw.message), 'no password, no delete: ' + (noPw && noPw.message));
    assert.deepStrictEqual(b.addresses(), before, 'and the keys are untouched');
    const wrong = await b.forgetWallets({ password: 'not-the-password' }).then(() => null, (e) => e);
    assert.ok(wrong && /Wrong password/.test(wrong.message), 'a wrong password is refused in words a person can act on: ' + (wrong && wrong.message));
    assert.deepStrictEqual(b.addresses(), before, 'and nothing was touched');
    const ok = await b.forgetWallets({ password: 'password123', force: true });
    assert.strictEqual(ok.removed, true, 'the right password deletes');
    assert.deepStrictEqual(b.addresses(), [], 'and the keys are gone');
  }

  console.log('Bump desk tests passed');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
