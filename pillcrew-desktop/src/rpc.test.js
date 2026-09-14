const { test } = require("node:test");
const assert = require("node:assert");
const RPC = require("./rpc");

// A fetch that answers like the real endpoint (getSlot -> a slot number).
function okFetch(slot = 329118442, delayMs = 0) {
  return async () => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, result: slot }) };
  };
}

test("rpc: a fast getSlot is healthy", () => {
  assert.equal(RPC.classify(12), "ok");
  assert.equal(RPC.classify(RPC.OK_MS - 1), "ok");
});

test("rpc: the latency bands split ok / slow / down where the comment says", () => {
  assert.equal(RPC.classify(RPC.OK_MS), "slow");
  assert.equal(RPC.classify(RPC.SLOW_MS - 1), "slow");
  assert.equal(RPC.classify(RPC.SLOW_MS), "down");
});

test("rpc: a cold first probe (the TLS handshake, ~475 ms measured) is still fine", () => {
  // Encodes the reason OK_MS is 1000 and not 400: the launch probe is the cold
  // one, and calling a working endpoint "slow" at every start is exactly the
  // noise this indicator exists to avoid.
  assert.equal(RPC.classify(475), "ok");
});

test("rpc: a probe that never answered is down, never slow", () => {
  assert.equal(RPC.classify(null), "down");
  assert.equal(RPC.classify(undefined), "down");
  assert.equal(RPC.classify(NaN), "down");
  assert.equal(RPC.classify(20, "boom"), "down");
});

test("rpc: probe returns the slot and a timing for a healthy endpoint", async () => {
  const h = await RPC.probe({ fetchImpl: okFetch(329118442) });
  assert.equal(h.state, "ok");
  assert.equal(h.slot, 329118442);
  assert.ok(typeof h.ms === "number" && h.ms >= 0 && h.ms < 2000);
});

test("rpc: probe measures real latency, so a slow answer is reported as slow", async () => {
  const h = await RPC.probe({ fetchImpl: okFetch(1, 1200) });
  assert.equal(h.state, "slow"); // 1200 ms sits between OK_MS and SLOW_MS
  assert.ok(h.ms >= 1150);
});

test("rpc: an HTTP error is down, with the status kept for the log", async () => {
  const h = await RPC.probe({ fetchImpl: async () => ({ ok: false, status: 429 }) });
  assert.equal(h.state, "down");
  assert.equal(h.error, "http 429");
});

test("rpc: a JSON-RPC error is down, not a broken probe", async () => {
  const h = await RPC.probe({
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ error: { message: "rate limited" } }) }),
  });
  assert.equal(h.state, "down");
  assert.equal(h.error, "rate limited");
});

test("rpc: a 200 with no slot in it is down", async () => {
  const h = await RPC.probe({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ result: null }) }) });
  assert.equal(h.state, "down");
  assert.equal(h.error, "no slot in the response");
});

test("rpc: a rejected fetch is caught and reported, so a timer cannot crash on it", async () => {
  const h = await RPC.probe({
    fetchImpl: async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    },
  });
  assert.equal(h.state, "down");
  assert.equal(h.error, "getaddrinfo ENOTFOUND");
});

test("rpc: a timeout aborts the request instead of hanging the poll", async () => {
  // The fetch only settles when its signal is aborted - exactly how a stalled
  // connection behaves, and the probe has to come back with an answer anyway.
  const hanging = (url, init) =>
    new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")));
    });
  const t0 = Date.now();
  const h = await RPC.probe({ fetchImpl: hanging, timeoutMs: 120 });
  assert.equal(h.state, "down");
  assert.ok(Date.now() - t0 < 2000, "must not wait for the connection");
});

test("rpc: labels say what the tray should print", () => {
  assert.equal(RPC.label({ state: "unknown" }), "checking…");
  assert.equal(RPC.label({ state: "down" }), "unreachable");
  assert.equal(RPC.label({ state: "ok", ms: 210 }), "ok · 210 ms");
  assert.equal(RPC.label({ state: "slow", ms: 1420 }), "slow · 1.4 s");
  assert.equal(RPC.label(null), "checking…");
});

test("rpc: only a slow or dead endpoint is worth interrupting the user about", () => {
  assert.equal(RPC.unhealthy({ state: "ok", ms: 90 }), false);
  assert.equal(RPC.unhealthy({ state: "unknown" }), false);
  assert.equal(RPC.unhealthy({ state: "slow", ms: 900 }), true);
  assert.equal(RPC.unhealthy({ state: "down" }), true);
});

test("rpc: PILLY_RPC_URL points the probe at a private endpoint, and is trimmed", async () => {
  const before = process.env.PILLY_RPC_URL;
  try {
    assert.equal(RPC.rpcUrl(), RPC.RPC_URL); // no override -> the public endpoint
    process.env.PILLY_RPC_URL = "  https://my-node.example/rpc  ";
    assert.equal(RPC.rpcUrl(), "https://my-node.example/rpc");
    process.env.PILLY_RPC_URL = "   ";
    assert.equal(RPC.rpcUrl(), RPC.RPC_URL); // blank is not a URL
    process.env.PILLY_RPC_URL = "https://my-node.example/rpc";
    let seen = null;
    await RPC.probe({ fetchImpl: async (url) => { seen = url; return { ok: true, status: 200, json: async () => ({ result: 7 }) }; } });
    assert.equal(seen, "https://my-node.example/rpc");
  } finally {
    if (before === undefined) delete process.env.PILLY_RPC_URL;
    else process.env.PILLY_RPC_URL = before;
  }
});

test("rpc: the endpoint is the public mainnet one and every state has a label", () => {
  assert.ok(RPC.RPC_URL.startsWith("https://"));
  assert.deepEqual(RPC.STATES, ["unknown", "ok", "slow", "down"]);
  for (const s of RPC.STATES) assert.ok(RPC.label({ state: s, ms: 100 }).length > 0);
});
