/**
 * PILLY'S SCORECARD — ported from Pilly Desktop. Every coin he names on his own (a hot mover, a launch, his pick of the day) is
 * written down with the market cap it had at that moment, and resolved later against the market cap it has now. The panel shows
 * the record, wins and losses included.
 *
 * One honest change from Pilly, and it is the reason this file exists at all: Pilly scored a pick on a price from its own feed.
 * This app publishes market cap for every coin it watches and nothing else per coin, so market cap is what is scored — and the
 * panel says "market cap since his call", not "price". A number is only worth showing if it is the number it claims to be.
 */
const fs = require('fs');
const path = require('path');

const MAX_PICKS = 20;
// A pick is not recorded twice within this window: the hot radar can flag the same coin again after its cooldown.
const DEDUPE_MS = 30 * 60000;
// Under this move a pick is "flat", not a win or a loss: a call has to be measurable to be judged.
const FLAT_PCT = 1;

function filePath(dir) { return path.join(dir, 'picks.json'); }

function load(dir) {
  try {
    const arr = JSON.parse(fs.readFileSync(filePath(dir), 'utf8'));
    return Array.isArray(arr) ? arr.filter((p) => p && p.mint) : [];
  } catch (_) { return []; }
}

function save(dir, arr) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath(dir), JSON.stringify(arr, null, 2), 'utf8');
  } catch (_) { /* ignore */ }
}

/**
 * Write a pick down. `mc` is the market cap when he said it; a pick with no market cap behind it is not recorded at all, because
 * there would be nothing to judge it by later.
 */
function record(dir, pick, now = Date.now()) {
  if (!dir || !pick || !pick.mint) return null;
  const mc = Number(pick.mc);
  if (!Number.isFinite(mc) || mc <= 0) return null;
  const arr = load(dir);
  if (arr.some((p) => p.mint === pick.mint && now - (p.ts || 0) < DEDUPE_MS)) return null;
  const entry = {
    mint: String(pick.mint), symbol: String(pick.symbol || '').slice(0, 12), name: String(pick.name || '').slice(0, 40),
    mc, source: ['hot', 'launch', 'pick', 'manual'].includes(pick.source) ? pick.source : 'manual',
    ts: now, pct: null, result: null,
  };
  arr.unshift(entry);
  save(dir, arr.slice(0, MAX_PICKS));
  return entry;
}

function list(dir) { return load(dir); }

/** Resolve what can be resolved, from the app's own rows (`mint`, `mc`). An open pick stays open when its coin is not priced. */
function update(dir, rows, now = Date.now()) {
  const arr = load(dir);
  const byMint = new Map((Array.isArray(rows) ? rows : []).map((r) => [r && r.mint, r]));
  let changed = false;
  for (const p of arr) {
    if (p.result !== null || !(Number(p.mc) > 0)) continue;
    const row = byMint.get(p.mint);
    const mc = row ? Number(row.mc) : NaN;
    if (!Number.isFinite(mc) || mc <= 0) continue;
    p.pct = ((mc - Number(p.mc)) / Number(p.mc)) * 100;
    p.result = p.pct > FLAT_PCT ? 'win' : p.pct < -FLAT_PCT ? 'loss' : 'flat';
    p.updated = now;
    changed = true;
  }
  if (changed) save(dir, arr);
  return arr;
}

/** The record, for the panel: wins, losses, the average move, and the best call he ever made. */
function stats(dir) {
  const arr = load(dir);
  const done = arr.filter((p) => p.result !== null);
  const wins = done.filter((p) => p.result === 'win').length;
  const losses = done.filter((p) => p.result === 'loss').length;
  const avgPct = done.length ? done.reduce((s, p) => s + (Number(p.pct) || 0), 0) / done.length : null;
  let best = null;
  for (const p of done) if (!best || (Number(p.pct) || 0) > (Number(best.pct) || 0)) best = p;
  return {
    total: arr.length,
    open: arr.length - done.length,
    wins,
    losses,
    flat: done.length - wins - losses,
    winRate: done.length ? Math.round((wins / done.length) * 100) : null,
    avgPct,
    best: best ? { symbol: best.symbol || null, mint: best.mint, pct: Number(best.pct) || 0 } : null,
  };
}

module.exports = { record, list, update, stats, MAX_PICKS, DEDUPE_MS, FLAT_PCT, filePath };
