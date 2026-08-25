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
    const addr = String(base.address || p?.relationships?.base_token?.data?.id || "").replace(/^solana_/, "");
    const name = a.name || "";
    const sym = (base.symbol || name.split("/")[0] || "").slice(0, 12);
    const price = Number(a.base_token_price_usd);
    const chg = a.price_change_percentage && a.price_change_percentage.h24 != null
      ? Number(a.price_change_percentage.h24)
      : null;
    const vol = a.volume_usd && a.volume_usd.h24 != null ? Number(a.volume_usd.h24) : null;
    const liq = Number(a.reserve_in_usd) || null;
    const mcap = a.market_cap_usd != null ? Number(a.market_cap_usd) : null;
    if (addr && isFinite(price) && price > 0) {
      list.push({ mint: addr, name: name.split("/")[0] || sym, symbol: sym, price, change24h: chg, volume24h: vol, liquidityUsd: liq, mcap });
    }
  }
  // GeckoTerminal doesn't report mcap for every pool (e.g. fresh bonding-curve
  // coins), so fill the gaps with one DexScreener batch call.
  const missing = list.filter((c) => c.mcap == null).map((c) => c.mint);
  if (missing.length) {
    for (let i = 0; i < missing.length; i += 30) {
      const j = await fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${missing.slice(i, i + 30).join(",")}`, 12000);
      const pairs = Array.isArray(j && j.pairs) ? j.pairs : [];
      for (const p of pairs) {
        const mint = p && p.baseToken && p.baseToken.address;
        if (!mint) continue;
        const mc = p.marketCap != null ? Number(p.marketCap) : null;
        if (mc == null || !isFinite(mc) || mc <= 0) continue;
        const item = list.find((c) => c.mint === mint);
        if (item && item.mcap == null) item.mcap = mc;
      }
    }
  }
  // Last resort: pump.fun knows EVERY coin on its bonding curve (DexScreener
  // only lists graduated AMM pairs), so fill the remaining mcap gaps from it.
  await Promise.all(
    list.filter((c) => c.mcap == null).map(async (c) => {
      const pump = await fromPump(c.mint);
      if (pump && pump.mcap) c.mcap = pump.mcap;
    })
  );
  const lines = list.map((c, i) =>
    `${i + 1}. ${c.name}${c.symbol ? ` (${c.symbol})` : ""} ${fmtUsd(c.price)}${c.change24h != null ? ` ${fmtPct(c.change24h)}` : ""}${c.mcap != null ? ` mcap ${fmtUsd(c.mcap)}` : ""}${c.volume24h != null ? ` vol ${fmtUsd(c.volume24h)}` : ""}${c.liquidityUsd != null ? ` liq ${fmtUsd(c.liquidityUsd)}` : ""}`
  );
  return {
    list,
    context: lines.length ? lines.join("\n") : "trending unavailable right now",
  };
}

/**
 * Solana wallet portfolio check: SOL balance + held tokens with live prices.
 * Free: public RPC for balances + DexScreener batch for prices. No keys.
 * @returns {Promise<{wallet, sol, solUsd, tokens, totalUsd, context, ok:true} | null>}
 */
const SOLANA_RPC = "https://api.mainnet-beta.solana.com";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const SOL_MINT = "So11111111111111111111111111111111111111112";

async function rpcCall(method, params) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(SOLANA_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": UA },
      signal: ctrl.signal,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// base58 -> bytes (null if any char isn't base58).
function b58ToBytes(s) {
  const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let num = 0n;
  for (const ch of s) {
    const v = A.indexOf(ch);
    if (v < 0) return null;
    num = num * 58n + BigInt(v);
  }
  let hex = num.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  const bytes = Buffer.from(hex, "hex");
  // Leading '1' characters encode leading zero bytes.
  let lead = 0;
  while (lead < s.length && s[lead] === "1") lead++;
  return Buffer.concat([Buffer.alloc(lead), bytes]);
}

// A valid Solana pubkey is exactly 32 bytes.
function isPubkey(s) {
  if (!s || typeof s !== "string" || s.length < 32 || s.length > 44) return false;
  const b = b58ToBytes(s);
  return !!b && b.length === 32;
}

async function fetchWalletPortfolio(address) {
  const addr = String(address || "").trim();
  if (!isPubkey(addr)) return null;

  const bal = await rpcCall("getBalance", [addr]);
  const lamports = Number(bal && bal.result && bal.result.value);
  const sol = isFinite(lamports) ? lamports / 1e9 : 0;

  // Tokens can live in either the legacy SPL Token program OR Token-2022
  // (pump.fun coins use both) - query both and merge by mint.
  const holdings = [];
  const seen = new Set();
  for (const program of [TOKEN_PROGRAM, TOKEN_2022_PROGRAM]) {
    const ta = await rpcCall("getTokenAccountsByOwner", [addr, { programId: program }, { encoding: "jsonParsed" }]);
    const accounts = Array.isArray(ta && ta.result && ta.result.value) ? ta.result.value : [];
    for (const item of accounts) {
      const info = item && item.account && item.account.data && item.account.data.parsed && item.account.data.parsed.info;
      if (!info || !info.mint) continue;
      const ui = Number(info.tokenAmount && info.tokenAmount.uiAmount);
      if (!isFinite(ui) || ui <= 0) continue;
      if (seen.has(info.mint)) continue;
      seen.add(info.mint);
      holdings.push({ mint: info.mint, amount: ui });
    }
  }

  // Live prices: query EACH mint individually - the batch endpoint caps at 30
  // pairs TOTAL, so a wallet with several tokens silently loses its most
  // liquid pairs (a wallet's BATON once priced 2.5x too high off a $2.7K pair).
  const mints = [SOL_MINT, ...holdings.map((h) => h.mint)].slice(0, 12);
  const priceMap = new Map();
  await Promise.all(
    mints.map(async (mint) => {
      const j = await fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, 12000);
      const pairs = Array.isArray(j && j.pairs) ? j.pairs : [];
      for (const p of pairs) {
        const rec = (tok) => {
          if (!tok || !tok.address) return;
          const price = Number(p.priceUsd);
          if (!isFinite(price) || price <= 0) return;
          // Use the MOST-LIQUID pair as the source of truth - a thin pair can
          // carry a wildly inflated price (a $2.7K-liquidity pair once priced a
          // wallet's BATON 2.5x too high).
          const liq = Number(p.liquidity && p.liquidity.usd) || 0;
          const cur = priceMap.get(tok.address);
          if (cur && (cur.liquidity || 0) >= liq) return;
          priceMap.set(tok.address, {
            price,
            liquidity: liq,
            name: tok.name || "",
            symbol: (tok.symbol || "").slice(0, 12),
            change24h: p.priceChange && p.priceChange.h24 != null ? Number(p.priceChange.h24) : null,
            volume24h: p.volume && p.volume.h24 != null ? Number(p.volume.h24) : null,
          });
        };
        rec(p.baseToken);
        rec(p.quoteToken);
      }
    })
  );
  // Fallback: pump.fun prices for mints DexScreener didn't know.
  for (const h of holdings) {
    if (priceMap.has(h.mint)) continue;
    const pump = await fromPump(h.mint);
    if (pump && pump.price) {
      priceMap.set(h.mint, { price: pump.price, name: pump.name, symbol: pump.symbol, change24h: null, volume24h: pump.volume24h || null });
    }
  }

  const solPrice = priceMap.get(SOL_MINT) ? priceMap.get(SOL_MINT).price : null;
  const solUsd = solPrice ? sol * solPrice : 0;
  const tokens = [];
  for (const h of holdings) {
    const pm = priceMap.get(h.mint);
    const usd = pm ? h.amount * pm.price : null;
    if (pm && usd != null && usd < 0.01) continue; // skip dust we can price
    tokens.push({
      mint: h.mint,
      name: (pm && pm.name) || h.mint.slice(0, 6),
      symbol: (pm && pm.symbol) || "",
      amount: h.amount,
      price: pm ? pm.price : null,
      usd,
      change24h: pm ? pm.change24h : null,
      volume24h: pm ? pm.volume24h : null,
    });
  }
  // Priced holdings first (by USD), unpriced at the bottom.
  tokens.sort((a, b) => (b.usd == null ? -1 : b.usd) - (a.usd == null ? -1 : a.usd));
  const top = tokens.slice(0, 10);
  const pricedUsd = top.reduce((s, t) => s + (t.usd != null ? t.usd : 0), 0);
  const totalUsd = solUsd + pricedUsd;
  // Weighted 24h change of the priced holdings.
  let change24h = null;
  {
    const wsum = top.reduce((s, t) => s + (t.usd != null && t.change24h != null ? t.usd : 0), 0);
    if (wsum > 0) {
      change24h = top.reduce((s, t) => s + (t.usd != null && t.change24h != null ? t.change24h * (t.usd / wsum) : 0), 0);
    }
  }

  const lines = [];
  lines.push(`Wallet ${addr.slice(0, 5)}…${addr.slice(-4)}`);
  lines.push(`SOL ${sol.toFixed(4)}${solUsd > 0 ? ` (${fmtUsd(solUsd)})` : ""}`);
  if (top.length) {
    lines.push(`Holdings ${top.length} token${top.length === 1 ? "" : "s"} · est ${fmtUsd(totalUsd)}${change24h != null ? ` · 24h ${fmtPct(change24h)}` : ""}`);
    top.forEach((t, i) => {
      const amt = t.amount >= 1000 ? t.amount.toLocaleString(undefined, { maximumFractionDigits: 0 }) : t.amount.toFixed(4);
      const val = t.usd != null ? fmtUsd(t.usd) : "no price";
      lines.push(`${i + 1}. ${t.name}${t.symbol ? ` (${t.symbol})` : ""} ${amt} · ${val}${t.change24h != null ? ` ${fmtPct(t.change24h)}` : ""}`);
    });
  } else {
    lines.push("No tokens held - just SOL.");
  }

  return { wallet: addr, sol, solUsd, tokens: top, totalUsd, change24h, context: lines.join("\n"), ok: true };
}

module.exports = { detectMint, fetchCoinContext, fetchTrendingTop, fetchWalletPortfolio, isPubkey, fmtUsd, fmtPct };
