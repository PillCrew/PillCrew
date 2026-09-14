const { test } = require("node:test");
const assert = require("node:assert");
const COINS = require("./coins");

// The wallet screen is the heaviest user of the Solana RPC endpoint, and it used
// to be hard-wired to the public one no matter what PILLY_RPC_URL said - a private
// endpoint would have been honoured by the health probe and ignored by the calls
// it was measuring. The requests are stubbed so this proves the wiring without
// touching the network.
test("coins: the wallet lookup asks the endpoint PILLY_RPC_URL points at", async () => {
  const before = process.env.PILLY_RPC_URL;
  const urls = [];
  const realFetch = global.fetch;
  process.env.PILLY_RPC_URL = "http://127.0.0.1:9/myrpc";
  global.fetch = async (url) => {
    urls.push(String(url));
    // getBalance-shaped answer: enough for the code to walk its own path.
    return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, result: { value: 0 } }) };
  };
  try {
    await COINS.fetchWalletPortfolio("So11111111111111111111111111111111111111112");
  } finally {
    global.fetch = realFetch;
    if (before === undefined) delete process.env.PILLY_RPC_URL;
    else process.env.PILLY_RPC_URL = before;
  }
  assert.ok(urls.length > 0, "the wallet lookup made no request at all");
  assert.equal(urls[0], "http://127.0.0.1:9/myrpc");
  assert.ok(!urls.some((u) => u.includes("mainnet-beta")), urls);
});

// pump.fun launches start at roughly $2.8K of market cap and its feed is sorted
// newest-first, so the top of the list is mostly coins nobody has bought. Pilly
// presents fresh launches as snipe material, so the floor has to be exact: 6999 is
// out, 7000 is in, and a coin whose market cap cannot be read is out as well - the
// floor is a promise, and an unknown cannot keep it.
test("coins: the fresh-launch floor is $7K and unknown market caps count as dust", () => {
  assert.equal(COINS.MIN_FRESH_MCAP, 7000);
  assert.equal(COINS.aboveFreshFloor({ mcap: 6999 }), false);
  assert.equal(COINS.aboveFreshFloor({ mcap: 6999.99 }), false);
  assert.equal(COINS.aboveFreshFloor({ mcap: 7000 }), true);
  assert.equal(COINS.aboveFreshFloor({ mcap: "8000" }), true);
  assert.equal(COINS.aboveFreshFloor({ mcap: null }), false);
  assert.equal(COINS.aboveFreshFloor({ mcap: "" }), false);
  assert.equal(COINS.aboveFreshFloor({ mcap: NaN }), false);
  assert.equal(COINS.aboveFreshFloor({ mcap: Infinity }), false);
  assert.equal(COINS.aboveFreshFloor({}), false);
  assert.equal(COINS.aboveFreshFloor(null), false);
});

test("coins: fetchNewCoins drops sub-floor launches, counts them and asks for a deeper page", async () => {
  const realFetch = global.fetch;
  const urls = [];
  const mcaps = [2822, 3000, 6999, 7000, 8790, null, 25000, 40000];
  global.fetch = async (url) => {
    urls.push(String(url));
    return {
      ok: true,
      status: 200,
      json: async () =>
        mcaps.map((m, i) => ({
          mint: `mint${i}`,
          name: `Coin ${i}`,
          symbol: `C${i}`,
          created_timestamp: 1700000000000 + i,
          usd_market_cap: m,
        })),
    };
  };
  let out;
  try {
    out = await COINS.fetchNewCoins(12);
  } finally {
    global.fetch = realFetch;
  }
  // Asking for 12 rows would return mostly dust, so the feed is asked for 4x that.
  assert.match(urls[0], /sort=created_timestamp/);
  assert.match(urls[0], /limit=48/);
  assert.deepEqual(
    out.list.map((c) => c.mcap),
    [7000, 8790, 25000, 40000]
  );
  assert.equal(out.hidden, 4);
  assert.ok(!out.context.includes("Coin 0"), out.context);
});

test("coins: the DexScreener fallback obeys the same floor", async () => {
  const realFetch = global.fetch;
  const dust = [2822, 3000].map((m, i) => ({ mint: `dust${i}`, usd_market_cap: m }));
  const profiles = [{ tokenAddress: "AAA" }, { tokenAddress: "BBB" }];
  const pairs = [
    {
      baseToken: { address: "AAA", name: "Small", symbol: "SML" },
      priceUsd: "0.0001",
      marketCap: 900,
      liquidity: { usd: 2000 },
      volume: { h24: 100 },
    },
    {
      baseToken: { address: "BBB", name: "Real", symbol: "REAL" },
      priceUsd: "0.02",
      marketCap: 12000,
      liquidity: { usd: 30000 },
      volume: { h24: 5000 },
    },
  ];
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes("frontend-api-v3.pump.fun")) return { ok: true, status: 200, json: async () => dust };
    if (u.includes("token-profiles")) return { ok: true, status: 200, json: async () => profiles };
    return { ok: true, status: 200, json: async () => ({ pairs }) };
  };
  let out;
  try {
    out = await COINS.fetchNewCoins(12);
  } finally {
    global.fetch = realFetch;
  }
  assert.deepEqual(out.list.map((c) => c.mint), ["BBB"]);
  assert.equal(out.hidden, 1);
});

// The user saw "Trending feed is unavailable right now" while the feed was healthy:
// a CDN in front of GeckoTerminal answers 502/503 every so often, and the old code
// gave up on any non-429 error on the first try. One blip is not an outage.
test("coins: a 5xx blip is retried before the trending feed is called unavailable", async () => {
  const realFetch = global.fetch;
  let attempts = 0;
  const payload = {
    data: [
      {
        attributes: {
          name: "BONK/SOL",
          base_token: { address: "mintA", symbol: "BONK" },
          base_token_price_usd: "0.00002",
          market_cap_usd: 500000,
          price_change_percentage: { m5: 1.5, h24: 4.2 },
          volume_usd: { h24: 90000 },
          reserve_in_usd: 250000,
        },
      },
    ],
  };
  global.fetch = async () => {
    attempts++;
    if (attempts === 1) return { ok: false, status: 502, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => payload };
  };
  let out;
  try {
    out = await COINS.fetchTrendingTop(5);
  } finally {
    global.fetch = realFetch;
  }
  assert.equal(attempts, 2);
  assert.deepEqual(out.list.map((c) => c.symbol), ["BONK"]);
  assert.equal(out.rateLimited, false);
});

test("coins: a rate limit is reported as throttled, not as an empty feed", async () => {
  const realFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 429, json: async () => ({}) });
  let out;
  try {
    out = await COINS.fetchTrendingTop(5);
  } finally {
    global.fetch = realFetch;
  }
  assert.deepEqual(out.list, []);
  assert.equal(out.rateLimited, true);
});
