const DS = 'https://api.dexscreener.com';
const JUP = 'https://api.jup.ag/tokens/v2';
const JUP_PRICE = 'https://lite-api.jup.ag/price/v3';
const GECKO = 'https://api.geckoterminal.com/api/v2/networks/solana';
const WSOL = 'So11111111111111111111111111111111111111112';
const UA = {
  accept: 'application/json',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) PillCrewSniper/1.0',
};
const BATCH = 30;
// A public data host tolerates about five requests a second, and it is asked by three pollers at once, so the
// traffic is paced: a call for an open position always passes, everything else waits its turn.
const CALLS_PER_SEC = 4;
const PRICE_MIN_GAP_MS = 1000;
// The words a memecoin symbol is made of. The DexScreener search board answers about thirty pairs per query, so it
// is walked one word at a time instead of asking the same thing every cycle.
const SEARCH_WORDS = ['pump', 'sol', 'ai', 'dog', 'cat', 'pepe', 'moon', 'trump', 'coin', 'baby'];

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

async function getJson(url, key, ms = 7000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const headers = key ? { ...UA, 'x-api-key': key } : UA;
    const r = await fetch(url, { headers, signal: ctl.signal });
    if (r.status === 429) throw Object.assign(new Error('rate limited'), { kind: 'rate' });
    if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { kind: 'http' });
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

function pickPair(pairs, mint) {
  let best = null;
  for (const p of pairs) {
    if (p.baseToken?.address !== mint) continue;
    if (!best || num(p.liquidity?.usd) > num(best.liquidity?.usd)) best = p;
  }
  return best;
}

function readPair(p) {
  // One window, never a mix. A coin with no trades in the last five minutes used to inherit the hour's counts,
  // which made a dead pool look like it was being bought; the five minute bucket is used whenever it exists.
  const m5 = p.txns && p.txns.m5;
  const useFive = Boolean(m5 && (m5.buys != null || m5.sells != null));
  const win = useFive ? m5 : (p.txns && p.txns.h1) || {};
  const vol = useFive ? num(p.volume && p.volume.m5) : num(p.volume && p.volume.h1);
  const buys = num(win.buys);
  const sells = num(win.sells);
  return {
    mint: p.baseToken.address,
    symbol: String(p.baseToken.symbol || '?').slice(0, 12),
    name: String(p.baseToken.name || '').slice(0, 40),
    dexId: p.dexId || '',
    quoteMint: p.quoteToken?.address || '',
    priceUsd: num(p.priceUsd),
    priceNative: num(p.priceNative),
    mcapUsd: num(p.marketCap) || num(p.fdv),
    liqUsd: num(p.liquidity?.usd),
    vol5mUsd: vol,
    change5m: num(p.priceChange?.m5),
    buys,
    sells,
    netUsd: vol * ((buys - sells) / Math.max(1, buys + sells)),
    pairCreatedAt: num(p.pairCreatedAt),
  };
}

class Market {
  constructor(opts = {}) {
    this.getKey = opts.getKey || (() => '');
    this.onError = opts.onError || (() => {});
    this.solUsd = 0;
    this.stats = { discovered: 0, priced: 0, calls: 0, errors: 0, skipped: 0 };
    this._source = 0;
    this._cool = {};
    this._steps = {};
    this._slots = {};
  }

  _host(url) {
    const text = String(url);
    // api.jup.ag and lite-api.jup.ag are two different services with two different limits: a rate limit on the token
    // index must never stop the price of a coin being held from being read, because that price is an exit.
    if (text.includes('lite-api.jup.ag')) return 'jup-price';
    if (text.includes('jup.ag')) return 'jupiter';
    if (text.includes('geckoterminal')) return 'gecko';
    return 'dexscreener';
  }

  /** True while that host is willing to talk. The two data sources have separate budgets. */
  ready(host = 'dexscreener') {
    return Date.now() >= (this._cool[host] || 0);
  }

