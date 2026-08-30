const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const PICKS = require("./picks");

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pilly-picks-"));
}

test("picks: record + list round-trip", () => {
  const dir = tmpDir();
  PICKS.record(dir, { mint: "AAAA", symbol: "TEST", name: "Test Coin", price: 0.5, source: "pick" });
  const list = PICKS.list(dir);
  assert.equal(list.length, 1);
  assert.equal(list[0].symbol, "TEST");
  assert.equal(list[0].result, null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("picks: same mint within 30 min is not double-recorded", () => {
  const dir = tmpDir();
  PICKS.record(dir, { mint: "BBBB", symbol: "X", price: 1, source: "hot" });
  PICKS.record(dir, { mint: "BBBB", symbol: "X", price: 1, source: "hot" });
  assert.equal(PICKS.list(dir).length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("picks: update resolves win/loss against prices", () => {
  const dir = tmpDir();
  PICKS.record(dir, { mint: "CCCC", symbol: "WIN", price: 1, source: "pick" });
  PICKS.record(dir, { mint: "DDDD", symbol: "LOSS", price: 2, source: "sniper" });
  PICKS.update(dir, { CCCC: { price: 1.5 }, DDDD: { price: 1 } });
  const list = PICKS.list(dir);
  const win = list.find((p) => p.mint === "CCCC");
  const loss = list.find((p) => p.mint === "DDDD");
  assert.equal(win.result, "win");
  assert.ok(win.pct > 40 && win.pct < 60);
  assert.equal(loss.result, "loss");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("picks: stats aggregates correctly", () => {
  const dir = tmpDir();
  PICKS.record(dir, { mint: "E1", symbol: "A", price: 1, source: "pick" });
  PICKS.record(dir, { mint: "E2", symbol: "B", price: 1, source: "pick" });
  PICKS.record(dir, { mint: "E3", symbol: "C", price: 1, source: "pick" });
  PICKS.update(dir, { E1: { price: 2 }, E2: { price: 0.5 }, E3: { price: 1.1 } });
  const st = PICKS.stats(dir);
  assert.equal(st.total, 3);
  assert.equal(st.wins, 2);
  assert.equal(st.losses, 1);
  assert.equal(st.flat, 0);
  assert.equal(st.winRate, 67);
  assert.ok(st.avgPct != null);
  fs.rmSync(dir, { recursive: true, force: true });
});
