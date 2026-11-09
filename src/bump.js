// The bump desk: volume and transaction activity for ONE token, spread over a pool of wallets this app creates itself.
//
// What it does, in one sentence: it buys and sells a token from several wallets of its own, with randomized amounts and
// randomized timing, so that the trades look like different people rather than one person in a loop.
//
// What it deliberately does NOT do, though the tools are here:
//  - it never bundles wallets into one slot: a Jito bundle here is one wallet's trade plus its tip, and the wallets still
//    trade one at a time, because several wallets in one block is the opposite of looking natural;
//  - it never leaves a bag behind silently: every buy is sold, and the sell-back on Stop is the default;
//  - it never invents a number: every figure in the panel comes from a transaction that was actually sent and confirmed,
//    or from the cost model printed before the run (see `estimate`).
//
// Money rules, because this spends real SOL:
//  - a wallet can only spend the budget it was given, and it must keep enough to create its token account and pay fees;
//  - every foreign transaction is inspected before the key touches it (`assertSwapTx`);
//  - the keys live in `<userData>/bump-wallets.json`, sealed with the wallet password, never in settings, never in a
//    settings code, never in the log.
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const {
  Keypair, PublicKey, SystemProgram, SystemInstruction, Transaction, VersionedTransaction, LAMPORTS_PER_SOL,
} = require('@solana/web3.js');
const bs58 = require('bs58');
const secretbox = require('./secretbox');
const { WSOL } = require('./jupiter');
const reclaim = require('./reclaim');
const { assertSwapTx } = require('./txguard');

const TRADE_URL = 'https://pumpportal.fun/api/trade-local';

// 1.25% bonding curve + 0.5% of the trade door, each way (the same numbers `renderer/fees.js` shows).
const SIDE_FEE_PCT = 1.75;
const BASE_FEE_SOL = 0.000005;          // one signature, no priority fee, 5000 lamports
const TOKEN_RENT_SOL = 0.00204;         // the account that holds the token, returned when it is closed
// RULE ADDED 2026-11-08 (1.1.2): a wallet cannot be emptied to nothing. Solana refuses a transaction that would leave an
// account holding between zero and its rent-exempt minimum (890 880 lamports), so a withdrawal that sends "everything
// minus a dust allowance" is rejected on chain - and a desk that does not confirm is a desk that reports it as sent.
const ACCOUNT_RENT_SOL = 0.00089088;
// RULE ADDED 2026-11-10 (1.1.4): the smallest amount of SOL a wallet must hold before a SELL is even worth asking for. A
// sell is not free: the route that gets a bag out of a nearly empty wallet has to create its wrapped-SOL account up front
// (simulated on the owner's own bag: "Transfer: insufficient lamports 875880, need 1488440"), the token account's own rent
// is already spent, and the swap's fee comes on top. The rescue floats this much in from the main wallet first, and the
// sweep takes every lamport of it back - only the fee is really spent.
const SELL_FLOAT_SOL = 0.006;
const MAX_WALLETS = 40;
// A round of more than ten buys is not a bump any more: the sell has to come back before the money runs out, and a wallet
// carrying ten bags at once is exactly the float `planBudget` prices.
const MAX_BUYS_PER_ROUND = 10;
const MAX_PER_TX_SOL = 2;
const MAX_BUDGET_SOL = 50;
const SWEEP_CHUNK = 6;                  // a transaction carries one signature per wallet; six keeps it well under 1232 bytes
const JITO_MAX_BUNDLE = 4;              // Jito caps a bundle at five transactions, and one of ours is the tip
// RULE ADDED 2026-11-11 (1.1.5): a bundle is offered a few times before the desk gives up on it. The block engine keeps a
// bundle for a slot or two only, so ONE send lands only when the next leader happens to run the Jito client - the owner
// measured exactly that ("TO POWINNO z jito zapierdalac"): the engine accepted every bundle and none landed, and a desk
// that retires Jito on the first miss looks like it ignores the switch. The same bytes are re-offered, and a tip is paid
// only by a bundle that lands.
const BUNDLE_SENDS = 3;
const BUNDLE_WAIT_MS = 1400;            // how long one offer is given to appear on chain (about a slot)
const JITO_MISS_LIMIT = 3;              // this many unlanded trades in a row retires Jito for the rest of the run
// RULE ADDED 2026-11-11 (1.1.6): how long a parked wallet sits out. One number, used by every park, so a park is always a
// pause: a wallet that could not trade is given another chance, and one that holds a bag sells it before it rests.
const PARK_MS = 120000;

// The settings this desk owns. They live in the same file as the rest of the app's settings, which is what makes them
// survive a restart and go through the same validation - but they are the only keys prefixed `bump`, and the wallet
// roster is NOT among them.
const BUMP_DEFAULTS = {
  bumpMint: '',
  bumpWallets: 6,
  bumpBudgetSol: 0.3,
  bumpMinSol: 0.004,
  bumpMaxSol: 0.012,
  bumpPerMinute: 18,
  // RULE ADDED 2026-11-08 (1.1.2): a ROUND is `bumpBuysPerRound` buys followed by ONE sell of the whole bag, and then the
  // wallet starts again. One buy and one sell is the default; three buys and one sell is what a "bought three times, sold
  // once" tape looks like. `bumpBuysRandom` draws the count for every round from 1..this, so no two rounds are alike.
  bumpBuysPerRound: 1,
  bumpBuysRandom: false,
  // Kept so an old settings file still loads. The buy share is no longer a setting: it is what the round produces
  // (buys / (buys + 1)), which is the only way the tape can be both right and reproducible.
  bumpBuyRatio: 70,
  bumpHoldMinSec: 25,
  bumpHoldMaxSec: 90,
  bumpMinutes: 15,
  // The cheapest pair that still lands: 1% slippage (the floor every route accepts) and a 1000 lamport tip. A bump is
  // meant to be cheap; a big tip on a 0.01 SOL trade is how a volume run costs more than the volume it buys.
  bumpSlippagePct: 1,
  bumpPriorityFeeSol: 0.000001,
  // RULE ADDED 2026-11-08 (1.1.2): the sliders come first. With this on, the TICKET is derived from the budget, the length
  // and the pace, so a small budget is not a slow accident. The wallet count is deliberately NOT derived (see bumpConfig):
  // the operator's number wins, and the plan says when the money cannot carry it.
  bumpAutoAmount: true,
  // RULE CHANGED 2026-11-11 (1.1.5): back ON by default. The old reason for OFF was real - the engine accepted every bundle
  // of the owner's coin and none landed, and a single unlanded bundle used to retire Jito AND fail the bump ("TO POWINNO z
  // jito zapierdalac"). A bundle is now a first try, not the wire: the same trade is offered BUNDLE_SENDS times and then
  // goes out through the normal route, so having Jito on can never cost a bump - and the tip is only paid by a bundle that
  // actually lands. It retires itself after JITO_MISS_LIMIT unlanded trades in a row.
  bumpUseJito: true,
  bumpJitoTipSol: 0.00001,
  bumpJitoBundle: 2,
  bumpSimulate: false,
  bumpSellBack: true,
};

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const round9 = (n) => Math.round(n * LAMPORTS_PER_SOL) / LAMPORTS_PER_SOL;
const short = (a) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : '—');

// The smallest ticket this desk will draw. Below it the round trip's fixed costs (two signatures) are a bigger share of
// the trade than the curve's own fee, and the "volume" becomes a machine for paying fees.
const MIN_TICKET_SOL = 0.0005;
// RULE CHANGED 2026-11-08 (1.1.2): this is now only what the PANEL suggests when the money cannot carry the pool the
// operator asked for - it no longer overrides the number he typed. A wallet needs about this much of the budget to be
// worth having (its rent plus enough left to trade), which is the arithmetic `planBudget` prints.
const BUDGET_PER_WALLET_SOL = 0.01;

/**
 * The honest arithmetic of a budget, which is what the sliders are for.
 *
 * The money is not spent by trading: a buy's SOL comes back when the bag is sold. What is spent is the FEE, and what has
 * to be parked is the float - a wallet may hold `buysPerRound` bags before its one sell - plus the rent for its token
 * account. So a budget buys a number of TRANSACTIONS, and the number is finite:
 *
 *   budget - rent - buffer  >=  txs × (signature + amount × 1.75%)  +  wallets × buysPerRound × amount
 *
 * Every transaction pays one signature and the curve's share once: a buy pays it on the SOL going in, a sell on the SOL
 * coming out. (The model used to price every bump as a whole round trip - two signatures and 3.5% - which overstated a
 * run's fees by about double, because `perMinute` counts transactions, not round trips.)
 *
 * Solve it for the ticket and you get the amount that makes a run exactly fit; solve it for the bumps and you get how
 * long the run can be. Both are printed before the run, and `start` refuses a plan that does not fit.
 */
function planBudget(cfg) {
  const wallets = Math.max(2, Math.round(cfg.wallets));
  const horizon = cfg.minutes > 0 ? cfg.minutes : 60;      // an open-ended run is priced over an hour
  const buys = Math.max(1, Math.round(cfg.buysPerRound || 1));
  // A "bump" is one transaction, which is what the pace and the counter mean: with three buys and one sell per round a
  // wallet does four bumps before it starts again.
  const bumps = Math.round(cfg.perMinute * horizon);
  // RULE CHANGED 2026-11-08 (1.1.2): a Jito tip is paid per transaction, in its own transaction (so its own signature fee).
  const jitoPerBump = cfg.useJito ? cfg.jitoTipSol + BASE_FEE_SOL : 0;
  const fixedPerBump = (cfg.priorityFeeSol + BASE_FEE_SOL) + jitoPerBump;
  const curveShare = SIDE_FEE_PCT / 100;
  const rentSol = TOKEN_RENT_SOL * wallets;
  const buffer = 0.0012;                                    // one funding signature plus dust
  const available = round9(cfg.budgetSol - rentSol - buffer);
  // What the panel offers when the money cannot carry the pool that was asked for: the pool the old cap used to impose
  // silently, now a suggestion with its own number instead of a decision taken behind the operator's back.
  const suggested = Math.max(2, Math.min(wallets, Math.floor(cfg.budgetSol / BUDGET_PER_WALLET_SOL)));
  // The float is what has to be parked while a round is open: every wallet carries up to `buys` bags before its sell.
  const floatPerWallet = buys;

  // The ticket that makes the configured run fit exactly.
  const fitAmount = bumps > 0 ? (available - bumps * fixedPerBump) / (bumps * curveShare + wallets * floatPerWallet) : 0;
  const wanted = cfg.autoAmount ? clamp(fitAmount, MIN_TICKET_SOL, MAX_PER_TX_SOL) : (cfg.minSol + cfg.maxSol) / 2;
  const amount0 = round9(wanted);

  // RULE ADDED 2026-11-11 (1.1.6): a ROUND has to fit in ONE wallet's share, and the band's TOP is what has to fit - the desk
  // draws any ticket up to `amount × 1.25`, so a plan whose top plus the rent does not fit in a share is a plan `start()`
  // refuses after the panel called it fine (measured: 0.0222 SOL a bump with 0.03 a wallet and a 0.03006 SOL requirement). So
  // the ticket is capped by the share, and the round check uses the top of the band, not its middle.
  const reserveSol = round9(TOKEN_RENT_SOL + 2 * (cfg.priorityFeeSol + BASE_FEE_SOL) + 0.0002 + (cfg.useJito ? cfg.jitoTipSol + BASE_FEE_SOL : 0));
  const perWalletSol = round9(cfg.budgetSol / wallets);
  const bandCap = (perWalletSol - reserveSol) / (1.25 * (1 + curveShare));
  const amount = round9(Math.max(MIN_TICKET_SOL, bandCap > 0 ? Math.min(amount0, bandCap) : amount0));
  const minSol = round9(Math.max(MIN_TICKET_SOL, amount * 0.75));
  const maxSol = round9(Math.max(MIN_TICKET_SOL * 1.05, amount * 1.25));
  const perBuySol = maxSol * (1 + curveShare) + fixedPerBump;
  const roundNeedSol = round9(TOKEN_RENT_SOL + buys * perBuySol);
  const buysThatFit = Math.max(0, Math.floor(((perWalletSol - TOKEN_RENT_SOL) / Math.max(perBuySol, 1e-9)) + 1e-9));
  const roundFits = perWalletSol + 1e-9 >= roundNeedSol;

  // With `amount` fixed, how many bumps does the budget really buy?
  const perBump = fixedPerBump + amount * curveShare;
  const affordableBumps = perBump > 0 ? Math.max(0, Math.floor((available - wallets * floatPerWallet * amount) / perBump)) : 0;
  const maxMinutes = cfg.perMinute > 0 ? Math.floor((affordableBumps / cfg.perMinute) * 10) / 10 : 0;
  const paceForDuration = horizon > 0 ? Math.floor((affordableBumps / horizon) * 10) / 10 : 0;
  // Two percent of slack: a plan that is one bump short of what the money buys is a plan that fits, and saying otherwise
  // would teach the operator to ignore the warning.
  const fits = amount >= MIN_TICKET_SOL && affordableBumps >= Math.floor(bumps * 0.98) && roundFits;

  let note = '';
  if (!fits) {
    if (available <= 0) {
      // The least this desk can run on: every wallet parks its rent and buys the smallest ticket the desk will draw, plus
      // one bump's signatures and the funding fee. Advice to use fewer wallets is only honest above the floor of two,
      // which is the smallest a pool can be - at two the only way forward is more money, and the note says how much.
      const floorSol = rentSol + buffer + wallets * MIN_TICKET_SOL + fixedPerBump;
      const fewer = wallets > 2 ? `Use fewer wallets (${suggested} fit this budget) or a bigger budget` : 'The budget has to be bigger';
      note = `${cfg.budgetSol.toFixed(3)} SOL does not even cover the ${rentSol.toFixed(4)} SOL of rent for ${wallets} wallets plus the funding fee and the smallest ticket. ${fewer}: about ${(Math.ceil(floorSol * 1000) / 1000).toFixed(3)} SOL is the least ${wallets} wallets can run on.`;
    } else if (amount < MIN_TICKET_SOL) {
      note = `That run needs ${bumps} bumps, and the fees alone (${(bumps * fixedPerBump).toFixed(4)} SOL) are more than the ${available.toFixed(4)} SOL left after rent. What this budget can do: about ${affordableBumps} bumps — ${maxMinutes} minutes at ${cfg.perMinute}/min, or ${paceForDuration}/min for ${horizon} minutes.`;
    } else if (!roundFits) {
      // The round is the unit of work, so this comes before any pace or length advice: a faster pace cannot fix a round the
      // money cannot pay for, and a run that starts anyway ends two minutes later with bags nobody sold.
      note = buysThatFit >= 1
        ? `${buys} buys a round need ${roundNeedSol.toFixed(4)} SOL in one wallet, and each of the ${wallets} gets ${perWalletSol.toFixed(4)}. Set "Buys in one round" to ${buysThatFit}, or raise the budget (or use fewer wallets) so the round fits.`
        : `Each of the ${wallets} wallets gets ${perWalletSol.toFixed(4)} SOL, which is not enough for its rent (${TOKEN_RENT_SOL.toFixed(4)} SOL) plus a single ${amount.toFixed(4)} SOL buy. Raise the budget or use fewer wallets.`;
    } else {
      note = `The budget buys about ${affordableBumps} bumps, not ${bumps}: ${maxMinutes} minutes at ${cfg.perMinute}/min, or ${paceForDuration}/min for ${horizon} minutes.`;
    }
  }
  return {
    wallets, bumps, horizon, amount,
    buysPerRound: buys,
    suggestedWallets: suggested,
    // The band is built around the ticket, but never below the smallest trade this desk will draw: a band whose bottom is
    // under the minimum would quietly do the thing the minimum exists to prevent.
    minSol,
    maxSol,
    fixedPerBumpSol: fixedPerBump, curveShare, rentSol, available,
    perBumpSol: perBump,
    affordableBumps, maxMinutes, paceForDuration,
    // What one wallet must be able to carry to finish a round, and how many buys its share really pays for.
    perWalletSol, roundNeedSol, buysThatFit, roundFits,
    runFeesSol: round9(Math.min(bumps, affordableBumps || bumps) * perBump),
    floatSol: round9(wallets * floatPerWallet * amount),
    fits, note,
  };
}

/**
 * The desk's own deposit address: ONE address you send SOL to, and the desk splits it across the pool by itself and
 * returns it when the run is over. It is a key like any other - sealed with the wallet password, in its own file, never
 * in settings - so a customer can top the desk up from a phone without ever handling a pool key.
 */