  _slot(host, max = CALLS_PER_SEC) {
    const now = Date.now();
    const slots = (this._slots[host] || []).filter((t) => now - t < 1000);
    this._slots[host] = slots;
    if (slots.length < max) { slots.push(now); return true; }
    this.stats.skipped++;
    return false;
  }

  async _call(url, urgent = false) {
    const host = this._host(url);
    if (!this.ready(host)) { this.stats.skipped++; return null; }
    const cap = host === 'jupiter' || host === 'jup-price' ? 2 : CALLS_PER_SEC;
    if ((host === 'dexscreener' || host === 'jupiter' || host === 'jup-price') && !urgent && !this._slot(host, cap)) return null;
    this.stats.calls++;
    try {
      const body = await getJson(url, this.getKey());
      this._steps[host] = 0;
      return body;
    } catch (e) {
      this.stats.errors++;
      // The host travels with the error: "Market data: rate limited" told nobody WHICH door was refusing, and on
      // 2026-11-05 it was Jupiter and GeckoTerminal for hours while DexScreener was answering normally.
      if (!e.host) e.host = host;
      if (e.kind === 'rate') {
        const step = Math.min(7, (this._steps[host] || 0) + 1);
        this._steps[host] = step;
        this._cool[host] = Date.now() + Math.min(60000, 700 * 2 ** step);
      }
      this.onError(e);
      return null;
    }
  }

  _readSol(list) {
    for (const p of list) {
      const usd = num(p.priceUsd);
      const native = num(p.priceNative);
      if (usd > 0 && native > 0) {
        const guess = usd / native;
        if (guess > 20 && guess < 2000) { this.solUsd = guess; return; }
      }
    }
  }

  async discover(wide = true) {
    const out = [];
    if (this.ready('jupiter')) {
      const fresh = await this._call(`${JUP}/recent?limit=50`);
      for (const t of Array.isArray(fresh) ? fresh : []) {
        if (!this._isPumpToken(t)) continue;
        out.push({ mint: t.id, source: 'launch', launched: true, hint: this._hintOf(t) });
      }
    } else this.stats.skipped++;

    const doors = wide ? 9 : 7;
    const DOOR_HOST = ['dexscreener', 'dexscreener', 'dexscreener', 'jupiter', 'jupiter', 'gecko', 'gecko', 'dexscreener', 'gecko'];
    let door = this._source++ % doors;
    if (!this.ready(DOOR_HOST[door])) {
      const working = [7, 0, 1, 2].filter((d) => d < doors && this.ready(DOOR_HOST[d]));
      // Nothing to ask: every door that is not already resting is on a host that refused. Saying so in the counter is
      // what keeps "the desk is working" and "the desk is silent" two different readings.
      if (!working.length) { this.stats.skipped++; return out; }
      // Rotated by the same cursor so the wide doors are not all the same one: the search board, both boost lists and
      // the profiles list take turns.
      door = working[this._source % working.length];
    }
    if (door === 0 || door === 1) {
      const url = door === 0 ? `${DS}/token-boosts/latest/v1` : `${DS}/token-boosts/top/v1`;
      const list = await this._call(url);
      for (const b of Array.isArray(list) ? list : []) {
        if (b.chainId !== 'solana' || !b.tokenAddress) continue;
        out.push({ mint: b.tokenAddress, source: 'callout' });
      }
    }
    if (door === 2) {
      const list = await this._call(`${DS}/token-profiles/latest/v1`);
      for (const p of Array.isArray(list) ? list : []) {
        if (p.chainId !== 'solana' || !p.tokenAddress) continue;
        out.push({ mint: p.tokenAddress, source: 'new' });
      }
    }
    if (door === 3 || door === 4) {
      const cat = door === 3 ? 'toptrending' : 'toptraded';
      const list = await this._call(`${JUP}/${cat}/5m?limit=50`);
      for (const t of Array.isArray(list) ? list : []) {
        if (!this._isPumpToken(t)) continue;
        out.push({ mint: t.id, source: cat === 'toptrending' ? 'trending' : 'volume', launched: true, hint: this._hintOf(t) });
      }
    }
    if (door === 5) {
      // Every pool on the Pump.fun dex, page by page. This is the wide net: coins that launched an hour ago and
      // never reached a trending list still show up here with real buys, sells and volume.
      this._geckoPage = (this._geckoPage || 0) % 4 + 1;
      const body = await this._call(`${GECKO}/dexes/pump-fun/pools?page=${this._geckoPage}`);
      out.push(...this._fromGecko(body, 'curve'));
    }
    if (door === 6) {
      // Trending pools rotate through three pages, so the same coins are not re-read on every cycle.
      this._geckoTrend = (this._geckoTrend || 0) % 3 + 1;
      const body = await this._call(`${GECKO}/trending_pools?page=${this._geckoTrend}`);
      out.push(...this._fromGecko(body, 'trending'));
    }
    if (door === 7) {
      const q = SEARCH_WORDS[(this._searchWord = ((this._searchWord || 0) + 1) % SEARCH_WORDS.length)];
      const body = await this._call(`${DS}/latest/dex/search?q=${q}`);
      out.push(...this._fromPairs(body?.pairs, 'search'));
    }
    if (door === 8) {
      // The newest pools on GeckoTerminal, across every Solana exchange, so a coin is seen minutes after it exists
      // rather than after it trends.
      this._geckoNew = (this._geckoNew || 0) % 3 + 1;
      const body = await this._call(`${GECKO}/new_pools?page=${this._geckoNew}`);
      out.push(...this._fromGecko(body, 'fresh'));
    }

    this.stats.discovered += out.length;
    const seen = new Set();
    return out.filter((c) => (seen.has(c.mint) ? false : (seen.add(c.mint), true)));
  }

