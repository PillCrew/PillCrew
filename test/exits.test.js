const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Every scratch directory this suite makes lives under one root that is removed on exit, and roots left by an
// earlier run are swept (see `test/scratch.js`).
const scratchDir = require('./scratch').root;
const { Store } = require('../src/store');
const { Engine, DEFAULTS } = require('../src/engine');
const WSOL = 'So11111111111111111111111111111111111111112';

const dir = fs.mkdtempSync(path.join(scratchDir, 'exits-'));
const wallet = { exists: () => true, isUnlocked: () => true, address: () => 'W', keypair: null };

function engine(overrides = {}, storeDir = null) {
  const store = new Store(storeDir || fs.mkdtempSync(path.join(scratchDir, 'exits-')), 's.json', DEFAULTS);
  // RULE CHANGED 2026-11-05: the shipped plan is the SIMPLE one (target, stop, time limit, and one give-back floor
  // for a big run). Every case below names the ladder it is testing, so the harness runs the full desk - and the
  // simple-mode behaviour has its own cases here and in `modules.test.js`.
  store.set({ paperLatencyMs: 0, paperBaseSlippagePct: 0, paperUnknownImpactPct: 0, mode: 'paper', simpleMode: false, takeProfitPct: 40, stopLossPct: 20, maxHoldSec: 600, trailArmPct: 15, trailGivePct: 8, tp1Pct: 0, breakEvenPct: 0, triggerHoldMs: 0, ...overrides });
  const e = new Engine(wallet, store);
  e.risk.check = async () => null;
  clearInterval(e._bal);
  clearInterval(e._ui);
  e.refreshBalance = () => {};
  // The harness has no chain, so a sale's transaction can never be found: measuring it would wait its half-second
  // second look on every exit in the suite. The measurement has tests of its own (`_txSolDelta` / `_measureProceeds`).
  e._measureProceeds = async () => null;
  e._log = () => {};
  e.running = true;
  // A real session always knows the exchange rate, because the engine asks for it before judging a market-priced
  // coin. Without one here, a dollar net-flow figure could not be turned into SOL and every such coin would fail on
  // "needs net buying" for a reason the test is not about.
  e.market.solPrice = () => 150;
  // RULE CHANGED 2026-11-05: a live entry now requires the POOL's own price, and these harnesses have no node to read
  // one from. The pool number is supplied here: these tests are about the exits and the retry ladder, not about how the
  // entry was priced (that has its own test in `curve.test.js`).
  e._entryPrice = async () => ({ mc: 100, src: 'curve' });
  return e;
}

function open(e, mint, solIn = 1) {
  // `pxSeed: true` mirrors a position that was just opened: its price is the entry's own reading, so the first live
  // print is taken as it comes (see `_pricePosition` and `_buy`).
  const p = { mint, symbol: mint, entryMc: 100, mc: 100, peakMc: 100, solIn, feeBuy: 0.0001, openedAt: Date.now(), status: 'open', closing: false, paper: true, fails: 0, nextTry: 0, pxSeed: true };
  e.positions.set(mint, p);
  e.tokens.set(mint, { mint, symbol: mint, mc: 100, mcHist: [], trades: [], status: 'bought', sources: new Set(['launch']) });
  return p;
}

const settle = () => new Promise((r) => setTimeout(r, 30));

