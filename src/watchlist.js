/**
 * YOUR WATCHLIST — ported from Pilly Desktop, with one honest change: the alert is measured on the number this app actually has.
 *
 * Pilly polled a price feed of its own and fired a desktop notification when the 24-hour change passed the bar. This app already
 * carries a 5-minute change for every coin it watches (it is what the hot radar reads), so that is what an alert watches — and
 * the panel says so, because a number that means something else is worse than no number.
 *
 * The file is `watchlist.json` in the app's own folder. Everything here is pure and file-backed: no Electron, no network, and
 * an address that is not a Solana address is refused rather than written.
 */
const fs = require('fs');
const path = require('path');

const MAX_ITEMS = 20;
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function filePath(dir) { return path.join(dir, 'watchlist.json'); }

function load(dir) {
  try {
    const j = JSON.parse(fs.readFileSync(filePath(dir), 'utf8'));
    if (j && Array.isArray(j.items)) return { items: j.items.filter((i) => i && ADDRESS.test(String(i.mint || ''))) };
  } catch (_) { /* start fresh */ }
  return { items: [] };
}

function save(dir, data) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath(dir), JSON.stringify(data, null, 2), 'utf8');
  } catch (_) { /* a watchlist that cannot be written is not a reason to stop the app */ }
}

function list(dir) { return load(dir).items; }

/** Add a coin. The mint must look like an address; the symbol is only a label and is capped. */
function add(dir, coin) {
  const mint = String((coin && coin.mint) || '').trim();
  if (!ADDRESS.test(mint)) throw new Error('That is not a Solana token address.');
  const d = load(dir);
  if (d.items.some((i) => i.mint === mint)) return d.items;
  if (d.items.length >= MAX_ITEMS) throw new Error(`The watchlist holds ${MAX_ITEMS} coins. Remove one first.`);
  d.items.unshift({ mint, symbol: String((coin && coin.symbol) || '').slice(0, 12), name: String((coin && coin.name) || '').slice(0, 40), alertPct: null, addedAt: Date.now() });
  save(dir, d);
  return d.items;
}

function remove(dir, mint) {
  const d = load(dir);
  d.items = d.items.filter((i) => i.mint !== mint);
  save(dir, d);
  return d.items;
}

/** The 5-minute move that fires an alert, in percent — `null` (or 0) switches the alert off for that coin. */
function setAlert(dir, mint, pct) {
  const d = load(dir);
  const it = d.items.find((i) => i.mint === mint);
  if (!it) return d.items;
  const n = Number(pct);
  it.alertPct = Number.isFinite(n) && n > 0 ? Math.min(100, Math.round(n * 10) / 10) : null;
  save(dir, d);
  return d.items;
}

/**
 * Which watched coins are firing right now. One alert per coin per `cooldownMs`, because a coin that is up 30% stays up 30% for
 * a while and a bubble every twenty seconds is not an alert, it is noise.
 * @param {Array} items the watchlist
 * @param {Array} rows  the app's own state rows (`mint`, `change5m`)
 * @param {{now?: number, cooldown?: Map<string, number>, cooldownMs?: number}} opts
 */
function firing(items, rows, opts = {}) {
  const now = Number(opts.now) || Date.now();
  const cooldown = opts.cooldown instanceof Map ? opts.cooldown : new Map();
  const coolMs = Number(opts.cooldownMs) > 0 ? Number(opts.cooldownMs) : 30 * 60000;
  const byMint = new Map((Array.isArray(rows) ? rows : []).map((r) => [r && r.mint, r]));
  const out = [];
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || !(Number(it.alertPct) > 0)) continue;
    const row = byMint.get(it.mint);
    const ch = row ? Number(row.change5m) : NaN;
    if (!Number.isFinite(ch) || Math.abs(ch) < Number(it.alertPct)) continue;
    if (now - (cooldown.get(it.mint) || 0) <= coolMs) continue;
    cooldown.set(it.mint, now);
    out.push({ mint: it.mint, symbol: it.symbol || null, change5m: ch, alertPct: Number(it.alertPct),
      text: `${ch >= 0 ? '🚀' : '☠️'} ${it.symbol || it.mint.slice(0, 4)} is ${ch >= 0 ? '+' : ''}${ch.toFixed(0)}% in 5m — your watchlist alert.` });
  }
  return out;
}

module.exports = { list, add, remove, setAlert, firing, load, MAX_ITEMS, filePath };
