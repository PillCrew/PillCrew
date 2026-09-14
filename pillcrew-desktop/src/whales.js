// Whale Follow: track whale wallets, diff their holdings between polls and
// alert when a whale opens a NEW position (accumulation signal).
// Persists pillcrew-whales.json in userData.
const fs = require("fs");
const path = require("path");

// How many mints we remember per whale for the diff. The portfolio read only
// returns the ten largest tokens, so this is what keeps a bag that dips out of
// the top ten - and climbs back in - from being announced as a new position.
const MAX_KNOWN = 200;

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
    known: [],
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
//
// The first poll after following has nothing to compare against, so every token
// the whale already held would look like a fresh buy - one alert and one
// scorecard "call" per long-term bag, which is exactly the false signal the
// panel promises never to send. That first poll therefore only seeds the
// baseline ("seeded": true, fresh empty) and stays silent.
//
// The comparison runs against every mint we have ever seen (`known`), not just
// against the previous poll: the portfolio read is capped to the ten largest
// tokens, so diffing snapshot to snapshot would report a bag that slipped to
// eleventh place and came back as a purchase. Files written before `known`
// existed are migrated on the first poll.
function snapshot(dir, address, mints) {
  const arr = load(dir);
  const w = arr.find((x) => x.address === address);
  if (!w) return { ok: false, error: "not followed" };
  const known = new Set([
    ...(Array.isArray(w.known) ? w.known : []),
    ...(Array.isArray(w.mints) ? w.mints : []),
  ]);
  const listing = (Array.isArray(mints) ? mints : []).filter(Boolean);
  const seeded = !w.lastSeen;
  const fresh = seeded ? [] : listing.filter((m) => !known.has(m));
  for (const m of listing) known.add(m);
  w.mints = listing;
  w.known = [...known].slice(-MAX_KNOWN);
  w.lastSeen = Date.now();
  save(dir, arr);
  return { ok: true, fresh, seeded };
}

module.exports = { list, add, remove, snapshot };
