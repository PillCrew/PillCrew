// src/coins.js - free Solana market data for Pilly (no keys needed).
// Sources (tried in order, each degrades independently):
//   1) pump.fun coin API    - authoritative for pump.fun coins (name/mcap/volume/age)
//   2) DexScreener tokens   - the real AMM pair (price/volume/liquidity/change/txns)
//   3) Jupiter tokens API   - organic score, verification, holder/audit intel (free tier)
//   4) GeckoTerminal        - trending pools + token pool liquidity fallback

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36";

async function fetchJson(url, ms = 9000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: ctrl.signal });
    if (res.status === 429) return { rateLimited: true };
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const fmtUsd = (v) => {
  const n = Number(v);
  if (!isFinite(n) || n <= 0) return "-";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  if (n >= 1) return `$${n.toFixed(4)}`;
  const dec = Math.min(8, Math.max(2, Math.ceil(-Math.log10(n)) + 2));
  return `$${n.toFixed(dec)}`;
};
const fmtPct = (v) => (v == null || !isFinite(Number(v)) ? "-" : `${Number(v) >= 0 ? "+" : ""}${Number(v).toFixed(1)}%`);

// ---- detection ----
function detectMint(text) {
  if (!text) return null;
  // pump.fun / jup.ag links: grab the mint from the URL path.
  const link = String(text).match(/https?:\/\/[^\s]+?\/(?:coin|tokens?|token)\/([A-Za-z0-9]{32,44})/i);
  if (link) return link[1];
  // Bare Solana base58 mint (32-44 chars), avoiding common words.
  const bare = String(text).match(/\b([1-9A-HJ-NP-Za-km-z]{32,44})\b/);
  if (bare) {
    const s = bare[1];
    // Heuristic: real mints almost always end with "pump" for pump.fun coins
    // or contain mixed case; also accept the well-known So111... (SOL).
    if (s.endsWith("pump") || s === "So11111111111111111111111111111111111111112") return s;
    if (/[a-z]/.test(s) && /[A-Z]/.test(s)) return s;
  }
  return null;
}

// ---- pump.fun ----
async function fromPump(mint) {
  const j = await fetchJson(`https://frontend-api-v3.pump.fun/coins/${encodeURIComponent(mint)}`);
  if (!j || j.rateLimited) return null;
  const mcap = Number(j.usd_market_cap);
  if (!isFinite(mcap) || mcap <= 0) return null;
  return {
    name: j.name || "",
    symbol: (j.symbol || "").slice(0, 12),
    image: j.image_uri || null,
    mcap,
    price: Number(j.raydium_pool?.open_market_pool_info?.market_pool_price) || null,
    volume24h: Number(j.volume_24) || 0,
    createdAt: j.created_timestamp ? Number(j.created_timestamp) : null,
    creator: j.creator || null,
    website: j.website ? j.website.replace(/^https?:\/\//, "") : null,
  };
}

// ---- DexScreener ----
async function fromDex(mint) {
  const j = await fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(mint)}`);
  if (!j || j.rateLimited) return null;
  const pairs = Array.isArray(j.pairs) ? j.pairs : [];
  if (!pairs.length) return null;
  const best = pairs.reduce(
    (b, c) => (Number(c?.liquidity?.usd || 0) > Number(b?.liquidity?.usd || 0) ? c : b),
    pairs[0]
  );
  const price = Number(best?.priceUsd);
  if (!isFinite(price) || price <= 0) return null;
  return {
    price,
    marketCap: best.marketCap != null ? Number(best.marketCap) : null,
    fdv: best.fdv != null ? Number(best.fdv) : null,
    volume24h: best.volume?.h24 != null ? Number(best.volume.h24) : null,
    liquidityUsd: best.liquidity?.usd != null ? Number(best.liquidity.usd) : null,
    change24h: best.priceChange?.h24 != null ? Number(best.priceChange.h24) : null,
    buys24h: best.txns?.h24?.buys ?? null,
    sells24h: best.txns?.h24?.sells ?? null,
    pair: best.pairAddress || null,
    dex: best.dexId || null,
    labels: Array.isArray(best.labels) ? best.labels : [],
  };
}

// ---- Jupiter intel ----
async function fromJupiter(mint) {
  const j = await fetchJson(`https://api.jup.ag/tokens/v2/search?query=${encodeURIComponent(mint)}`);
  if (!j || j.rateLimited) return null;
  const arr = Array.isArray(j) ? j : [j];
  const d = arr.find((x) => x && x.id === mint) || arr[0];
  if (!d || d.id !== mint) return null;
  const audit = d.audit || {};
  const s24 = d.stats24h || {};
  return {
    organicScore: d.organicScore != null ? Math.round(d.organicScore) : null,
    organicLabel: d.organicScoreLabel || null,
    isVerified: !!d.isVerified,
    isSus: "isSus" in audit ? !!audit.isSus : null,
    mintAuthority: audit.mintAuthorityDisabled == null ? null : audit.mintAuthorityDisabled ? "renounced" : "active",
    topHoldersPct: audit.topHoldersPercentage != null ? Number(audit.topHoldersPercentage) : null,
    devBalancePct: audit.devBalancePercentage != null ? Number(audit.devBalancePercentage) : null,
    holderCount: d.holderCount ?? null,
    buyVolume24h: s24.buyVolume != null ? Number(s24.buyVolume) : null,
    sellVolume24h: s24.sellVolume != null ? Number(s24.sellVolume) : null,
    numBuys24h: s24.numBuys ?? null,
    numSells24h: s24.numSells ?? null,
    mcap: d.mcap != null ? Number(d.mcap) : null,
    liquidity: d.liquidity != null ? Number(d.liquidity) : null,
  };
}

