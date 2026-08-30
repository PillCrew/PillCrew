// src/pnl.js - per-coin entry prices (PnL tracking), persisted to userData.
// When you watch a coin, Pilly auto-captures the price at watch time; you can
// also set/override the entry price yourself (watchlist panel, wallet card).
// PnL% = (current - entry) / entry * 100.

const fs = require("fs");
const path = require("path");

function filePath(userData) {
  return path.join(userData, "pilly-pnl.json");
}

function load(userData) {
  try {
    const j = JSON.parse(fs.readFileSync(filePath(userData), "utf8"));
    if (j && j.entries && typeof j.entries === "object") return j;
  } catch (e) {
    /* ignore - start fresh */
  }
  return { entries: {} };
}

function save(userData, data) {
  try {
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(filePath(userData), JSON.stringify(data, null, 2), "utf8");
  } catch (e) {
    /* ignore */
  }
}

// entry price for a mint, or null
function get(userData, mint) {
  const e = load(userData).entries[String(mint || "")];
  return e && isFinite(Number(e.entry)) ? Number(e.entry) : null;
}

// set entry price for a mint. entry must be a positive number.
function set(userData, mint, entry) {
  const n = Number(entry);
  if (!String(mint || "").trim() || !isFinite(n) || n <= 0) return null;
  const d = load(userData);
  d.entries[String(mint).trim()] = { entry: n, updatedAt: Date.now() };
  save(userData, d);
  return n;
}

function remove(userData, mint) {
  const d = load(userData);
  delete d.entries[String(mint || "")];
  save(userData, d);
}

// all entries as { mint: entryPrice }
function all(userData) {
  const out = {};
  const d = load(userData);
  for (const mint of Object.keys(d.entries)) {
    const e = d.entries[mint];
    if (e && isFinite(Number(e.entry))) out[mint] = Number(e.entry);
  }
  return out;
}

// PnL % helper (pure, no I/O) - used by renderer via IPC-returned entries.
function pnlPct(current, entry) {
  const c = Number(current);
  const e = Number(entry);
  if (!isFinite(c) || !isFinite(e) || c <= 0 || e <= 0) return null;
  return ((c - e) / e) * 100;
}

module.exports = { get, set, remove, all, pnlPct };