class DeskVault {
  constructor(dir) {
    this.file = path.join(dir, 'bump-vault.json');
    this.meta = this._load();
    this.keypair = null;
  }

  _load() {
    let text;
    try { text = fs.readFileSync(this.file, 'utf8'); } catch (err) {
      if (err && err.code === 'ENOENT') return null;
      throw new Error('The desk address file could not be read (' + ((err && err.code) || 'unknown error') + ').');
    }
    let meta;
    try { meta = JSON.parse(text); } catch (_) { throw new Error('The desk address file is damaged and cannot be used.'); }
    if (!meta || typeof meta.address !== 'string' || !secretbox.isSealed(meta.enc)) throw new Error('The desk address file is damaged and cannot be used.');
    return meta;
  }

  exists() { return !!this.meta; }
  address() { return this.meta ? this.meta.address : null; }

  create(password) {
    if (this.meta) throw new Error('The desk address already exists.');
    const kp = Keypair.generate();
    const meta = { version: 1, address: kp.publicKey.toBase58(), enc: secretbox.seal(Buffer.from(kp.secretKey), password) };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(meta), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
    this.meta = meta;
    this.keypair = kp;
    return kp;
  }

  unlock(password) {
    if (!this.meta) return null;
    const kp = Keypair.fromSecretKey(new Uint8Array(secretbox.open(this.meta.enc, password)));
    if (kp.publicKey.toBase58() !== this.meta.address) throw new Error('The desk address file is damaged and cannot be used.');
    this.keypair = kp;
    return kp;
  }

  remove() {
    fs.rmSync(this.file, { force: true });
    this.meta = null;
    this.keypair = null;
  }
}

/**
 * The "make it fit" button: the same budget, the same coin, a pace or a duration the money can actually pay for. It keeps
 * the run length when that length is worth keeping (half an hour or more) and lowers the pace; otherwise it keeps the pace
 * and shortens the run. The answer is a settings patch, so the operator sees and can still change every number.
 */
function fitPlan(settings = {}) {
  const c = bumpConfig(settings);
  const plan = planBudget(c);
  if (plan.fits) return { fits: true, patch: {}, note: 'That plan already fits the budget.' };
  // RULE CHANGED 2026-11-11 (1.1.6): the fitter scores candidates instead of taking the first one that fits. The round has to fit
  // before anything else (a wallet must be able to pay for its whole round before it sells), and after that the cheapest
  // thing to give up is the PACE, then the LENGTH, then the round size, then the pool - which is what an operator would do.
  // First-fit produced answers like "1 minute at 1.1/min", which is not a run; a penalty makes the answer the closest plan
  // to what was asked that the money can actually pay for.
  const W = { bumpPerMinute: 1, bumpMinutes: 3, bumpBuysPerRound: 5, bumpWallets: 8 };
  const relative = (was, now) => (was ? Math.max(0, was - now) / was : 0);
  const describe = (patch, p) => {
    const bits = [];
    if (patch.bumpWallets != null && patch.bumpWallets !== c.wallets) bits.push(`${patch.bumpWallets} wallets instead of ${c.wallets}`);
    if (patch.bumpBuysPerRound != null && patch.bumpBuysPerRound !== c.buysPerRound) bits.push(`${patch.bumpBuysPerRound} buy${patch.bumpBuysPerRound === 1 ? '' : 's'} a round instead of ${c.buysPerRound}`);
    if (patch.bumpPerMinute != null && patch.bumpPerMinute !== c.perMinute) bits.push(`${patch.bumpPerMinute}/min instead of ${c.perMinute}`);
    if (patch.bumpMinutes != null && patch.bumpMinutes !== c.minutes) bits.push(`${patch.bumpMinutes} minutes instead of ${c.minutes}`);
    return `Fitted: ${bits.join(', ')} - about ${p.affordableBumps} bumps.`;
  };
  const uniq = (list) => [...new Set(list)];
  const pools = uniq([c.wallets, plan.suggestedWallets, Math.max(2, c.wallets - 1), 2]).filter((w) => w >= 2 && w <= c.wallets);
  const rounds = [];
  for (let b = Math.min(c.buysPerRound, Math.max(1, plan.buysThatFit || c.buysPerRound)); b >= 1; b--) rounds.push(b);
  // A run shorter than five minutes is not a run, and a pace below 1/min is not a pace: both are in the grid only as the
  // last resort, weighed by the penalty like everything else.
  const minutesList = uniq([c.minutes, ...(c.minutes > 1 ? [Math.floor(c.minutes * 0.75), Math.floor(c.minutes * 0.5), Math.floor(c.minutes * 0.25)] : []), 5].map((m) => Math.max(1, m)));
  const paceList = uniq([c.perMinute, ...(c.perMinute > 1 ? [Math.round(c.perMinute * 0.75 * 10) / 10, Math.round(c.perMinute * 0.5 * 10) / 10, Math.round(c.perMinute * 0.25 * 10) / 10] : []), 2, 1].map((p) => Math.max(1, p)));
  let best = null;
  for (const wallets of pools) {
    for (const buys of rounds) {
      for (const minutes of minutesList) {
        for (const perMinute of paceList) {
          const patch = {};
          if (wallets !== c.wallets) patch.bumpWallets = wallets;
          if (buys !== c.buysPerRound) patch.bumpBuysPerRound = buys;
          if (minutes !== c.minutes) patch.bumpMinutes = minutes;
          if (perMinute !== c.perMinute) patch.bumpPerMinute = perMinute;
          if (!Object.keys(patch).length) continue;
          const p = planBudget(bumpConfig({ ...settings, ...patch, bumpAutoAmount: true }));
          if (!p.fits) continue;
          const penalty = W.bumpPerMinute * relative(c.perMinute, perMinute)
            + W.bumpMinutes * relative(c.minutes, minutes)
            + W.bumpBuysPerRound * relative(c.buysPerRound, buys)
            + W.bumpWallets * relative(c.wallets, wallets);
          // Fewer bumps is the last tie-breaker: between two plans the operator asked for equally, prefer the one that runs.
          const score = penalty * 1e6 - p.affordableBumps;
          if (!best || score < best.score) best = { score, patch, plan: p };
        }
      }
    }
  }
  if (best) return { fits: true, patch: best.patch, note: describe(best.patch, best.plan) };
  // Nothing fits: say what the run as asked would need, in SOL, rather than "raise the budget" with no number. The search
  // keeps the operator's own settings and only moves the budget, so the answer is the amount this exact plan costs.
  let needSol = null;
  for (let b = Math.round(c.budgetSol * 1000) / 1000 + 0.001; b <= MAX_BUDGET_SOL && b < c.budgetSol * 8; b = Math.round((b * 1.15 + 0.001) * 1000) / 1000) {
    if (planBudget(bumpConfig({ ...settings, bumpBudgetSol: b, bumpAutoAmount: true })).fits) { needSol = b; break; }
  }
  const money = needSol
    ? ` This exact plan needs about ${needSol.toFixed(3)} SOL: ${(needSol - c.budgetSol).toFixed(3)} more than the ${c.budgetSol.toFixed(3)} you have.`
    : '';
  return { fits: false, patch: {}, note: (plan.note || 'That budget is too small for this desk: raise the budget or use fewer wallets.') + money };
}

/**
 * A deposit, checked before it is signed: one transfer, out of this wallet, into the desk address, for the amount asked.
 * A mistyped amount here is money sent to an address the operator did not mean, which is the one mistake a deposit cannot
 * undo.
 */
function guardDeposit(tx, from, to, lamports) {
  if (!tx.instructions.length) throw new Error('Safety check: a deposit with nothing in it was refused.');
  for (const ix of tx.instructions) {
    if (!ix.programId.equals(SystemProgram.programId)) throw new Error('Safety check: that transaction carried an instruction that is not a transfer.');
    const d = SystemInstruction.decodeTransfer(ix);
    if (!d.fromPubkey.equals(from) || !d.toPubkey.equals(to) || Number(d.lamports) !== lamports) {
      throw new Error('Safety check: that deposit did not match what was asked for.');
    }
  }
}

/**
 * The funding transaction, checked instruction by instruction before it is signed. It moves real SOL out of the main
 * wallet, so the only shape allowed is: a transfer, from the main wallet, to a wallet this desk owns, for exactly the
 * amount that was planned. Anything else is a transfer to a stranger and is refused.
 */
function guardFunding(tx, fromPubkey, planned) {
  for (const ix of tx.instructions) {
    if (!ix.programId.equals(SystemProgram.programId)) throw new Error('Safety check: a funding transaction carried an instruction that is not a transfer.');
    const d = SystemInstruction.decodeTransfer(ix);
    if (!d.fromPubkey.equals(fromPubkey)) throw new Error('Safety check: funding would leave another wallet.');
    if (planned.get(d.toPubkey.toBase58()) !== Number(d.lamports)) throw new Error('Safety check: funding would pay an amount that was not planned.');
  }
  if (!tx.instructions.length) throw new Error('Safety check: a funding transaction with nothing in it was refused.');
}

/**
 * The sweep, checked the same way: every transfer lands in the main wallet and comes out of a wallet this desk owns.
 * A sweep that pays anybody else is the one mistake that would take the whole pool at once.
 */
function guardSweep(tx, toPubkey, ours) {
  for (const ix of tx.instructions) {
    if (!ix.programId.equals(SystemProgram.programId)) throw new Error('Safety check: a sweep carried an instruction that is not a transfer.');
    const d = SystemInstruction.decodeTransfer(ix);
    if (!d.toPubkey.equals(toPubkey)) throw new Error('Safety check: a sweep would send SOL somewhere other than your wallet.');
    if (!ours.includes(d.fromPubkey.toBase58())) throw new Error('Safety check: a sweep would move SOL out of a wallet this desk does not own.');
  }
}

/**
 * The settings, clamped to what can actually run. Everything here is enforced again at send time, never trusted.
 */
function bumpConfig(settings = {}) {
  const minSol0 = clamp(num(settings.bumpMinSol, BUMP_DEFAULTS.bumpMinSol), 0.0002, MAX_PER_TX_SOL);
  const maxSol0 = clamp(num(settings.bumpMaxSol, BUMP_DEFAULTS.bumpMaxSol), minSol0, MAX_PER_TX_SOL);
  const holdMin = clamp(num(settings.bumpHoldMinSec, BUMP_DEFAULTS.bumpHoldMinSec), 1, 3600);
  const holdMax = clamp(num(settings.bumpHoldMaxSec, BUMP_DEFAULTS.bumpHoldMaxSec), holdMin, 7200);
  const budgetSol = clamp(num(settings.bumpBudgetSol, BUMP_DEFAULTS.bumpBudgetSol), 0.005, MAX_BUDGET_SOL);
  const requested = Math.round(clamp(num(settings.bumpWallets, BUMP_DEFAULTS.bumpWallets), 2, MAX_WALLETS));
  const autoAmount = settings.bumpAutoAmount !== false;
  // RULE CHANGED 2026-11-08 (1.1.2): the wallet count is the operator's, not the budget's. It used to be capped to one
  // wallet per 0.01 SOL, so typing six wallets and 0.02 SOL silently ran two - the panel showed two rows for a number
  // nobody had asked for. Now six means six: if the money cannot carry six, `planBudget` says so with the number that
  // would (6 wallets park 0.0122 SOL of rent, so 0.005 SOL buys none of them), and the fitter is what lowers the pool.
  const wallets = requested;
  const cfg = {
    mint: String(settings.bumpMint || '').trim(),
    wallets,
    requestedWallets: requested,
    budgetSol,
    minSol: minSol0,
    maxSol: maxSol0,
    // A tenth of a bump a minute is a real setting: a small budget spread over three hours is 2.5/min, and rounding it
    // to 3 would put the plan back over the money.
    perMinute: Math.round(clamp(num(settings.bumpPerMinute, BUMP_DEFAULTS.bumpPerMinute), 0.1, 600) * 10) / 10,
    // A round is N buys and then one sell of the whole bag; the buy share is what that produces, not a knob that fights it.
    buysPerRound: Math.round(clamp(num(settings.bumpBuysPerRound, BUMP_DEFAULTS.bumpBuysPerRound), 1, MAX_BUYS_PER_ROUND)),
    buysRandom: settings.bumpBuysRandom === true,
    buyRatio: clamp(num(settings.bumpBuyRatio, BUMP_DEFAULTS.bumpBuyRatio), 0, 100),
    holdMinSec: holdMin,
    holdMaxSec: holdMax,
    minutes: Math.round(clamp(num(settings.bumpMinutes, BUMP_DEFAULTS.bumpMinutes), 0, 1440)),
    slippagePct: clamp(num(settings.bumpSlippagePct, BUMP_DEFAULTS.bumpSlippagePct), 1, 50),
    priorityFeeSol: clamp(num(settings.bumpPriorityFeeSol, BUMP_DEFAULTS.bumpPriorityFeeSol), 0.000001, 0.01),
    // RULE ADDED 2026-11-08 (1.1.2): a missing key means "on", so the default in BUMP_DEFAULTS actually reaches the desk.
    // `Boolean(undefined)` is false, which silently turned every default-on switch off for anyone who had never touched it.
    useJito: settings.bumpUseJito !== false,
    jitoTipSol: clamp(num(settings.bumpJitoTipSol, BUMP_DEFAULTS.bumpJitoTipSol), 0.000001, 0.01),
    jitoBundle: Math.round(clamp(num(settings.bumpJitoBundle, BUMP_DEFAULTS.bumpJitoBundle), 2, JITO_MAX_BUNDLE)),
    simulate: Boolean(settings.bumpSimulate),
    sellBack: settings.bumpSellBack !== false,
    autoAmount,
  };
  if (autoAmount) {
    // The ticket comes from the budget and the run length, which is the order the sliders are in.
    const plan = planBudget(cfg);
    cfg.minSol = plan.minSol;
    cfg.maxSol = plan.maxSol;
  }
  return cfg;
}

/**
 * What the configured run costs before a single lamport leaves. This is the number the competitor's price list hides:
 * the curve's own fee both ways, the priority fee on every transaction, the tip if Jito is on, and the rent each wallet
 * has to park for its token account.
 *
 * `opts.have` is how many addresses the pool really holds. A pool size is a REQUEST - the roster is written when the keys
 * are made - so a plan priced for three wallets while two exist is a plan that promises a wallet nobody has (the owner's
 * own report: "wpisałem 3 ... zrobiło 2 adresy ... tu tez 2 napisane 2 wallets"). The plan is priced for what exists and
 * says out loud what to press to get the rest.
 */
function estimate(settings = {}, opts = {}) {
  const c = bumpConfig(settings);
  const asked = c.wallets;
  const have = Number.isFinite(opts.have) ? Math.round(opts.have) : null;
  let poolNote = '';
  if (have != null && have >= 2 && have < asked) {
    c.wallets = clamp(have, 2, MAX_WALLETS);
    poolNote = `You asked for ${asked} wallets and the pool holds ${c.wallets}: the plan is priced for the ${c.wallets} that exist. Press "Create wallets" to add ${asked - c.wallets} more address${asked - c.wallets === 1 ? '' : 'es'} and the split follows.`;
  }
  const plan = planBudget(c);
  const avg = (c.minSol + c.maxSol) / 2;
  const buys = Math.max(1, c.buysPerRound);
  // RULE CHANGED 2026-11-08 (1.1.2): one transaction pays ONE signature and the curve's share ONCE. The old line priced a
  // bump as a whole round trip (two signatures, 3.5%), which is the cost of two bumps.
  const perBumpFees = avg * (SIDE_FEE_PCT / 100) + (c.priorityFeeSol + BASE_FEE_SOL);
  const jitoPerBump = c.useJito ? c.jitoTipSol + BASE_FEE_SOL : 0;
  const bumps = c.minutes > 0 ? c.perMinute * c.minutes : 0;
  const perWalletRent = TOKEN_RENT_SOL;
  const walletRent = perWalletRent * c.wallets;
  // How much SOL one transaction moves on average: a round is `buys` buys plus the one sell of the whole bag, so the round
  // pushes 2 × buys × amount through `buys + 1` transactions.
  const volumePerBump = avg * ((2 * buys) / (buys + 1));
  return {
    avgAmountSol: round9(avg),
    buysPerRound: buys,
    // The share of the transactions that are buys, which is exactly what a round of `buys` buys and one sell produces.
    buySharePct: Math.round((buys / (buys + 1)) * 1000) / 10,
    perBumpFeesSol: perBumpFees + jitoPerBump,
    // The curve's own share is the dominant cost, so it is named separately: it is what the mint's own liquidity takes,
    // not what this app takes.
    perBumpCurveSol: avg * (SIDE_FEE_PCT / 100),
    perBumpNetworkSol: c.priorityFeeSol + BASE_FEE_SOL + jitoPerBump,
    bumps,
    runFeesSol: bumps ? (perBumpFees + jitoPerBump) * bumps : 0,
    walletRentSol: walletRent,
    // Volume a run of that length pushes through the mint (both sides), which is what a volume desk is judged on.
    runVolumeSol: bumps * volumePerBump,
    slippagePct: c.slippagePct,
    wallets: c.wallets,
    perWalletSol: c.budgetSol / c.wallets,
    budgetSol: c.budgetSol,
    autoAmount: c.autoAmount,
    // The sliders' own answer: does the money cover the plan, and if not, what does it cover?
    fits: plan.fits,
    planNote: plan.note,
    // A round the money cannot pay for is refused before the run, with the count it can pay for (1.1.6).
    roundFits: plan.roundFits,
    buysThatFit: plan.buysThatFit,
    roundNeedSol: plan.roundNeedSol,
    perWalletSol: plan.perWalletSol,
    affordableBumps: plan.affordableBumps,
    maxMinutes: plan.maxMinutes,
    paceForDuration: plan.paceForDuration,
    floatSol: plan.floatSol,
    // Why the pool and the slider are two different numbers, when they are.
    poolNote,
    note: perWalletRent > 0 && c.budgetSol / c.wallets < c.maxSol + perWalletRent
      ? 'The budget per wallet is smaller than one trade plus the rent for its token account: raise the budget or lower the trade size.'
      : '',
  };
}