function ageLabel(ms) {
  if (ms == null || !isFinite(ms)) return null;
  if (ms < 0) ms = 0;
  const h = ms / 3600000;
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 24) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

/**
 * Full live snapshot for a mint.
 * @returns {Promise<{coin: object, context: string} | null>}
 */
async function fetchCoinContext(mint) {
  if (!mint) return null;
  const [pump, dex, jup] = await Promise.all([fromPump(mint), fromDex(mint), fromJupiter(mint)]);
  if (!pump && !dex) return null; // nothing knows this token

  const now = Date.now();
  const createdAt = pump?.createdAt ?? null;
  const ageMs = createdAt ? now - createdAt : null;

  // Best values (prefer pump for pump coins, dex for everything else).
  const price = pump?.price || dex?.price || null;
  const mcap = pump?.mcap || dex?.marketCap || jup?.mcap || null;
  const volume = pump?.volume24h || dex?.volume24h || null;
  const liquidity = dex?.liquidityUsd || jup?.liquidity || null;
  const change24h = dex?.change24h ?? null;
  const buys = dex?.buys24h ?? jup?.numBuys24h ?? null;
  const sells = dex?.sells24h ?? jup?.numSells24h ?? null;

  const coin = {
    mint,
    name: pump?.name || (dex?.pair ? "token" : "Unknown"),
    symbol: pump?.symbol || "",
    image: pump?.image || null,
    price,
    mcap,
    volume24h: volume,
    liquidityUsd: liquidity,
    change24h,
    buys24h: buys,
    sells24h: sells,
    age: ageLabel(ageMs),
    ageMs,
    verified: jup?.isVerified ?? null,
    organicScore: jup?.organicScore ?? null,
    organicScoreLabel: jup?.organicLabel ?? null,
    isSus: jup?.isSus ?? null,
    mintAuthority: jup?.mintAuthority ?? null,
    topHoldersPct: jup?.topHoldersPct ?? null,
    devBalancePct: jup?.devBalancePct ?? null,
    holderCount: jup?.holderCount ?? null,
    pair: dex?.pair || null,
    dex: dex?.dex || null,
    labels: dex?.labels || [],
  };

  const lines = [];
  lines.push(`Coin: ${coin.name}${coin.symbol ? ` (${coin.symbol})` : ""}${pump ? " · pump.fun" : ""}`);
  if (price != null) lines.push(`price ${fmtUsd(price)}`);
  if (change24h != null) lines.push(`24h ${fmtPct(change24h)}`);
  if (mcap != null) lines.push(`mcap ${fmtUsd(mcap)}`);
  if (volume != null) lines.push(`24h volume ${fmtUsd(volume)}${volume > 0 && volume < 10000 ? " (DUST)" : volume >= 1000000 ? " (strong)" : volume >= 50000 ? "" : " (thin)"}`);
  if (liquidity != null) lines.push(`liquidity ${fmtUsd(liquidity)}`);
  if (volume != null && liquidity != null && liquidity > 0) lines.push(`vol/liq ${(volume / liquidity).toFixed(2)}x`);
  if (coin.age) lines.push(`age ${coin.age}`);
  if (buys != null && sells != null && buys + sells > 0) {
    lines.push(`24h txns ${buys.toLocaleString()} buys / ${sells.toLocaleString()} sells (${Math.round((buys / (buys + sells)) * 100)}% buy share)`);
  }
  if (coin.organicScore != null) lines.push(`organic ${coin.organicScore}/100${coin.organicScoreLabel ? ` (${coin.organicScoreLabel})` : ""}`);
  if (coin.verified != null) lines.push(coin.verified ? "verified" : "unverified");
  if (coin.isSus) lines.push("FLAGGED SUSPICIOUS (Jupiter) - high rug risk");
  if (coin.mintAuthority) lines.push(`mint authority ${coin.mintAuthority}`);
  if (coin.topHoldersPct != null) lines.push(`top-10 holders ${coin.topHoldersPct.toFixed(1)}%`);
  if (coin.devBalancePct != null) lines.push(`dev holds ${coin.devBalancePct.toFixed(1)}%`);
  if (coin.holderCount != null) lines.push(`${coin.holderCount.toLocaleString()} holders`);
  if (coin.dex) lines.push(`pair: ${coin.dex}${coin.pair ? ` (${coin.pair.slice(0, 8)}…)` : ""}`);

  return { coin, context: lines.join("\n") };
}