(async () => {
  // Price at a given gross move: mcap 100 -> move of +x% is 100 * (1 + x/100).
  const at = (pct) => 100 * (1 + pct / 100);

  // Take profit fires on the net move, and a 40% target needs the fee drag on top.
  // RULE CHANGED 2026-11-05 (1.0.2): the shipped target is 80%, so this case names the 40% target it is testing - it is
  // about what is net of fees.
  {
    const e = engine({ takeProfitPct: 40 });
    const p = open(e, 'TP');
    p.mc = at(30);
    e._tick(); e._tick();
    await settle();
    assert.ok(e.positions.has('TP'), 'a 30% gross move is only 27% net, below a 40% target');

    p.mc = at(46);
    e._tick(); e._tick();
    await settle();
    assert.ok(!e.positions.has('TP'), 'a 43% net move clears the target');
    assert.match(e.history[0].reason, /Take profit/);
    // RULE ADDED: a closed coin goes back to being watched (with a cooldown) instead of staying "Bought" for ever,
    // which used to make it invisible to every later evaluation while the market table said it was still held.
    assert.strictEqual(e.tokens.get('TP').status, 'watching', 'the coin is back on the board after the sale');
  }

  // RULE CHANGED: a stop loss no longer waits `triggerHoldMs`. It has to be seen on a second, fresh price after
  // STOP_HOLD_MS (150 ms), and a coin already through twice its stop sells on the first reading. The 400 ms wait was
  // written for a take profit, where a spike has to prove itself; on a falling coin it is a fifth of the move -
  // measured in paper mode against the live market, a 10% stop held for 400 ms booked -26%, and a 22% stop -37%.
  {
    const e = engine({ stopLossPct: 20, triggerHoldMs: 400 });
    const p = open(e, 'SL');
    p.mc = at(-25);
    e._tick();
    assert.ok(e.positions.has('SL'), 'a stop is never sold on the reading that first sees it');
    await new Promise((r) => setTimeout(r, 170));
    e._tick();
    await settle();
    assert.ok(!e.positions.has('SL'), 'a stop sells 150 ms after the level is first seen, not after triggerHoldMs (400 ms)');
    assert.match(e.history[0].reason, /Stop loss/);
  }

  // A crash through twice the stop does not wait even for that, and a take profit still does.
  {
    const e = engine({ stopLossPct: 20, takeProfitPct: 40, triggerHoldMs: 400 });
    const p = open(e, 'CRASH');
    p.mc = at(-45);
    e._tick();
    assert.ok(e.positions.has('CRASH'), 'the first reading only arms the rule');
    e._tick();
    await settle();
    assert.ok(!e.positions.has('CRASH'), 'a coin through twice its stop sells on the next reading, with no hold at all');

    const q = open(e, 'SLOW');
    q.mc = at(45);
    e._tick();
    assert.ok(e.positions.has('SLOW'), 'a take profit waits for the level to hold');
    e._tick();
    await settle();
    assert.ok(e.positions.has('SLOW'), 'a take profit does not sell 0 ms after the level appears: triggerHoldMs still guards it');
  }

  // RULE CHANGED: the trailing stop is a RISK rule, so it waits `STOP_HOLD_MS` (150 ms) rather than `triggerHoldMs`
  // (400 ms). Measured in a paper run: a coin that peaked at +12.8% was sold by the trailing stop at -5.3%, because
  // 400 ms of confirmation on a falling coin is a fifth of the move. The trigger is also keyed on the rule rather than
  // on the label - the label carries the peak, and a label is not an identity.
  // RULE CHANGED AGAIN: the room the trail gives back is a share of the peak (45%, floored at `trailGivePct`), so this
  // coin that peaked at +47% net is not sold by a 10-point pull-back any more - only by one past 21 points.
  {
    const e = engine({ takeProfitPct: 80, trailArmPct: 15, trailGivePct: 8, triggerHoldMs: 400 });
    const p = open(e, 'TRAILKEY');
    p.mc = at(50);
    e._tick();
    assert.ok(e.positions.has('TRAILKEY'), 'the first reading arms the peak and sells nothing');

    // A pull-back inside the room the peak has earned holds the position: 47% net peaked, 21 points of room.
    p.mc = at(35);
    e._tick();
    assert.ok(e.positions.has('TRAILKEY'), 'a pull-back smaller than the peak\'s own room holds the position');

    // Give back more than the trail allows: the rule is on, the position has to hold the level before it sells.
    p.mc = at(20);
    e._tick();
    assert.ok(e.positions.has('TRAILKEY'), 'the give-back is seen, not acted on, on the first reading');
    await new Promise((r) => setTimeout(r, 170));
    e._tick();
    await settle();
    assert.ok(!e.positions.has('TRAILKEY'), 'a trailing stop sells 150 ms after the give-back, not after triggerHoldMs (400 ms)');
    assert.match(e.history[0].reason, /Trailing stop/);
    assert.match(e.history[0].reason, /peaked at \+/);
  }

  // RULE CHANGED: the trailing stop gives back a SHARE of the peak instead of a fixed number of points that was
  // tightened to 5 after the first rung and to 2 once past three times the target. With that shape every profit rule
  // in a paper session closed between +6% and +12% while the losses filled at -21% to -33% - a desk that cannot pay for
  // its own losers, whatever the entry rule does. The floor (`trailGivePct`) still protects a small peak tightly.
  {
    const e = engine({ takeProfitPct: 300, trailArmPct: 10, trailGivePct: 6 });
    assert.ok(Math.abs(e._trailGive(20) - 9) < 0.01, 'a +20% peak gives back 45% of it (9 points)');
    assert.ok(Math.abs(e._trailGive(100) - 45) < 0.01, 'a +100% peak gives back 45 points, so a runner has room to run');
    assert.ok(Math.abs(e._trailGive(5) - 6) < 0.01, 'under the floor the profile\'s own give-back still applies');
  }

  // The whole point of the wider room: a runner that pulls back 20 points and then doubles is still held.
  {
    const e = engine({ takeProfitPct: 300, trailArmPct: 10, trailGivePct: 6 });
    const p = open(e, 'RUNNER');
    p.mc = at(100);
    e._tick(); e._tick();
    await settle();
    assert.ok(e.positions.has('RUNNER'), 'a +97% net peak is not sold on the way up');
    p.mc = at(80);
    e._tick(); e._tick();
    await settle();
    assert.ok(e.positions.has('RUNNER'), 'a 20-point pull-back from a +97% peak is inside the room it earned');
    p.mc = at(200);
    e._tick(); e._tick();
    await settle();
    assert.ok(e.positions.has('RUNNER'), 'and the runner is still open at +194% net');
  }

  // The trailing stop protects a runner: peak 47% net, a pull-back inside the room it earned holds, a bigger one closes.
  {
    const e = engine({ takeProfitPct: 80 });
    const p = open(e, 'TRAIL');
    p.mc = at(50);
    e._tick(); e._tick();
    await settle();
    assert.ok(e.positions.has('TRAIL'), 'the peak is tracked but nothing fires yet');

    p.mc = at(45);
    e._tick(); e._tick();
    await settle();
    assert.ok(e.positions.has('TRAIL'), 'a small give back from the peak holds the position');

    // RULE CHANGED: 45% of a +47% net peak is 21 points of room, so the give-back that closes it is a bigger one.
    p.mc = at(25);
    e._tick(); e._tick();
    await settle();
    assert.ok(!e.positions.has('TRAIL'), 'a give back past the peak\'s own room closes it');
    assert.match(e.history[0].reason, /Trailing stop/);
    assert.match(e.history[0].reason, /peaked at \+/);
  }

  // A closed trade carries what it was worth at best, what fired it and how long it was held: the row in the window
  // has to be readable without the log, and a trade that peaked at +41% and filled at +8% has to keep that fact.
  {
    const e = engine({ takeProfitPct: 60, tp1Pct: 0 });
    const p = open(e, 'ROW');
    p.mc = at(45);
    e._tick(); e._tick();
    await settle();
    assert.ok(e.positions.has('ROW'), 'nothing closes on the way up');
    p.mc = at(75);
    e._tick(); e._tick();
    await settle();
    assert.ok(!e.positions.has('ROW'));
    const row = e.history[0];
    assert.ok(typeof row.heldSec === 'number' && row.heldSec >= 0, 'the row knows how long the coin was held');
    assert.ok(row.peakPct > 40, `the row keeps the best it was worth (got ${row.peakPct})`);
    assert.ok(row.firedPct != null && row.firedPct >= 60, `the row keeps the move that fired the rule (got ${row.firedPct})`);
  }

  // Partial take profit: half out at the first rung, the rest keeps running.
  {
    const e = engine({ tp1Pct: 20, tp1SellPct: 50 });
    const p = open(e, 'PART', 1);
    p.mc = at(25);
    e._tick(); e._tick();
    await settle();
    assert.ok(e.positions.has('PART'), 'the position stays open after the first rung');
    assert.strictEqual(e.positions.get('PART').tp1Done, true, 'the rung is marked so it cannot fire twice');
    assert.ok(Math.abs(e.positions.get('PART').solIn - 0.5) < 1e-9, 'half the size was sold');
    assert.strictEqual(e.books.paper.trades, 0, 'a partial sale is not a closed trade');
    assert.match(e.history[0].reason, /part 1/);
    assert.ok(e.history[0].pnlSol > 0, 'the rung banked a profit');
    assert.ok(e.paper.balance > 5, 'and the paper balance grew');

    // The rest exits on the hard target.
    p.mc = at(50);
    e._tick(); e._tick();
    await settle();
    assert.ok(!e.positions.has('PART'), 'the runner closes on the target');
    assert.strictEqual(e.books.paper.trades, 1, 'one round trip counted once');
  }

  // Stop loss is measured on the same net number the card shows: a 20% stop fires when the ticket is really
  // down 20%, which on this market is about a 17% fall of the price (the round trip costs 3%).
  {
    const e = engine();
    const p = open(e, 'SL');
    p.mc = at(-14);
    e._tick(); e._tick();
    await settle();
    assert.ok(e.positions.has('SL'), 'a 14% fall is 17% net, still above the 20% stop');
    p.mc = at(-19);
    e._tick(); e._tick();
    await settle();
    assert.ok(!e.positions.has('SL'), 'a 19% fall is 22% net, past the stop');
    assert.match(e.history[0].reason, /Stop loss/);
  }

  // A cold streak pauses new entries but never blocks an exit.
  {
    const e = engine({ maxLossStreak: 2, pauseMinutes: 5 });    for (const id of ['L1', 'L2']) {
      const p = open(e, id);
      p.mc = at(-25);
      e._tick(); e._tick();
      await settle();
    }
    assert.ok(e.pausedUntil > Date.now(), 'two losses in a row paused the desk');
    const before = e.positions.size;
    await e._buy({ mint: 'BLOCKED', symbol: 'B', mc: 100 }, { score: 90, m: { buyers: 20 } });
    assert.strictEqual(e.positions.size, before, 'no entry during the pause');

    const still = open(e, 'STILL');
    still.mc = at(-25);
    e._tick(); e._tick();
    await settle();
    assert.ok(!e.positions.has('STILL'), 'an open position still exits during the pause');
  }

  // The time limit closes a coin that went nowhere.
  {
    const e = engine({ maxHoldSec: 5 });
    const p = open(e, 'TIME');
    p.openedAt = Date.now() - 6000;
    e._tick(); e._tick();
    await settle();
    assert.ok(!e.positions.has('TIME'));
    assert.match(e.history[0].reason, /Time limit/);
  }

  // Break even: a coin that has been up a real amount is never allowed to become a loss. Losses in this market
  // are mostly winners given back, and the round trip costs fees twice.
  {
    const e = engine({ breakEvenPct: 12, tp1Pct: 0, takeProfitPct: 80, trailArmPct: 90 });
    const p = open(e, 'EVEN');
    p.mc = at(20);
    e._tick(); e._tick();
    await settle();
    assert.ok(e.positions.has('EVEN'), 'a 20% run arms the rule but does not close anything');

    p.mc = at(4);
    e._tick(); e._tick();
    await settle();
    assert.ok(e.positions.has('EVEN'), 'still 1% net up, so it holds');
    p.mc = at(1);
    e._tick(); e._tick();
    await settle();
    assert.ok(!e.positions.has('EVEN'), 'back to zero leaves the position');
    assert.match(e.history[0].reason, /Break even/);

    const off = engine({ breakEvenPct: 0, takeProfitPct: 80, trailArmPct: 90 });
    const q = open(off, 'NOEVEN');
    q.mc = at(20);
    off._tick();
    await settle();
    q.mc = at(1);
    off._tick();
    await settle();
    assert.ok(off.positions.has('NOEVEN'), 'zero switches the rule off');
  }

  // RULE CHANGED: a coin that has already run is not an entry. Buying it is buying the exit of whoever is up,
  // which is what the first sessions of live-practice data showed most often.
  {
    const e = engine({ maxChange5mPct: 120, minScore: 10, minBuyers: 1, minNetFlowSol: 0.1 });
    open(e, 'HOT');
    const hot = e.tokens.get('HOT');
    hot.mcHist = [[Date.now() - 10000, 10], [Date.now(), 40]];
    // RULE CHANGED 2026-11-05: the shipped band starts at 60 SOL, and a 90 SOL coin is inside it - the point of this
    // case is the five minute ceiling, not the floor.
    hot.ext = { at: Date.now(), change5m: 180, buys: 40, sells: 5, netUsd: 500, liqUsd: 9000, mcSol: 90 };
    hot.mc = 90;
    const v = e._eval(hot, Date.now());
    assert.strictEqual(v.pass, false);
    assert.match(v.reason, /Already up 180%/);

    hot.ext.change5m = 60;
    assert.ok(e._eval(hot, Date.now()).reason !== v.reason, 'a sane move is judged on the normal rules');
  }

  // A stop that is blown through in one tick is still a stop loss, not a break even: the label has to describe
  // what happened to the money.
  {
    const e = engine({ breakEvenPct: 12, tp1Pct: 0, takeProfitPct: 80, trailArmPct: 90 });
    const p = open(e, 'GAP');
    p.mc = at(20);
    e._tick(); e._tick();
    await settle();
    assert.ok(e.positions.has('GAP'), 'a healthy run first');

    p.mc = at(-40);
    e._tick(); e._tick();
    await settle();
    assert.ok(!e.positions.has('GAP'));
    assert.match(e.history[0].reason, /Stop loss/, 'a gap through the stop is reported as the stop');
  }

  // A chain that refuses the price is not a verdict on the coin: the order is placed once more through the backup
  // route, which quotes fresh against the same market and puts the tolerance on the tokens, so the ticket stands.
  // A market that has moved to PumpSwap is marked so the backup route finds the new pool by itself.
  {
    const e = engine({ slippagePct: 25 });
    e.store.set({ mode: 'live', slippagePct: 25, maxPositions: 4, maxBuysPerMin: 10 });
    e.running = true; e.walletBalance = 5;
    const t = { mint: 'SLIP', symbol: 'SLIP', creator: 'c', createdAt: Date.now(), mc: 40, mcHist: [], trades: [], devSold: false, status: 'watching', score: 80, reason: '', lastActivity: Date.now(), launched: true, sources: new Set(['launch']) };
    e.tokens.set('SLIP', t);
    const slips = [];
    e._tradeLive = async (action, mint, sol, opt) => { slips.push(['primary', opt.slippage]); return { sig: 's' + slips.length, raw: null }; };
    e._backupTrade = async (action, mint, sol, opt) => { slips.push(['backup', opt.slippage]); return { sig: 'b' + slips.length, raw: null, landed: true }; };
    let attempts = 0;
    e._confirm = async () => { attempts++; return attempts === 1 ? { state: 'failed', err: '{"InstructionError":[3,{"Custom":6002}]}' } : { state: 'confirmed', err: '' }; };
    e._tokenBalanceRaw = async () => 7n;
    await e._buy(t, { score: 80, m: { buyers: 9 } });
    assert.strictEqual(slips.length, 2, 'the order is placed twice, never more');
    assert.strictEqual(slips[0][0], 'primary', 'the first attempt is the primary route at the smart tolerance');
    assert.deepStrictEqual(slips[1], ['backup', 25], 'the retry goes through the backup route at the ceiling the user set');
    assert.ok(e.positions.has('SLIP'), 'and the position is booked when the retry fills');

    // A curve that has already moved on is marked graduated. With the setting on, the retry follows it to the new
    // pool through the backup route; with it off (the default) the coin is left alone instead of being traded on a
    // market the user switched off - and it is not asked a second time.
    const g = { mint: 'MOVED', symbol: 'MOVED', creator: 'c', createdAt: Date.now(), mc: 40, mcHist: [], trades: [], devSold: false, status: 'watching', score: 80, reason: '', lastActivity: Date.now(), launched: true, sources: new Set(['launch']) };
    e.tokens.set('MOVED', g);
    e.store.set({ allowGraduated: true });
    const routes = [];
    e._tradeLive = async (action, mint, sol, opt) => { routes.push(['primary', opt.pool]); return { sig: 'x', raw: null }; };
    e._backupTrade = async () => { routes.push(['backup', 'auto']); return { sig: 'xb', raw: null, landed: true }; };
    let n = 0;
    e._confirm = async () => { n++; return n === 1 ? { state: 'failed', err: '{"InstructionError":[3,{"Custom":6005}]}' } : { state: 'confirmed', err: '' }; };
    await e._buy(g, { score: 80, m: { buyers: 9 } });
    assert.deepStrictEqual(routes, [['primary', 'pump'], ['backup', 'auto']], 'the second attempt follows the coin to the market it moved to');
    assert.strictEqual(g.graduated, true);

    const off = { mint: 'LEFT', symbol: 'LEFT', creator: 'c', createdAt: Date.now(), mc: 40, mcHist: [], trades: [], devSold: false, status: 'watching', score: 80, reason: '', lastActivity: Date.now(), launched: true, sources: new Set(['launch']) };
    e.tokens.set('LEFT', off);
    e.store.set({ allowGraduated: false });
    const pools2 = [];
    e._tradeLive = async (action, mint, sol, opt) => { pools2.push(opt.pool); return { sig: 'y', raw: null }; };
    e._confirm = async () => ({ state: 'failed', err: '{"InstructionError":[3,{"Custom":6005}]}' });
    await e._buy(off, { score: 80, m: { buyers: 9 } });
    assert.deepStrictEqual(pools2, ['pump'], 'a coin that graduated is not traded when that is switched off');
    assert.strictEqual(e.positions.has('LEFT'), false);
    assert.strictEqual(off.graduated, true, 'and it is remembered as graduated');

    // 6063 is UnsupportedQuoteMint: a curve quoted in something other than SOL. Measured on chain, no tolerance and
    // no route can fill it, so the coin is retired after one attempt instead of being paid for again.
    const q = { mint: 'QUOTE', symbol: 'QUOTE', creator: 'c', createdAt: Date.now(), mc: 40, mcHist: [], trades: [], devSold: false, status: 'watching', score: 80, reason: '', lastActivity: Date.now(), launched: true, sources: new Set(['launch']) };
    e.tokens.set('QUOTE', q);
    const pools3 = [];
    let backups = 0;
    e._tradeLive = async (action, mint, sol, opt) => { pools3.push(opt.pool); return { sig: 'z', raw: null }; };
    e._backupTrade = async () => { backups++; return { sig: 'zb', raw: null, landed: true }; };
    e._confirm = async () => ({ state: 'failed', err: '{"InstructionError":[3,{"Custom":6063}]}' });
    await e._buy(q, { score: 80, m: { buyers: 9 } });
    assert.deepStrictEqual(pools3, ['pump'], 'exactly one attempt is paid for');
    assert.strictEqual(backups, 0, 'and no backup order is spent on a curve that cannot quote SOL');
    assert.strictEqual(q.unsupported, true);
    assert.strictEqual(e.positions.has('QUOTE'), false);
    assert.match(e._eval(q, Date.now()).reason, /another token/);
  }

  // A position the RPC could not vouch for is dropped, not booked, when the wallet proves its buy never landed:
  // a sale that never happened must not appear in the live result as a real one.
  {
    const e = engine({ mode: 'live' });
    e.store.set({ mode: 'live' });
    const p = { mint: 'PHANTOM', symbol: 'PHANTOM', entryMc: 100, mc: 100, peakMc: 100, solIn: 0.001, feeBuy: 0.00005, openedAt: Date.now(), status: 'open', closing: false, paper: false, fails: 0, nextTry: 0, sig: null, tokIn: null };
    e.positions.set('PHANTOM', p);
    e._tradeLive = async () => { throw new Error('Nothing to sell'); };
    e._tokenBalanceRaw = async () => 0n;
    await e._sell(p, 'Stop loss');
    assert.strictEqual(e.positions.has('PHANTOM'), false, 'the phantom leaves the book');
    assert.strictEqual(e.history.length, 0, 'and nothing is booked as a sale');
    assert.strictEqual(e.books.live.pnl, 0, 'the live result is untouched');
  }

  // Statistics live in two books, so practice results can never be mistaken for real ones.
  {
    const e = engine();
    const p = open(e, 'BOOKS');
    p.mc = at(46);
    e._tick(); e._tick();
    await settle();
    assert.strictEqual(e.books.paper.trades, 1, 'the practice book counts the round trip');
    assert.strictEqual(e.books.live.trades, 0, 'the real book is untouched');
    assert.ok(e.books.paper.pnl > 0);

    e.resetStats('paper');
    assert.strictEqual(e.books.paper.trades, 0);
    assert.strictEqual(e.books.paper.pnl, 0);
    assert.strictEqual(e.history.length, 0, 'and the practice trades leave the list');
  }

  // The sell side of the same ladder. It is a separate path in the engine, and it carried a bare `s` that only
  // showed up live: "VOLITION has not sold yet: s is not defined" meant every refused sell skipped the rescue and
  // waited for the slow retry instead.
  // RULE CHANGED: an urgent exit now asks BOTH doors at once (the first signed transaction wins), so a stalled
  // primary cannot hold a stop - a refused primary then re-quotes through the backup route, which is the third call
  // in the slip list below.
  {
    const e = engine({ slippagePct: 25 });
    e.store.set({ mode: 'live', slippagePct: 25, autoReclaim: false });
    e.running = true; e.walletBalance = 5;
    e._sweepDust = async () => {};
    e._scheduleReclaim = () => {};
    const p = {
      mint: 'SELLSLIP', symbol: 'SELLSLIP', entryMc: 100, mc: 100, peakMc: 100, solIn: 0.001, feeBuy: 0,
      openedAt: Date.now(), status: 'open', closing: false, paper: false, fails: 0, nextTry: 0, tokIn: 1000n,
    };
    e.positions.set('SELLSLIP', p);
    e.tokens.set('SELLSLIP', { mint: 'SELLSLIP', symbol: 'SELLSLIP', mc: 100, mcHist: [], trades: [], status: 'bought', sources: new Set(['launch']) });
    const slips = [];
    e._tradeLive = async (action, mint, sol, opt) => { slips.push(['primary', opt.slippage]); return { sig: 'p1', raw: null }; };
    let held = 1000n;
    e._backupTrade = async (action, mint, sol, opt) => { slips.push(['backup', opt.slippage]); held = 0n; return { sig: 'b1', raw: null, landed: true }; };
    let n = 0;
    e._confirm = async () => { n++; return n === 1 ? { state: 'failed', err: '{"InstructionError":[3,{"Custom":6002}]}' } : { state: 'confirmed', err: '' }; };
    e._tokenBalanceRaw = async () => held;
    e._finishSell = (pos, why) => { e.positions.delete(pos.mint); e.sold = why; };
    await e._sell(p, 'Stop loss', 100);
    assert.strictEqual(slips.filter((x) => x[0] === 'primary').length, 1, 'the primary door is asked once');
    assert.strictEqual(slips.filter((x) => x[0] === 'backup').length, 1, 'the backup is submitted only after a definite primary rejection');
    assert.ok(slips.every((x) => x[1] === 25), `every attempt carries the exit's own tolerance, got ${JSON.stringify(slips)}`);
    assert.strictEqual(e.sold, 'Stop loss', 'and the exit is booked once it fills');
    assert.ok(!e.positions.has('SELLSLIP'));
  }

  // A wallet under the rent-exempt floor cannot pay any fee, so an exit is refused before an order is wasted and the
  // owner is told the one thing only he can fix. Measured live: 0.000658 SOL with two profitable positions that could
  // not be sold, and every log line said "not confirmed by the RPC", which is not the problem.
  {
    const e = engine({ mode: 'live', maxHoldSec: 0 });
    const said = [];
    e._log = (level, msg) => said.push({ level, msg });
    e.walletBalance = 0.000658;
    const p = open(e, 'NOFEE');
    p.paper = false;
    p.status = 'open';
    let ordered = 0;
    e._tradeLive = async () => { ordered++; return { sig: 'x', raw: null }; };
    e._backupTrade = async () => { ordered++; return { sig: 'y', raw: null }; };
    await e._sell(p, 'Stop loss', 100);
    assert.strictEqual(ordered, 0, 'no order is sent from a wallet that cannot pay a fee');
    assert.ok(e.positions.has('NOFEE'), 'the position stays in the book, so it closes by itself after a deposit');
    assert.ok(p.nextTry > Date.now(), 'and it is tried again, not abandoned');
    const line = said.find((l) => /0\.00089/.test(l.msg));
    assert.ok(line, 'the trader is told the rent floor, in plain words');
    assert.strictEqual(line.level, 'error');
    assert.match(line.msg, /65|W/, 'with the address to send to');
    assert.ok(!said.some((l) => /has not sold yet/.test(l.msg)), 'and not with the misleading not-confirmed sentence');
  }

  // The reserve: an entry may never spend the SOL that pays the exits, and an order in flight is not offered again
  // while the chain reading is still behind.
  {
    const e = engine({ mode: 'live', buyAmountSol: 0.01 });
    const said = [];
    e._log = (level, msg) => said.push({ level, msg });
    e.walletBalance = 0.02;
    assert.ok(Math.abs(e._freeSol() - 0.018) < 1e-9, 'the reserve is not spendable');
    e._noteSpend(0.005);
    assert.ok(Math.abs(e._freeSol() - 0.013) < 1e-9, 'an order in flight is counted against the wallet');
    e.walletBalance = 0.004;
    const t = { mint: 'RESERVE', symbol: 'RESERVE', mc: 100, status: 'watching' };
    await e._buy(t, { score: 90, m: { buyers: 20 } });
    assert.strictEqual(e.positions.size, 0, 'a 0.004 SOL wallet does not buy a 0.001 ticket with a 0.002 reserve');
    assert.ok(said.some((l) => /keep the exit fees aside/.test(l.msg)), 'and it says so');
  }

  // A take profit that has slipped back to break-even before the order went out is not sold: the rule is that
  // a winner is never closed at a loss, and the stop or the trail decides afterwards.
  {
    const e = engine({ takeProfitPct: 40, maxHoldSec: 600, trailArmPct: 0, breakEvenPct: 0 });
    const p = open(e, 'SLIP');
    p.paper = false;
    p.entryMc = 100;
    p.mc = 100;
    p.tokIn = 1000n;
    let ordered = 0;
    e._tradeLive = async () => { ordered++; return { sig: 'x', raw: null }; };
    e._backupTrade = async () => { ordered++; return { sig: 'y', raw: null }; };
    e._tokenBalanceRaw = async () => 1000n;
    await e._sell(p, 'Take profit', 100);
    assert.strictEqual(ordered, 0, 'a winner that slipped to a loss is not sold');
    assert.ok(p.nextTry > Date.now(), 'and it is looked at again on the next tick');
    assert.strictEqual(p.closing, false, 'the position stays open, not stuck');
  }

  // The safeguard: a level has to HOLD before the bot sells. One tick that touches +60% and is
  // gone again must not close anything, and the same level held for the window must.
  {
    const e = engine({ takeProfitPct: 40, triggerHoldMs: 300 });
    const p = open(e, 'HOLD');
    p.mc = at(60);
    e._tick();
    await settle();
    assert.ok(e.positions.has('HOLD'), 'a single reading does not sell, however high');
    e._tick();
    await settle();
    assert.ok(e.positions.has('HOLD'), 'nor does a second reading inside the window');
    await new Promise((r) => setTimeout(r, 320));
    e._tick();
    await settle();
    assert.ok(!e.positions.has('HOLD'), 'a level that holds for the window is sold');
    assert.match(e.history[0].reason, /Take profit/);
  }

  // A spike far above its target is an exit where two round trips decide whether the spike is kept: both doors are
  // asked at once and the first signed transaction wins.
  // RULE CHANGED: this used to be reached through a "Stop loss" at +97%, which is exactly the nonsense the new
  // re-check refuses (a stop cannot sell a profit). A runner that really is giving back from its peak still races both
  // doors.
  // RULE CHANGED AGAIN: the give-back that makes a trailing sale genuine is a share of the peak now, so this coin that
  // peaked at +117% net has to be 52 points down before the trail is really gone - the price here is +42% net.
  {
    const e = engine({ takeProfitPct: 30, maxHoldSec: 600, trailArmPct: 0, breakEvenPct: 0 });
    const p = open(e, 'SPIKE');
    p.paper = false;
    p.entryMc = 100;
    p.mc = at(45);
    p.peakMc = at(120);
    p.tokIn = 1000n;
    const asked = { primary: 0, backup: 0 };
    e._tradeLive = async () => { asked.primary++; return { sig: 'P', raw: null }; };
    e._backupTrade = async () => { asked.backup++; await new Promise((r) => setTimeout(r, 60)); return { sig: 'B', raw: null }; };
    e._confirm = async () => ({ state: 'confirmed', err: '' });
    e._tokenBalanceRaw = async () => 0n;
    e._finishSell = (pos, why) => { e.positions.delete(pos.mint); e.sold = why; };
    await e._sell(p, 'Trailing stop (peaked at +117.0%)', 100);
    assert.strictEqual(asked.primary, 1, 'one signed order is submitted');
    assert.strictEqual(asked.backup, 0, 'a confirmed primary sale never starts a second order');
    assert.match(String(e.sold), /Trailing stop/, 'and the exit is booked once it fills');
  }

  // A trade on a coin that is held prices it the moment it arrives, with no poll and no network in front of it, and
  // stamps a fresh reading so a held level can fire. Measured live, the poll used to await a quote request first, so a
  // move the stream had already delivered was acted on hundreds of milliseconds late.
  {
    const e = engine({ triggerHoldMs: 0 });
    const p = open(e, 'FAST');
    assert.ok(!p.pxAt, 'a fresh position has no reading yet');
    // RULE CHANGED 2026-11-05: the print used here is +48%, under the wild-move line. A print that jumps the price by
    // more than half is now asked to appear twice even on the first reading (measured on $sol: a 4x first print
    // fired "Take profit at +301.4%" into a fill at -15.0%), and that rule has its own test below.
    e.ingest({ mint: 'FAST', txType: 'buy', marketCapSol: 148, solAmount: 1, traderPublicKey: 'someone' });
    assert.ok(Math.abs(p.mc - 148) < 0.01, `the trade itself set the price, got ${p.mc}`);
    assert.strictEqual(p.pxSource, 'chain');
    assert.ok(p.pxAt > 0, 'and the reading is stamped');
    e._tick();
    await settle();
    assert.ok(e.positions.has('FAST'), 'the first sight of a level only arms it');
    e.ingest({ mint: 'FAST', txType: 'buy', marketCapSol: 162, solAmount: 1, traderPublicKey: 'someone' });
    e._tick();
    await settle();
    assert.ok(!e.positions.has('FAST'), 'the second fresh reading fires the exit - no poll was involved');
    assert.match(e.history[0].reason, /Take profit/);
  }

  // The positions panel must move with the market, not with the slowest timer on the page: a price change on a held
  // coin is pushed on its own channel at once, and a quiet tick pushes nothing at all.
  {
    const e = engine();
    const p = open(e, 'FASTPX');
    e._persistPositions();
    const pushes = [];
    e.on('positions', (list) => pushes.push(list));
    e._pushPositions();
    assert.strictEqual(pushes.length, 1, 'a structural change is pushed immediately');
    assert.strictEqual(pushes[0][0].mint, 'FASTPX');
    e._pushPositions();
    assert.strictEqual(pushes.length, 1, 'a quiet tick pushes nothing');
    const t = e.tokens.get('FASTPX');
    t.lastStreamAt = Date.now();
    t.mc = 130;
    e._pricePosition(p, Date.now());
    e._pushPositions();
    assert.strictEqual(pushes.length, 2, 'a price change is pushed');
    assert.ok(pushes[1][0].pnlPct > 25, `the percentage travelled with it, got ${pushes[1][0].pnlPct}`);
  }

  // A risk rule is re-checked right before the order is signed: a stop that fired on a dip the coin has already
  // recovered from does not sell. Measured live, a coin was closed with "Stop loss" written on it at +5.9% - the bot
  // paying a whole round trip to lower a risk that had already gone away.
  {
    const logs = [];
    const e = engine();
    e._log = (lvl, msg) => logs.push(msg);
    const p = open(e, 'RECOV');
    p.paper = false; p.status = 'open'; p.tokIn = 1000n; p.solIn = 0.01; p.feeBuy = 0;
    let asked = 0;
    e._tradeLive = async () => { asked++; return { sig: 'S', raw: null, landed: true }; };
    e._backupTrade = async () => { asked++; return { sig: 'B', raw: null, landed: true }; };
    p.mc = at(12);                                 // +12% gross on a 0.01 ticket is +5% after every cost: no loss
    await e._sell(p, 'Stop loss', 100);
    assert.strictEqual(asked, 0, 'no order is built for a loss that is no longer there');
    assert.ok(e.positions.has('RECOV'), 'the position stays and is watched again');
    assert.ok(logs.some((l) => /no longer there/.test(l)), 'and the log says why it was not sold');
    assert.ok(!p.closing, 'the position is not left locked by the abandoned sale');
  }

  // The same guard for the trail: a coin that bounced back above its give-back level is not a trail exit.
  {
    const e = engine();
    const p = open(e, 'TRAILUP');
    p.paper = false; p.status = 'open'; p.tokIn = 1000n; p.solIn = 0.01; p.feeBuy = 0; p.tp1Done = true;
    let asked = 0;
    e._tradeLive = async () => { asked++; return { sig: 'S', raw: null, landed: true }; };
    p.peakMc = at(50);
    p.mc = at(48);
    await e._sell(p, 'Trailing stop (peaked at +47.0%)', 100);
    assert.strictEqual(asked, 0, 'a bounce above the give-back is not a trail exit');
  }

  // A runner is no longer handed the whole tolerance. 40% did not fill better, it removed the floor: a position at
  // +40% filled at -30% on a spike. A spike now gets SPIKE_SLIP, and anything worse is refused.
  // RULE CHANGED: the tight tolerance is no longer keyed on "twice the target" (which a moon target never reaches) or
  // on the size of the move: ANY exit still in profit gets SPIKE_SLIP, and only an exit that is under water keeps the
  // wide tolerance it needs in order to fill at all.
  {
    const e = engine({ takeProfitPct: 30 });
    open(e, 'SPIKE');
    assert.strictEqual(e._slippageFor('SPIKE', true, 70), 15, 'a spike gets 15%, not 40%');
    assert.strictEqual(e._slippageFor('SPIKE', true, 5), 15, 'and so does a small profit: a 40% order may fill at -32%');
    assert.ok(e._slippageFor('SPIKE', true, -12) >= 20, 'a losing exit keeps its wide tolerance, because it has to fill');
    // RULE CHANGED: a take profit is an exit too. The user's slippage is an ENTRY ceiling, and with a 1% setting every
    // take profit was refused the moment the pool moved - the retry was priced where the coin was by then, and a +70%
    // winner was booked at -89% with the coin back up two seconds later. A profit exit now gets at least SPIKE_SLIP.
    const tight = engine({ takeProfitPct: 30, slippagePct: 1 });
    open(tight, 'TIGHT');
    assert.ok(tight._slippageFor('TIGHT', false, 70) >= 15, `a 1% ceiling cannot wedge a take profit, got ${tight._slippageFor('TIGHT', false, 70)}`);
    assert.ok(tight._slippageFor('TIGHT', false, -5) >= 1, 'and an exit under water still asks for its own room');
    assert.ok(tight._slippageFor('TIGHT', true, 70) >= 15, 'a stop still has room');
  }

  // A price that is not arriving any more must not look like a price. Measured live on 2026-11-05: a coin went from a
  // 50k market cap to nothing while the position card kept printing +71%, and a trader sold it by hand because the
  // bot never did. Two separate faults made that possible, and both are held here.
  {
    // 1) A FALL is the market and is taken on the first reading, whatever its size. Only a jump UP needs a second
    // opinion. The old guard refused both, and because the refused reading was never accepted, the old number stayed
    // for ever: every later reading was "too big a jump" from it too.
    const e = engine({ takeProfitPct: 500, stopLossPct: 30, trailArmPct: 0, maxHoldSec: 3600, triggerHoldMs: 0 });
    const p = open(e, 'CRASH');
    p.mc = 100; p.pxAt = Date.now(); p.pxSource = 'chain';
    p.extRef = { priceUsd: 1, mc: 100 };
    p.pxPull = 0.2; p.pxPullAt = Date.now();          // the quote collapsed by 80% in one reading
    e._pricePosition(p, Date.now());
    assert.ok(Math.abs(p.mc - 20) < 0.01, `a fall of 80% in one reading is the market and is taken at once, got ${p.mc}`);
    assert.strictEqual(p.pxSource, 'quote');

    // ...while a jump UP of the same size still has to be seen twice, so one printed price cannot inflate a position.
    const q = open(e, 'PUMP');
    q.mc = 100; q.pxAt = Date.now(); q.pxSource = 'chain';
    q.extRef = { priceUsd: 1, mc: 100 };
    q.pxPull = 5; q.pxPullAt = Date.now();            // 5x in one reading
    e._pricePosition(q, Date.now());
    assert.strictEqual(q.mc, 100, 'a 5x jump is not taken on one reading');
    q.pxPull = 5; q.pxPullAt = Date.now();            // ...the same value again agrees with itself
    e._pricePosition(q, Date.now());
    assert.ok(Math.abs(q.mc - 500) < 1, `two readings that agree become the price, got ${q.mc}`);
  }
  {
    // 2) A position nobody is pricing is SOLD instead of held blind: the last number a feed gave is not what the coin
    // is worth now, and holding it is how a winner turns into nothing.
    const e = engine();
    const p = open(e, 'BLIND');
    e.history.length = 0;
    p.paper = false; p.tokIn = 1000n; p.solIn = 0.01; p.feeBuy = 0;
    let sold = null;
    e._tradeLive = async () => ({ sig: 'S', raw: null, landed: true });
    e._tokenBalanceRaw = async () => 0n;
    e._confirm = async () => ({ state: 'confirmed', err: '' });
    e._finishSell = (pos, why) => { sold = why; e.positions.delete(pos.mint); };
    p.pxAt = Date.now() - 120000;                      // two minutes with no reading
    e._tick();
    await settle();
    assert.match(String(sold), /Price lost/, `a position with no price for two minutes is closed, got ${sold}`);
    assert.ok(!e.positions.has('BLIND'));

    // A position whose price is current is never touched by that watchdog.
    const e2 = engine();
    const live = open(e2, 'LIVE');
    live.paper = false; live.tokIn = 1000n;
    let asked2 = 0;
    e2._tradeLive = async () => { asked2++; return { sig: 'S', raw: null, landed: true }; };
    live.pxAt = Date.now();
    e2._tick();
    await settle();
    assert.strictEqual(asked2, 0, 'a priced position is left to its own rules');
    assert.ok(e2.positions.has('LIVE'));

    // And the panel says how old the number is, so a still percentage cannot look live.
    const view = e2._positionsView().find((v) => v.mint === 'LIVE');
    assert.ok(view && Number.isFinite(view.pxAgeSec), 'the view carries the age of the price');
  }

  // A sale that did not come from a trigger still has to say what the coin was doing at that moment. A missing
  // `firedAt` compares as zero in JavaScript, so every manual sale printed "(Manual sell at +0.0%)" - a lie on the
  // one line the trader reads after pressing the button.
  {
    const logs = [];
    const e = engine();
    e._log = (lvl, msg) => logs.push(msg);
    const p = open(e, 'MANUAL');
    p.paper = true;
    p.mc = at(35);                                  // the coin is up 35% at the moment of the press
    p.tokIn = 1000n;
    await e._sell(p, 'Manual sell', 100, { manual: true });
    const line = logs.find((l) => /Manual sell/.test(l)) || '';
    assert.match(line, /Manual sell at \+3[0-9]/, `the line names the move that was sold, got: ${line}`);
  }

  // The two confirmation slots are separate: a curve reading and an aggregator quote are different pools, so one
  // must never be the second opinion the other needs. Here the curve's slot already holds the very number the quote
  // is about to print - the old shared slot would call that "two readings that agree" and take it.
  {
    const e = engine();
    const p = open(e, 'SLOTS');
    p.mc = 100; p.pxAt = Date.now(); p.pxSource = 'chain';
    // The curve refused this very number a moment ago, so it sits in the curve's slot. While the two shared one slot,
    // the quote below would find it there, call it "two readings that agree" and take a 3x on a single print.
    p.pxOdd = 300;
    p.pxOddCurve = 300;
    p.extRef = { priceUsd: 1, mc: 100 };
    p.pxPull = 3; p.pxPullAt = Date.now();          // the quote says 3x
    e._pricePosition(p, Date.now());
    assert.strictEqual(p.mc, 100, 'a curve number is not confirmation for a quote from another pool');
    p.pxPull = 3; p.pxPullAt = Date.now();          // ...the quote agrees with itself
    e._pricePosition(p, Date.now());
    assert.ok(Math.abs(p.mc - 300) < 1, `two quote readings that agree become the price, got ${p.mc}`);
  }

  // A position restored while a session is being set up must not be sold before any feed has answered: its price
  // clock starts when it enters this session's book, not when it was bought. Sixty seconds after a restart there is
  // still nothing to price it with, and the old rule ("no price for forty-five seconds") would sell it blind.
  {
    const e = engine();                              // maxHoldSec 600, so the time limit is not what fires here
    let sold = false;
    e._tradeLive = async () => { sold = true; return { sig: 'S', raw: null, landed: true }; };
    e._tokenBalanceRaw = async () => 1000n;
    e.positions.set('OLD', {
      mint: 'OLD', symbol: 'OLD', entryMc: 100, mc: 100, peakMc: 100, solIn: 0.01, feeBuy: 0,
      openedAt: Date.now() - 60000, bookedAt: Date.now(), status: 'open', closing: false,
      paper: false, fails: 0, nextTry: 0, pending: false, tokIn: 1000n,
    });
    e._tick();
    await settle();
    assert.strictEqual(sold, false, 'a position restored a moment ago waits for its first price');
    assert.ok(e.positions.has('OLD'));
    // ...and it is not kept for ever either: a restored coin nobody can price is closed once the longer grace is up.
    e.positions.get('OLD').bookedAt = Date.now() - 200000;
    e._tick();
    await settle();
    assert.strictEqual(sold, true, 'a restored coin that never gets a price is still sold, just later');
  }

  // The price lane for a held coin. A graduated coin has no curve left to read and the price service answers for only
  // some mints, so the board of its PumpSwap pair is the door that is always there - and it used to be asked once
  // every 1.2 s, which is a stop at -9% filling at -14%. It is now asked every half second, and only for a coin with
  // no live stream (a stream already prices it on the arrow).
  {
    const e = engine();
    const p = open(e, 'BOARD');
    p.paper = false; p.status = 'open'; p.tokIn = 1000n; p.pxAt = Date.now(); p.mc = 100; p.entryMc = 100;
    const calls = [];
    e.market.prices = async () => new Map();
    e.market.enrich = async (mints, urgent) => {
      calls.push({ mints: [...mints], urgent });
      return new Map([['BOARD', { mint: 'BOARD', priceUsd: 2, priceNative: 0, mcapUsd: 0, liquidity: { usd: 5000 } }]]);
    };
    e.rpcCall = async () => { throw new Error('no node'); };
    // The depth sweep is pushed into the future so the only thing that can ask for this coin is the fast lane.
    e._posEnrichAt = Date.now(); e._posBoardAt = 0; e._lostAt = Date.now();
    await e._pollPositions();
    assert.ok(calls.some((c) => c.urgent && c.mints.includes('BOARD')), 'the board is asked for a held coin with no stream');
    assert.ok(p.pxPull > 0, 'and its answer becomes the quote the position is priced from');

    // A coin whose stream is talking needs no board at all: the stream already carries the pool's own number.
    const t = e.tokens.get('BOARD');
    t.lastStreamAt = Date.now(); t.mc = 150;
    calls.length = 0;
    e._posEnrichAt = Date.now(); e._posBoardAt = 0;
    await e._pollPositions();
    assert.ok(!calls.some((c) => c.mints.includes('BOARD')), 'a coin with a live stream is not asked for again');

    // RULE ADDED 2026-11-05: a pair on another exchange is not this desk's market. `enrich` returns the deepest-liquidity
    // pair, and a young pump.fun coin is often listed on a copy-cat exchange with a few dollars in it. Measured in a
    // paper run on the shipped plan: one such pair quoted 4x and the target sold the position at "+434.6%" in thirty
    // seconds. A foreign row may not set the price a rule acts on.
    const p2 = open(e, 'FOREIGN');
    p2.paper = false; p2.status = 'open'; p2.tokIn = 1000n; p2.mc = 100; p2.entryMc = 100;
    const t2 = e.tokens.get('FOREIGN');
    t2.lastStreamAt = 0; t2.mc = 0;
    e.market.enrich = async (mints) => new Map([['FOREIGN', {
      mint: 'FOREIGN', dexId: 'raydium', priceUsd: 9, priceNative: 0, mcapUsd: 0, liquidity: { usd: 40 },
    }]]);
    e._posBoardAt = 0; e._posEnrichAt = Date.now(); e._lostAt = 0;
    await e._pollPositions();
    assert.ok(!(p2.pxPull > 0), 'a quote from another exchange never becomes the position\'s price');
    e.market.enrich = async () => new Map([['FOREIGN', {
      mint: 'FOREIGN', dexId: 'pumpswap', priceUsd: 1, priceNative: 0, mcapUsd: 0, liquidity: { usd: 5000 },
    }]]);
    e._posBoardAt = 0; e._lostAt = 0;
    await e._pollPositions();
    assert.ok(p2.pxPull > 0, 'its own PumpSwap pool still does');

    // RULE NARROWED 2026-11-05 (measured on $SAFU: stopped at -101.4% in one session and sold at "+1142.5%" in the next):
    // a graduated coin keeps its old pump.fun pair listed, frozen at the graduation figure. Both pairs are the coin's
    // own, so the exchange name alone cannot tell them apart - the coin's own state does.
    const p3 = open(e, 'FOSSIL');
    p3.paper = false; p3.status = 'open'; p3.tokIn = 1000n; p3.mc = 100; p3.entryMc = 100;
    e.tokens.get('FOSSIL').graduated = true;
    e.tokens.get('FOSSIL').lastStreamAt = 0;
    e.market.enrich = async () => new Map([['FOSSIL', {
      mint: 'FOSSIL', dexId: 'pumpfun', priceUsd: 40, priceNative: 0, mcapUsd: 0, liquidity: { usd: 300 },
    }]]);
    e._posBoardAt = 0; e._posEnrichAt = Date.now(); e._lostAt = 0;
    await e._pollPositions();
    assert.ok(!(p3.pxPull > 0), 'the frozen curve of a graduated coin is not a price');
  }

  // The percentage must move with the price and with nothing else. Smart fees follow the live fee market, so a
  // position measured against the current exit tip showed a percentage that wandered while the price stood still -
  // and the stop and the trail move with that number. The trade is judged on what it cost when it was taken.
  {
    const e = engine({ mode: 'live', smartFees: true, priorityFeeSol: 0.01, buyAmountSol: 0.01 });
    const p = open(e, 'FEES');
    p.paper = false; p.solIn = 0.01; p.feeBuy = 0.0002; p.feeExitEst = 0.0002; p.mc = at(20);
    e._feeSol = 0.0001;
    const quiet = e._pnlPct(p);
    e._feeSol = 0.005;                                  // the network got busy; the price did not move
    assert.strictEqual(e._pnlPct(p), quiet, 'the same price reads the same percentage whatever the fee market does');
  }

  // A position whose price is not known yet shows a dash, not a number: "0.0%" is a fact about the market, and while
  // an unadopted holding has no reference price there is no such fact to report.
  {
    const e = engine();
    const p = open(e, 'EMPTY');
    p.entryMc = 0; p.mc = 0;
    assert.strictEqual(e._positionsView()[0].pnlPct, null, 'no reference price means no percentage at all');
    p.entryMc = 100; p.mc = 100;
    assert.ok(Number.isFinite(e._positionsView()[0].pnlPct), 'and a priced coin reports the real move');
  }

  // Two entries into one coin at the same moment. The holder lookup is a network wait, so the guard made before it is
  // only a guess about the state after it. Measured in a paper session: two buys of one coin 16 ms apart, because both
  // calls passed the same check before either had written its position - two losses instead of one.
  {
    const e = engine({ deepEntry: true, minHolders: 1, maxPositions: 5, simpleMode: false });
    const buys = [];
    e._log = (lvl, msg) => { if (lvl === 'buy') buys.push(msg); };
    e._entryPrice = async () => ({ mc: 40, src: 'curve' });
    const t = { mint: 'RACE1', symbol: 'RACE', name: 'R', mc: 40, mcHist: [], trades: [], status: 'watching', score: 90, reason: '', lastActivity: Date.now(), createdAt: Date.now() };
    e.tokens.set('RACE1', t);
    const ev = { score: 90, m: { buyers: 20, net: 5 } };
    const waiting = [];
    e._holdersFor = () => new Promise((r) => waiting.push(() => r(500)));
    const cashBefore = e.paper.balance;
    const a = e._buy(t, ev);
    const b = e._buy(t, ev);
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(waiting.length, 2, 'both calls reached the network wait, so both passed the first check');
    waiting.forEach((f) => f());
    await Promise.all([a, b]);
    // The book is a map, so a second entry does not double the position - it OVERWRITES it, having spent the SOL: the
    // only witness is how many times money left.
    assert.strictEqual(buys.length, 1, `one coin is bought once, got ${buys.length}`);
    // The ticket is read from the plan, not typed here: the shipped default moved from 0.02 to 0.1 SOL in 1.0.2 and a
    // hard-coded ticket turns that into a fake failure.
    const ticket = e.s.buyAmountSol;
    assert.ok(Math.abs((cashBefore - e.paper.balance) - (ticket * 1.0175 + e.s.priorityFeeSol)) < ticket * 0.2, 'and the wallet was debited once');
  }

  // The buy path reserves a slot before pricing, but the UI must not show an unpriced candidate.
  // path holds the slot in `positions` while it asks the pool for a price, and drops it again when the price is refused
  // (500 refusals in one paper session). The panel reads the published view, so an unpaid slot must never be in it.
  {
    const e = engine({ maxPositions: 5 });
    const t = { mint: 'GHOST1', symbol: 'GHOST', name: 'G', mc: 40, mcHist: [], trades: [], status: 'watching', score: 90, reason: '', lastActivity: Date.now(), createdAt: Date.now() };
    e.tokens.set('GHOST1', t);
    e._entryPrice = async () => ({ mc: 40, refuse: 'No pool price to buy on' });
    await e._buy(t, { score: 90, m: { buyers: 20, net: 5 } });
    assert.strictEqual(e.positions.size, 0, 'a refused entry leaves nothing behind');
    assert.deepStrictEqual(e._positionsView(), [], 'and nothing was ever on the panel');

    // The price arrives while the page is already drawing: until it does, the row is not a position.
    let release;
    e._entryPrice = () => new Promise((r) => { release = () => r({ mc: 40, src: 'curve' }); });
    const t2 = { mint: 'GHOST2', symbol: 'GHOST2', name: 'G', mc: 40, mcHist: [], trades: [], status: 'watching', score: 90, reason: '', lastActivity: Date.now(), createdAt: Date.now() };
    e.tokens.set('GHOST2', t2);
    const pendingBuy = e._buy(t2, { score: 90, m: { buyers: 20, net: 5 } });
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(e.positions.has('GHOST2'), 'the slot is held while the pool is asked');
    assert.deepStrictEqual(e._positionsView(), [], 'but nothing unpaid is drawn');
    release();
    await pendingBuy;
    assert.strictEqual(e._positionsView().length, 1, 'once the pool answers, the position is on the panel');
  }

  // One trade print is not a market. A move of more than half the position's value in a single reading is asked to
  // appear twice before it moves the position: a real crash prints again within milliseconds, while a phantom print
  // (another pool, a misparsed field, one wash trade) can never fire a stop or a target on its own. Measured in a
  // paper session: a coin "stopped out" at -63% one hundred and thirty milliseconds after it was bought.
  {
    const e = engine();
    const p = open(e, 'WILD');
    p.mc = 100; p.pxAt = Date.now(); p.pxSource = 'chain'; p.pxSeed = false;
    const t = e.tokens.get('WILD');
    t.lastStreamAt = Date.now();
    t.mc = 30;                                        // one print says the coin lost 70%
    e._pricePosition(p, Date.now());
    assert.strictEqual(p.mc, 100, 'one print is not a move');
    t.mc = 30;                                        // ...the next trades agree with it
    e._pricePosition(p, Date.now());
    assert.ok(Math.abs(p.mc - 30) < 0.01, `two agreeing prints are the market, got ${p.mc}`);

    // A normal step is taken at once, with no second look: the guard only covers the absurd.
    const q = open(e, 'STEP');
    q.mc = 100; q.pxAt = Date.now(); q.pxSeed = false;
    e.tokens.get('STEP').lastStreamAt = Date.now();
    e.tokens.get('STEP').mc = 92;
    e._pricePosition(q, Date.now());
    assert.ok(Math.abs(q.mc - 92) < 0.01, 'an ordinary move is taken on the first reading');

    // RULE CHANGED 2026-11-05 (1.0.2, measured on a live trade: a position that peaked at +30.7% was booked 28 points under its level and lost 13.1%,
    // -13.1%`): a FALL is the market and is taken on the FIRST reading when the position opened on the pool's own price.
    // Holding it back until two prints happened to agree within 10% is what let a dying coin keep a stale number and
    // then book the first tidy print 28 points under the level that fired.
    const fall = open(e, 'FALL');
    fall.mc = 100; fall.pxAt = Date.now(); fall.pxSeed = false; fall.pxEntry = 'curve';
    e.tokens.get('FALL').lastStreamAt = Date.now();
    e.tokens.get('FALL').mc = 70;                     // one print, a third down
    e._pricePosition(fall, Date.now());
    assert.ok(Math.abs(fall.mc - 70) < 0.01, `a fall from a pool-priced entry is taken at once, got ${fall.mc}`);

    // A position that opened on somebody else's number (a board row) still waits for the second look: the $sol case.
    const board = open(e, 'BOARDFALL');
    board.mc = 100; board.pxAt = Date.now(); board.pxSeed = false; board.pxEntry = 'board';
    e.tokens.get('BOARDFALL').lastStreamAt = Date.now();
    e.tokens.get('BOARDFALL').mc = 40;                // a sixtieth percent fall, past the wild-move bar
    e._pricePosition(board, Date.now());
    assert.strictEqual(board.mc, 100, 'a board-priced entry still asks for a second look before believing a fall');
    e.tokens.get('BOARDFALL').mc = 39;
    e._pricePosition(board, Date.now());
    assert.ok(Math.abs(board.mc - 39) < 0.01, 'and takes it when the prints agree');

    // A spike UP is still never believed on its own, whatever the entry was.
    const spike = open(e, 'SPIKE');
    spike.mc = 100; spike.pxAt = Date.now(); spike.pxSeed = false; spike.pxEntry = 'curve';
    e.tokens.get('SPIKE').lastStreamAt = Date.now();    e.tokens.get('SPIKE').mc = 400;
    e._pricePosition(spike, Date.now());
    assert.strictEqual(spike.mc, 100, 'a four-fold print is not a market until it prints twice');

    // RULE ADDED 2026-11-05 (1.0.2): a PROFIT rule may not act on a number nobody refreshed. Measured on a live
    // trade, a give-back fired 28 points under its own level because the position had been sitting on a stale price.
    // A stop still fires - it protects money - but a target or a give-back asks for a fresh reading first.
    const stale = engine({ simpleMode: true, takeProfitPct: 20, triggerHoldMs: 0 });
    const sp = open(stale, 'STALE');
    sp.mc = 130; sp.entryMc = 100; sp.peakMc = 130; sp.pxAt = Date.now() - 5000;   // five seconds of nothing
    stale.positions.set('STALE', sp);
    let sold = 0;
    stale._sell = () => { sold++; };
    stale._tick();
    assert.strictEqual(sold, 0, 'a target does not fire on a five second old price');
    assert.ok(sp.wantPx > 0, 'and the position asks for a fresh one');
    sp.pxAt = Date.now();                                                            // the price arrives
    stale._tick();
    assert.strictEqual(sold, 0, 'the trigger is armed on the first fresh reading, as always');
    sp.pxAt = Date.now() + 1;                                                        // a second reading confirms it
    stale._tick();
    assert.strictEqual(sold, 1, 'and then the rule acts');
    // A RISK rule is not blocked by the freshness guard: it arms on a stale reading and sells as soon as it can confirm.
    const sp2 = open(stale, 'STALELOSS');
    sp2.mc = 60; sp2.entryMc = 100; sp2.pxAt = Date.now() - 5000;
    stale.positions.set('STALELOSS', sp2);
    sold = 0;
    stale._tick();
    assert.strictEqual(sold, 0, 'the first reading only arms it, exactly as before');
    assert.ok(!sp2.wantPx, 'and a stop does not wait for a fresh quote the way a target does');
    sp2.pxAt = Date.now() + 1;
    stale._tick();
    assert.strictEqual(sold, 1, 'a stop fires on whatever reading it has');

    // The entry read is shorter when the coin's own tape is fresh: the pool's number is only confirmation then.
    // RULE CHANGED 2026-11-05 (1.0.4: the scan and the tick were too slow for a sniper): the budgets came down
    // from 450/700 ms to 300/500 ms, and a coin with a fresh tape no longer reaches this read at all (`_entryPrice` prices it
    // from the trade it just printed). The rule itself is unchanged: a fresh tape gets the short wait, a quiet coin the long one.
    assert.strictEqual(stale._entryBudget({ lastStreamAt: Date.now() }), 300, 'a fresh stream means a 300 ms read');
    assert.strictEqual(stale._entryBudget({ lastStreamAt: Date.now() - 9000 }), 500, 'a quiet coin gets the full wait');
  }

  // RULE ADDED: the simple plan keeps ONE protective rule. It has no trail of its own, and a coin that peaked at
  // +61.3% was booked at -89.2% with the coin back up two seconds later - the whole session's loss in one trade. Once
  // a position has been up SIMPLE_RUN_ARM, half of that peak is kept.
  {
    const e = engine({ simpleMode: true, takeProfitPct: 50, stopLossPct: 30, maxHoldSec: 3600 });
    let sold = null;
    e._sell = (p, why) => { sold = why; };
    const p = open(e, 'GIVEBACK');
    p.paper = false; p.peakMc = at(61.3); p.mc = at(25);      // gave back more than half of a +61% run
    e.positions.set('GIVEBACK', p);
    e._tick();                                                // the first sight of a level only arms it
    e._tick();                                                // the second fresh reading fires it
    assert.match(String(sold), /Peak give-back/, `a +61% run is not allowed to turn into a loss, got ${sold}`);

    // A small move gets no such treatment: below the arm the stop and the target are the whole plan.
    const e2 = engine({ simpleMode: true, takeProfitPct: 50, stopLossPct: 30, maxHoldSec: 3600 });
    let sold2 = null;
    e2._sell = (p, why) => { sold2 = why; };
    const q = open(e2, 'SMALLRUN');
    q.paper = false; q.peakMc = at(15); q.mc = at(6);
    e2.positions.set('SMALLRUN', q);
    e2._tick();
    assert.strictEqual(sold2, null, 'a +15% peak is not a run worth protecting');

    // The full desk keeps its own trail and is untouched by this rule.
    const e3 = engine({ simpleMode: false, trailArmPct: 50, takeProfitPct: 200, stopLossPct: 90 });
    let sold3 = null;
    e3._sell = (p, why) => { sold3 = why; };
    const r = open(e3, 'FULLDESK');
    r.paper = false; r.peakMc = at(61.3); r.mc = at(25);
    e3.positions.set('FULLDESK', r);
    e3._tick();
    assert.strictEqual(sold3, null, 'the full desk is not given the simple plan rule');
  }

  // RULE ADDED 2026-11-05: the closed trades and the running totals are ON DISK. They used to live in memory only, so
  // every restart wiped the day's profit and loss and the panel claimed a session that had never traded - and this
  // app is restarted a dozen times a day while it is being tended.
  {
    const bookDir = fs.mkdtempSync(path.join(scratchDir, 'exits-book-'));
    const e1 = engine({}, bookDir);
    const p1 = open(e1, 'KEEP', 1);
    p1.mc = 100 * (1 + 60 / 100);
    e1._tick(); e1._tick();
    await settle();
    assert.ok(!e1.positions.has('KEEP'), 'the coin really was sold in the first session');
    assert.strictEqual(e1.books.paper.trades, 1, 'and the book counted it');
    const booked = e1.books.paper.pnl;
    assert.ok(booked !== 0, 'with a real profit in it');

    // A second engine on the same folder is what a restart really is.
    const e2 = engine({}, bookDir);
    assert.strictEqual(e2.books.paper.trades, 1, 'the restart knows the trade happened');
    assert.strictEqual(e2.books.paper.pnl, booked, 'and keeps the profit, to the lamport');
    assert.strictEqual(e2.history.length, 1, 'the closed trade is still on the list');
    assert.strictEqual(e2.history[0].symbol, 'KEEP');
    assert.match(e2.history[0].reason, /Take profit/, 'with the rule that closed it');
    // Clearing the numbers is a decision, so it must survive a restart too - otherwise "Reset" is a lie.
    e2.resetStats('paper');
    const e3 = engine({}, bookDir);
    assert.strictEqual(e3.books.paper.trades, 0, 'a cleared book stays cleared');
    assert.strictEqual(e3.history.length, 0);
    fs.rmSync(bookDir, { recursive: true, force: true });
  }

  fs.rmSync(dir, { recursive: true, force: true });
  // RULE ADDED 2026-11-05: the SOL a sale really moved is read from the transaction, and a LEGACY transaction names
  // its keys `accountKeys` while a v0 one names them `staticAccountKeys`. Reading only the v0 name made every legacy
  // sale unmeasurable, and "unmeasurable" books an estimate - measured live: LIBRE booked +0.0044 SOL where the wallet
  // gained +0.0146 SOL, a winner reported at a third of its size.
  {
    const e = engine();
    delete e._measureProceeds; // the real one, with its second look
    const kp = wallet.keypair; // null in this harness: the fee payer is faked instead
    const owner = { toBase58: () => 'OWNOUR' };
    e.wallet = { keypair: { publicKey: owner } };
    const legacy = {
      meta: { preBalances: [5, 1000000000], postBalances: [5, 1005000000] },
      transaction: { message: { accountKeys: [{ toBase58: () => 'OTHER' }, { toBase58: () => 'OWNOUR', equals: (k) => k === owner }] } },
    };
    e.rpcCall = async () => legacy;
    assert.strictEqual(await e._txSolDelta('SIG'), 0.005, 'a legacy sale is measured');
    const v0 = {
      meta: { preBalances: [1000000000], postBalances: [1002000000] },
      transaction: { message: { staticAccountKeys: [{ equals: (k) => k === owner }] } },
    };
    e.rpcCall = async () => v0;
    assert.strictEqual(await e._txSolDelta('SIG'), 0.002, 'and so is a versioned one');
    e.rpcCall = async () => ({ meta: { preBalances: [1], postBalances: [2] }, transaction: { message: {} } });
    assert.strictEqual(await e._txSolDelta('SIG'), null, 'a transaction with no keys is honestly unknown');
    e.rpcCall = async () => { throw new Error('rpc down'); };
    assert.strictEqual(await e._txSolDelta('SIG'), null, 'and an unreachable node is unknown too, never a guess');
    // A node that has not indexed the sale yet is asked once more, half a second later: an estimate is a third of the
    // truth on a real sale (LIBRE, 2026-11-05).
    let calls = 0;
    e._txSolDelta = async () => (++calls === 1 ? null : 0.0146);
    assert.strictEqual(await e._measureProceeds('SIG'), 0.0146, 'the second look measures the sale');
    assert.strictEqual(calls, 2, 'exactly one second look, not a loop');
    calls = 0;
    e._txSolDelta = async () => { calls++; return 0.02; };
    assert.strictEqual(await e._measureProceeds('SIG'), 0.02);
    assert.strictEqual(calls, 1, 'a sale that measured the first time is not asked twice');
    // A node that hands the RPC pool on to another endpoint answers a little later, so the last look is worth waiting
    // for: measured live, three sales in a row booked estimates while the public nodes rotated.
    calls = 0;
    e._txSolDelta = async () => (++calls < 3 ? null : 0.031);
    assert.strictEqual(await e._measureProceeds('SIG'), 0.031, 'a third look catches a slower node');
    assert.strictEqual(calls, 3, 'and then it stops asking');
  }

  // RULES ADDED 2026-11-05, all three measured live on one stuck position (SAFU):
  //  • a SALE lets the door find its own pool - naming `pump` for a coin that graduated made the door answer "Pool
  //    account not found" for ever;
  //  • the backup route rests for a minute after refusing to quote, instead of being waited for on every attempt;
  //  • a coin whose pool has no liquidity is said ONCE, in words, and re-checked in ten minutes - not every second.
  {
    const e = engine();
    const seen = [];
    e._tradeLive = async (action, mint, amount, opt) => {
      seen.push(opt);
      if (opt.pool === 'pump') throw Object.assign(new Error('the trade door refused it (Pool account not found)'), { phase: 'build' });
      throw Object.assign(new Error('the wallet holds nothing to sell'), { phase: 'build', noFee: true });
    };
    const p = open(e, 'GRAD');
    p.paper = false; p.solIn = 0.01; p.feeBuy = 0; p.graduated = false;
    e.wallet.keypair = { publicKey: { toBase58: () => 'OWNOUR' } };
    await e._sell(p, 'Stop loss', 100).catch(() => {});
    assert.ok(seen.length >= 1, 'the sale really tried a door');
    assert.ok(seen.every((o) => o.pool === 'auto'), 'and it never guesses the curve (urgent path)');
    // The non-urgent path asks one door at a time, and it must name no pool either: a take profit on a coin the desk
    // never saw graduate was refused for twenty minutes on the live wallet.
    const quietSeen = [];
    const e2 = engine();
    e2._tradeLive = async (action, mint, amount, opt) => {
      quietSeen.push(opt);
      throw Object.assign(new Error('the wallet holds nothing to sell'), { phase: 'build', noFee: true });
    };
    const q = open(e2, 'GRAD2');
    q.paper = false; q.solIn = 0.01; q.feeBuy = 0; q.graduated = false;
    q.mc = 150;                                  // a take profit only fires while the coin is up
    e2.tokens.get('GRAD2').mc = 150;
    e2.wallet.keypair = { publicKey: { toBase58: () => 'OWNOUR' } };
    await e2._sell(q, 'Take profit', 100).catch(() => {});
    assert.ok(quietSeen.length >= 1, 'the quiet path really tried a door');
    assert.ok(quietSeen.every((o) => o.pool === 'auto'), 'and it never guesses the curve (quiet path)');
  }
  {
    const e = engine();
    let asked = 0;
    e._jupiterSwap = async () => { asked++; throw new Error('Jupiter has no route (400: Failed to get quotes)'); };
    await assert.rejects(() => e._backupTrade('sell', 'M', null, {}), /Failed to get quotes/);
    assert.strictEqual(asked, 1);
    await assert.rejects(() => e._backupTrade('sell', 'M', null, {}), /resting/);
    assert.strictEqual(asked, 1, 'a refusing backup is not asked again inside the minute');
    e._jupDownUntil = 0;
    await assert.rejects(() => e._backupTrade('sell', 'M', null, {}), /Failed to get quotes/);
    assert.strictEqual(asked, 2, 'and it is asked again after the rest');
  }
  {
    const e = engine();
    const p = open(e, 'RUG');
    p.paper = false; p.solIn = 0.01; p.feeBuy = 0; p.fails = 2; p.openedAt = Date.now() - 5 * 60000;
    e.wallet.keypair = { publicKey: { toBase58: () => 'OWNOUR' } };
    e._tradeLive = async () => { throw Object.assign(new Error('the trade door refused it (Pool account not found)'), { phase: 'build' }); };
    e._backupTrade = async () => { throw new Error('the backup route also failed'); };
    const tok = e.tokens.get('RUG');
    tok.ext = { liqUsd: 0, dexId: 'pumpswap', at: Date.now() };
    const lines = [];
    e._log = (level, msg) => lines.push(level + ': ' + msg);
    p.nextTry = 0;
    await e._sell(p, 'Stop loss', 100).catch(() => {});
    const line = lines.find((l) => /no liquidity left/.test(l));
    assert.ok(line, 'the emptied pool is said in words');
    assert.ok(/ten minutes/.test(line), 'and what happens next');
    assert.strictEqual(p.stuck, true, 'the position is marked so it is not hammered');
    assert.ok(p.nextTry - Date.now() > 9 * 60000, 'with a long rest, not a 300 ms one');
  }
  // RULE CORRECTED 2026-11-05: a FRESH pump.fun coin reports no liquidity at all (its "pool" is the bonding curve),
  // and the first version of the rule above read that as a dead pool and abandoned a live position for ten minutes -
  // measured on lambo, bought for 0.01 SOL and declared worthless sixteen seconds later while it was up +146%.
  {
    for (const setup of [
      { dexId: 'pumpfun', liqUsd: 0, fails: 5, ageMs: 10 * 60000, why: 'a curve coin has no liquidity figure to read' },
      { dexId: 'pumpswap', liqUsd: 0, fails: 1, ageMs: 10 * 60000, why: 'one refusal is not a dead pool' },
      { dexId: 'pumpswap', liqUsd: 0, fails: 5, ageMs: 10000, why: 'and a coin this young has not been indexed yet' },
    ]) {
      const e = engine();
      const p = open(e, 'NOTDEAD');
      p.paper = false; p.solIn = 0.01; p.feeBuy = 0; p.fails = setup.fails; p.openedAt = Date.now() - setup.ageMs;
      e.wallet.keypair = { publicKey: { toBase58: () => 'OWNOUR' } };
      e._tradeLive = async () => { throw Object.assign(new Error('the chain refused it'), { phase: 'build' }); };
      e._backupTrade = async () => { throw new Error('the backup route also failed'); };
      e.tokens.get('NOTDEAD').ext = { liqUsd: setup.liqUsd, dexId: setup.dexId, at: Date.now() };
      const lines = [];
      e._log = (level, msg) => lines.push(level + ': ' + msg);
      p.nextTry = 0;
      await e._sell(p, 'Stop loss', 100).catch(() => {});
      assert.notStrictEqual(p.stuck, true, `a live coin is not written off: ${setup.why}`);
      assert.ok(!lines.some((l) => /no liquidity left/.test(l)), `and nothing claims it is worthless: ${setup.why}`);
      assert.ok(p.nextTry - Date.now() < 60000, `it keeps trying: ${setup.why}`);
    }
  }

  // RULE ADDED 2026-11-05: an order the door refused must not hold the ticket against the balance. Measured live on a
  // 0.022 SOL wallet: one buy skipped with "quoted in another token" left `Not enough SOL (0.0078 free, 0.0127 needed)`
  // on every following attempt for a minute, because the spend note lives 60 s.
  {
    const e = engine();
    const p = open(e, 'NOTHING');
    p.paper = false;
    const entry = e._noteSpend(0.0122);
    assert.strictEqual(e._pendingSpend(), 0.0122, 'the ticket is held while the order is in the air');
    e._releaseSpend(entry);
    assert.strictEqual(e._pendingSpend(), 0, 'and given back the moment the order is known not to have landed');
    assert.strictEqual(e._releaseSpend(null), undefined, 'releasing nothing is not an error');
  }

  // RULE ADDED 2026-11-05: a sale booked from an ESTIMATE is measured again in the background and the row is
  // corrected. Measured live: three sales in one afternoon were booked as "(estimated)" while the public nodes were
  // rotating on 429 - one of them (LIBRE) was booked +0.0044 SOL when the wallet really gained +0.0146.
  {
    // The queueing side: a sale with a signature and no measurement is queued, one that was measured is not.
    const eq = engine();
    eq._settleMint = () => {};
    eq._shutdownIfIdle = () => {};
    eq._persistBook = () => {};
    const est = open(eq, 'EST');
    est.paper = false; est.sig = 'BUY_SIG'; est.sellSig = 'SIGEST'; est.proceeds = null; est.solIn = 0.01; est.feeBuy = 0;
    eq._finishSell(est, 'Stop loss', 0.0001, 100);
    assert.strictEqual((eq._remeasure || []).length, 1, 'an estimated sale is queued for a second look');
    assert.strictEqual(eq._remeasure[0].sig, 'SIGEST');
    const meas = open(eq, 'MEAS');
    meas.paper = false; meas.sig = 'SIGMEAS'; meas.proceeds = 0.011; meas.solIn = 0.01; meas.feeBuy = 0;
    eq._finishSell(meas, 'Stop loss', 0.0001, 100);
    assert.strictEqual(eq._remeasure.length, 1, 'a sale the chain already measured is not queued');
  }
  {
    const e = engine();
    const row = { ts: Date.now(), symbol: 'LATE', mint: 'LATE', solIn: 0.01, pnlSol: -0.0037, pnlPct: -36.6, reason: 'Stop loss', paper: false };
    e.books.live.trades = 1; e.books.live.losses = 1; e.books.live.pnl = -0.0037;
    e._remeasure = [{ sig: 'SIG', row, soldSol: 0.01, feeBuy: 0, rentBack: 0, tries: 1, nextAt: 0 }];
    let asked = null;
    e._txSolDelta = async (sig) => { asked = sig; return 0.0146; };
    let persisted = 0;
    e._persistBook = () => { persisted++; };
    await e._remeasureSells();
    assert.strictEqual(asked, 'SIG', 'the sale is asked about by its own signature');
    assert.ok(Math.abs(row.pnlSol - 0.0046) < 1e-9, 'the row now carries the money (0.0146 in, 0.01 paid, so +0.0046), not the estimate');
    assert.ok(Math.abs(e.books.live.pnl - 0.0046) < 1e-9, 'and the book moved with it');
    assert.strictEqual(e.books.live.losses, 0, 'a loss that was really a win swaps sides');
    assert.strictEqual(e.books.live.wins, 1);
    assert.ok(persisted >= 1, 'and the correction is written to disk');
    assert.strictEqual(e._remeasure.length, 0, 'the row is not measured twice');
    // A node that never answers is asked a dozen times and then left alone.
    const e2 = engine();
    const r2 = { ts: Date.now(), symbol: 'NEVER', mint: 'NEVER', solIn: 0.01, pnlSol: -0.001, pnlPct: -10, reason: 'Stop loss', paper: false };
    e2.history.unshift(r2);
    e2._remeasure = [{ sig: 'S2', row: r2, soldSol: 0.01, feeBuy: 0, rentBack: 0, tries: 11, nextAt: 0 }];
    let tries = 0;
    e2._txSolDelta = async () => { tries++; return null; };
    await e2._remeasureSells();
    assert.strictEqual(tries, 1, 'it is asked once');
    e2._remeasure[0].nextAt = 0;
    await e2._remeasureSells();
    assert.strictEqual(tries, 1, 'a hopeless signature is not asked for ever');
    assert.strictEqual(e2._remeasure.length, 0, 'and is dropped');
    assert.strictEqual(r2.pnlSol, -0.001, 'the estimate stays as it was, honestly unmeasured');
  }

  // RULES ADDED 2026-11-05, both measured on ONE live trade — $sol, bought 17:03:55 for 0.005 SOL and booked
  // "Take profit at +301.4%" five seconds later at **-15.0%**:
  //  • the entry price was a BOARD row while the order filled elsewhere (the log says "filled on the re-quote"), so
  //    every percentage was measured from a price the wallet never paid;
  //  • and because the first reading after an entry was exempt from the wild-move check, that wrong entry turned one
  //    print into a +301% peak which fired a target into a falling coin.
  {
    // The fill IS the entry: 0.005 SOL bought 4000 whole tokens of a billion-supply coin = 1250 SOL market cap.
    const e = engine();
    const p = open(e, 'FILLpump');
    p.mint = 'FILLpump';
    p.paper = false; p.entryMc = 56; p.mc = 56; p.peakMc = 56; p.tokIn = 4_000_000_000n; // 4000 tokens, 6 decimals
    e.positions.set('FILLpump', p);
    await e._entryFromFill(p, 0.005, 0, 6);
    assert.ok(Math.abs(p.entryMc - 1250) < 1, `the entry is the price paid, got ${p.entryMc.toFixed(1)}`);
    assert.strictEqual(p.mc, p.entryMc, 'and the position starts at it');
    // A mint that is not a pump.fun launch (a different supply) keeps its own price: the arithmetic assumes one
    // billion tokens and would otherwise answer with a number wrong by the supply ratio.
    const other = open(e, 'OTHER');
    other.paper = false; other.entryMc = 56; other.mc = 56; other.tokIn = 4_000_000_000n;
    e.positions.set('OTHER', other);
    await e._entryFromFill(other, 0.005, 0, 6);
    assert.strictEqual(other.entryMc, 56, 'a non-pump mint keeps the price it was bought on');
    // ...and the decimals have to arrive from the balance read, or the whole thing silently does nothing - which is
    // exactly what happened on the first live trade after this rule was written ($MGOAT, still "+414%").
    const e3 = engine();
    e3.wallet.keypair = { publicKey: { toBase58: () => 'OWNOUR' } };
    e3.rpcCall = async () => ({ value: [{ account: { data: { parsed: { info: { tokenAmount: { amount: '2500000', decimals: 6, uiAmountString: '2.5' } } } } } }] });
    const seen = {};
    const raw = await e3._tokenBalanceRaw('M', seen);
    assert.strictEqual(raw, 2500000n, 'the raw amount is read');
    assert.strictEqual(seen.decimals, 6, 'and so are the decimals, which the entry price needs');
    assert.strictEqual(seen.gone, false);
    // A reading that is not a number at all is not this token: nothing is invented.
    const q = open(e, 'WILD');
    q.paper = false; q.entryMc = 56; q.mc = 56; q.tokIn = 1n;
    await e._entryFromFill(q, 0.005, 0, 0);
    assert.strictEqual(q.entryMc, 56, 'an impossible fill-derived price is ignored');
  }
  {
    // The first print after a BOARD entry is not exempt: it must be confirmed like any other wild move.
    const e = engine();
    const p = open(e, 'SPIKE');
    p.paper = false; p.entryMc = 100; p.mc = 100; p.peakMc = 100;
    p.pxSeed = true; p.pxSource = 'entry';                    // entry read from the board
    p.tokIn = 1000n; p.solIn = 0.01; p.feeBuy = 0; p.feeExitEst = 0;
    e.tokens.get('SPIKE').mc = 400;                            // one print, four times the entry
    e.tokens.get('SPIKE').lastStreamAt = Date.now();
    e._pricePosition(p, Date.now());
    assert.strictEqual(p.mc, 100, 'a single 4x print does not become the price');
    // Seen twice, it does.
    p.pxOddChain = 400;
    e._pricePosition(p, Date.now());
    assert.strictEqual(p.mc, 400, 'two agreeing readings are believed');
    // RULE CHANGED 2026-11-05 (replaced "a curve entry trusts the pool about itself"): a first print 2x away from a
    // pool-priced entry is now asked to appear twice. That exemption is what produced "$DNUT peaked at +159.3%" two
    // seconds after the buy and "$SAFU +1142.5%"; the pool still gets the last word, one more reading later.
    const e2 = engine();
    const r = open(e2, 'LAUNCH');
    r.paper = false; r.entryMc = 100; r.mc = 100; r.peakMc = 100;
    r.pxSeed = true; r.pxSource = 'curve';
    e2.tokens.get('LAUNCH').mc = 200;
    e2.tokens.get('LAUNCH').lastStreamAt = Date.now();
    e2._pricePosition(r, Date.now());
    assert.strictEqual(r.mc, 100, 'one print doubling a pool-priced entry is not a move yet');
    e2._pricePosition(r, Date.now());
    assert.strictEqual(r.mc, 200, 'the second reading that agrees with it is');
  }

  // RULE ADDED 2026-11-05 (measured on $MGOAT: "peaked +414.4%" and sold at -15.2% while the coin was on its curve):
  // a pump.fun coin also gets listed on other exchanges as a copy-cat pool with a few dollars in it, and the board
  // hands back the row with the deepest liquidity. That price is a different market - the exit cannot fill there - so
  // it must never become the number a position is measured at.
  {
    const e = engine();
    e.market.solUsd = 150;
    e._adopt({ mint: 'FOREIGN', source: 'launch', launched: true });
    const t = e.tokens.get('FOREIGN');
    t.mc = 131;
    e._applyMarket('FOREIGN', { mint: 'FOREIGN', symbol: 'FOREIGN', dexId: 'meteora', quoteMint: WSOL, priceNative: 0.00000067, priceUsd: 0.0001, mcapUsd: 67000, liqUsd: 5, buys: 9, sells: 1 });
    assert.strictEqual(t.mc, 131, 'a foreign pool never sets the market cap');
    assert.strictEqual(t.ext.foreignPool, true, 'and the row is marked as another exchange');
    // The coin's own market still does.
    e._applyMarket('FOREIGN', { mint: 'FOREIGN', symbol: 'FOREIGN', dexId: 'pumpfun', quoteMint: WSOL, priceNative: 0.00000014, priceUsd: 0.00002, mcapUsd: 14000, liqUsd: 0, buys: 9, sells: 1 });
    assert.ok(Math.abs(t.mc - 140) < 1, `its own curve does, got ${t.mc}`);
    // And a position's fallback quote is never taken from the foreign row either.
    const p = { mint: 'FOREIGN', entryMc: 131, mc: 131, solIn: 0.005, paper: false };
    e.positions.set('FOREIGN', p);
    e._applyMarket('FOREIGN', { mint: 'FOREIGN', symbol: 'FOREIGN', dexId: 'raydium', quoteMint: WSOL, priceNative: 0.0000033, priceUsd: 0.0005, mcapUsd: 330000, liqUsd: 9, buys: 1, sells: 1 });
    assert.ok(!(p.pxPull > 0), 'a foreign quote does not become the position price');
  }

  // RULE ADDED 2026-11-05: a profit rule may not fire before the entry price has been settled from the fill. The
  // correction needs one RPC round trip, and $MGOAT was sold two seconds after the buy - faster than that. A stop, the
  // creator selling, the time limit and a lost price stay armed throughout, because those are the rules that protect
  // money rather than count it.
  {
    const e = engine({ triggerHoldMs: 0 });
    const p = open(e, 'SETTLE');
    p.entryMc = 100; p.mc = 200; p.peakMc = 200; p.entrySettled = false;
    e._pnlPct = () => 100;                       // a hundred percent up
    e._sell = () => { e.soldNow = true; };
    e._tick();
    e._tick();
    assert.ok(!e.soldNow, 'a target does not fire on a price the entry has not been settled against');
    p.entrySettled = true;
    e._tick();
    e._tick();
    assert.ok(e.soldNow, 'and it fires as soon as the entry is settled');
    // The stop is not held back by the same gate.
    const e2 = engine({ triggerHoldMs: 0 });
    const q = open(e2, 'STOP');
    q.entryMc = 100; q.mc = 50; q.peakMc = 100; q.entrySettled = false;
    e2._pnlPct = () => -50;
    e2._sell = () => { e2.soldStop = true; };
    e2._tick();
    e2._tick();
    assert.ok(e2.soldStop, 'a stop still fires while the entry is being settled');
  }

  // RULE ADDED 2026-11-05: a ticket whose fees are more than a fifth of it is refused, in words, with the number to
  // use instead. Measured live: a 0.001 SOL ticket paid 0.0004 SOL of tips per round trip (40%), every position opened
  // at -42%, and five stops fired inside a minute. No entry can pay for that, and the desk must say so rather than lose
  // the ticket quietly.
  {
    const e = engine({ buyAmountSol: 0.001, priorityFeeSol: 0.0002 });
    e.walletBalance = 5; e._freeSol = () => 5;
    const lines = [];
    e._log = (level, msg) => lines.push(level + ': ' + msg);
    const t = { mint: 'TOOCHEAP', symbol: 'TOOCHEAP', mc: 200, score: 90, status: 'watching', createdAt: Date.now() - 60000, trades: [], mcHist: [], lastActivity: Date.now(), sources: new Set(['launch']) };
    e.tokens.set('TOOCHEAP', t);
    e._evalOne = () => {};
    await e._buy(t, { score: 90, m: { buyers: 20 }, pass: true });
    assert.ok(!e.positions.has('TOOCHEAP'), 'a ticket that cannot pay its fees is not traded');
    const line = lines.find((l) => /estimated round-trip fees/.test(l));
    assert.ok(line, 'and the refusal is said in words');
    assert.match(line, /44.50% of the ticket, above the 8% limit/);
    // The same tip on a normal ticket is fine.
    const e2 = engine({ buyAmountSol: 0.02, priorityFeeSol: 0.0002 });
    e2.walletBalance = 5; e2._freeSol = () => 5;
    e2._log = () => {};
    const t2 = { mint: 'FINE', symbol: 'FINE', mc: 200, score: 90, status: 'watching', createdAt: Date.now() - 60000, trades: [], mcHist: [], lastActivity: Date.now(), sources: new Set(['launch']) };
    e2.tokens.set('FINE', t2);
    const market = { prices: async () => new Map(), enrich: async () => new Map() };
    e2.market = market;
    e2._entryPrice = async () => ({ mc: 200, src: 'curve' });
    e2._tradeLive = async () => ({ sig: 'S', raw: null, landed: true });
    e2._confirm = async () => ({ state: 'confirmed', err: '' });
    e2._tokenBalanceRaw = async () => 1000n;
    await e2._buy(t2, { score: 90, m: { buyers: 20 }, pass: true });
    assert.ok(e2.positions.has('FINE'), 'a 0.02 SOL ticket with the same tip goes through');

    // RULE ADDED 2026-11-06 (1.1.1): a practice fill books the price the buy line printed, not whatever the coin had
  // moved to while the fill was "waiting". Measured on a live practice run: the line said mc 178, the exit said mc 155,
  // and the trade was booked at -39.9% - an invented loss of twenty-odd points that every exit rule then measured from.
  {
    const e = engine({ buyAmountSol: 0.1, paperBaseSlippagePct: 1, paperUnknownImpactPct: 2 });
    e.walletBalance = 5; e._freeSol = () => 5; e._freeSol = () => 5;
    const lines = [];
    e._log = (level, msg) => lines.push(msg);
    e._paperWait = async () => {};
    e._entryPrice = async () => ({ mc: 178, src: 'curve' });
    const t = { mint: 'MOVED', symbol: 'MOVED', mc: 178, score: 90, status: 'watching', createdAt: Date.now() - 60000, trades: [], mcHist: [], lastActivity: Date.now(), sources: new Set(['launch']) };
    e.tokens.set('MOVED', t);
    // The coin runs while the simulated fill is in flight: exactly the case that manufactured the fake loss.
    e._paperWait = async () => { t.mc = 258; };
    await e._buy(t, { score: 90, m: { buyers: 20 }, pass: true });
    const p = e.positions.get('MOVED');
    assert.ok(p, 'the practice entry happened');
    assert.ok(p.entryMc < 190, `booked at the quoted price plus impact, got ${p.entryMc}`);
    assert.ok(p.entryMc > 178, 'and with the depth impact added, not taken away');
    assert.strictEqual(p.mc, p.entryMc, 'the position starts at the price it paid');
    assert.ok(Math.abs(p.peakMc - p.entryMc) < 1e-9, 'and the peak starts there too');
    const line = lines.find((l) => /^Buying/.test(l));
    assert.match(line, /mc 1[78]\d/, 'the buy line prints the same number the books carry: ' + line);

    // The other half of the same rule: a fall books the fall plus the costs, and never more than that. Before the fix a
    // -13% move could book -40%, because the entry it was measured from was invented.
    p.mc = p.entryMc * 0.6;                    // the coin fell 40% from what was paid
    e._finishSell(p, 'Stop loss', e._feeFor(true), 100);
    const row = e.history[0];
    assert.ok(row, 'the sale was booked');
    assert.ok(row.pnlPct <= -40, `the costs are inside a loss: ${row.pnlPct.toFixed(1)}%`);
    assert.ok(row.pnlPct > -60, `and the loss is the move plus costs, not double of it: ${row.pnlPct.toFixed(1)}% for a -40% move`);
  }

  // RULE CHANGED 2026-11-05: the ceiling is a SETTING (`maxRoundTripPct`) instead of a constant, but it can never be
    // switched off - a 5% floor, because a desk with no gate trades tickets whose tips are most of the ticket.
    const e3 = engine({ buyAmountSol: 0.001, priorityFeeSol: 0.0002, maxRoundTripPct: 60 });
    e3.walletBalance = 5; e3._freeSol = () => 5; e3._log = () => {}; e3._entryPrice = async () => ({ mc: 200, src: 'curve' });
    e3.market = market;
    const t3 = { mint: 'LOOSE', symbol: 'LOOSE', mc: 200, score: 90, status: 'watching', createdAt: Date.now() - 60000, trades: [], mcHist: [], lastActivity: Date.now(), sources: new Set(['launch']) };
    e3.tokens.set('LOOSE', t3);
    await e3._buy(t3, { score: 90, m: { buyers: 20 }, pass: true });
    assert.ok(e3.positions.has('LOOSE'), 'a raised ceiling lets a small ticket through when the operator asks for it');
    const e4 = engine({ buyAmountSol: 0.001, priorityFeeSol: 0.0002, maxRoundTripPct: 0 });
    e4.walletBalance = 5; e4._freeSol = () => 5; e4._log = () => {}; e4.market = market;
    const t4 = { mint: 'OFF', symbol: 'OFF', mc: 200, score: 90, status: 'watching', createdAt: Date.now() - 60000, trades: [], mcHist: [], lastActivity: Date.now(), sources: new Set(['launch']) };
    e4.tokens.set('OFF', t4);
    await e4._buy(t4, { score: 90, m: { buyers: 20 }, pass: true });
    assert.ok(!e4.positions.has('OFF'), 'and a zero ceiling is read as the 5% floor, never as "off"');
  }

  // RULE ADDED 2026-11-05: the coin's own age is a setting in both directions. A launch younger than the floor has no
  // tape to judge (its buyers are the dev and his friends), and one older than the ceiling has already had its move.
  {
    // RULE CHANGED 2026-11-05 (1.0.2): the shipped plan asks for 70 buyers, so this case names its own bar - it is
    // about the two clocks, not about the crowd.
    const e = engine({ simpleMode: true, minBuyers: 5 });
    e.store.set({ minTokenAgeSec: 20, maxTokenAgeSec: 600 });
    const coin = (mint, ageSec) => {
      const t = { mint, name: 'A', symbol: 'A', creator: 'c', mc: 120, mcHist: [[Date.now() - 3000, 100], [Date.now(), 120]], trades: [], devSold: false, devBuySol: 0, status: 'watching', score: 90, reason: '', lastActivity: Date.now(), lastStreamAt: Date.now(), createdAt: Date.now() - ageSec * 1000 };
      for (let i = 0; i < 40; i++) t.trades.push({ ts: Date.now(), side: 'buy', sol: 0.2, trader: 'w' + i });
      e.tokens.set(mint, t);
      return t;
    };
    assert.match(e._eval(coin('YOUNG', 5), Date.now()).reason, /Too new \(5s old, needs 20s\)/, 'a coin five seconds old is not traded');
    assert.match(e._eval(coin('OLD', 3600), Date.now()).reason, /Too old \(60 min\)/, 'nor one that has been running for an hour');
    assert.strictEqual(e._eval(coin('FIT', 120), Date.now()).pass, true, 'one inside the window is');
    e.store.set({ minTokenAgeSec: 0, maxTokenAgeSec: 0 });
    assert.strictEqual(e._eval(coin('OFF2', 3600), Date.now()).pass, true, 'and zero turns both clocks off');
  }

  // RULE ADDED 2026-11-05 (measured on $JIMOTHY: "Peak give-back (peaked at +36.7%)" booked at -5.5%): a give-back is
  // a FLOOR. Waiting 400 ms for it to be confirmed is waiting for the floor to be gone, and on that trade the wait cost
  // twenty points. A stop already has this exemption; now every rule whose level is a floor has it too.
  {
    const e = engine({ triggerHoldMs: 400, trailArmPct: 20, trailGivePct: 10, breakEvenPct: 10 });
    assert.strictEqual(e._riskHoldMs('Peak give-back', 10, 36.7, 'quote'), 0, 'already through the level: sell now');
    assert.ok(e._riskHoldMs('Peak give-back', 18, 36.7, 'quote') > 0, 'just at it: still confirmed');
    assert.strictEqual(e._riskHoldMs('Break even', -8, 20, 'quote'), 0, 'a coin under water does not wait to be confirmed');
    assert.ok(e._riskHoldMs('Break even', -1, 20, 'quote') > 0);
    // A target that has been clearly cleared does not wait either (measured: $SMOKING peaked +36.7% and booked +4.1%
    // because the take profit was still inside its confirmation while the coin came back down).
    assert.strictEqual(e._riskHoldMs('Take profit', 60, 65, 'quote'), 0, 'a target five points past is sold at once');
    assert.ok(e._riskHoldMs('Take profit', 41, 41, 'quote') > 0, 'a target just touched is still confirmed');
    // And the resume action really lifts a pause.
    e.pausedUntil = Date.now() + 600000; e.pauseReason = '5 losses in a row'; e.lossStreak = 5;
    e._log = () => {};
    const out = e.resumeEntries();
    assert.strictEqual(e.pausedUntil, 0, 'the pause is gone');
    assert.strictEqual(e.lossStreak, 0, 'and the streak starts again, so the same rule cannot re-pause at once');
    assert.strictEqual(out.paused, false);
  }

  console.log('Exits test passed');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

