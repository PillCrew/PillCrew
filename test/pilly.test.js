// Pilly's proactive half: the hot radar, the brief, his pick, a whale alert and his mood. Pure logic, an injected clock, and
// every rule Pilly Desktop had — one mention per coin per half hour, a dust floor, an alert that outranks a joke.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/pilly');

const BUMPER = { mint: 'M1', symbol: 'BUMP', name: 'Bumper', change5m: 34, mc: 120000, liq: 40000 };
const QUIET = { mint: 'M2', symbol: 'MEH', name: 'Meh', change5m: 3, mc: 900000, liq: 90000 };
const DUST = { mint: 'M3', symbol: 'DUST', name: 'Dust', change5m: 90, mc: 3000, liq: 900 };

test('the hot radar names the hottest mover that matters, and only once', () => {
  const now = 1_700_000_000_000;
  const got = P.hotCoin([QUIET, BUMPER, DUST], { pct: 10, now });
  assert.ok(got, 'a fresh mover was found');
  assert.equal(got.mint, 'M1');
  assert.match(got.text, /BUMP \+34% in 5m/, 'the sentence carries the real number: ' + got.text);

  const radar = new P.Radar();
  const first = radar.hot([BUMPER], { pct: 10, now });
  assert.ok(first, 'the first scan speaks');
  assert.equal(radar.hot([BUMPER], { pct: 10, now: now + 60000 }), null, 'a minute later it is the same coin, not news');
  assert.ok(radar.hot([BUMPER], { pct: 10, now: now + P.HOT_COOLDOWN_MS + 1000 }), 'after the cooldown it may speak again');
});

test('a coin too small to matter is never news', () => {
  assert.equal(P.hotCoin([DUST], { pct: 10 }), null, 'a 90% move on a $3K coin is a bot or a rug');
  assert.equal(P.aboveFloor(DUST), false);
  assert.equal(P.aboveFloor(BUMPER), true);
  assert.equal(P.aboveFloor({ mint: 'X' }), false, 'an unpriced coin has no tape, so it has no story');
  // The bar is a setting: raise it and the mover is no longer hot.
  assert.equal(P.hotCoin([BUMPER], { pct: 40 }), null);
});

test('the fallback is the day\'s extreme, and only when it is extreme', () => {
  const rows = [{ ...QUIET, change24h: 4 }, { ...BUMPER, change24h: 41 }, DUST && { ...DUST, change24h: 900 }];
  const up = P.extremeMover(rows);
  assert.equal(up.kind, 'up');
  assert.equal(up.mint, 'M1', 'the dust coin is excluded even though its move is the biggest');
  assert.match(up.text, /BUMP \+41%/);
  const down = P.extremeMover([{ ...QUIET, change24h: -3 }, { ...BUMPER, change24h: -33 }]);
  assert.equal(down.kind, 'down');
  assert.equal(P.extremeMover([{ ...QUIET, change24h: 2 }]), null, 'a quiet day is not an alert');
});

test('the daily brief says what is on hand and what the session did, from the numbers it is given', () => {
  const text = P.dailyBrief({ name: 'Pilly', sol: 0.0276, sessionDeltaSol: 0.0042, openCount: 2, hot: BUMPER });
  assert.match(text, /gm anon/);
  assert.match(text, /0\.028 SOL on hand/);
  assert.match(text, /up 0\.0042 SOL this session/);
  assert.match(text, /2 positions open/);
  assert.match(text, /BUMP is the mover/);
  const quiet = P.dailyBrief({ sol: 0.5 });
  assert.match(quiet, /nothing opened yet/);
  assert.doesNotMatch(quiet, /NaN|undefined/, 'a missing number is left out, never printed as NaN: ' + quiet);
  const once = new P.Radar();
  assert.ok(once.brief({ sol: 1 }), 'the first brief speaks');
  assert.equal(once.brief({ sol: 1 }), null, 'and only once per session');
});

test('his pick, a whale alert and his mood are each one sentence with real numbers', () => {
  const pick = P.pickSentence({ symbol: 'MOPS', reason: 'liquidity is climbing and the dev is gone', by: 'DeepSeek' });
  assert.match(pick, /MOPS is my pick \(DeepSeek\)/);
  assert.match(pick, /liquidity is climbing/);
  assert.equal(P.pickSentence({}), null, 'no coin means no sentence');
  assert.match(P.pickSentence({ symbol: 'X' }), /no reason given/, 'and it never invents a reason');

  const whale = P.whaleSentence({ wallet: '8v9mABCDEFGH5nGV', symbol: 'MOPS', usd: 1500 });
  assert.match(whale, /8v9m…5nGV just opened MOPS/);
  assert.match(whale, /\$1\.5K/);
  assert.equal(P.whaleSentence({ wallet: 'x' }), null);

  assert.equal(P.moodFor({ pnlPct: 5 }).kind, 'up');
  assert.equal(P.moodFor({ pnlPct: -8 }).kind, 'down');
  assert.equal(P.moodFor({ pnlPct: 0.4 }).kind, 'flat');
  assert.equal(P.moodFor({}).text, null);

  const r = new P.Radar();
  const now = 1_700_000_000_000;
  assert.ok(r.pick({ symbol: 'A', reason: 'r' }, now), 'the first pick speaks');
  assert.equal(r.pick({ symbol: 'B', reason: 'r' }, now + 60000), null, 'not again a minute later');
  assert.ok(r.pick({ symbol: 'B', reason: 'r' }, now + 7 * 3600000), 'but it does every six hours');
});