/** One sealed file of generated wallets. Addresses stay readable (the panel needs them); the secrets do not. */
class Roster {
  constructor(dir) {
    this.file = path.join(dir, 'bump-wallets.json');
    this.meta = this._load();
  }

  _load() {
    let text;
    try { text = fs.readFileSync(this.file, 'utf8'); } catch (err) {
      if (err && err.code === 'ENOENT') return null;
      throw new Error('The bump wallet file could not be read (' + ((err && err.code) || 'unknown error') + '). Move it away or restore it from a backup.');
    }
    let meta;
    try { meta = JSON.parse(text); } catch (_) { throw new Error('The bump wallet file is damaged and cannot be used.'); }
    if (!meta || meta.version !== 1 || !Array.isArray(meta.addresses) || !secretbox.isSealed(meta.enc)) {
      throw new Error('The bump wallet file is damaged and cannot be used.');
    }
    return meta;
  }

  addresses() { return this.meta ? this.meta.addresses.slice() : []; }
  exists() { return !!this.meta; }

  /** Generate `count` wallets. Refused while a roster exists: replacing keys that may hold SOL is a decision, not a click. */
  create(count, password) {
    if (this.meta) throw new Error('Bump wallets already exist. Forget them first (that deletes the keys).');
    const n = Math.round(clamp(num(count, 6), 2, MAX_WALLETS));
    const keypairs = [];
    for (let i = 0; i < n; i++) keypairs.push(Keypair.generate());
    this._write(keypairs, password);
    return { addresses: this.addresses(), keypairs };
  }

  /**
   * Grow the roster to `count`, KEEPING the wallets that already exist (and any money in them). Typing ten when two exist
   * adds eight; it does not throw the two away. The keys can only ever be added, never replaced by this path - replacing a
   * key that may hold SOL is what `forget` is for, and that one refuses while there is money.
   */
  extend(count, password) {
    const n = Math.round(clamp(num(count, 6), 2, MAX_WALLETS));
    if (!this.meta) return { ...this.create(n, password), kept: 0, added: n };
    const current = this.addresses().length;
    // RULE FIXED 2026-11-09 (1.1.2): the caller gets EVERY keypair, not just the new ones. Growing a pool of two into five used
    // to hand back only the three new keys, so the two wallets that already held the money fell out of the in-memory map and
    // could not sign anything until the next unlock - a desk that looked funded and could not trade its own first wallet.
    const existing = this.unlock(String(password || ''));
    if (!existing) throw new Error('There are no bump wallets yet. Create them first.');
    if (n <= current) return { addresses: this.addresses(), keypairs: existing, kept: current, added: 0 };
    const added = [];
    for (let i = current; i < n; i++) added.push(Keypair.generate());
    this._write([...existing, ...added], String(password || ''));
    return { addresses: this.addresses(), keypairs: [...existing, ...added], kept: current, added: added.length };
  }

  _write(keypairs, password) {
    const secrets = keypairs.map((k) => Buffer.from(k.secretKey).toString('hex'));
    const meta = {
      version: 1,
      addresses: keypairs.map((k) => k.publicKey.toBase58()),
      enc: secretbox.seal(JSON.stringify(secrets), password),
    };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(meta), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
    this.meta = meta;
  }

  /** The keypairs, in memory only. Nothing here is ever written back or logged. */
  unlock(password) {
    if (!this.meta) throw new Error('There are no bump wallets yet. Create them first.');
    // RULE ADDED 2026-11-11 (1.1.5): a wrong password is the operator's typo, not a crash. The raw authentication failure from
    // the box names nothing, and the delete now asks for this password, so the sentence has to be one a person can act on.
    let plain;
    try { plain = secretbox.open(this.meta.enc, password); } catch (_) { throw new Error('Wrong password: the bump wallets were not opened, and nothing was changed.'); }
    let secrets;
    try { secrets = JSON.parse(plain.toString('utf8')); } catch (_) { throw new Error('The bump wallet file is damaged and cannot be used.'); }
    if (!Array.isArray(secrets) || secrets.length !== this.meta.addresses.length) throw new Error('The bump wallet file is damaged and cannot be used.');
    return secrets.map((hex, i) => {
      const kp = Keypair.fromSecretKey(Uint8Array.from(Buffer.from(hex, 'hex')));
      if (kp.publicKey.toBase58() !== this.meta.addresses[i]) throw new Error('The bump wallet file is damaged and cannot be used.');
      return kp;
    });
  }

  forget() {
    fs.rmSync(this.file, { force: true });
    this.meta = null;
    return { removed: true };
  }
}

class BumpBot extends EventEmitter {
  /**
   * @param {object} opts
   * @param {object} opts.wallet   the main WalletManager (funds the pool, receives it back)
   * @param {object} opts.store    the settings store
   * @param {object} opts.rpc      the RPC manager (`call`, `broadcast`)
   * @param {object} [opts.jito]   the block engine client, used only when bundling
   * @param {string} opts.dir      userData directory
   */
  constructor(opts = {}) {
    super();
    this.wallet = opts.wallet;
    this.store = opts.store;
    this.rpc = opts.rpc;
    this.jito = opts.jito || null;
    // RULE ADDED 2026-11-08 (1.1.2): the second execution route. The pump door cannot price a coin that has migrated to
    // PumpSwap (measured on the owner's coin: it quoted 0.00247 SOL for tokens the AMM sells for 0.00459), so a trade its
    // transaction provably could not make is retried through Jupiter - the same client the sniper trades with.
    this.jupiter = opts.jupiter || null;
    this._doorBroken = new Set();          // mints whose pump-door transaction failed on chain during this run
    this._jitoBroken = false;              // JITO_MISS_LIMIT trades in a row without a landing bundle: the run stops asking
    this._jitoMisses = 0;                  // consecutive trades whose bundle did not land (reset by a bundle that does)
    this._bundledSig = null;               // the signature of the trade currently offered as a bundle, if any
    this.now = opts.now || (() => Date.now());
    this.sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.rand = opts.rand || Math.random;
    this.door = opts.door || null;          // injected in tests; the real one is `_postDoor`
    this.roster = new Roster(opts.dir || process.cwd());
    this.vault = new DeskVault(opts.dir || process.cwd());

    this.keys = new Map();                  // address -> Keypair, only while the roster is open
    this.rows = [];
    this.running = false;
    this.paused = false;
    this._busy = false;
    this._timer = null;
    this.nextAt = 0;
    this.endsAt = 0;
    this.startedAt = 0;
    this._pausedAt = 0;
    this.lastLine = '';
    this.stats = this._emptyStats();
    this._balancesAt = 0;
  }

  _emptyStats() {
    return {
      bumps: 0, buys: 0, sells: 0, errors: 0, spentSol: 0, feesSol: 0, volumeSol: 0,
      buysSol: 0, sellsSol: 0, startedAt: 0, endedAt: 0, rate: 0, _rateAt: 0, _rateBase: 0,
    };
  }

  _cfg() { return bumpConfig(this.store ? this.store.get() : {}); }

  // ───────── the pool ─────────

  addresses() { return this.roster.addresses(); }
  unlocked() { return this.keys.size > 0; }
  wallets() { return this._rows(this._cfg()); }
  /** How many addresses the pool holds right now (the plan is priced against this, not against the slider). */
  pool() { return this.roster.addresses().length; }
  vaultAddress() { return this.vault.address(); }

  /** The one address a customer tops up. Created on demand, with the wallet password, before any money moves. */
  createVault(password) {
    if (!password || String(password).length < 8) throw new Error('Type your wallet password (at least 8 characters).');
    if (this.wallet && this.wallet.exists()) this.wallet.verify(String(password));
    const kp = this.vault.create(String(password));
    this._push();
    return { address: kp.publicKey.toBase58() };
  }

