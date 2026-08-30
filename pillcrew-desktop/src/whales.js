// Whale Follow (v1.2.0): track whale wallets, diff their holdings between
// polls and alert when a whale opens a NEW position (accumulation signal).
// Persists pillcrew-whales.json in userData.
const fs = require("fs");
const path = require("path");

function file(dir) {
  return path.join(dir, "pillcrew-whales.json");
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

function list(dir) {
  return load(dir);
}

function add(dir, address, label) {
  const arr = load(dir);
  const a = String(address || "").trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)) return { ok: false, error: "not a valid Solana address" };
  if (arr.some((w) => w.address === a)) return { ok: false, error: "already followed" };
  arr.push({
    address: a,
    label: String(label || "").trim() || a.slice(0, 6) + "…" + a.slice(-4),
    mints: [],
    lastSeen: 0,
  });
  save(dir, arr);
  return { ok: true };
}

function remove(dir, address) {
  save(dir, load(dir).filter((w) => w.address !== address));
  return { ok: true };
}

// Record the whale's current holdings; returns the mints that are NEW since
// the previous poll (i.e. fresh positions the whale just opened).
function snapshot(dir, address, mints) {
  const arr = load(dir);
  const w = arr.find((x) => x.address === address);
  if (!w) return { ok: false, error: "not followed" };
  const seen = new Set(Array.isArray(w.mints) ? w.mints : []);
  const fresh = (Array.isArray(mints) ? mints : []).filter((m) => m && !seen.has(m));
  w.mints = Array.isArray(mints) ? mints : [];
  w.lastSeen = Date.now();
  save(dir, arr);
  return { ok: true, fresh };
}

module.exports = { list, add, remove, snapshot };