test('the sniper watch names the freshest launch once, and never a coin with no tape', () => {
  const now = 1_700_000_000_000;
  const rows = [
    { mint: 'L1', symbol: 'FRESH', age: 20, mc: 20000 },
    { mint: 'L2', symbol: 'OLDER', age: 60, mc: 50000 },
    { mint: 'L3', symbol: 'DUST', age: 10, mc: 1200 },
    { mint: 'L4', symbol: 'STALE', age: 900, mc: 900000 },
  ];
  const got = P.launchCoin(rows, { now });
  assert.ok(got, 'a fresh launch was found');
  assert.equal(got.mint, 'L1', 'the freshest one, not the oldest still in the window');
  assert.match(got.text, /FRESH is 20s old/);
  assert.match(got.text, /want me to watch it/);
  const r = new P.Radar();
  assert.equal(r.launch(rows, { now }).mint, 'L1', 'the first launch speaks');
  assert.equal(r.launch(rows, { now: now + 60000 }).mint, 'L2', 'and a different launch may speak later');
  assert.equal(r.launch(rows, { now: now + 120000 }), null, 'but no launch is ever said twice');
  assert.equal(P.launchCoin([{ mint: 'L3', symbol: 'DUST', age: 5, mc: 1200 }], { now }), null, 'a dust launch is not worth a bubble');
});

test('the chat chip turns one press into a question and the numbers it needs', () => {
  const rows = [
    { mint: 'M1', symbol: 'BUMP', change5m: 34, mc: 120000, buyers: 44 },
    { mint: 'M2', symbol: 'MEH', change5m: -8, mc: 900000, buyers: 12 },
  ];
  const trending = P.chipAction('trending');
  assert.equal(trending.task, 'trending');
  assert.equal(trending.needs, 'trending');
  const ctx = P.chipContext('trending', { rows });
  assert.match(ctx, /BUMP: 5m \+34%/);
  assert.match(ctx, /mcap \$120\.0K/);
  assert.match(ctx, /buyers 44/);
  assert.match(P.chipContext('trending', { rows: [] }), /No live coin rows/, 'an empty list says so instead of leaving a hole');

  // A chip that fronts a meme task asks the model for that job and needs no data at all.
  assert.equal(P.chipAction('roast').task, 'roast');
  assert.equal(P.chipAction('roast').needs, null);
  assert.equal(P.chipAction('nonsense'), null, 'an unknown chip is not an action');

  // The watchlist chip prints the bar next to the move, so a model cannot confuse the two.
  const watch = P.chipContext('watchlist', { watchlist: [{ mint: 'M1', symbol: 'BUMP', alertPct: 15 }], rows });
  assert.match(watch, /BUMP: alert ±15%, 5m \+34%/);
  assert.match(P.chipContext('watchlist', { watchlist: [] }), /watchlist is empty/);
  assert.match(P.chipContext('scorecard', { stats: { total: 3, wins: 2, losses: 1, open: 0, winRate: 67 } }), /2 wins, 1 losses, .*hit rate 67%/);
  assert.match(P.chipContext('whales', { wallets: ['8v9mABCDEFGH5nGV'] }), /8v9m/);
  assert.match(P.chipContext('settings', { settings: { buyAmountSol: 0.02, slippagePct: 12, priorityFeeSol: 0.0001, maxPositions: 3, stopLossPct: 20, takeProfitPct: 60 } }), /ticket 0\.02 SOL.*slippage 12%/);
});

test('the system prompt is the operator\'s words, then the task, then the language lock', () => {
  const sys = P.chatSystem({ instructions: 'Be brief.', task: 'caption', language: 'zh' });
  assert.match(sys, /^Be brief\./);
  assert.match(sys, /meme caption/);
  assert.match(sys, /Simplified Chinese/);
  // No task and no lock leaves only the operator's instructions; nothing is invented.
  assert.equal(P.chatSystem({ instructions: 'Only facts.' }), 'Only facts.');
  assert.equal(P.chatSystem({ instructions: 'Only facts.', task: 'nope', language: 'nope' }), 'Only facts.');
  assert.equal(P.chatSystem({}), '', 'nothing at all stays nothing');
});

test('every speaker keeps its own clock, so one cannot silence another', () => {
  const r = new P.Radar();
  const now = 1_700_000_000_000;
  assert.ok(r.whale({ wallet: '8v9mABCDEFGH5nGV', symbol: 'MOPS', usd: 900 }, now));
  assert.equal(r.whale({ wallet: '8v9mABCDEFGH5nGV', symbol: 'MOPS', usd: 900 }, now + 1000), null, 'two whales in a second is one bubble');
  assert.ok(r.joke(now), 'a joke still gets through');
  assert.equal(r.joke(now + 1000), null, 'but not twice in a row');
  assert.ok(r.mood({ pnlPct: -9 }, now), 'and the mood is on its own clock');
  assert.ok(r.pick({ symbol: 'A', reason: 'r' }, now), 'as is the pick');
  r.reset();
  assert.ok(r.brief({ sol: 1 }), 'a reset makes the session new again');
});