  /** Move SOL from the main wallet to the desk address: the one manual step, and it is one press. */
  async depositFromMain(amountSol) {
    const amount = Number(amountSol);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter an amount greater than 0.');
    if (!this.wallet || !this.wallet.isUnlocked()) throw new Error('Unlock your wallet first.');
    if (!this.vault.exists()) throw new Error('Create the desk address first.');
    const to = new PublicKey(this.vault.address());
    const main = this.wallet.keypair.publicKey;
    const lamports = Math.round(amount * LAMPORTS_PER_SOL);
    const balance = await this.rpc.call((conn) => conn.getBalance(main), { timeoutMs: 4000 });
    if (balance / LAMPORTS_PER_SOL < amount + 0.00002) throw new Error(`Your wallet holds ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL, which does not cover ${amount.toFixed(4)} plus the fee.`);
    // RULE ADDED 2026-11-08 (1.1.2): the same rule that broke the withdrawal. Solana refuses a transfer that would leave a
    // wallet between zero and its rent-exempt minimum, so "top up 0.005" out of a 0.0055 wallet is rejected on chain. It is
    // refused here instead, with the amount that would work.
    const left = (balance - lamports - 5000) / LAMPORTS_PER_SOL;
    if (left < ACCOUNT_RENT_SOL) {
      const most = Math.max(0, (balance / LAMPORTS_PER_SOL) - ACCOUNT_RENT_SOL - 0.00001);
      throw new Error(`Your wallet has ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL and must keep ${ACCOUNT_RENT_SOL.toFixed(4)} of it (Solana will not let a wallet sit below that). The most you can send is ${most.toFixed(4)} SOL.`);
    }
    const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: main, toPubkey: to, lamports }));
    // The same rule as funding: one transfer, out of this wallet, into the desk address, for the amount asked for.
    guardDeposit(tx, main, to, lamports);
    const { blockhash } = await this.rpc.call((conn) => conn.getLatestBlockhash(), { timeoutMs: 4000 });
    tx.feePayer = main;
    tx.recentBlockhash = blockhash;
    tx.sign(this.wallet.keypair);
    const sig = await this.rpc.broadcast(tx.serialize());
    await this._confirm(sig);
    await this._refreshBalances();
    this._say(`Moved ${amount.toFixed(4)} SOL to the desk address.`);
    return { signature: sig, sol: amount, address: this.vault.address() };
  }

  createWallets(count, password) {
    if (this.running) throw new Error('Stop the bump desk before changing its wallets.');
    if (!password || String(password).length < 8) throw new Error('Type your wallet password (at least 8 characters).');
    // The same password the wallet itself uses: a wrong one is caught here rather than discovered as a decryption
    // failure later, and it is also the check that this is the operator and not somebody else at the keyboard.
    if (this.wallet && this.wallet.exists()) this.wallet.verify(String(password));
    // The pool and the desk address share one password, so they are created together: a desk you can top up but cannot
    // take the money back out of would be a trap.
    if (!this.vault.exists()) this.vault.create(String(password));
    else this.vault.unlock(String(password));
    // RULE CHANGED 2026-11-08 (1.1.2): pressing "Create wallets" with a bigger number GROWS the roster and keeps the wallets
    // that are already there - the old code refused ("forget them first"), which meant a pool of two could only become ten by
    // deleting keys that may hold money. A smaller number never deletes anything: the plan simply carries the first N.
    const out = this.roster.extend(count, String(password));
    this.keys = new Map(out.keypairs.map((k) => [k.publicKey.toBase58(), k]));
    if (!this.vault.exists()) this.vault.create(String(password));
    this.vault.unlock(String(password));
    this.rows = this._rows(this._cfg());
    this._push();
    return { addresses: out.addresses, created: out.added, kept: out.kept, vault: this.vault.address() };
  }

  unlockWallets(password) {
    const keypairs = this.roster.unlock(String(password || ''));
    this.keys = new Map(keypairs.map((k) => [k.publicKey.toBase58(), k]));
    this.vault.unlock(String(password || ''));
    this.rows = this._rows(this._cfg());
    this._push();
    return { unlocked: this.keys.size, vault: this.vault.address() };
  }

  lockWallets() {
    if (this.running) throw new Error('Stop the bump desk before locking its wallets.');
    this.keys.clear();
    this.vault.keypair = null;
    this._push();
    return { unlocked: 0 };
  }

  /**
   * Send every lamport of these wallets to one address, leaving each account at ZERO on purpose (a wallet that keeps its
   * rent-exempt floor cannot be deleted without throwing money away, which is exactly what "Delete the keys" used to do).
   * Each wallet pays its own signature, so one jammed wallet never holds up the rest.
   */
  async _drainAll(list, to, out = { moved: [], stuck: [], sol: 0 }) {
    const toPk = to instanceof PublicKey ? to : new PublicKey(to);
    for (const address of list) {
      const kp = this.keys.get(address) || (this.vault.address() === address ? this.vault.keypair : null);
      if (!kp) { out.stuck.push({ address, error: 'its key is not unlocked' }); continue; }
      let lamports = 0;
      try {
        lamports = await this.rpc.call((conn) => conn.getBalance(kp.publicKey), { timeoutMs: 5000, budgetMs: 12000, waitMs: 6000 });
      } catch (e) { out.stuck.push({ address, error: String(e.message).slice(0, 80) }); continue; }
      const send = lamports - Math.round(BASE_FEE_SOL * LAMPORTS_PER_SOL);
      if (send <= 0) continue;
      try {
        const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: toPk, lamports: send }));
        guardSweep(tx, toPk, [address]);
        const { blockhash } = await this.rpc.call((conn) => conn.getLatestBlockhash(), { timeoutMs: 5000, budgetMs: 12000, waitMs: 6000 });
        tx.feePayer = kp.publicKey;
        tx.recentBlockhash = blockhash;
        tx.sign(kp);
        const sig = await this.rpc.broadcast(tx.serialize());
        await this._confirm(sig);
        out.moved.push(address);
        out.sol = round9(out.sol + send / LAMPORTS_PER_SOL);
      } catch (e) { out.stuck.push({ address, error: String(e.message).slice(0, 90) }); }
    }
    return out;
  }

  /**
   * RULE CHANGED 2026-11-10 (1.1.4): "Delete the keys" now does the whole job itself - the owner's own words: "przy usuwaniu
   * powinno samo zamykać all monety, odzyskiwać feesy i nam zwracać". It used to only REFUSE while anything was left, and
   * because the desk address deliberately keeps its rent floor the refusal could never be satisfied: the button was dead
   * ("USUNĄĆ też nie mogę"). The order below is the only safe one - every bag sold, every emptied token account closed so its
   * rent comes back, every lamport swept home, and only then the keys. Whatever genuinely cannot be moved (a bag nobody will
   * buy, a node that will not answer) stops the delete with the reason and needs a second, explicit press that says what is
   * being abandoned on chain.
   */
  async forgetWallets({ force = false, password = '' } = {}) {
    if (this.running) throw new Error('Stop the bump desk before deleting its wallets.');
    // RULE ADDED 2026-11-11 (1.1.5): the password is required, and it is checked BEFORE anything is touched. Deleting keys is
    // the one thing this desk can do that no money can undo, and an unlocked roster is not proof of the operator: anything on
    // this machine that can reach the app's own channels (a debugger, a stray script) could press it. The password also
    // unlocks the roster, which is what lets the recovery below sell a bag while the desk was locked.
    if (this.roster.exists()) {
      if (!password || String(password).length < 8) throw new Error('Type your wallet password to delete the keys.');
      // `unlock` throws on a wrong password, which is the check - and a successful one leaves the keys in hand for the sell.
      this.unlockWallets(String(password));
    }
    const pool = this.roster.addresses();
    const addresses = [this.vault.address(), ...pool].filter(Boolean);
    const recovered = { sold: 0, closed: 0, rentSol: 0, returnedSol: 0, bags: [], errors: [] };
    const c = this._cfg();
    const unlocked = this.unlocked();
    const home = this.wallet && this.wallet.isUnlocked() ? this.wallet.keypair.publicKey : null;
    if (unlocked && (pool.length || this.vault.keypair)) {
      if (!this.rows.length) this.rows = this._rows(c);
      // 1. every bag out, by the rescue's own ladder (the door, then Jupiter), with the fee float first.
      if (c.mint) {
        for (const row of this.rows) {
          const bag = await this._bagRaw(row.address, { tries: 2 });
          if (!bag.known) { recovered.bags.push(row.short); recovered.errors.push(`${row.short}: the chain could not be asked what it holds`); continue; }
          if (bag.raw === 0n) { row.holdingSol = 0; continue; }
          try {
            await this._ensureFeeFloat(row.address).catch(() => {});
            await this._sellBagOut(row);
            const left = await this._bagRaw(row.address, { tries: 2 });
            if (left.known && left.raw === 0n) { row.holdingSol = 0; recovered.sold++; }
            else { recovered.bags.push(row.short); recovered.errors.push(`${row.short}: the bag could not be sold`); }
          } catch (e) {
            recovered.bags.push(row.short);
            recovered.errors.push(`${row.short}: ${String(e.message).slice(0, 90)}`);
          }
        }
      }
      // 2. the rent of every emptied token account, which is worth more than a bump on its own.
      for (const address of pool) {
        try {
          const kp = this.keys.get(address);
          const scan = await reclaim.scanTokenAccounts((fn, o) => this.rpc.call(fn, o), address);
          if (scan.empty.length) {
            const sent = await reclaim.closeEmpty({ accounts: scan.empty, sendChunk: reclaim.makeSender((fn, o) => this.rpc.call(fn, o), kp) });
            recovered.closed += sent.closed || scan.empty.length;
            recovered.rentSol = round9(recovered.rentSol + (sent.sol || scan.emptyRentSol || 0));
          }
        } catch (e) { recovered.errors.push('rent: ' + String(e.message).slice(0, 70)); }
      }
      // 3. the money itself, home, leaving nothing behind to be thrown away with the keys.
      if (home) {
        const drained = await this._drainAll([...pool, this.vault.address()].filter(Boolean), home);
        recovered.returnedSol = drained.sol;
        recovered.errors.push(...drained.stuck.map((s) => `${short(s.address)}: ${s.error}`));
      } else {
        recovered.errors.push('your wallet is locked, so there is nowhere for the money to go - unlock it and press Delete again');
      }
    }
    // 4. ask the chain one last time. A key is deleted only when the chain says there is nothing there.
    let leftSol = 0;
    let leftUnknown = 0;
    const leftBags = [];
    try {
      const info = await this.rpc.call((conn) => conn.getMultipleAccountsInfo(addresses.map((a) => new PublicKey(a))), { timeoutMs: 5000, budgetMs: 14000, attempts: 4, waitMs: 8000 });
      for (const acc of info || []) if (acc && acc.lamports > 0) leftSol += acc.lamports / LAMPORTS_PER_SOL;
    } catch (_) { leftUnknown = addresses.length; }
    if (c.mint) {
      for (const address of pool) {
        const bag = await this._bagRaw(address, { tries: 2 });
        if (!bag.known) { leftUnknown += 1; leftBags.push(short(address)); } else if (bag.raw > 0n) leftBags.push(short(address));
      }
    }
    const anythingLeft = leftSol > 0.00002 || leftUnknown > 0 || leftBags.length > 0;
    if (anythingLeft && !force) {
      const why = [
        leftBags.length ? `${leftBags.length} wallet${leftBags.length === 1 ? '' : 's'} (${leftBags.join(', ')}) still hold a bag` : '',
        leftSol > 0.00002 ? `${leftSol.toFixed(4)} SOL is still on chain` : '',
        leftUnknown ? `${leftUnknown} address${leftUnknown === 1 ? '' : 'es'} could not be checked` : '',
        recovered.errors.length ? recovered.errors.slice(0, 2).join('; ') : '',
      ].filter(Boolean).join('; ');
      const err = new Error(`Nothing was deleted: ${why}. Every bag is sold and every lamport is brought home first - press Delete again and confirm to remove the keys anyway (what is listed here stays on chain, reachable only with the keys).`);
      err.code = 'DELETE_NEEDS_FORCE';
      err.data = { recovered, leftSol: round9(leftSol), leftBags, leftUnknown };
      throw err;
    }
    this.keys.clear();
    this.roster.forget();
    this.vault.remove();
    this.rows = [];
    this._push();
    if (anythingLeft) {
      this._say(`Keys deleted. ${leftBags.length ? `${leftBags.length} bag${leftBags.length === 1 ? '' : 's'} (${leftBags.join(', ')}) could not be sold and is abandoned on chain` : ''}${leftBags.length && leftSol > 0.00002 ? ', and ' : ''}${leftSol > 0.00002 ? `${leftSol.toFixed(4)} SOL stays on chain` : ''}.`);
    } else if (recovered.sold || recovered.returnedSol || recovered.closed) {
      this._say(`Keys deleted. ${recovered.sold ? `${recovered.sold} bag${recovered.sold === 1 ? '' : 's'} sold, ` : ''}${recovered.closed ? `${recovered.closed} token account${recovered.closed === 1 ? '' : 's'} closed (${recovered.rentSol.toFixed(4)} SOL of rent), ` : ''}${recovered.returnedSol.toFixed(4)} SOL came home first.`);
    }
    return { removed: true, recovered, leftSol: round9(leftSol), leftBags };
  }

  _reserve() {
    const c = this._cfg();
    // What one wallet must keep after a buy: the token account's rent, the fee for the sell that follows, and - when Jito
    // is on - the tip plus its own signature, because the tip is paid by this wallet and not by the main one.
    return round9(TOKEN_RENT_SOL + 2 * (c.priorityFeeSol + BASE_FEE_SOL) + 0.0002 + (c.useJito ? c.jitoTipSol + BASE_FEE_SOL : 0));
  }

  /**
   * The pool rows. The pool is the FIRST `wallets` addresses of the roster and nothing else: a roster can hold ten addresses
   * while the plan carries two, and "the plan says two" has to mean two - otherwise every funded address is eligible and the
   * desk quietly trades ten while the panel priced two (the owner's own question: "10 addresses, then I change it to 2 -
   * does it split across those two and start?").
   */
  _rows(c = this._cfg()) {
    const per = c.budgetSol / c.wallets;
    return this.roster.addresses().map((address, index) => {
      const prev = this.rows.find((r) => r.address === address) || {};
      const active = index < c.wallets;
      return {
        address, short: short(address),
        active,
        budgetSol: active ? per : 0,
        balanceSol: prev.balanceSol ?? null,
        spentSol: prev.spentSol || 0,
        holdingSol: prev.holdingSol || 0,
        sellAt: prev.sellAt || 0,
        // The round: how many buys this wallet has made in it, and how many it needs before its one sell.
        roundBuys: prev.roundBuys || 0,
        roundTarget: prev.roundTarget || 0,
        bumps: prev.bumps || 0,
        fails: prev.fails || 0,
        stuck: Boolean(prev.stuck),
        // When a parking spell ends. A parked wallet is retried, not abandoned (self-healing, and the rescue button is the
        // manual version of the same thing).
        stuckUntil: prev.stuckUntil || 0,
      };
    });
  }

  /**
   * RULE ADDED 2026-11-09 (1.1.3): the money you put in IS the budget. The owner sent 0.02 SOL to the desk address with three
   * wallets and was refused with "each wallet would get 0.0025 SOL" - because the budget was still the old slider value while
   * the pool held four times that. Nobody should have to retype the amount they just deposited: whichever is bigger (the
   * slider or the money actually in the desk address) is what the plan is priced against, and the setting is saved so the
   * panel shows the same number the desk is using.
   */
  _adoptPoolMoney(c) {
    if (c.simulate) return c;
    // The split itself is paid out of the desk address, so the budget is what the pool holds MINUS the two signatures that
    // move it (plus a hair of margin). Taking the whole balance as the budget left the pool a fee short of funding itself.
    const keep = round9(2 * (c.priorityFeeSol + BASE_FEE_SOL) + 0.001);
    const pot = round9((this.vault.balanceSol || 0) - keep);
    if (pot < 0.005 || pot <= c.budgetSol + 1e-9) return c;
    const next = round9(Math.min(MAX_BUDGET_SOL, pot));
    this.store.set({ bumpBudgetSol: next });
    this._say(`The desk address holds ${(this.vault.balanceSol || 0).toFixed(4)} SOL, so the budget is ${next.toFixed(4)} SOL: what you put in is what is planned.`);
    return this._cfg();
  }

  // ───────── funding and returning the money ─────────

  /** Top every wallet up to its share of the budget, in ONE transaction, from the desk address. */
  async fund() {
    if (this.running) throw new Error('Stop the bump desk before funding it.');
    if (!this.unlocked()) throw new Error('Unlock the bump wallets first.');
    await this._refreshBalances();
    const c = this._adoptPoolMoney(this._cfg());
    const per = round9(c.budgetSol / c.wallets);
    const need = round9(this._reserve() + c.maxSol);
    if (per < need) {
      throw new Error(`Each wallet would get ${per.toFixed(4)} SOL, but one trade plus its rent needs ${need.toFixed(4)}. Raise the budget, use fewer wallets or trade smaller.`);
    }
    const plan = planBudget(c);
    // RULE ADDED 2026-11-11 (1.1.6): the money is not split into a pool that cannot finish a round. Funding such a plan is how
    // a run ended two minutes in with bags nobody sold (0.0116 SOL, three wallets, four buys a round).
    if (!plan.roundFits) throw new Error(plan.note || `Each wallet would get ${plan.perWalletSol.toFixed(4)} SOL, which cannot carry a round of ${plan.buysPerRound} buys (${plan.roundNeedSol.toFixed(4)} SOL). Lower "Buys in one round", use fewer wallets or raise the budget.`);
    const wallets = plan.wallets;
    const share = round9(c.budgetSol / wallets);
    const addresses = this.roster.addresses();
    if (!addresses.length) throw new Error('Create the bump wallets first.');
    const info = await this.rpc.call((conn) => conn.getMultipleAccountsInfo(addresses.map((a) => new PublicKey(a))), { timeoutMs: 4000, budgetMs: 9000 });
    const plan2 = [];
    // RULE ADDED 2026-11-08 (1.1.2): only the wallets the PLAN uses are funded. The pool may hold more addresses than the
    // budget can carry (six created, two affordable), and funding every address in the roster asked the desk address for
    // 0.06 SOL to run a 0.02 SOL plan - the owner's own 0.02 was refused for being 0.041 short of a number he never set.
    for (let i = 0; i < Math.min(addresses.length, wallets); i++) {
      const current = (info && info[i] ? info[i].lamports : 0) / LAMPORTS_PER_SOL;
      const delta = round9(share - current);
      // Below a thousandth of a SOL a top-up is not worth its own fee; anything bigger is real money and is moved.
      if (delta > 0.001) plan2.push({ address: addresses[i], lamports: Math.round(delta * LAMPORTS_PER_SOL) });
    }
    if (!plan2.length) return { funded: 0, sol: 0, alreadyFunded: true };
    const total = plan2.reduce((n, p) => n + p.lamports, 0) / LAMPORTS_PER_SOL;
    // The money comes from the desk address - the one address somebody tops up - and from nowhere else.
    const source = this.vault.keypair;
    if (!source) throw new Error('Unlock the desk address first (it is unlocked with the pool).');
    const sourcePub = source.publicKey;
    const balance = await this.rpc.call((conn) => conn.getBalance(sourcePub), { timeoutMs: 4000 });
    const keep = round9(2 * (c.priorityFeeSol + BASE_FEE_SOL) + 0.001);
    const short = round9(total + keep - balance / LAMPORTS_PER_SOL);
    if (short > 0.0005) {
      // RULE ADDED 2026-11-08 (1.1.2): one press. If the desk address is short but the wallet can cover it, the deficit is
      // moved across first (one guarded transfer) and the split follows - the operator asked for a funded pool, not for
      // two buttons and an address to copy.
      const can = this.wallet && this.wallet.isUnlocked()
        ? (await this.rpc.call((conn) => conn.getBalance(this.wallet.keypair.publicKey), { timeoutMs: 4000 })) / LAMPORTS_PER_SOL
        : 0;
      if (can >= short + 0.00002) {
        this._say(`The desk address was ${short.toFixed(4)} SOL short; moving that from your wallet first.`);
        await this.depositFromMain(short);
      } else {
        throw new Error(`The desk address holds ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL and this plan needs ${(total + keep).toFixed(4)}. Send ${short.toFixed(4)} SOL more to ${this.vault.address()} (or put it in your wallet and press Fund again).`);
      }
    }
    const known = new Set(addresses);
    const tx = new Transaction();
    for (const p of plan2) {
      if (!known.has(p.address)) throw new Error('A funding target is not one of the bump wallets.');   // cannot happen; checked anyway
      tx.add(SystemProgram.transfer({ fromPubkey: sourcePub, toPubkey: new PublicKey(p.address), lamports: p.lamports }));
    }
    // The guard runs on the very instructions that will be signed: every transfer leaves the desk address and lands in a
    // wallet this desk owns, for the amount the plan says. A wrong instruction here is a transfer to a stranger.
    guardFunding(tx, sourcePub, new Map(plan2.map((p) => [p.address, p.lamports])));
    const { blockhash } = await this.rpc.call((conn) => conn.getLatestBlockhash(), { timeoutMs: 4000 });
    tx.feePayer = sourcePub;
    tx.recentBlockhash = blockhash;
    tx.sign(source);
    const sig = await this.rpc.broadcast(tx.serialize());
    await this._confirm(sig);
    await this._refreshBalances();
    this._say(`Split ${total.toFixed(4)} SOL from the desk address across ${plan2.length} wallet${plan2.length === 1 ? '' : 's'}.`);
    // RULE ADDED 2026-11-08 (1.1.2): addresses outside the plan are named, never silently ignored. A roster built for ten
    // wallets and a plan of two leaves eight holding money that will not trade - the owner asked exactly this question, and
    // the answer has to be on the panel, not in his head.
    const idleSol = round9(addresses.slice(wallets).reduce((n, a, i) => {
      const idx = wallets + i;
      const lamports = info && info[idx] ? info[idx].lamports : 0;
      return n + lamports / LAMPORTS_PER_SOL;
    }, 0));
    if (idleSol > 0.001) {
      this._say(`${addresses.length - wallets} wallet${addresses.length - wallets === 1 ? '' : 's'} outside this plan hold ${idleSol.toFixed(4)} SOL and will not trade. Raise the pool size, or press "Withdraw everything" to bring it back.`);
    }
    return { funded: plan2.length, sol: round9(total), signature: sig, idleSol };
  }

  /**
   * The rescue button on one wallet row. It does the three things an operator needs when something looks jammed, on ONE
   * address, without touching the rest of the pool:
   *   - sells whatever the chain says this wallet still holds (not what the book remembers),
   *   - closes the emptied token accounts so their rent comes back,
   *   - unparks the wallet so the desk may use it again.
   * Safe while a run is going: it trades the same way the run does (door, then Jupiter) and never signs for a wallet it does
   * not own.
   */
  async rescueWallet(address) {
    if (!this.unlocked()) throw new Error('Unlock the bump wallets first.');
    const key = String(address || '');
    if (!this.roster.addresses().includes(key)) throw new Error('That address is not one of the bump wallets.');
    // The LIVE row, not a copy: the rescue has to leave the book changed (bag gone, wallet unparked) or the run keeps
    // believing what the rescue just proved wrong.
    if (!this.rows.length) this.rows = this._rows(this._cfg());
    const row = this.rows.find((r) => r.address === key);
    const c = this._cfg();
    const out = { address: key, short: row.short, attempted: false, sold: false, unknown: false, closed: 0, rentSol: 0, unparked: false, errors: [], topUpSol: 0 };
    // 0. A wallet that cannot pay a fee cannot sell anything. The sweep used to take every lamport and a wallet swept to zero
    // is not merely empty - Solana destroys the account - so the rescue puts the fee float back from the main wallet first
    // (the operator's own money, spent to get a bag out and returned by the next withdrawal). Simulated on the owner's own
    // bag: the route that carries a sell out of a nearly empty wallet asks for 1 488 440 lamports of account rent up front,
    // so "nothing left but the fee" is not enough - the float has to cover the wrapped-SOL account as well.
    try { out.topUpSol = await this._ensureFeeFloat(key); } catch (e) { out.errors.push('the wallet cannot pay a fee: ' + e.message); }
    // 1. Whatever the CHAIN says it holds is sold, whether or not the run booked it. The rescue never uses a bundle: getting
    // out is not a place to gamble on an auction (a bundle that does not land is exactly the jam this button exists for),
    // and a sell that comes back unconfirmed is asked about again before the button gives up - a rescue is the one place
    // where waiting is better than failing.
    // RULE ADDED 2026-11-10 (1.1.4): a read that FAILED is not a wallet that holds nothing. That single `.catch(() => 0n)` is
    // what told the owner "nothing held" about 39 018 746 966 tokens while every node in the pool was answering 429.
    if (c.mint) {
      let bag = await this._bagRaw(key);
      if (!bag.known) {
        out.unknown = true;
        out.errors.push(`the chain could not be asked what it holds (${String((bag.error && bag.error.message) || 'no answer').slice(0, 80)})`);
      }
      out.attempted = bag.known && bag.raw > 0n;
      for (let attempt = 0; attempt < 2 && !out.sold && bag.known && bag.raw > 0n; attempt++) {
        try {
          row.holdingSol = row.holdingSol || c.minSol;
          await this._sellBagOut(row);
          out.sold = true;
          break;
        } catch (e) {
          out.errors.push(String(e.message).slice(0, 140));
        }
        // The chain decides, not the confirmation: a sell that went unanswered but left the wallet empty DID sell.
        bag = await this._bagRaw(key, { tries: 2 });
        if (bag.known && bag.raw === 0n) { out.sold = true; break; }
        if (!bag.known) out.unknown = true;
        if (attempt === 0) await this.sleep(6000);
      }
      if (!bag.known) out.unknown = true;
    }
    // 2. An emptied token account holds about 0.00204 SOL of rent: closing it is money back.
    try {
      const kp = this.keys.get(key);
      const scan = await reclaim.scanTokenAccounts((fn, o) => this.rpc.call(fn, o), key);
      if (scan.empty.length) {
        const sent = await reclaim.closeEmpty({ accounts: scan.empty, sendChunk: reclaim.makeSender((fn, o) => this.rpc.call(fn, o), kp) });
        out.closed = sent.closed || scan.empty.length;
        out.rentSol = round9(sent.sol || scan.emptyRentSol || 0);
      }
    } catch (e) {
      out.errors.push('rent: ' + e.message);
    }
    // 3. The book follows: a rescued wallet holds nothing and is not parked.
    if (out.sold) { row.holdingSol = 0; row.sellAt = 0; row.roundBuys = 0; row.roundTarget = 0; }
    if (row.stuck) { row.stuck = false; row.stuckUntil = 0; out.unparked = true; }
    row.fails = 0;
    await this._refreshBalances();
    // The sentence says what actually happened: a bag sold, a bag still there, nothing was held, or the chain did not answer.
    const held = out.sold ? 'bag sold'
      : out.unknown ? 'the chain could not be asked what it holds, so nothing was sold'
        : (out.attempted ? 'the bag is still there, nothing was sold' : 'nothing held');
    const why = [...new Set(out.errors)].slice(0, 2).join('; ');
    this._say(`Rescued ${row.short}: ${held}${out.topUpSol ? `, ${out.topUpSol.toFixed(4)} SOL put back for its fee` : ''}${out.closed ? `, ${out.closed} empty token account${out.closed === 1 ? '' : 's'} closed (${out.rentSol.toFixed(4)} SOL of rent back)` : ''}${out.unparked ? ', wallet unparked' : ''}${why ? ` - ${why}` : ''}.`);
    this._push();
    return out;
  }

  /**
   * Take the money back: sell whatever is still held (optional), close the emptied token accounts so their rent comes
   * back, then move every lamport that is left to the main wallet. That is the "withdraw the unused budget" button.
   */
  async sweep({ includeTokens = true, toMain = true } = {}) {
    if (this.running) throw new Error('Stop the bump desk first: it is still trading.');
    if (!this.unlocked()) throw new Error('Unlock the bump wallets first.');
    const c = this._cfg();
    const result = { sold: 0, closed: 0, rentSol: 0, returnedSol: 0, toWalletSol: 0, signatures: [], stuck: [] };
    const rows = this._rows(c);
    if (includeTokens && c.mint) {
      for (const row of rows) {
        // RULE ADDED 2026-11-08 (1.1.2): the chain is asked, not the book. A buy whose confirmation timed out may have landed
        // later, and then the wallet holds tokens the run never booked - selling only what is remembered would leave them
        // there for ever ("withdrawn" while a bag sits in a pool wallet). Whatever is in the wallet is sold.
        if (!row.holdingSol) {
          // RULE ADDED 2026-11-10 (1.1.4): a read that FAILED is not a wallet that holds nothing. The sweep used to treat an
          // unreachable node as "no bag", which is how a withdrawal reported success while a bag sat in a pool wallet.
          const bag = await this._bagRaw(row.address, { tries: 2 });
          if (!bag.known) { result.stuck.push({ address: row.short, error: 'the chain could not be asked what it holds - press Withdraw again' }); continue; }
          if (bag.raw > 0n) {
            row.holdingSol = c.minSol;
            this._say(`${row.short} holds tokens this run never booked (an earlier transaction landed late): they are sold too.`);
          }
        }
        if (!row.holdingSol) continue;
        // A bag can only be sold by a wallet that can pay a fee: if the pool is dry the smallest float is put back first.
        await this._ensureFeeFloat(row.address).catch((e) => this._say(`${row.short} cannot pay a fee for its sell: ${e.message}`));
        try { await this._swap(row, 'sell', '100%', { noJito: true }); result.sold++; row.holdingSol = 0; } catch (e) {
          if (await this._sellSettled(row)) { result.sold++; row.holdingSol = 0; } else result.stuck.push({ address: row.short, error: e.message });
        }
      }
    }
    // Empty token accounts still hold about 0.00204 SOL of rent each. Closing them is worth more than one bump.
    for (const address of this.roster.addresses()) {
      try {
        const kp = this.keys.get(address);
        const scan = await reclaim.scanTokenAccounts((fn, o) => this.rpc.call(fn, o), address);
        if (!scan.empty.length) continue;
        const sent = await reclaim.closeEmpty({ accounts: scan.empty, sendChunk: reclaim.makeSender((fn, o) => this.rpc.call(fn, o), kp) });
        result.closed += sent.closed || scan.empty.length;
        result.rentSol = round9(result.rentSol + (sent.sol || scan.emptyRentSol));
      } catch (_) { /* a wallet that cannot close its accounts is not a reason to leave the rest of the money behind */ }
    }
    const addresses = this.roster.addresses();
    // RULE ADDED 2026-11-09 (1.1.3): a wallet that still HOLDS TOKENS keeps its rent-exempt floor. The sweep used to take
    // every lamport, which does not merely empty the wallet - it destroys the account, and a destroyed wallet cannot sign the
    // sell that would get its bag out. The owner's own HoQr…2wJb ended up exactly there: 39 018 tokens, an account that no
    // longer exists, and a Rescue button that could not pay a fee. Only a wallet whose sale actually went through is emptied.
    const stillHolding = new Set(rows.filter((r) => (r.holdingSol || 0) > 0).map((r) => r.address));
    const keepFloor = Math.round(ACCOUNT_RENT_SOL * LAMPORTS_PER_SOL);
    // Everything goes back to the ONE address first - the desk address - and only then, if asked, home to the wallet.
    // Two steps, because a customer who moved money to the desk address expects to find it there after a withdrawal.
    const vaultPub = this.vault.keypair ? this.vault.keypair.publicKey : (this.vault.address() ? new PublicKey(this.vault.address()) : null);
    if (!vaultPub) throw new Error('The desk address is missing: unlock the pool before withdrawing.');
    const info = await this.rpc.call((conn) => conn.getMultipleAccountsInfo(addresses.map((a) => new PublicKey(a))), { timeoutMs: 4000, budgetMs: 9000 });
    const txCount = Math.ceil(addresses.length / SWEEP_CHUNK);
    const feesNeeded = txCount * (SWEEP_CHUNK + 1) * BASE_FEE_SOL + 0.001;
    const vaultBalance = await this.rpc.call((conn) => conn.getBalance(vaultPub), { timeoutMs: 4000 }).catch(() => null);
    if (vaultBalance != null && vaultBalance / LAMPORTS_PER_SOL < feesNeeded) {
      this._say(`The return needs about ${feesNeeded.toFixed(4)} SOL in the desk address for its own fees; it holds ${(vaultBalance / LAMPORTS_PER_SOL).toFixed(4)}. Nothing was sent.`);
    }
    for (let i = 0; i < addresses.length; i += SWEEP_CHUNK) {
      const chunk = addresses.slice(i, i + SWEEP_CHUNK);
      const tx = new Transaction();
      // RULE FIXED 2026-11-08 (1.1.2): only the wallets that actually put a transfer in this transaction sign it. Signing
      // with the whole chunk threw `unknown signer` the moment the pool held more addresses than the plan funds (six
      // created, two funded): the empty ones have no instruction, so they are not signers, and a signer the transaction
      // does not need is an error - the owner's own withdrawal bounced on it.
      const contributors = [];
      let moved = 0;
      for (const address of chunk) {
        const idx = addresses.indexOf(address);
        const lamports = (info && info[idx] ? info[idx].lamports : 0);
        // A wallet that still holds a bag keeps the floor so its account survives to sign the sell (see the rule above).
        const send = lamports - (stillHolding.has(address) ? keepFloor : 0);
        // A wallet holding less than a thousand lamports is not worth a signature: the transfer itself would fail.
        if (send <= 2000) continue;
        tx.add(SystemProgram.transfer({ fromPubkey: new PublicKey(address), toPubkey: vaultPub, lamports: send }));
        contributors.push(address);
        moved += send;
      }
      if (!tx.instructions.length) continue;
      guardSweep(tx, vaultPub, contributors);
      const { blockhash } = await this.rpc.call((conn) => conn.getLatestBlockhash(), { timeoutMs: 4000 });
      // The desk address pays the fee and signs alongside the pool wallets: a sweep costs one fee, not one per wallet.
      tx.feePayer = vaultPub;
      tx.recentBlockhash = blockhash;
      const missing = contributors.filter((a) => !this.keys.get(a));
      if (missing.length) throw new Error(`${missing.length} pool wallet${missing.length === 1 ? '' : 's'} still hold SOL but their key is not unlocked. Unlock the pool and press "Withdraw everything" again.`);
      const signers = [this.vault.keypair, ...contributors.map((a) => this.keys.get(a))].filter(Boolean);
      tx.sign(...signers);
      const sig = await this.rpc.broadcast(tx.serialize());
      try {
        await this._confirm(sig);
      } catch (e) {
        // A chunk that did not land leaves its money in the wallets, which is exactly where the operator expects it when
        // the panel says the return failed.
        result.stuck.push({ address: `${chunk.length} wallet${chunk.length === 1 ? '' : 's'}`, error: e.message, signature: sig });
        continue;
      }
      result.signatures.push(sig);
      result.returnedSol = round9(result.returnedSol + moved / LAMPORTS_PER_SOL);
    }
    await this._refreshBalances();
    // And then home, if asked: one more transfer, from the desk address to the wallet that pays for everything else.
    if (toMain && this.wallet && this.wallet.isUnlocked() && this.vault.keypair) {
      const left = (await this.rpc.call((conn) => conn.getBalance(vaultPub), { timeoutMs: 4000 })) / LAMPORTS_PER_SOL;
      // What has to stay behind: the rent-exempt floor plus one signature for the transfer itself. Sending more than
      // this is rejected by the chain with InsufficientFundsForRent, and the desk address keeps the floor for its next
      // withdrawal - it is still the customer's money, never a fee anybody keeps.
      const floor = round9(ACCOUNT_RENT_SOL + BASE_FEE_SOL + 0.00001);
      const send = round9(left - floor);
      if (send > 0.001) {
        const main = this.wallet.keypair.publicKey;
        const lamports = Math.round(send * LAMPORTS_PER_SOL);
        const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: vaultPub, toPubkey: main, lamports }));
        guardDeposit(tx, vaultPub, main, lamports);
        const { blockhash } = await this.rpc.call((conn) => conn.getLatestBlockhash(), { timeoutMs: 4000 });
        tx.feePayer = vaultPub;
        tx.recentBlockhash = blockhash;
        tx.sign(this.vault.keypair);
        const sig = await this.rpc.broadcast(tx.serialize());
        // It counts as returned only once the chain says so. A rejected transfer leaves the money in the desk address
        // and comes back as an error the operator can read, instead of a cheerful line about SOL he never received.
        try {
          await this._confirm(sig);
        } catch (e) {
          result.stuck.push({ address: 'desk', error: e.message, signature: sig });
          result.toWalletSol = 0;
          result.dustSol = round9(left);
          this.stats.errors++;
          this._say(`The desk address could not send ${send.toFixed(4)} SOL home: ${e.message}`);
          return this._finishSweep(result);
        }
        result.signatures.push(sig);
        result.toWalletSol = send;
        result.dustSol = round9(left - send);
      } else if (left > 0) {
        // Under the floor there is nothing to send: say how much stays, so "I withdrew and the number did not change" has
        // an answer on the panel instead of in an explorer.
        result.dustSol = round9(left);
      }
    }
    return this._finishSweep(result);
  }

  /** One place for the sentence the operator reads, so it can never claim more than the chain confirmed. */
  async _finishSweep(result) {
    await this._refreshBalances();
    const parts = [`Returned ${result.returnedSol.toFixed(4)} SOL to the desk address`];
    if (result.toWalletSol) parts.push(`${result.toWalletSol.toFixed(4)} SOL home to your wallet`);
    if (result.closed) parts.push(`closed ${result.closed} empty token account${result.closed === 1 ? '' : 's'}`);
    let line = parts.join(', ') + '.';
    if (result.dustSol) line += ` ${result.dustSol.toFixed(4)} SOL stays in the desk address: a Solana wallet cannot be emptied below its rent-free floor, and that floor is still yours - the next run spends it.`;
    if (result.stuck.length) line += ` ${result.stuck.length} transfer${result.stuck.length === 1 ? '' : 's'} did not go through: ${result.stuck.map((s) => s.error).join(' ')}`;
    this._say(line);
    return result;
  }

  // ───────── the run ─────────

  async start() {
    if (this.running) return { ok: true, already: true };
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(this._cfg().mint)) throw new Error('Paste the token address (CA) first.');
    if (!this.unlocked()) throw new Error('Unlock the bump wallets first.');
    // RULE ADDED 2026-11-09 (1.1.3): the money in the desk address counts before the plan is judged - Start used to price a
    // plan against an old slider value while the pool held several times that, and refused money that was already there.
    await this._refreshBalances();
    const c = this._adoptPoolMoney(this._cfg());
    if (!c.simulate && (!this.wallet || !this.wallet.isUnlocked())) throw new Error('Unlock your wallet first: the pool is paid from it.');
    // RULE ADDED 2026-11-08 (1.1.2): a plan that the money cannot pay for is refused here, in one sentence with the
    // numbers that do fit. Starting a run that dies of fees ten minutes in is the failure this replaces.
    const plan = planBudget(c);
    if (!c.simulate && !plan.fits) throw new Error(plan.note || 'The budget does not cover this run. Lower the pace, shorten the run or add SOL.');
    const rows = this._rows(c);
    if (!c.simulate) {
      const funded = rows.filter((r) => (r.balanceSol || 0) >= c.maxSol + this._reserve());
      if (!funded.length) throw new Error('No bump wallet holds a trade. Press "Fund the pool" first.');
    }
    // No RPC call here on purpose: Start used to fetch a blockhash nobody used, so a moment of RPC trouble could refuse a
    // start with no money involved.
    this.rows = rows;
    this.running = true;
    this.paused = false;
    // A new run gives the pump door and the block engine one more chance: their pricing and their auction can change.
    this._doorBroken.clear();
    this._jitoBroken = false;
    this._jitoMisses = 0;
    this._bundledSig = null;
    this.stats = this._emptyStats();
    this.stats.startedAt = this.now();
    this.startedAt = this.now();
    this.endsAt = c.minutes > 0 ? this.startedAt + c.minutes * 60000 : 0;
    this.nextAt = this.startedAt;
    this._say(c.simulate ? 'Dry run started - nothing is sent, the cost model is being applied.' : `Bump desk started on ${short(c.mint)} with ${rows.length} wallets.`);
    this._schedule(0);
    this._push();
    return { ok: true, wallets: rows.length, endsAt: this.endsAt };
  }

  pause() {
    if (!this.running || this.paused) return { ok: true };
    this.paused = true;
    this._pausedAt = this.now();
    this._clearTimer();
    this._say('Paused. The run time is extended by however long you leave it paused.');
    this._push();
    return { ok: true };
  }

  resume() {
    if (!this.running || !this.paused) return { ok: true };
    const waited = this.now() - this._pausedAt;
    this.paused = false;
    this._pausedAt = 0;
    // A pause must not eat the run: the clock stops with the desk, exactly as it does for a customer who pauses a boost.
    if (this.endsAt) this.endsAt += waited;
    for (const row of this.rows) if (row.sellAt) row.sellAt += waited;
    this.nextAt = this.now();
    this._say('Running again.');
    this._schedule(0);
    this._push();
    return { ok: true };
  }

  /**
   * Stop the desk. Bags are sold back by default: a bump run that stops with wallets full of a token has not finished.
   *
   * `home: true` is the operator's Stop and the run's own end: after the bags are sold the whole desk is swept home to the
   * main wallet (every wallet's bag, every rent closed, every lamport back). The owner's rule: "ZAWSZE jak stopuje po swoim
   * czasie ma z każdego walleta wszystko sprzedać i kasa ma być na głównym wallecie".
   */
  async stop({ sellBack = null, home = false } = {}) {
    const c = this._cfg();
    const want = sellBack == null ? c.sellBack : Boolean(sellBack);
    if (!this.running) return { ok: true, already: true };
    this.running = false;
    this.paused = false;
    this._clearTimer();
    // RULE ADDED 2026-11-09 (1.1.2): Stop waits for the trade that is already in the air. Without this, a swap that was sent
    // a millisecond before the press finished after it - a buy on a desk the operator had just stopped, and a sell-back that
    // then ran into it. The wait is bounded and real (not the injected clock), and the sell-back follows it.
    if (this._busy) {
      this._say('Waiting for the trade in flight before stopping…');
      for (let waited = 0; this._busy && waited < 100; waited++) await new Promise((r) => setTimeout(r, 100));
    }
    const held = this.rows.filter((r) => r.holdingSol);
    let sold = 0;
    if (want && !c.simulate) {
      for (const row of held) {
        // RULE CHANGED 2026-11-11 (1.1.6): the sell-back walks the same ladder a rescue does (door, legacy Jupiter, current
        // Jupiter) and floats the fee first. The bare `_swap` here was what left a bag behind on Stop with the sentence
        // "Could not sell back … Jupiter has no route", about a wallet that merely could not pay for its own swap.
        try { await this._sellBagOut(row); row.holdingSol = 0; row.sellAt = 0; sold++; } catch (e) {
          if (await this._sellSettled(row)) { row.holdingSol = 0; row.sellAt = 0; sold++; } else this._say(`Could not sell back ${row.short}: ${e.message}`);
        }
      }
    }
    this.stats.endedAt = this.now();
    this._say(`Stopped. ${this.stats.bumps} bumps, ${sold} bag${sold === 1 ? '' : 's'} sold back${want ? '' : ', bags left in the wallets'}.`);
    // RULE ADDED 2026-11-11 (1.1.6): the operator's Stop is the end of the desk, so the money comes home in the same press:
    // every wallet's bag sold (the chain decides what each holds), every emptied token account closed so its rent comes back,
    // and every lamport sent to the main wallet. `sellBack` off still means "leave my bags where they are" and nothing moves.
    let wound = false;
    if (home && want && !c.simulate && this.unlocked()) {
      try {
        await this.sweep({ includeTokens: true, toMain: true });
        wound = true;
      } catch (e) {
        this._say(`The money could not be brought home (${e.message}). Nothing is lost: press "Withdraw everything" and it will.`);
      }
    }
    this._push();
    this.emit('done', this.state());
    return { ok: true, bumps: this.stats.bumps, soldBack: sold, leftHolding: this.rows.filter((r) => r.holdingSol).length, wound };
  }

  /**
   * The run is over by itself (its clock, or the money). RULE CHANGED 2026-11-11 (1.1.6): it ends with the full wind-down, not
   * with "stop and leave the bags for later" - the owner's own words: "ZAWSZE jak stopuje po swoim czasie ma z każdego walleta
   * wszystko sprzedać i kasa ma być na głównym wallecie". That is `stop({ home: true })`: sell, close the rent, sweep home.
   */
  async _finish(reason) {
    if (!this.running) return { ok: true, already: true };
    const c = this._cfg();
    this._say(`Run finished: ${reason}.`);
    return this.stop({ sellBack: c.sellBack, home: true });
  }

  _clearTimer() {
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
  }

  _schedule(ms) {
    this._clearTimer();
    if (!this.running) return;
    const wait = Math.max(5, Math.min(ms, 60000));
    this._timer = setTimeout(() => { this._tick(); }, wait);
    if (this._timer && typeof this._timer.unref === 'function') this._timer.unref();
  }

  _baseInterval() {
    const c = this._cfg();
    return 60000 / c.perMinute;
  }

  /** A rate is a target, not a metronome: a wall of transactions exactly 33 ms apart is the signature of a bot. */
  _jitter(ms) {
    return Math.max(15, ms * (1 + (this.rand() * 0.4 - 0.2)));
  }

  async _tick() {
    if (!this.running || this.paused) return;
    if (this._busy) { this._schedule(50); return; }
    const now = this.now();
    if (this.endsAt && now >= this.endsAt) { await this._finish('the configured run time is up'); return; }
    if (now < this.nextAt - 5) { this._schedule(this.nextAt - now); return; }
    // RULE ADDED 2026-11-09 (1.1.2): the janitor. Once a minute the CHAIN is asked what each wallet in the plan really holds;
    // a bag the book never saw (a buy whose confirmation timed out and landed later) is adopted and sold by this run instead
    // of waiting for the withdrawal. That is the difference between "it self-heals" and "the operator finds it later".
    const c = this._cfg();
    if (!c.simulate && c.mint && (!this._janitorAt || now - this._janitorAt > 60000)) {
      this._janitorAt = now;
      for (const row of this.rows) {
        if (row.active === false || row.holdingSol || row.stuck) continue;
        const raw = await this._tokenBalanceRaw(c.mint, row.address).catch(() => 0n);
        if (raw > 0n) {
          row.holdingSol = c.minSol;
          row.roundBuys = row.roundTarget || 1;
          row.sellAt = now + 1000;
          this._say(`${row.short} holds tokens the book never saw (a trade landed late): the run sells them now instead of leaving them for the withdrawal.`);
        }
      }
    }
    const job = this._choose(now);
    if (!job) {
      // Nothing left to do: every wallet is either out of budget or holding a bag with time still to run.
      const waiting = this.rows.some((r) => r.holdingSol && r.sellAt);
      if (!waiting) {
        // The reason names what the money actually ran out of: a round is the unit of work, so "spent its budget" was only
        // half the story when the desk stopped with bags in three wallets (the owner's own two-minute run).
        const round = this._cfg().buysPerRound;
        await this._finish(`no wallet can pay for another ${round === 1 ? 'trade' : `round of ${round} buys`}`);
        return;
      }
      this._schedule(Math.min(2000, Math.max(100, ...this.rows.filter((r) => r.sellAt).map((r) => r.sellAt - now))));
      return;
    }
    this._busy = true;
    // The next slot is counted from the PREVIOUS slot, not from now: a bump that took 300 ms must not silently stretch
    // the pace, or a twenty-a-minute run drifts to seventeen and nobody can tell why. A stall longer than one whole
    // interval drops the missed slots instead of firing them in a burst.
    const base = this._baseInterval();
    // RULE FIXED 2026-11-09 (1.1.2): after a stall (a 15 s confirmation, a refused route) the next slot is counted from NOW,
    // never from the slot that was missed. The old test was `next < now - base`, which allowed a tick up to a whole interval
    // in the past - and that is how three buys landed one second apart right after a slow bundle: a burst is the one pattern
    // an onlooker reads as a bot, so a missed slot is dropped, not caught up.
    const next = (this.nextAt || now) + this._jitter(base);
    this.nextAt = next < now ? now + this._jitter(base) : next;
    try {
      await this._run(job);
    } catch (e) {
      // A refused bump is a line, not a crash: the desk keeps its place in the schedule and counts it.
      this.stats.errors++;
      this._say(`${job.kind === 'buy' ? 'Buy' : 'Sell'} refused on ${job.row.short}: ${e.message}`);
    } finally {
      this._busy = false;
      // RULE ADDED 2026-11-09 (1.1.2): the balances on the panel are the chain's, not a snapshot from the start of the run.
      // They used to be read once at Start: after four buys the panel still showed the opening balance (measured live: the
      // panel said 0.008 while the chain held 0.0042), and the "can this wallet pay" gate was reading that same stale number.
      if (!this._balancesAt || this.now() - this._balancesAt > 10000) await this._refreshBalances();
      if (this.running && !this.paused) this._schedule(Math.max(5, this.nextAt - this.now()));
      this._push();
    }
  }

  /**
   * Which bump comes next. A wallet works in ROUNDS: it buys `bumpBuysPerRound` times (or a random count up to it), and then
   * sells the whole bag once and starts again. So the scheduler is simple and honest:
   *   - a bag whose sell is due goes first (a bag that cannot be sold is money in a coin nobody is watching);
   *   - a wallet in the middle of a round may buy again, up to its target;
   *   - a wallet that has just sold starts a new round.
   * The buy share is not a setting any more: it is what the round produces, `buys / (buys + 1)`, which is the only way the
   * tape can be both right and reproducible.
   */
  _choose(now) {
    const c = this._cfg();
    const rows = this.rows;
    // RULE ADDED 2026-11-11 (1.1.6): A ROUND THE MONEY CANNOT FINISH IS CLOSED, NOT STARVED. The owner's own run on a
    // 0.0116 SOL pool with four buys a round did 8 buys and ZERO sells in two minutes, then said "every wallet spent its
    // budget" - because a wallet that can pay for one trade but not for the rest of its round spends its whole balance on
    // bags it can never sell. So a wallet mid-round that cannot afford the buys it has left sells what it holds NOW and
    // starts again; the tape keeps running and no bag is ever abandoned.
    if (!c.simulate) {
      for (const r of rows) {
        if (!r.holdingSol || r.sellAt) continue;
        // RULE ADDED 2026-11-11 (1.1.6): A BAG ALWAYS HAS A SELL TIME. A wallet parked for lack of SOL (or parked by the guard,
        // or adopted late) kept `sellAt = 0` and was then invisible to the scheduler for the rest of the run - the owner's own
        // "8v9m…5nGV ... 3/4 buys · parked · bag" sitting there while the other two traded. A bag is sold when its round is
        // complete, when the wallet cannot pay for the buys it has left, or when it is parked - and the fee float in the sell
        // branch is what lets a thin wallet pay for that sell. A wallet that can still finish its round waits, as a round does.
        const target = r.roundTarget || c.buysPerRound;
        const left = Math.max(0, target - (r.roundBuys || 0));
        const parked = r.stuck && !(r.stuckUntil && now >= r.stuckUntil);
        const canFinish = !parked && (r.balanceSol || 0) >= this._reserve() + Math.max(1, left) * (c.maxSol + c.priorityFeeSol + BASE_FEE_SOL);
        if (!left || !canFinish) r.sellAt = now;
      }
    }
    const due = rows.filter((r) => r.holdingSol && r.sellAt && r.sellAt <= now).sort((a, b) => a.sellAt - b.sellAt)[0];
    if (due) return { kind: 'sell', row: due };
    const canBuy = rows.filter((r) => {
      if (r.stuck && !(r.stuckUntil && this.now() >= r.stuckUntil)) return false;
      // Only the wallets the plan carries trade. An address that was funded by an earlier, larger pool is not in this plan:
      // it waits for "Withdraw everything", and the panel names it as idle.
      if (r.active === false) return false;
      // Mid-round: it may buy again, but never past the count this round drew.
      if (r.roundBuys > 0) {
        if (r.roundBuys >= (r.roundTarget || c.buysPerRound)) return false;
      } else if (r.holdingSol) {
        return false;                                    // a bag with no round open: waiting for its sell
      }
      if (c.simulate) return true;
      // RULE FIXED 2026-11-08 (1.1.2): the LIVE balance is the truth, minus one trade and its reserve. This used to subtract
      // `spentSol`, which only ever grew - the SOL a buy spends comes back when the bag is sold, so the subtraction made a
      // wallet look spent after four bumps and ended the owner's run at twelve ("every wallet spent its budget") with 0.0198
      // SOL still sitting in the pool. `spentSol` is volume pushed, nothing else.
      // RULE ADDED 2026-11-11 (1.1.6): and the wallet has to be able to pay for the REST OF ITS ROUND, not just for one
      // trade. Opening a round a wallet cannot finish is how the desk filled three wallets with bags and never sold one.
      const left = Math.max(1, (r.roundBuys ? (r.roundTarget || c.buysPerRound) : c.buysPerRound) - r.roundBuys);
      const needAll = this._reserve() + left * (c.maxSol + c.priorityFeeSol + BASE_FEE_SOL);
      return (r.balanceSol || 0) >= needAll;
    });
    if (!canBuy.length) return null;
    // A shuffled bag, not a round robin: a strict rotation is the one pattern a spectator can see.
    const pick = canBuy[Math.floor(this.rand() * canBuy.length) % canBuy.length];
    return { kind: 'buy', row: pick };
  }

  async _run(job) {
    const c = this._cfg();
    if (job.kind === 'buy') {
      // A stop or a pause that lands between the schedule and the trade must win: a stopped desk does not BUY. Selling is
      // always allowed - that is how the money comes back.
      if (!this.running && !c.simulate) return;
      // A new round draws its own count when the operator asked for a random one: every round of the run is a different
      // length, which is what a tape looks like when nobody is counting.
      if (job.row.roundBuys === 0) {
        job.row.roundTarget = c.buysRandom
          ? 1 + Math.floor(this.rand() * c.buysPerRound)
          : c.buysPerRound;
      }
      // Uniform between the two ends, to the lamport: no two transactions carry the same number.
      const amount = round9(c.minSol + this.rand() * Math.max(0, c.maxSol - c.minSol));
      // A dry run has no balance to read: it is priced against the budget the run was configured with.
      const budget = c.simulate ? c.budgetSol / c.wallets : (job.row.balanceSol ?? c.budgetSol / c.wallets);
      // RULE FIXED 2026-11-08 (1.1.2): the gate is the live balance, not the sum of everything this wallet ever bought - the
      // ticket comes back on the sell, so only the fees are consumed.
      const spendLeft = budget - this._reserve();
      // RULE FIXED 2026-11-11 (1.1.6): the park carries an EXPIRY. `stuck = true` without `stuckUntil` was a permanent park -
      // the wallet never traded again and its bag never sold (the owner's own "8v9m…5nGV ... parked" while the others traded
      // fine). Two minutes, then it is given another chance, exactly like a park after a refusal.
      if (spendLeft < amount) {
        job.row.stuck = true;
        job.row.stuckUntil = this.now() + PARK_MS;
        this._say(`${job.row.short} has no SOL left for another trade (${budget.toFixed(4)} SOL, a trade plus its rent needs ${(amount + this._reserve()).toFixed(4)}); it sells what it holds and rests until ${new Date(job.row.stuckUntil).toISOString().slice(11, 19)}Z.`);
        return;
      }
      try {
        await this._swap(job.row, 'buy', amount);
      } catch (e) {
        // RULE ADDED 2026-11-08 (1.1.2): an UNKNOWN outcome is not the same as a refusal. If the transaction could not be
        // confirmed but the wallet now holds tokens, it landed late - the bag is booked and the round carries on instead of
        // the desk losing track of tokens it paid for.
        if (c.simulate || !/not on chain|outcome unknown/i.test(e.message)) throw e;
        const landedRaw = await this._tokenBalanceRaw(c.mint, job.row.address).catch(() => 0n);
        if (landedRaw <= 0n) throw e;
        this._say(`${job.row.short}: the buy was not confirmed in time but landed - the bag is booked and the round carries on.`);
      }
      job.row.spentSol = round9(job.row.spentSol + amount);
      job.row.holdingSol = round9((job.row.holdingSol || 0) + amount);
      job.row.roundBuys = (job.row.roundBuys || 0) + 1;
      job.row.bumps++;
      job.row.fails = 0;
      // The hold band starts when the ROUND is complete, not after every buy: the bags of one round are sold together, once.
      if (job.row.roundBuys >= job.row.roundTarget) {
        const hold = c.holdMinSec + this.rand() * Math.max(0, c.holdMaxSec - c.holdMinSec);
        job.row.sellAt = this.now() + Math.round(hold * 1000);
      }
      this.stats.bumps++;
      this.stats.buys++;
      this.stats.buysSol = round9(this.stats.buysSol + amount);
      this.stats.spentSol = round9(this.stats.spentSol + amount);
      this.stats.volumeSol = round9(this.stats.volumeSol + amount);
      this.stats.feesSol = round9(this.stats.feesSol + amount * (SIDE_FEE_PCT / 100) + c.priorityFeeSol + BASE_FEE_SOL);
      this._say(`Buy ${amount.toFixed(4)} SOL of ${short(c.mint)} from ${job.row.short}${c.simulate ? ' (dry run)' : ''}.`);
    } else {
      const amount = job.row.holdingSol || c.minSol;
      // RULE ADDED 2026-11-11 (1.1.6): the run's own sell floats the wallet's fee first, exactly as the Stop ladder does. A
      // wallet whose balance sits between "has a bag" and "can pay for a sell" is how a bag stayed parked in the owner's own
      // pool (8v9m…5nGV: 0.0033 SOL against the 0.0034 a sell needs). The float comes from the main wallet and the withdrawal
      // takes it back, so it costs the fee only - and it is only paid when the wallet really is short.
      if (!c.simulate) await this._ensureFeeFloat(job.row.address).catch((e) => this._say(`${job.row.short} cannot pay for its sell yet: ${e.message}`));
      try {
        await this._swap(job.row, 'sell', '100%', { noJito: true });
        this.stats.bumps++;
        this.stats.sells++;
        this.stats.sellsSol = round9(this.stats.sellsSol + amount);
        // RULE ADDED 2026-11-08 (1.1.2): a sell that only partly fills is not the end of the round. The chain is asked what is
        // left in the wallet, and a round that still holds tokens keeps its bag and tries again - otherwise the desk would
        // book "sold" while tokens sat in the wallet, and only a withdrawal would find them.
        const residue = c.simulate ? 0n : await this._tokenBalanceRaw(c.mint, job.row.address).catch(() => 0n);
        if (residue > 0n) {
          job.row.sellAt = this.now() + 3000;
          job.row.fails = 0;
          this.stats.volumeSol = round9(this.stats.volumeSol + amount);
          this.stats.feesSol = round9(this.stats.feesSol + amount * (SIDE_FEE_PCT / 100) + c.priorityFeeSol + BASE_FEE_SOL);
          this._say(`${job.row.short} still holds tokens after the sell (a partial fill): the round stays open and sells again.`);
          return;
        }
        // The round is over: the whole bag is gone and the wallet starts again from one buy.
        job.row.holdingSol = 0;
        job.row.sellAt = 0;
        job.row.roundBuys = 0;
        job.row.roundTarget = 0;
        job.row.bumps++;
        job.row.fails = 0;
        // RULE ADDED 2026-11-11 (1.1.6): a sell that went through proves the wallet works, so a park is lifted with it. The flag
        // used to survive the sale, which left a wallet marked "parked" for the rest of the run while it traded perfectly -
        // the owner's own "8v9m…5nGV ... parked" row.
        if (job.row.stuck) { job.row.stuck = false; job.row.stuckUntil = 0; }
        this.stats.volumeSol = round9(this.stats.volumeSol + amount);
        this.stats.feesSol = round9(this.stats.feesSol + amount * (SIDE_FEE_PCT / 100) + c.priorityFeeSol + BASE_FEE_SOL);
        this._say(`Sell back from ${job.row.short}${c.simulate ? ' (dry run)' : ''}.`);
      } catch (e) {
        job.row.fails++;
        // Three refusals in a row on one wallet is not a busy slot, it is a wallet that cannot trade this coin (a
        // frozen account, a route that will not price it). It is parked and named instead of being retried for ever.
        if (job.row.fails >= 3) {
          // RULE CHANGED 2026-11-09 (1.1.2): parking is a PAUSE, not a death sentence. A wallet that could not sell sits out two
          // minutes and is then tried again - a jammed route or a busy block clears, and a wallet parked for a whole run is
          // money the operator has to rescue by hand. The rescue button on its row is the manual version of the same thing.
          job.row.stuck = true;
          job.row.stuckUntil = this.now() + PARK_MS;
          this._say(`${job.row.short} cannot sell this token right now (${e.message}). It is parked for 2 minutes, then it is retried.`);
        }
        else job.row.sellAt = this.now() + 5000;
        throw e;
      }
    }
  }

  /**
   * The chain is the only witness that counts. Every money movement goes through here before the desk says a word about
   * it: `broadcast` answering means the bytes were accepted, and an accepted transaction that failed moves nothing.
   */
  async _confirm(signature, opts = {}) {
    if (!this.rpc || typeof this.rpc.confirm !== 'function') {
      throw new Error('The RPC manager cannot confirm transactions: refusing to report money as moved without proof.');
    }
    return this.rpc.confirm(signature, { timeoutMs: 30000, ...opts });
  }

  /**
   * A Jito bundle is a FIRST TRY at a better slot, never the wire the trade hangs on. The block engine keeps a bundle for
   * a slot or two, so one send lands only when the next leader happens to run the Jito client - measured on the owner's
   * own coin: every bundle was accepted and none landed, and the switch looked like it did nothing. So the same signed
   * transaction is offered a few times, and if none of them lands the IDENTICAL bytes go out through the normal route.
   *
   * That is safe by construction: the bytes carry one signature, and Solana executes a signature at most once, so the
   * second path can never trade twice - and the tip is only ever paid by a bundle that actually lands. A bundle the
   * engine REFUSES is dropped at once: a refusal means these bytes were not accepted, so offering them again is noise.
   */
  async _bundleFirst(tx, bytes, kp, c) {
    const signature = bs58.encode(tx.signatures[0]);
    let tip = null;
    try {
      const [tipAccount] = await this.jito.tipAccounts();
      const tipTx = new Transaction().add(SystemProgram.transfer({
        fromPubkey: kp.publicKey, toPubkey: new PublicKey(tipAccount), lamports: Math.round(c.jitoTipSol * LAMPORTS_PER_SOL),
      }));
      const { blockhash } = await this.rpc.call((conn) => conn.getLatestBlockhash(), { timeoutMs: 4000 });
      tipTx.feePayer = kp.publicKey;
      tipTx.recentBlockhash = blockhash;
      tipTx.sign(kp);
      tip = tipTx.serialize();
    } catch (e) {
      this._say(`Jito could not be prepared (${e.message}); the bump goes out the normal way.`);
      return null;
    }
    this._bundledSig = signature;
    let last = '';
    for (let i = 0; i < BUNDLE_SENDS; i++) {
      try {
        await this.jito.sendBundle([bytes, tip]);
        this.stats.bundles = (this.stats.bundles || 0) + 1;
      } catch (e) {
        this._say(`Jito refused the bundle (${e.message}); the bump goes out the normal way.`);
        return null;
      }
      try {
        await this._confirm(signature, { timeoutMs: BUNDLE_WAIT_MS, pollMs: 300 });
        this._jitoMisses = 0;
        return { signature };
      } catch (e) {
        last = e.message;
        // It landed and reverted: these bytes are in a block, and offering them again cannot change that.
        if (/landed and FAILED/.test(e.message)) throw e;
      }
    }
    this._jitoMisses = (this._jitoMisses || 0) + 1;
    if (this._jitoMisses >= JITO_MISS_LIMIT) {
      this._jitoBroken = true;
      this._say(`Jito offered ${JITO_MISS_LIMIT} trades in a row and none landed (${String(last).slice(0, 80)}). The rest of this run goes through the normal route.`);
    } else {
      this._say(`Jito's bundle did not land (${String(last).slice(0, 80)}); the trade went out the normal way.`);
    }
    return null;
  }

  async _swap(row, action, amount, opts = {}) {
    const c = this._cfg();
    if (c.simulate) return { simulated: true };
    const kp = this.keys.get(row.address);
    if (!kp) throw new Error('The bump wallets are locked.');
    // RULE ADDED 2026-11-08 (1.1.2): once the pump door has provably failed on this coin, the rest of the run goes straight
    // to Jupiter. Every refused attempt costs a fee and about five seconds, and the owner's own run paid that twice a bump
    // (the door's transaction landed and failed, then Jupiter carried the same trade) before this existed.
    if (this.jupiter && this._doorBroken.has(c.mint) && !opts.ignoreDoorBroken) return this._swapViaJupiter(row, action, amount, c);
    // RULE ADDED 2026-11-10 (1.1.4): a rescue wants the door TRIED, whatever a previous buy proved. `_doorBroken` exists so
    // a run does not pay for the same refusal every bump, but a sell-out is one attempt at getting a bag home: it walks its
    // own ladder (door, then Jupiter) and does not inherit that shortcut.
    const owner = kp.publicKey.toBase58();
    const body = {
      publicKey: owner,
      action,
      mint: c.mint,
      amount,
      denominatedInSol: action === 'buy' ? 'true' : 'false',
      slippage: c.slippagePct,
      // A cent of tip, not a "priority" budget: the whole point of a bump is that it is cheap. Jittered so that no two
      // transactions carry the same fee either.
      priorityFee: round9(c.priorityFeeSol * (0.9 + this.rand() * 0.2)),
      pool: 'auto',
    };
    const raw = await (this.door || this._postDoor)(body);
    let tx;
    try { tx = VersionedTransaction.deserialize(new Uint8Array(raw)); } catch (e) { throw new Error('The trade door sent a transaction that could not be read: ' + e.message); }
    assertSwapTx(tx, owner, { maxSolOut: action === 'buy' ? amount : 0 });
    tx.sign([kp]);
    const bytes = tx.serialize();
    // Every trade starts with no bundle behind it: a signature left over from the last one must never be confirmed on
    // behalf of this one (that would book a bump that was never sent).
    this._bundledSig = null;
    if (c.useJito && this.jito && !this._jitoBroken && !opts.noJito) {
      const bundled = await this._bundleFirst(tx, bytes, kp, c);
      if (bundled) return { signature: bundled.signature, bundled: true };
    }
    let sig = null;
    try {
      sig = await this.rpc.broadcast(bytes);
    } catch (e) {
      // RULE CHANGED 2026-11-11 (1.1.5): a bundle that lands between our last look and this broadcast makes the door
      // answer "already processed". That is not a failure - it is the trade arriving - so the signature we already know
      // is asked about by name, and only a real absence is reported.
      if (this._bundledSig) {
        try {
          const done = await this._confirm(this._bundledSig, { timeoutMs: 10000 });
          return { signature: done.signature, bundled: true };
        } catch (_) { /* fall through to the honest error */ }
      }
      throw e;
    }
    // The bump counts as a bump only once the chain says it is in a block: a transaction that was accepted and then
    // failed is a fee paid for nothing, and reporting it as activity would be the desk lying about its own work.
    try {
      await this._confirm(sig, { timeoutMs: 20000 });
      return { signature: sig };
    } catch (e) {
      // RULE ADDED 2026-11-09 (1.1.3): a SELL whose transaction went unanswered is settled by the token balance. The chain
      // is the only book that matters: a wallet holding nothing has sold, whatever the confirmation said, and the desk must
      // stop believing it holds a bag it no longer has (that belief is what piles up "holds tokens this run never booked").
      // Only a sell is settled this way - a buy is never assumed from a balance it might have held before.
      if (action === 'sell') {
        const left = await this._tokenBalanceRaw(c.mint, owner).catch(() => null);
        if (left === 0n) return { signature: sig, settledByBalance: true };
      }
      // RULE ADDED 2026-11-08 (1.1.2): a transaction that LANDED AND FAILED provably did nothing, so the trade may still be
      // made another way. The pump door prices a coin that has migrated to PumpSwap about 85% below the AMM (measured on the
      // owner's own coin: ExceededSlippage, 2487145 allowed against 4590423 required), and Jupiter routes straight through
      // that pool. An UNKNOWN outcome is never retried: it may be on chain, and sending it twice buys twice.
      if (!/landed and FAILED/.test(e.message) || !this.jupiter || opts.noJupFallback) throw e;
      this._doorBroken.add(c.mint);
      this._say(`The pump door refused the trade on chain (${/\((.*?)\)/.exec(e.message) ? /\((.*?)\)/.exec(e.message)[1].slice(0, 60) : e.message.slice(0, 60)}); taking it through Jupiter instead.`);
      return this._swapViaJupiter(row, action, amount, c);
    }
  }

  /** The second route: the same trade, priced and executed by Jupiter (which routes PumpSwap, Raydium and the curve). */
  async _swapViaJupiter(row, action, amount, c, opts = {}) {
    const kp = this.keys.get(row.address);
    if (!kp) throw new Error('The bump wallets are locked.');
    const owner = kp.publicKey.toBase58();
    const amountRaw = action === 'buy'
      ? BigInt(Math.round(amount * LAMPORTS_PER_SOL))
      : await this._tokenBalanceRaw(c.mint, owner);
    if (amountRaw <= 0n) {
      // A 100% sell of a wallet that holds nothing has already happened as far as the book is concerned; reporting it as a
      // failure left runs claiming a bag they had already sold back.
      if (action === 'sell') return { settledByBalance: true };
      throw new Error('Nothing to buy.');
    }
    // RULE ADDED 2026-11-10 (1.1.4): the LEGACY lane is tried first. It quotes without naming a taker, so it builds for the
    // wallets this desk actually runs (a few thousandths of SOL), while the current lane refuses every taker below roughly
    // 0.06 SOL with "Failed to get quotes" - which reached the panel as "Jupiter has no route" on a coin that routes
    // perfectly. Only a definite refusal falls through to the current lane; an unknown outcome is never repeated.
    if (typeof this.jupiter.swapV1 === 'function' && !opts.skipV1) {
      let built = null;
      try {
        built = await this.jupiter.swapV1({
          keypair: kp,
          inputMint: action === 'buy' ? WSOL : c.mint,
          outputMint: action === 'buy' ? c.mint : WSOL,
          amountRaw: amountRaw.toString(),
          slippageBps: Math.round(c.slippagePct * 100),
          guard: (tx, walletOwner) => assertSwapTx(tx, walletOwner, { maxSolOut: action === 'buy' ? amount : 0 }),
        });
      } catch (e) {
        // Nothing was signed in this lane, so the other lane may still carry the trade - but a refusal by our own safety
        // guard is not a route problem and is never papered over.
        if (/^Safety check/.test(String(e.message))) throw e;
        built = null;
      }
      if (built) {
        // RULE ADDED 2026-11-11 (1.1.6): Jito carries the Jupiter lane too. Once the pump door is broken this is where EVERY
        // trade goes, so without this the switch would only ever see the opening bumps of a run - the owner's own run showed
        // 3 bundles for 110 bumps ("TO POWINNO z jito zapierdalac"). Same rule as the door lane: a first try at a better
        // slot, then the IDENTICAL bytes on the normal route (one signature, so the fallback can never trade twice).
        if (c.useJito && this.jito && !this._jitoBroken && !opts.noJito) {
          const tx = VersionedTransaction.deserialize(new Uint8Array(built.bytes));
          const bundled = await this._bundleFirst(tx, built.bytes, kp, c);
          if (bundled) return { signature: bundled.signature, route: 'jupiter-v1', bundled: true };
        }
        let sig = null;
        try {
          sig = await this.rpc.broadcast(built.bytes);
        } catch (e) {
          // The bundle may have landed between our last look and this send: ask the signature we already know about.
          if (this._bundledSig) {
            try {
              const done = await this._confirm(this._bundledSig, { timeoutMs: 10000 });
              return { signature: done.signature, route: 'jupiter-v1', bundled: true };
            } catch (_) { /* fall through to the honest error */ }
          }
          throw e;
        }
        try {
          await this._confirm(sig, { timeoutMs: 20000 });
        } catch (e) {
          // Past the signature the outcome is unknown, never "retry": the chain is asked instead.
          if (action === 'sell') {
            const left = await this._tokenBalanceRaw(c.mint, owner).catch(() => null);
            if (left === 0n) return { signature: sig, settledByBalance: true, route: 'jupiter-v1' };
          }
          throw e;
        }
        return { signature: sig, route: 'jupiter-v1' };
      }
    }
    const swap = (raw) => this.jupiter.swap({
      keypair: kp,
      inputMint: action === 'buy' ? WSOL : c.mint,
      outputMint: action === 'buy' ? c.mint : WSOL,
      amountRaw: raw.toString(),
      slippageBps: Math.round(c.slippagePct * 100),
      guard: (tx, walletOwner) => assertSwapTx(tx, walletOwner, { maxSolOut: action === 'buy' ? amount : 0 }),
    });
    let signature;
    try {
      signature = await swap(amountRaw).catch(async (e) => {
        // RULE ADDED 2026-11-09 (1.1.2): "no route" is a DEFINITE refusal - nothing was signed - so the same trade can be asked
        // for once more. Jupiter answered `400: Failed to get quotes` on roughly one bump in four on the owner's coin, and
        // each of those was a slot lost for no reason. Only definite failures are retried; an unknown outcome never is.
        if (e && e.definite === false) throw e;
        await new Promise((r) => setTimeout(r, 400));
        return swap(amountRaw);
      });
    } catch (e) {
      // Same rule as the pump route: an unanswered SELL is settled by the token balance, never assumed either way.
      if (action === 'sell') {
        const left = await this._tokenBalanceRaw(c.mint, owner).catch(() => null);
        if (left === 0n) return { settledByBalance: true, route: 'jupiter' };
      }
      throw e;
    }
    return { signature, route: 'jupiter' };
  }

  /**
   * Put back the smallest amount of SOL that lets one wallet act: the rent-exempt floor (so the account exists) plus a
   * signature or two. Pays from the main wallet, refuses when that wallet is locked or too thin, and confirms before it says
   * the money moved. Used by the rescue, never by the run.
   */
  async _topUpFee(address, needSol) {
    const to = new PublicKey(address);
    const have = (await this.rpc.call((conn) => conn.getBalance(to), { timeoutMs: 4000 })) / LAMPORTS_PER_SOL;
    const send = round9(needSol - have);
    if (send <= 0) return 0;
    if (!this.wallet || !this.wallet.isUnlocked()) throw new Error(`it needs ${send.toFixed(4)} SOL and your wallet is locked - unlock it and press Rescue again`);
    const main = this.wallet.keypair.publicKey;
    const balance = (await this.rpc.call((conn) => conn.getBalance(main), { timeoutMs: 4000 })) / LAMPORTS_PER_SOL;
    if (balance < send + ACCOUNT_RENT_SOL + 0.00002) throw new Error(`it needs ${send.toFixed(4)} SOL and your wallet holds ${balance.toFixed(4)} - send it a little SOL and press Rescue again`);
    const lamports = Math.round(send * LAMPORTS_PER_SOL);
    const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: main, toPubkey: to, lamports }));
    guardDeposit(tx, main, to, lamports);
    const { blockhash } = await this.rpc.call((conn) => conn.getLatestBlockhash(), { timeoutMs: 4000 });
    tx.feePayer = main;
    tx.recentBlockhash = blockhash;
    tx.sign(this.wallet.keypair);
    const sig = await this.rpc.broadcast(tx.serialize());
    await this._confirm(sig);
    this._say(`Put ${send.toFixed(4)} SOL back into ${address.slice(0, 4)}…${address.slice(-4)} so it can pay its own fee.`);
    return send;
  }

  /**
   * Did a sell that came back unanswered actually happen? The token balance is the only book that matters: a wallet holding
   * none of the mint has sold it, whatever the confirmation (or a bundle) said. Used wherever a sell failed but the money
   * must not be reported in limbo - a stuck bag would be swept or sold a second time by the janitor.
   */
  async _sellSettled(row) {
    const c = this._cfg();
    if (!c.mint) return false;
    const left = await this._tokenBalanceRaw(c.mint, row.address).catch(() => null);
    return left === 0n;
  }

  /** How much of `mint` this wallet really holds, in the token's own units. Used by the Jupiter sell, which needs a raw amount. */
  async _tokenBalanceRaw(mint, owner) {
    const res = await this.rpc.call((conn) => conn.getParsedTokenAccountsByOwner(new PublicKey(owner), { mint: new PublicKey(mint) }), { timeoutMs: 4000, budgetMs: 9000, listAccounts: true });
    let raw = 0n;
    for (const it of (res && res.value) || []) {
      const info = it && it.account && it.account.data && it.account.data.parsed && it.account.data.parsed.info;
      if (info && info.tokenAmount && info.tokenAmount.amount) raw += BigInt(info.tokenAmount.amount);
    }
    return raw;
  }

  /**
   * RULE ADDED 2026-11-10 (1.1.4): "the chain could not be asked" is NOT "the wallet holds nothing". The rescue reported
   * `nothing held` about a wallet holding 39 018 746 966 tokens, because the token read was wrapped in `.catch(() => 0n)` and
   * the pool was answering 429. `known: false` is an honest third answer, and the caller must not delete or claim anything
   * on it. The read is retried (a public host refusing one call is not the chain refusing), and the wait grows.
   */
  async _bagRaw(address, { tries = 3 } = {}) {
    const c = this._cfg();
    if (!c.mint) return { known: true, raw: 0n, mint: null };
    let lastErr = null;
    for (let i = 0; i < tries; i++) {
      try {
        const raw = await this.rpc.call((conn) => conn.getParsedTokenAccountsByOwner(new PublicKey(address), { mint: new PublicKey(c.mint) }), { timeoutMs: 5000, budgetMs: 12000, attempts: 3, waitMs: 6000, listAccounts: true })
          .then((res) => {
            let sum = 0n;
            for (const it of (res && res.value) || []) {
              const info = it && it.account && it.account.data && it.account.data.parsed && it.account.data.parsed.info;
              if (info && info.tokenAmount && info.tokenAmount.amount) sum += BigInt(info.tokenAmount.amount);
            }
            return sum;
          });
        return { known: true, raw, mint: c.mint };
      } catch (e) {
        lastErr = e;
        if (i < tries - 1) await this.sleep(1200 * (i + 1));
      }
    }
    return { known: false, raw: null, mint: c.mint, error: lastErr };
  }

  /**
   * RULE ADDED 2026-11-10 (1.1.4): a wallet that cannot pay its own fee cannot sell anything, so a rescue floats the money
   * in FIRST - and it no longer skips that step when the balance read fails, which is how a bag sat unsold behind "nothing
   * held". The float is the operator's own SOL and comes straight back in the withdrawal; only the fee is spent.
   */
  async _ensureFeeFloat(address, needSol = SELL_FLOAT_SOL) {
    let have = null;
    let lastErr = null;
    for (let i = 0; i < 3 && have == null; i++) {
      try {
        have = (await this.rpc.call((conn) => conn.getBalance(new PublicKey(address)), { timeoutMs: 5000, budgetMs: 10000, attempts: 3, waitMs: 6000 })) / LAMPORTS_PER_SOL;
      } catch (e) {
        lastErr = e;
        if (i < 2) await this.sleep(1000 * (i + 1));
      }
    }
    if (have == null) throw new Error(`the chain could not be asked how much SOL it holds (${String((lastErr && lastErr.message) || 'no answer').slice(0, 70)}) - press Rescue again in a moment`);
    if (have >= needSol) return 0;
    return this._topUpFee(address, round9(needSol));
  }

  /**
   * Get ONE wallet's bag out, down a ladder that cannot double-sell: the pump door (it needs no wrapped-SOL account, so it
   * is the only route that fits a wallet holding barely a fee), then Jupiter's legacy lane (it quotes without a taker, so it
   * builds for a thin wallet), then Jupiter's current lane. Each rung is only tried after a DEFINITE refusal - nothing signed
   * - and an unknown outcome stops the ladder and asks the chain instead.
   */
  async _sellBagOut(row) {
    const c = this._cfg();
    const kp = this.keys.get(row.address);
    if (!kp) throw new Error('The bump wallets are locked.');
    const reasons = [];
    // RULE ADDED 2026-11-11 (1.1.6): the wallet is given its fee BEFORE the ladder starts. The owner's own Stop printed
    // "Could not sell back 8v9m…5nGV: Jupiter has no route (400: Failed to get quotes)" - that refusal is not a missing
    // market, it is a wallet holding 0.0033 SOL asking for a swap that needs 0.0034. The float comes from the main wallet
    // and the withdrawal takes it back, so it costs the fee only.
    await this._ensureFeeFloat(row.address).catch((e) => reasons.push(`the fee float could not be put in (${e.message})`));
    const definite = (e) => {
      const msg = String((e && e.message) || e);
      if (e && e.definite === false) return false;
      if (/landed and FAILED/.test(msg)) return true;              // it executed and reverted: the bag is untouched
      if (/not on chain after|outcome unknown/i.test(msg)) return false;
      return true;                                                 // refused before a signature existed
    };
    const settle = async () => {
      const bag = await this._bagRaw(row.address, { tries: 2 });
      if (bag.known && bag.raw === 0n) return { settledByBalance: true, route: 'ladder' };
      return null;
    };

    try {
      return await this._swap(row, 'sell', '100%', { noJito: true, ignoreDoorBroken: true, noJupFallback: true });
    } catch (e) {
      reasons.push(e.message);
      if (!definite(e)) throw e;
    }
    const afterDoor = await settle();
    if (afterDoor) return afterDoor;

    if (this.jupiter && typeof this.jupiter.swapV1 === 'function') {
      try {
        const built = await this.jupiter.swapV1({
          keypair: kp,
          inputMint: c.mint,
          outputMint: WSOL,
          amountRaw: (await this._tokenBalanceRaw(c.mint, row.address)).toString(),
          slippageBps: Math.round(c.slippagePct * 100),
          guard: (tx, walletOwner) => assertSwapTx(tx, walletOwner, { maxSolOut: 0 }),
        });
        const sig = await this.rpc.broadcast(built.bytes);
        await this._confirm(sig, { timeoutMs: 20000 });
        return { signature: sig, route: 'jupiter-v1' };
      } catch (e) {
        reasons.push(e.message);
        if (!definite(e)) throw e;
        const after = await settle();
        if (after) return after;
      }
    }

    if (this.jupiter) {
      try {
        return await this._swapViaJupiter(row, 'sell', '100%', c, { skipV1: true });
      } catch (e) {
        reasons.push(e.message);
        const after = await settle();
        if (after) return after;
      }
    }
    throw new Error(reasons.join('; '));
  }

  async _postDoor(body) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 5000);
    try {
      const r = await fetch(TRADE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
      if (!r.ok) {
        const text = (await r.text().catch(() => '')).slice(0, 120);
        throw new Error(`the trade door refused it (${r.status}${text ? ': ' + text : ''})`);
      }
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('the trade door did not answer in time');
      throw e;
    } finally { clearTimeout(timer); }
  }

  // ───────── the panel ─────────

  async _refreshBalances() {
    const addresses = this.roster.addresses();
    if (!addresses.length) return;
    if (!this.rows.length) this.rows = this._rows(this._cfg());
    try {
      const keys = addresses.map((a) => new PublicKey(a));
      const vaultAddr = this.vault.address();
      if (vaultAddr) keys.push(new PublicKey(vaultAddr));
      const info = await this.rpc.call((conn) => conn.getMultipleAccountsInfo(keys), { timeoutMs: 4000, budgetMs: 9000 });
      this.rows.forEach((row, i) => { row.balanceSol = info && info[i] ? round9(info[i].lamports / LAMPORTS_PER_SOL) : 0; });
      if (vaultAddr) {
        const v = info && info[addresses.length] ? info[addresses.length].lamports / LAMPORTS_PER_SOL : 0;
        this.vault.balanceSol = round9(v);
        this.vault.empty = v < 0.001;
      }
      this._balancesAt = this.now();
    } catch (_) { /* a panel without balances is better than a desk that stops */ }
  }

  _say(line) {
    this.lastLine = line;
    this.emit('log', line);
    this._push();
  }

  state() {
    const c = this._cfg();
    const rows = this.rows.length ? this.rows : this._rows(c);
    const total = this.stats.buys + this.stats.sells;
    const inPlay = rows.reduce((n, r) => n + (r.holdingSol || 0), 0);
    // Why the pace is not the pace. A wallet pool is a hard ceiling: with three wallets and a ninety second hold band the
    // desk can only do three bumps before it has to wait, whatever the pace says. Naming it is the difference between a
    // panel that looks broken and one that explains itself.
    const holding = rows.filter((r) => r.holdingSol).length;
    const stuck = rows.filter((r) => r.stuck).length;
    // A wallet is free to buy when its round still has buys left in it - or when it has no round open at all - and it can pay.
    const free = rows.filter((r) => {
      if (r.stuck) return false;
      const openRound = r.roundBuys > 0 ? r.roundBuys < (r.roundTarget || c.buysPerRound) : !r.holdingSol;
      if (!openRound) return false;
      return c.simulate || (r.balanceSol || 0) >= c.minSol + this._reserve();
    }).length;
    let waiting = '';
    if (this.running && !free) {
      waiting = holding
        ? `Every wallet is in a round and waiting for its sell: the pace is limited by the ${c.holdMinSec}–${c.holdMaxSec} s hold band, not by ${c.perMinute}/min.`
        : 'No wallet has enough SOL left for one trade plus its rent. Raise the budget or the wallet count.';
    }
    return {
      running: this.running, paused: this.paused, simulate: c.simulate,
      mint: c.mint, short: short(c.mint),
      addresses: this.roster.addresses(),
      unlocked: this.unlocked(),
      vault: { exists: this.vault.exists(), address: this.vault.address(), balanceSol: this.vault.balanceSol ?? null },
      wallets: rows.map((r) => ({
        address: r.address, short: r.short, balanceSol: r.balanceSol,
        budgetSol: round9(r.budgetSol), spentSol: r.spentSol, holdingSol: r.holdingSol,
        active: r.active !== false,
        roundBuys: r.roundBuys || 0, roundTarget: r.roundTarget || c.buysPerRound,
        bumps: r.bumps, stuck: r.stuck, sellsIn: r.sellAt ? Math.max(0, Math.round((r.sellAt - this.now()) / 1000)) : null,
      })),
      buysPerRound: c.buysPerRound, buysRandom: c.buysRandom,
      // Money in addresses the plan does not carry: it is safe, it is not idle by accident, and the panel says so.
      idleSol: round9(rows.filter((r) => r.active === false).reduce((n, r) => n + (r.balanceSol || 0), 0)),
      stats: {
        bumps: this.stats.bumps, buys: this.stats.buys, sells: this.stats.sells, errors: this.stats.errors,
        spentSol: this.stats.spentSol, feesSol: this.stats.feesSol, volumeSol: this.stats.volumeSol,
        buySharePct: total ? Math.round((this.stats.buys / total) * 100) : null,
        rate: this._rate(), startedAt: this.stats.startedAt, endsAt: this.endsAt || null,
      },
      inPlaySol: round9(inPlay),
      free, holding, stuck,
      // Why the switch on the panel is either doing something or was stood down: the panel says which, so nobody has to
      // guess whether Jito is in the loop (the owner's own question: "TO POWINNO z jito zapierdalac").
      jito: {
        on: c.useJito, tipSol: round9(c.jitoTipSol), broken: Boolean(this._jitoBroken),
        misses: this._jitoMisses || 0, bundles: this.stats.bundles || 0,
      },
      // What the pool actually is, against what the sliders ask for. The two are not the same number: the roster is written
      // when keys are made, and a bigger pool size never invents addresses by itself.
      pool: { asked: c.wallets, have: this.roster.addresses().length },
      waiting,
      estimate: estimate(this.store ? this.store.get() : {}, { have: this.roster.addresses().length }),
      lastLine: this.lastLine,
    };
  }

  _rate() {
    // Bumps per minute over the last half minute of actual work, which is the number the customer cares about: not what
    // was configured, but what the desk is achieving.
    const now = this.now();
    if (!this.stats._rateAt) { this.stats._rateAt = now; this.stats._rateBase = this.stats.bumps; return 0; }
    const span = now - this.stats._rateAt;
    if (span < 30000) return this.stats.rate || 0;
    const rate = ((this.stats.bumps - this.stats._rateBase) * 60000) / span;
    this.stats.rate = Math.round(rate * 10) / 10;
    this.stats._rateAt = now;
    this.stats._rateBase = this.stats.bumps;
    return this.stats.rate;
  }

  _push() {
    try { this.emit('state', this.state()); } catch (_) { /* a listener that throws is not a reason to stop */ }
  }
}

module.exports = {
  BumpBot, Roster, DeskVault, bumpConfig, planBudget, estimate, fitPlan, guardFunding, guardSweep, guardDeposit, BUMP_DEFAULTS,
  SIDE_FEE_PCT, BASE_FEE_SOL, TOKEN_RENT_SOL, MIN_TICKET_SOL, MAX_WALLETS, MAX_PER_TX_SOL, MAX_BUDGET_SOL, JITO_MAX_BUNDLE,
  BUNDLE_SENDS, BUNDLE_WAIT_MS, JITO_MISS_LIMIT,
};
