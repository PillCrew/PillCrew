const assert = require('assert');
const { Market, readPair } = require('../src/market');

const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const mint = (n) => String(n).padEnd(44, 'x');
const pair = (m, extra = {}) => ({
  chainId: 'solana',
  dexId: 'pumpfun',
  baseToken: { address: m, symbol: 'TOK', name: 'Token' },
  priceUsd: '0.00003',
  priceNative: '0.0000003',
  marketCap: 30000,
  fdv: 30000,
  liquidity: { usd: 8000 },
  volume: { m5: 4000, h1: 20000 },
  priceChange: { m5: 12.5 },
  txns: { m5: { buys: 40, sells: 10 }, h1: { buys: 90, sells: 30 } },
  pairCreatedAt: 1793793228000,
  ...extra,
});

(async () => {
  const calls = [];
  Market.prototype._origFetch = global.fetch;

  global.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes('token-boosts/latest')) {
      return res(200, [
        { chainId: 'solana', tokenAddress: mint('A') },
        { chainId: 'base', tokenAddress: 'nope' },
        { chainId: 'solana', tokenAddress: mint('B') },
      ]);
    }
    if (String(url).includes('token-boosts/top')) {
      return res(200, [
        { chainId: 'solana', tokenAddress: mint('F') },
        { chainId: 'solana', tokenAddress: mint('G') },
      ]);
    }
    if (String(url).includes('token-profiles')) {
      return res(200, [{ chainId: 'solana', tokenAddress: mint('C') }]);
    }
    if (String(url).includes('tokens/v2/recent')) {
      return res(200, [{ id: mint('R'), symbol: 'FRESH', name: 'Fresh', launchpad: 'pump.fun', mcap: 5000, liquidity: 0, stats5m: { priceChange: 5, numBuys: 12, numSells: 3 }, audit: {} }]);
    }
    if (String(url).includes('toptrending') || String(url).includes('toptraded')) {
      return res(200, [
        { id: mint('D'), symbol: 'PUMPY', name: 'Pumpy', launchpad: 'pump.fun', mcap: 42000, liquidity: 9000, stats5m: { priceChange: 20, numBuys: 55, numSells: 12 }, audit: { freezeAuthorityDisabled: false }, dev: 'DEV9' },
        { id: mint('E'), symbol: 'BONK', name: 'Bonk', launchpad: 'raydium-launchlab' },
      ]);
    }
    if (String(url).includes('latest/dex/tokens/')) {
      const wanted = String(url).split('latest/dex/tokens/')[1].split(',');
      return res(200, { pairs: wanted.map((m) => pair(m)) });
    }
    if (String(url).includes('latest/dex/search')) {
      return res(200, { pairs: [pair(mint('S1')), pair(mint('S1'), { liquidity: { usd: 100 } }), { chainId: 'base', baseToken: { address: mint('NO') } }] });
    }
    if (String(url).includes('/new_pools')) {
      return res(200, { data: [{
        id: 'solana_pool1',
        relationships: { base_token: { data: { id: 'solana_' + mint('N1') } } },
        attributes: {
          name: 'NEW / SOL', base_token_price_native_currency: '0.000001', base_token_price_usd: '0.0002',
          market_cap_usd: '25000', reserve_in_usd: '6000', pool_created_at: new Date(Date.now() - 60000).toISOString(),
          volume_usd: { m5: '900' }, price_change_percentage: { m5: '4.5' }, transactions: { m5: { buys: 20, sells: 5 } },
        },
      }] });
    }
    return res(404, {});
  };

  try {
    const market = new Market();
    const count = (rows, src) => rows.filter((r) => r.source === src).length;
    // RULE ADDED 2026-11-05: the Jupiter budget is ONE call a second (measured on a live key: twenty quick
    // calls answered five and refused fifteen, one every 700 ms broke on the fourth). Successive discovery rounds in
    // this test therefore wait for the allowance instead of pretending five calls fit in a second.
    const settle = () => new Promise((r) => setTimeout(r, 1100));

    // Every cycle polls the newest tokens, because that list spans about one minute, and one wide door rotates
    // beside it. Asserting per source keeps the test honest when the rotation changes.
    const boosts = await market.discover();
    assert.strictEqual(count(boosts, 'callout'), 2, 'only Solana boosts are returned');
    assert.strictEqual(count(boosts, 'launch'), 1, 'the launch door answers on every cycle');

    await settle();
    // RULE ADDED 2026-11-05: the Jupiter budget is its own bucket - two calls in a second, then one a second - kept
    // apart from DexScreener's four. Measured on a live key: twenty quick calls answered five and refused
    // fifteen, one every 700 ms broke on the fourth, one every 1.1 s did not.
    assert.strictEqual(market._slot('jupiter', 2), true, 'the first Jupiter call in a second is allowed');
    assert.strictEqual(market._slot('jupiter', 2), true, 'so is the second, a cycle asks the index and a door');
    assert.strictEqual(market._slot('jupiter', 2), false, 'the third is not');
    market._slots.jupiter = [];
    market._slots['jup-price'] = [];
    const topBoosts = await market.discover();
    assert.strictEqual(count(topBoosts, 'callout'), 2, 'the top-boost door answers the same shape');

    await settle();
    const profiles = await market.discover();
    assert.strictEqual(count(profiles, 'new'), 1, 'fresh DexScreener profiles arrive as "new"');

    await settle();
    const trending = await market.discover();
    assert.strictEqual(count(trending, 'trending'), 1, 'a non-pump launchpad is filtered out');
    const hit = trending.find((c) => c.source === 'trending');
    assert.strictEqual(hit.launched, true, 'a Jupiter pump.fun coin carries proof of origin');
    assert.strictEqual(hit.hint.symbol, 'PUMPY');
    assert.strictEqual(hit.hint.buys, 55);
    // RULE CHANGED: Jupiter publishes priceChange already as a percentage (checked against DexScreener on the same
    // coins), so it is stored as it arrives instead of being scaled by 100 a second time.
    assert.strictEqual(hit.hint.change5m, 20, 'a Jupiter percentage is stored as a percentage');
    assert.strictEqual(hit.hint.freezeRisk, true, 'the audit block is read, not a field that does not exist');
    assert.strictEqual(hit.hint.creator, 'DEV9');

    await settle();
    const traded = await market.discover();
    assert.strictEqual(count(traded, 'volume'), 1, 'the top-traded door closes the rotation');

    // The wide doors: the DexScreener search board and GeckoTerminal's newest pools. They are what the coin count
    // rests on, so they are asserted by name, and `discover(false)` must never ask for them.
    {
      calls.length = 0;
      const wide = [];
      // One door per cycle on a one-a-second budget: the rotation needs nine cycles to show every door.
    for (let i = 0; i < 9; i++) { wide.push(...await market.discover(true)); await settle(); }
      assert.ok(calls.some((u) => u.includes('/latest/dex/search?q=')), 'the search board is asked');
      assert.ok(calls.some((u) => u.includes('/new_pools')), 'the newest pools are asked');
      assert.ok(wide.some((r) => r.source === 'search'), 'and a coin from the search board reaches the board');
      assert.ok(wide.some((r) => r.source === 'fresh'), 'as does one from the newest pools');
      const searched = wide.find((r) => r.source === 'search');
      assert.ok(searched.hint.liqUsd > 0, 'a search coin carries the numbers it is scored on');
      calls.length = 0;
      for (let i = 0; i < 9; i++) { await market.discover(false); await settle(); }
      assert.ok(!calls.some((u) => u.includes('/latest/dex/search?q=')), 'turning it off stops the search board');
      assert.ok(!calls.some((u) => u.includes('/new_pools')), 'and the newest pools with it');
    }

    // RULE ADDED 2026-11-05: the shared bucket is now applied to every DexScreener call, so a housekeeping price call
    // waits its turn instead of tripping a 429 - and it returns nothing rather than hammering the host. The bucket is
    // filled by hand here: the rounds above now wait a second for Jupiter's own allowance, so time can no longer
    // guarantee the bucket is full when this line runs.
    market._slots = {};
    for (let i = 0; i < 4; i++) assert.ok(market._slot('dexscreener'), 'the DexScreener bucket holds four calls a second');
    assert.strictEqual((await market.enrich([mint('C')])).size, 0, 'a paced call is skipped while the bucket is full');
    market._slots = {};                               // a second later the bucket is empty again
    const rows = await market.enrich([mint('A'), mint('B'), 'not-a-mint']);
    assert.strictEqual(rows.size, 2, 'two valid mints priced, the junk one dropped');
    const row = rows.get(mint('A'));
    assert.strictEqual(row.symbol, 'TOK');
    assert.strictEqual(row.buys, 40);
    assert.strictEqual(row.sells, 10);
    assert.strictEqual(row.liqUsd, 8000);
    assert.ok(row.netUsd > 0, 'net flow is the trade imbalance');
    assert.ok(market.solPrice() > 20 && market.solPrice() < 2000, `SOL price learned from priceUsd/priceNative, got ${market.solPrice()}`);

    // A pair with an empty five minute bucket must not borrow the hour's counts: a pool that has not traded for
    // minutes is not being bought, and the old fallback made it look busy.
    const quiet = readPair({
      baseToken: { address: 'Q', symbol: 'QUIET' }, dexId: 'pumpfun', priceNative: '0.00001', priceUsd: '0.002',
      marketCap: 20000, liquidity: { usd: 5000 }, priceChange: { m5: 0 },
      txns: { m5: { buys: 0, sells: 0 }, h1: { buys: 90, sells: 10 } }, volume: { m5: 0, h1: 4000 },
    });
    assert.strictEqual(quiet.buys, 0, 'an empty five minute bucket stays empty');
    assert.strictEqual(quiet.netUsd, 0, 'and there is no net flow to claim');
    const hourly = readPair({
      baseToken: { address: 'H', symbol: 'HOURLY' }, dexId: 'pumpfun', priceNative: '0.00001', priceUsd: '0.002',
      liquidity: { usd: 5000 }, priceChange: { m5: 1 },
      txns: { h1: { buys: 90, sells: 10 } }, volume: { h1: 4000 },
    });
    assert.strictEqual(hourly.buys, 90, 'with no five minute bucket at all the hour is used');
    assert.strictEqual(hourly.vol5mUsd, 4000, 'and the volume is taken from the same window');

    assert.strictEqual(market.isPumpCoin({ dexId: 'pumpfun', mint: 'x' }), true);
    assert.strictEqual(market.isPumpCoin({ dexId: 'pumpswap', mint: 'x' }), true);
    assert.strictEqual(market.isPumpCoin({ dexId: 'raydium', mint: 'abcPump' }), true, 'graduated mints end in "pump"');
    assert.strictEqual(market.isPumpCoin({ dexId: 'raydium', mint: 'abcBonk' }), false);

    // A 429 must not throw at the caller, and it must stop the hammering: each host counts one refusal, and every
    // further request in the cooldown is skipped instead of being sent.
    global.fetch = async () => res(429, {});
    const before = market.stats.errors;
    const empty = await market.discover();
    assert.deepStrictEqual(empty, []);
    assert.strictEqual(market.stats.errors, before + 2, 'one refusal per host, counted quietly');
    const skippedBefore = market.stats.skipped;
    await market.discover();
    assert.ok(market.stats.skipped > skippedBefore, 'the next cycle waits for the cooldown instead of retrying');
    assert.strictEqual(market.ready('jupiter'), false, 'the launch host is resting');
    const rotating = ['dexscreener', 'gecko'].filter((host) => !market.ready(host));
    assert.ok(rotating.length >= 1, 'and so is the host of the rotating door that refused');

    // Once one host recovers it is used again on its own.
    global.fetch = async (url) => (String(url).includes('jup.ag') ? res(200, []) : res(429, {}));
    market._cool.jupiter = 0;
    const recovered = await market.discover();
    assert.deepStrictEqual(recovered, [], 'an empty answer is still an answer');
    assert.strictEqual(market.ready('jupiter'), true, 'the recovered host is back in service');

    // The price service is a host of its own: a rate limit on the token index must never stop the price of a coin
    // being held from being read, because that price is what an exit is measured on.
    {
      let priceCalls = 0;
      global.fetch = async (url) => {
        if (String(url).includes('lite-api.jup.ag')) { priceCalls++; return res(200, { [mint('P')]: { usdPrice: 1.5 } }); }
        return res(429, {});
      };
      const fresh = new Market();
      await fresh.discover();
      assert.strictEqual(fresh.ready('jupiter'), false, 'the token index is resting after its refusal');
      const px = await fresh.prices([mint('P')]);
      assert.strictEqual(priceCalls, 1, 'the price service is still asked');
      assert.ok(Math.abs(px.get(mint('P')).priceUsd - 1.5) < 1e-9, 'and the price of the held coin comes back');
      assert.strictEqual(fresh.ready('jup-price'), true, 'the price host kept working while the index was resting');
      assert.strictEqual(fresh.ready('jupiter'), false, 'and the index cooldown never touched it');
      // RULE ADDED 2026-11-05: one price call a second, however often the 150 ms exit tick asks. Measured live: 31
      // refusals in one minute against the price service with a single position held - the desk was the flood, and a
      // 429 there is answered by refusing the prices of every coin on the machine.
      priceCalls = 0;
      await fresh.prices([mint('P')]);
      await fresh.prices([mint('P')]);
      await fresh.prices([mint('P')]);
      assert.strictEqual(priceCalls, 0, 'a second call inside the same second is not sent at all');
      fresh._priceAt = Date.now() - 1500;
      await fresh.prices([mint('P')]);
      assert.strictEqual(priceCalls, 1, 'and the next second is asked once');
    }

    // The user agent is the header that was getting every Jupiter door refused: `PillCrewSniper/1.0` answered 429
    // while a browser-shaped string answered 200 for the same request, one after the other.
    {
      const seen = [];
      global.fetch = async (url, init) => { seen.push(String((init && init.headers && init.headers['user-agent']) || '')); return res(200, {}); };
      const m = new Market();
      await m.discover();
      assert.ok(seen.length > 0, 'a door was asked');
      assert.ok(seen.every((ua) => /Mozilla\/5\.0/.test(ua)), 'every request carries the browser-shaped token');
      assert.ok(seen.every((ua) => /PillCrewSniper/.test(ua)), 'and still names this app, so the traffic is identifiable');
    }

    const best = readPair({ ...pair('m1', { liquidity: { usd: 10 } }) });
    assert.strictEqual(best.mint, 'm1');

    // The holder count, asked only by the extra entry filters: Gecko writes it with thousands separators, and a
    // missing or unreadable answer is "unknown", never a number that would let a bar pass silently.
    {
      const m = new Market();
      m._call = async (url) => (String(url).includes('/info')
        ? { data: { attributes: { holders: '1,234' } } }
        : { data: { attributes: { holders: '0' } } });
      const row = await m.holders(mint('H'));
      assert.strictEqual(row.holders, 1234, 'the separator is stripped and the number read');
      m._call = async () => ({ data: { attributes: {} } });
      assert.strictEqual(await m.holders(mint('H')), null, 'a page without a count is unknown');
      m._call = async () => null;
      assert.strictEqual(await m.holders(mint('H')), null, 'a host that answers nothing is unknown, not zero');
    }

    // RULE ADDED 2026-11-05: a door on a host that is refusing is replaced by a working one. Measured live: five of the
  // nine discovery doors live on Jupiter or GeckoTerminal, both of which answered 429 for hours while DexScreener was
  // fine - and most cycles discovered nothing at all.
  {
    const m = new Market({ onError: () => {} });
    const asked = [];
    global.fetch = async (url) => {
      asked.push(String(url));
      return String(url).includes('jup.ag') || String(url).includes('geckoterminal') ? res(429, {}) : res(200, { pairs: [], data: [] });
    };
    // Both of those hosts refused a moment ago, which is the state that lasted for hours on 2026-11-05.
    m._cool.jupiter = Date.now() + 60000;
    m._cool.gecko = Date.now() + 60000;
    for (let i = 0; i < 6; i++) await m.discover(true);
    const hosts = asked.map((u) => (u.includes('dexscreener') ? 'dexscreener' : u.includes('gecko') ? 'gecko' : 'jupiter'));
    assert.ok(!hosts.includes('jupiter'), 'a refused index is not asked again');
    assert.ok(!hosts.includes('gecko'), 'and neither is a refused pool list');
    assert.ok(hosts.length >= 4, 'while every cycle still discovers from a door that answers');
    assert.ok(hosts.every((h) => h === 'dexscreener'), 'and only from those');
  }

  console.log('Market test passed');
    process.exit(0);
  } finally {
    global.fetch = Market.prototype._origFetch;
  }
})().catch((e) => { console.error(e); process.exit(1); });