  /** DexScreener pairs grouped by their base token, best pool first, each carrying the numbers a coin is scored on. */
  _fromPairs(pairs, source) {
    const out = [];
    const best = new Map();
    for (const p of Array.isArray(pairs) ? pairs : []) {
      if (!p || p.chainId !== 'solana') continue;
      const mint = p.baseToken && p.baseToken.address;
      if (!mint || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) continue;
      const liq = num(p.liquidity && p.liquidity.usd);
      const prev = best.get(mint);
      if (!prev || liq > prev.liq) best.set(mint, { pair: p, liq });
    }
    for (const [mint, { pair }] of best) out.push({ mint, source, hint: readPair(pair) });
    return out;
  }

  /** GeckoTerminal rows carry price, depth, volume and the buy and sell counts, so a coin can be scored at once. */
  _fromGecko(body, source) {
    const rows = Array.isArray(body?.data) ? body.data : [];
    const out = [];
    for (const row of rows) {
      const id = row?.relationships?.base_token?.data?.id || '';
      const mint = id.startsWith('solana_') ? id.slice(7) : '';
      if (!mint) continue;
      const a = row.attributes || {};
      const [symbol, name] = String(a.name || '').split(' / ');
      const createdAt = Date.parse(a.pool_created_at) || 0;
      out.push({
        mint,
        source,
        // A pool is "launched" only while it is young; an older one is scored as an established mover instead of
        // being credited with a launch it no longer is.
        launched: Boolean(createdAt && Date.now() - createdAt < 30 * 60000),
        hint: {
          symbol: String(symbol || '?').slice(0, 12),
          name: String(name || symbol || '').slice(0, 40),
          priceNative: num(a.base_token_price_native_currency),
          priceUsd: num(a.base_token_price_usd),
          mcapUsd: num(a.market_cap_usd) || num(a.fdv_usd),
          liqUsd: num(a.reserve_in_usd),
          vol5mUsd: num(a.volume_usd?.m5),
          change5m: num(a.price_change_percentage?.m5),
          buys: num(a.transactions?.m5?.buys),
          sells: num(a.transactions?.m5?.sells),
          createdAt,
        },
      });
    }
    return out;
  }

