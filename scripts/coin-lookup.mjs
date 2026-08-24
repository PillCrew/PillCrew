// PillCrew - quick coin lookup
// Paste a Solana token address (or a pump.fun / dexscreener link) and get a
// compact live snapshot: price, 24h change, market cap, liquidity and volume.
//
// Usage:
//   node scripts/coin-lookup.mjs <mint-address-or-url>

const input = (process.argv[2] || "").trim();
const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const URL_MINT_RE = /[1-9A-HJ-NP-Za-km-z]{32,44}/;

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

function resolveMint(raw) {
  const t = raw.trim();
  if (MINT_RE.test(t)) return t;
  const m = t.match(URL_MINT_RE);
  return m ? m[0] : null;
}

async function main() {
  if (!input) {
    console.log("Usage: node scripts/coin-lookup.mjs <mint-or-url>");
    process.exit(1);
  }
  const mint = resolveMint(input);
  if (!mint) {
    console.error("Could not find a valid Solana token address in that input.");
    process.exit(1);
  }

  const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
  const { pairs } = await res.json();
  const best = (pairs || []).reduce(
    (a, b) => (Number(b?.liquidity?.usd || 0) > Number(a?.liquidity?.usd || 0) ? b : a),
    pairs?.[0]
  );

  if (!best) {
    console.log("No live data found for this token (very new or delisted).");
    return;
  }

  const p = best;
  console.log("-------------------------------");
  console.log(`Token      : ${p.baseToken?.name} (${p.baseToken?.symbol})`);
  console.log(`Price      : $${Number(p.priceUsd).toLocaleString(undefined, { maximumFractionDigits: 12 })}`);
  console.log(`24h change : ${p?.priceChange?.h24 != null ? `${p.priceChange.h24 >= 0 ? "+" : ""}${p.priceChange.h24.toFixed(2)}%` : "-"}`);
  console.log(`Market cap : ${fmt(p.marketCap)}`);
  console.log(`Liquidity  : ${fmt(p.liquidity?.usd)}`);
  console.log(`Volume 24h : ${fmt(p.volume?.h24)}`);
  console.log(`Pair       : ${p.dexId} / ${p.pairAddress}`);
  console.log(`Mint       : ${mint}`);
  console.log("-------------------------------");
}

main().catch((e) => {
  console.error("Failed:", e.message);
  process.exit(1);
});
