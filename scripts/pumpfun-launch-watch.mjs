// PillCrew - pump.fun launch watcher
// Polls pump.fun's own "new coins" list and prints brand-new launches as they
// appear, live in the terminal. No keys, no accounts - just the public API.
//
// Usage:
//   node scripts/pumpfun-launch-watch.mjs
//   node scripts/pumpfun-launch-watch.mjs --min-mcap 50000

const API = "https://frontend-api-v3.pump.fun/coins";
const _idx = process.argv.indexOf("--min-mcap");
const MIN_MCAP = Number(_idx !== -1 && process.argv[_idx + 1] ? process.argv[_idx + 1] : 9000);
const POLL_MS = 5000;

const seen = new Set();
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

async function poll() {
  try {
    const res = await fetch(`${API}?limit=50&offset=0`);
    if (!res.ok) return;
    const coins = await res.json();
    for (const c of coins) {
      if (!c?.mint || seen.has(c.mint)) continue;
      seen.add(c.mint);
      const mcap = Number(c.usd_market_cap || 0);
      if (mcap < MIN_MCAP) continue;
      const supply = Number(c.total_supply) / 10 ** (c.base_decimals || 6);
      const price = mcap > 0 && supply > 0 ? mcap / supply : null;
      const ageMin = c.created_timestamp
        ? Math.round((Date.now() - new Date(c.created_timestamp).getTime()) / 60000)
        : null;
      console.log(
        `[${new Date().toLocaleTimeString()}] NEW ${(c.symbol || "?").padEnd(8)} ` +
          `${(c.name || "").padEnd(20).slice(0, 20)} price ${price ? price.toPrecision(4) : "-".padEnd(8)} ` +
          `mcap ${fmt(mcap).padEnd(8)} age ${ageMin ?? "-"}m mint ${c.mint}`
      );
    }
  } catch (e) {
    /* transient network error - keep watching */
  }
}

console.log(`Watching pump.fun for new launches (mcap >= ${fmt(MIN_MCAP)})...`);
setInterval(poll, POLL_MS);
