// The two Pilly features that live in files: the watchlist with its alerts, and his scorecard. Both are pure and file-backed, so
// every rule below is a test with a temporary folder.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Watch = require('../src/watchlist');
const Picks = require('../src/picks');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pillcrew-watch-'));
const A = 'GxWqJbWPxMseev7WXYNPLEG8K59v2fAhJ5m5o7Yepump';
// A valid base58 address with a distinct tail (base58 has no 0, O, I or l — that is what the first test is about).
const addr = (n) => `${'1'.repeat(40)}${['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'm', 'n', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w'][n % 21]}${'z'}`;

test('the watchlist keeps real addresses only, and says why it refused one', () => {
  const dir = tmp();
  assert.deepEqual(Watch.list(dir), [], 'a fresh install watches nothing');
  const items = Watch.add(dir, { mint: A, symbol: 'PILLCREW' });
  assert.equal(items.length, 1);
  assert.equal(items[0].symbol, 'PILLCREW');
  assert.equal(items[0].alertPct, null, 'watching is not alerting');
  Watch.add(dir, { mint: A, symbol: 'PILLCREW' });
  assert.equal(Watch.list(dir).length, 1, 'the same coin is not watched twice');
  assert.throws(() => Watch.add(dir, { mint: 'not-an-address' }), /not a Solana token address/);
  Watch.remove(dir, A);
  assert.deepEqual(Watch.list(dir), []);
});

test('the watchlist holds twenty coins and refuses the twenty-first', () => {
  const dir = tmp();
  for (let i = 0; i < Watch.MAX_ITEMS; i++) Watch.add(dir, { mint: addr(i) });
  assert.equal(Watch.list(dir).length, Watch.MAX_ITEMS);
  assert.throws(() => Watch.add(dir, { mint: addr(20) }), /holds 20 coins/);
});

test('an alert fires on the 5-minute move, once, and only above its own bar', () => {
  const dir = tmp();
  Watch.add(dir, { mint: A, symbol: 'PILLCREW' });
  const rows = [{ mint: A, change5m: 22 }];
  assert.deepEqual(Watch.firing(Watch.list(dir), rows), [], 'no bar set, no alert');
  Watch.setAlert(dir, A, 15);
  assert.equal(Watch.list(dir)[0].alertPct, 15);
  const now = 1_700_000_000_000;
  const cooldown = new Map();
  const first = Watch.firing(Watch.list(dir), rows, { now, cooldown });
  assert.equal(first.length, 1);
  assert.match(first[0].text, /PILLCREW is \+22% in 5m/, 'the alert carries the real number: ' + first[0].text);
  assert.deepEqual(Watch.firing(Watch.list(dir), rows, { now: now + 60000, cooldown }), [], 'the same move is not repeated a minute later');
  assert.equal(Watch.firing(Watch.list(dir), [{ mint: A, change5m: 5 }], { now: now + 3600000, cooldown }).length, 0, 'and a quiet coin never fires');
  assert.equal(Watch.firing(Watch.list(dir), [{ mint: A, change5m: -30 }], { now: now + 3600000, cooldown }).length, 1, 'a dump fires too');
});

test('his scorecard judges a pick by market cap, and refuses to judge one it cannot price', () => {
  const dir = tmp();
  assert.deepEqual(Picks.list(dir), []);
  assert.equal(Picks.record(dir, { mint: A, symbol: 'X' }), null, 'a pick with no market cap behind it is not recorded');
  const now = 1_700_000_000_000;
  const p = Picks.record(dir, { mint: A, symbol: 'PILLCREW', mc: 100000, source: 'hot' }, now);
  assert.ok(p && p.result === null, 'it starts open');
  assert.equal(Picks.record(dir, { mint: A, symbol: 'PILLCREW', mc: 100000 }, now + 60000), null, 'the same coin is not recorded twice in half an hour');

  Picks.update(dir, [{ mint: A, mc: 130000 }], now + 3600000);
  const done = Picks.list(dir)[0];
  assert.equal(done.result, 'win');
  assert.ok(Math.abs(done.pct - 30) < 0.001, 'the move is the real one: ' + done.pct);

  const stats = Picks.stats(dir);
  assert.equal(stats.total, 1);
  assert.equal(stats.open, 0);
  assert.equal(stats.wins, 1);
  assert.equal(stats.winRate, 100);
  assert.equal(stats.best.symbol, 'PILLCREW');

  // An unpriced coin stays open rather than being judged on nothing.
  Picks.record(dir, { mint: addr(5), symbol: 'OPEN', mc: 50000 }, now + 2 * 3600000);
  Picks.update(dir, [], now + 3 * 3600000);
  assert.equal(Picks.stats(dir).open, 1, 'nothing to price means nothing is settled');
});

test('a flat call is neither a win nor a loss', () => {
  const dir = tmp();
  const now = 1_700_000_000_000;
  Picks.record(dir, { mint: A, mc: 100000 }, now);
  Picks.update(dir, [{ mint: A, mc: 100400 }], now + 60000);
  const s = Picks.stats(dir);
  assert.equal(s.flat, 1);
  assert.equal(s.wins, 0);
  assert.equal(s.losses, 0);
  assert.equal(s.winRate, 0, 'a flat call is not a win: ' + s.winRate);
});
