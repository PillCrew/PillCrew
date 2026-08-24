// PillCrew - DexScreener trending scanner
// Prints DexScreener's Trending tab (boosted tokens, Solana) with live prices,
// market caps, 24h change and liquidity. Picks the most-liquid pair per token.
//
// Usage:
//   node scripts/dexscreener-trending.mjs            # top 10
//   node scripts/dexscreener-trending.mjs 25         # top 25

const LIMIT = Math.min(30, Math.max(1, Number(process.argv[2] || 10)));
const MIN_LIQUIDITY = 9000;

const fmt = (n) =>
  n == null
    ? "-"
    : n >= 1e9
      ? `$${(n / 1e9).toFixed(2)}B`
      : n >= 1e6
        ? `$${(n / 1e6).toFixed(1)}M`
        : n >= 1e3
          ? `$${(n / 1e3).toFixed(1)}K`
          : `$${n.toFixed(0)}`;

const chg = (v) => (v == null ? "-" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);

async function main() {
  const boostsRes = await fetch("https://api.dexscreener.com/token-boosts/top/v1");
  const boosts = await boostsRes.json();
  const mints = (Array.isArray(boosts) ? boosts : [])
    .filter((b) => b?.chainId === "solana" && b?.tokenAddress)
    .slice(0, LIMIT)
    .map((b) => b.tokenAddress);

  if (!mints.length) {
    console.log("No trending tokens right now.");
    return;
  }

  const pairsRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mints.join(",")}`);
  const { pairs } = await pairsRes.json();
  const best = {};
  for (const p of pairs || []) {
    const m = p?.baseToken?.address;
    if (!m) continue;
    if (!best[m] || Number(p?.liquidity?.usd || 0) > Number(best[m].liquidity?.usd || 0)) best[m] = p;
  }

  console.log(`#  SYMBOL            PRICE        24H        MCAP      LIQUIDITY  VOL 24H`);
  mints.forEach((mint, i) => {
    const p = best[mint];
    if (!p) return;
    const liq = Number(p?.liquidity?.usd || 0);
    if (liq < MIN_LIQUIDITY) return;
    const sym = (p.baseToken?.symbol || mint.slice(0, 6)).padEnd(18).slice(0, 18);
    console.log(
      `${String(i + 1).padStart(2)}  ${sym} ${String(p.priceUsd || "-").padEnd(12).slice(0, 12)} ` +
        `${chg(p?.priceChange?.h24).padEnd(9)} ${fmt(p?.marketCap).padEnd(9)} ` +
        `${fmt(liq).padEnd(9)} ${fmt(p?.volume?.h24)}`
    );
  });
}

main().catch((e) => {
  console.error("Failed:", e.message);
  process.exit(1);
});
