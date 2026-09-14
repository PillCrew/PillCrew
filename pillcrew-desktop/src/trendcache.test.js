const { test } = require("node:test");
const assert = require("node:assert");
const TREND = require("./trendcache");

// The user reported "Trending feed is unavailable right now" while the feed was
// healthy a moment later: one 502 from the CDN in front of GeckoTerminal was the
// whole story. These tests pin the rule that a failed read falls back to the last
// good one, that the fallback says how old it is, and that it never pretends to be
// live or outlives its usefulness.

const good = (n = 2, at = 1_000_000) => ({
  list: Array.from({ length: n }, (_, i) => ({ symbol: `SYM${i}`, mcap: 1e6, change24h: i + 1 })),
  context: "top 2 by volume",
  at,
});

test("trendcache: a real read is worth storing, an empty or failed one is not", () => {
  assert.strictEqual(TREND.trendingToStore(null), null);
  assert.strictEqual(TREND.trendingToStore({ list: [], context: "x" }), null);
  assert.strictEqual(TREND.trendingToStore({ list: undefined }), null);
  const stored = TREND.trendingToStore({ list: [{ symbol: "BONK" }], context: "ctx" }, 555);
  assert.deepStrictEqual(stored, { list: [{ symbol: "BONK" }], context: "ctx", at: 555 });
});

test("trendcache: a blip serves the last good list, marked with its age", () => {
  const last = good(2, 1_000_000);
  const payload = TREND.trendingFallback(last, { rateLimited: false }, 1_000_000 + 60_000);
  assert.strictEqual(payload.stale, true);
  assert.strictEqual(payload.staleAt, 1_000_000);
  assert.strictEqual(payload.list.length, 2);
  assert.strictEqual(payload.rateLimited, false);
  // The real numbers survive: the rundown is about data, just an older read.
  assert.match(payload.context, /top 2 by volume/);
  assert.match(payload.context, /last read, from /);
});

test("trendcache: throttling and silence are reported differently than a live read", () => {
  const throttled = TREND.trendingFallback(good(), { rateLimited: true }, 1_000_000 + 1);
  assert.strictEqual(throttled.rateLimited, true);
  assert.strictEqual(TREND.trendingFallback(good(), null, 1_000_000 + 1).rateLimited, false);
});

test("trendcache: nothing to show when the last read is gone or too old", () => {
  assert.strictEqual(TREND.trendingFallback(null, {}, 1_000_000), null);
  assert.strictEqual(TREND.trendingFallback({ list: [], at: 0 }, {}, 1_000_000), null);
  // Just inside the window, then just outside it.
  const at = 1_000_000;
  assert.ok(TREND.trendingFallback(good(1, at), {}, at + TREND.TRENDING_STALE_MAX - 1));
  assert.strictEqual(
    TREND.trendingFallback(good(1, at), {}, at + TREND.TRENDING_STALE_MAX + 1),
    null
  );
  // A clock that moved backwards must not produce a future-dated list.
  assert.strictEqual(TREND.trendingFallback(good(1, 2_000_000), {}, 1_000_000), null);
});
