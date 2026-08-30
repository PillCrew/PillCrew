// Pilly's Scorecard (v1.2.0): tracks every proactive pick (hot radar + Pilly's
// pick) with the price at call time, then resolves win/loss vs later prices so
// Pilly has a real, shareable track record. Persists pillcrew-picks.json.
const fs = require("fs");
const path = require("path");

const MAX_PICKS = 20;

function file(dir) {
  return path.join(dir, "pillcrew-picks.json");
}

function load(dir) {
  try {
    const arr = JSON.parse(fs.readFileSync(file(dir), "utf8"));
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function save(dir, arr) {
  try {
    fs.writeFileSync(file(dir), JSON.stringify(arr));
  } catch (e) {
    /* ignore */
  }
}

// Add a pick at the current price (entry for the scorecard).
function record(dir, pick) {
  if (!dir || !pick || !pick.mint) return null;
  const arr = load(dir);
  // Don't double-record the same mint within 30 min (hot radar can re-flag it).
  const now = Date.now();
  if (arr.some((p) => p.mint === pick.mint && now - p.ts < 30 * 60000)) return null;
  const entry = {
    mint: pick.mint,
    symbol: pick.symbol || "",
    name: pick.name || "",
    price: Number(pick.price) > 0 ? Number(pick.price) : null,
    source: pick.source || "pick", // "hot" | "pick" | "manual"
    ts: now,
    pct: null,
    result: null, // "win" | "loss" | "flat"
  };
  arr.unshift(entry);
  save(dir, arr.slice(0, MAX_PICKS));
  return entry;
}

function list(dir) {
  return load(dir);
}

// Resolve open picks against current prices. prices is the fetchPrices shape:
// { mint: { price, change24h } } or { mint: number } - both are handled.
function update(dir, prices) {
  if (!prices) return load(dir);
  const arr = load(dir);
  let changed = false;
  for (const p of arr) {
    if (p.result !== null || p.price == null || p.price <= 0) continue;
    const raw = prices[p.mint];
    const cur = raw != null ? (typeof raw === "object" ? raw.price : Number(raw)) : null;
    if (cur != null && isFinite(cur) && cur > 0) {
      p.pct = ((cur - p.price) / p.price) * 100;
      p.result = p.pct > 1 ? "win" : p.pct < -1 ? "loss" : "flat";
      p.updated = Date.now();
      changed = true;
    }
  }
  if (changed) save(dir, arr);
  return arr;
}

// Aggregate stats for the scorecard panel.
function stats(dir) {
  const arr = load(dir);
  const done = arr.filter((p) => p.result !== null);
  const wins = done.filter((p) => p.result === "win").length;
  const losses = done.filter((p) => p.result === "loss").length;
  const avg = done.length
    ? done.reduce((s, p) => s + (p.pct || 0), 0) / done.length
    : null;
  let best = null;
  for (const p of done) {
    if (!best || (p.pct || 0) > best.pct) best = p;
  }
  return {
    total: arr.length,
    open: arr.length - done.length,
    wins,
    losses,
    flat: done.length - wins - losses,
    winRate: done.length ? Math.round((wins / done.length) * 100) : null,
    avgPct: avg,
    best,
  };
}

module.exports = { record, list, update, stats };
