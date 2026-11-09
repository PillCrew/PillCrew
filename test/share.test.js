const assert = require('assert');
const Share = require('../src/share');
const { DEFAULTS, AUTOPILOT } = require('../src/engine');

const settings = { ...DEFAULTS, ...AUTOPILOT, buyAmountSol: 0.02, rpcUrl: 'https://my-secret-node.example', pumpdevKey: 'KEY-123' };
const code = Share.encode(settings);

// A code is a tweet-sized string, and it carries the policy and nothing else.
assert.ok(code.startsWith(Share.PREFIX_NEW), 'the code names its format');
// X refuses a post whose text reads as a link, and `PCS1.<base64>` reads as `domain.tld` to every linkifier there is.
assert.ok(!code.includes('.'), 'a code carries no dot, so no chat app mistakes it for a web address');
assert.ok(code.length < 280, `a code has to fit in a post, got ${code.length}`);
const back = Share.decode(code);
for (const k of Share.SHARE_KEYS) {
  assert.ok(Math.abs(Number(back.values[k]) - Number(settings[k])) < 1e-9, `${k} survives the round trip`);
}
assert.strictEqual(back.profile, 'balanced');

// Secrets and machine state are not in the payload at all: not hidden, absent.
const payload = JSON.parse(Buffer.from(code.slice(5).split(Share.SEP)[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
assert.deepStrictEqual(Object.keys(payload).sort(), ['n', 'p', 'v'], 'the payload is a version, a profile and a list of numbers');
assert.deepStrictEqual(Object.keys(back.values).sort(), [...Share.SHARE_KEYS].sort(), 'and decodes to the shared keys only');
assert.ok(!Share.SHARE_KEYS.includes('rpcUrl'), 'an RPC URL from a stranger is never applied');
assert.ok(!Share.SHARE_KEYS.includes('pumpdevKey') && !Share.SHARE_KEYS.includes('incineratorKey'), 'no API keys');
assert.ok(!Share.SHARE_KEYS.includes('mode') && !Share.SHARE_KEYS.includes('openPositions'), 'no mode and no positions');

// Damage is refused instead of half applied.
const broken = code.slice(0, -1) + (code.endsWith('a') ? 'b' : 'a');
assert.throws(() => Share.decode(broken), /damaged/, 'a changed character is caught by the checksum');
assert.throws(() => Share.decode(code.slice(0, 40)), /truncated|damaged|read/, 'a truncated code is refused');
assert.throws(() => Share.decode('hello'), /not a PillCrew settings code/, 'anything else is refused');
assert.throws(() => Share.decode(''), /not a PillCrew settings code/, 'an empty code is refused');

// The description is the line someone posts next to the code.
const line = Share.describe(settings);
assert.match(line, /\d+% target/, 'the description names the target');
assert.match(line, /first rung/, 'and the first rung');

// A code shared BEFORE a setting existed still works. The list is positional, so a shorter list is an older code, not a
// damaged one - and every code already posted on X has to keep working for ever.
{
  // RULE CHANGED 2026-11-05 (three keys were appended: the two coin-age clocks and the fee gate): an older code is
  // modelled as a PREFIX of the list, which is exactly what an older release wrote, instead of "the current list minus
  // the keys that came later" - that only matched while the new keys happened to be the last ones.
  const cut = Share.SHARE_KEYS.indexOf('maxChange5mPct') + 1;   // everything up to the five minute ceiling
  const keys = Share.SHARE_KEYS.slice(0, cut);
  const values = keys.map((k) => Number(settings[k]));
  const body = Buffer.from(JSON.stringify({ v: 1, p: 'balanced', n: values })).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  let h = 0x811c9dc5;
  for (const ch of body) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  const oldCode = Share.PREFIX + body + '.' + (h >>> 0).toString(36).slice(-2).padStart(2, '0');
  const old = Share.decode(oldCode);
  assert.strictEqual(old.values.minHolders, undefined, 'an older code simply does not carry the newer holder bar');
  assert.strictEqual(old.values.maxBuyers, undefined, 'nor the newer buyer ceiling');
  assert.strictEqual(old.values.simpleMode, undefined, 'nor the simple settings switch');
  assert.strictEqual(old.values.minChange5mPct, undefined, 'nor the newer five minute floor');
  assert.strictEqual(old.values.maxChange5mPct, settings.maxChange5mPct, 'and carries everything it did carry');
}

// RULE ADDED 2026-11-05: the styles are the shipped plans, and a style must never move the money at risk. `High roller`
// (the `aggressive` key) is the plan for a big bankroll: a 60% target against a 12% stop, six slots, a bigger tip - and
// NOT a ticket, because pressing a card may not raise what is at stake.
{
  const { PROFILES } = require('../src/engine');
  for (const [name, p] of Object.entries(PROFILES)) {
    assert.strictEqual(p.buyAmountSol, undefined, `${name} carries no ticket`);
  }
  const hi = PROFILES.aggressive;
  assert.strictEqual(hi.takeProfitPct, 60);
  assert.strictEqual(hi.stopLossPct, 12);
  assert.strictEqual(hi.maxPositions, 2);
  assert.strictEqual(hi.simpleMode, false, 'the capital preset keeps advanced entry checks enabled');
  assert.ok(hi.takeProfitPct / hi.stopLossPct >= 4, 'and pays four losses with one winner');
  // RULE CHANGED 2026-11-05 (1.0.2, the shipped settings code): the shipped plan is an 80% target against a 45% stop -
  // a coin is given room to run, and the fee gate keeps tickets that cannot pay for that room out of it. What a style
  // still may not do is carry a ticket.
  const bal = PROFILES.balanced;
  assert.strictEqual(bal.takeProfitPct, 80);
  assert.strictEqual(bal.stopLossPct, 45);
  assert.strictEqual(bal.maxHoldSec, 500);
  assert.strictEqual(bal.minBuyers, 50);
  assert.strictEqual(bal.maxPositions, 10);
  assert.strictEqual(bal.maxBuysPerMin, 30);
  assert.strictEqual(bal.simpleMode, false, 'the corrected plan runs the full desk');
  assert.strictEqual(bal.maxRoundTripPct, 8);
}

console.log('Share tests passed');