/**
 * Hot coins right now (GeckoTerminal trending_pools, free, no key).
 * @returns {Promise<{list: Array, context: string}>}
 */
async function fetchTrendingTop(limit = 8) {
  const j = await fetchJson(`https://api.geckoterminal.com/api/v2/networks/solana/trending_pools?page=1`);
  const pools = Array.isArray(j?.data) ? j.data : [];
  const list = [];
  for (const p of pools.slice(0, limit)) {
    const a = p?.attributes || {};
    const base = a.base_token || {};
    const quote = a.quote_token || {};
    const addr = base.address || p?.relationships?.base_token?.data?.id;
    const name = a.name || "";
    const sym = (base.symbol || name.split("/")[0] || "").slice(0, 12);
    const price = Number(a.base_token_price_usd);
    const chg = a.price_change_percentage && a.price_change_percentage.h24 != null
      ? Number(a.price_change_percentage.h24)
      : null;
    const vol = a.volume_usd && a.volume_usd.h24 != null ? Number(a.volume_usd.h24) : null;
    const liq = Number(a.reserve_in_usd) || null;
    if (addr && isFinite(price) && price > 0) {
      list.push({ mint: addr, name: name.split("/")[0] || sym, symbol: sym, price, change24h: chg, volume24h: vol, liquidityUsd: liq });
    }
  }
  const lines = list.map((c, i) =>
    `${i + 1}. ${c.name}${c.symbol ? ` (${c.symbol})` : ""} ${fmtUsd(c.price)}${c.change24h != null ? ` ${fmtPct(c.change24h)}` : ""}${c.volume24h != null ? ` vol ${fmtUsd(c.volume24h)}` : ""}`
  );
  return {
    list,
    context: lines.length ? lines.join("\n") : "trending unavailable right now",
  };
}

module.exports = { detectMint, fetchCoinContext, fetchTrendingTop, fmtUsd, fmtPct };
