// src/watchlist.js - desktop watchlist + price alerts (persisted to userData).
// The user can watch any coin and set a ±% alert; the main process polls live
// prices and fires a native Windows notification when an alert triggers.
const fs = require("fs");
const path = require("path");

function filePath(userData) {
  return path.join(userData, "pilly-watchlist.json");
}

function load(userData) {
  try {
    const j = JSON.parse(fs.readFileSync(filePath(userData), "utf8"));
    if (j && Array.isArray(j.items)) return j;
  } catch (e) {
    /* ignore - start fresh */
  }
  return { items: [] };
}

function save(userData, data) {
  try {
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(filePath(userData), JSON.stringify(data, null, 2), "utf8");
  } catch (e) {
    /* ignore */
  }
}

// items: [{ mint, symbol, name, alertPct, addedAt }]
function list(userData) {
  return load(userData).items;
}

function add(userData, coin) {
  const d = load(userData);
  const mint = String((coin && coin.mint) || "").trim();
  if (!mint) return d.items;
  if (!d.items.some((i) => i.mint === mint)) {
    d.items.push({
      mint,
      symbol: (coin.symbol || "").slice(0, 12),
      name: coin.name || "",
      alertPct: null,
      addedAt: Date.now(),
    });
    save(userData, d);
  }
  return d.items;
}

function remove(userData, mint) {
  const d = load(userData);
  d.items = d.items.filter((i) => i.mint !== mint);
  save(userData, d);
  return d.items;
}

// alertPct = min |24h change| % that triggers a notification (null disables).
function setAlert(userData, mint, pct) {
  const d = load(userData);
  const it = d.items.find((i) => i.mint === mint);
  if (it) {
    const n = Number(pct);
    it.alertPct = isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
    save(userData, d);
  }
  return d.items;
}

module.exports = { list, add, remove, setAlert };