  _isPumpToken(t) {
    return Boolean(t && t.id) && (t.launchpad === 'pump.fun' || String(t.id).endsWith('pump'));
  }

  _hintOf(t) {
    const s5 = t.stats5m || {};
    const audit = t.audit || {};
    return {
      symbol: String(t.symbol || '?').slice(0, 12),
      name: String(t.name || '').slice(0, 40),
      creator: t.dev || null,
      mcapUsd: num(t.mcap) || num(t.fdv),
      liqUsd: 0,
      change5m: num(s5.priceChange),
      buys: num(s5.numBuys),
      sells: num(s5.numSells),
      netUsd: num(s5.buyVolume) - num(s5.sellVolume),
      // The audit block is the only real safety signal Jupiter publishes: whether the dev can still mint or freeze.
      mintRisk: audit.mintAuthorityDisabled === false,
      freezeRisk: audit.freezeAuthorityDisabled === false,
      devHoldPct: num(audit.devBalancePercentage),
    };
  }

  async prices(mints) {
    const ids = [...new Set(mints.filter((m) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m)))];
    if (!ids.length) return new Map();
    // The price service has its own cooldown. Checking the token index instead is what let a refusal on the launch
    // list hold back the prices of every coin being held.
    if (!this.ready('jup-price')) return new Map();
    // One call a second, however often the exit tick asks: the free allowance is per IP and a flood is answered with
    // 429 for everything on this machine, including the prices of the coins being held.
    const nowMs = Date.now();
    if (this._priceAt && nowMs - this._priceAt < PRICE_MIN_GAP_MS) return new Map();
    this._priceAt = nowMs;
    const out = new Map();
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const body = await this._call(`${JUP_PRICE}?ids=${chunk.join(',')}`);
      for (const [mint, row] of Object.entries(body || {})) {
        const usd = num(row && row.usdPrice);
        if (usd > 0) out.set(mint, { priceUsd: usd, liqUsd: num(row.liquidity), at: Date.now() });
      }
    }
    return out;
  }

  /** Prices up to 30 mints per request. Returns a Map keyed by mint. `urgent` marks the open positions. */
  async enrich(mints, urgent = false) {
    if (!this.ready('dexscreener')) return new Map();
    const unique = [...new Set(mints.filter((m) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m)))];
    const rows = new Map();
    for (let i = 0; i < unique.length; i += BATCH) {
      const chunk = unique.slice(i, i + BATCH);
      const body = await this._call(`${DS}/latest/dex/tokens/${chunk.join(',')}`, urgent);
      const pairs = body?.pairs;
      if (!Array.isArray(pairs)) continue;
      this._readSol(pairs);
      for (const mint of chunk) {
        const best = pickPair(pairs, mint);
        if (!best) continue;
        rows.set(mint, readPair(best));
        this.stats.priced++;
      }
    }
    return rows;
  }

  async holders(mint) {
    if (!this.ready('gecko') || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return null;
    const body = await this._call(`${GECKO}/tokens/${mint}/info`);
    const h = Number(String(body?.data?.attributes?.holders ?? '').replace(/[,\s]/g, ''));
    if (!(h > 0)) return null;
    return { holders: h };
  }

  /** One mint through DexScreener, used when a coin is adopted without a quote. */
  async price(mint) {
    const rows = await this.enrich([mint]);
    return rows.get(mint) || null;
  }

  solPrice() {
    if (this.solUsd > 0) return this.solUsd;
    return 0;
  }

  isPumpCoin(row) {
    if (!row) return false;
    if (row.dexId === 'pumpfun' || row.dexId === 'pumpswap') return true;
    return /pump$/i.test(row.mint || '');
  }
}

module.exports = { Market, WSOL, readPair };
