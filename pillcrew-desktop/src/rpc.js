// src/rpc.js - Solana RPC health (v1.1.2).
//
// Every on-chain screen in Pilly leans on the same public mainnet endpoint
// (balances, whale diffs, the rug check). When that endpoint is rate-limited or
// slow, those screens quietly show "no data" and the user has no way to tell a
// dead mint from a dead endpoint. One cheap getSlot call answers that question,
// and the tray reports it: silent while it is fine, loud when it is not.
//
// PILLY_RPC_URL points the whole app at a private endpoint (Helius, QuickNode,
// a local validator) - the public one rate-limits exactly the users who ask for
// the on-chain screens most.
const RPC_URL = "https://api.mainnet-beta.solana.com";

function rpcUrl() {
  const custom = process.env && process.env.PILLY_RPC_URL;
  return custom && String(custom).trim() ? String(custom).trim() : RPC_URL;
}

// A healthy public endpoint answers getSlot in ~80 ms once the connection is
// warm, but the very first probe of a session pays for the TLS handshake, which
// on a normal link measured ~475 ms - so the bar for "fine" has to sit above
// that, or a perfectly good endpoint would be reported as slow at every launch.
// Past 2.5 s it is useless for the screens that make several calls in a row, so
// it is reported as down rather than merely slow.
const OK_MS = 1000;
const SLOW_MS = 2500;

// The four states the UI knows about.
const STATES = ["unknown", "ok", "slow", "down"];

function classify(ms, err) {
  if (err || typeof ms !== "number" || !isFinite(ms) || ms < 0) return "down";
  if (ms >= SLOW_MS) return "down";
  if (ms >= OK_MS) return "slow";
  return "ok";
}

// Short label for the tray: "checking…", "ok · 210 ms", "slow · 1.4 s",
// "unreachable". Returns plain text so the menu and the tooltip cannot drift.
function label(health) {
  const state = (health && health.state) || "unknown";
  if (state === "unknown") return "checking…";
  if (state === "down") return "unreachable";
  const ms = health.ms;
  const shown = ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
  return `${state} · ${shown}`;
}

// Only an unhealthy endpoint is worth showing without being asked.
function unhealthy(health) {
  const state = (health && health.state) || "unknown";
  return state === "slow" || state === "down";
}

/**
 * One liveness probe. Never throws and never rejects: a failed probe is a state
 * ("down" with a reason), because the caller is a timer.
 * @param {{url?:string, timeoutMs?:number, fetchImpl?:Function}} [opts]
 * @returns {Promise<{state:string, ms:number|null, slot:number|null, error?:string, at:number}>}
 */
async function probe(opts = {}) {
  const url = opts.url || rpcUrl();
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 6000;
  const doFetch = opts.fetchImpl || (typeof fetch === "function" ? fetch : null);
  const at = Date.now();
  if (!doFetch) return { state: "down", ms: null, slot: null, error: "no fetch available", at };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await doFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "Pilly/1.1.2" },
      signal: ctrl.signal,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSlot" }),
    });
    const ms = Date.now() - at;
    if (!res || !res.ok) {
      return { state: "down", ms, slot: null, error: `http ${(res && res.status) || "?"}`, at: Date.now() };
    }
    const body = typeof res.json === "function" ? await res.json().catch(() => null) : null;
    if (!body || body.error) {
      const msg = body && body.error && body.error.message ? body.error.message : "bad payload";
      return { state: "down", ms, slot: null, error: msg, at: Date.now() };
    }
    const slot = Number(body.result);
    if (!isFinite(slot) || slot <= 0) {
      return { state: "down", ms, slot: null, error: "no slot in the response", at: Date.now() };
    }
    return { state: classify(ms), ms, slot, at: Date.now() };
  } catch (e) {
    return { state: "down", ms: null, slot: null, error: (e && e.message) || String(e), at: Date.now() };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { probe, classify, label, unhealthy, rpcUrl, STATES, RPC_URL, OK_MS, SLOW_MS };
