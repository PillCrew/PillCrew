const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const WHALES = require("./whales");

const ADDR = "5FHwkrdxntdK24hgQU8qgBjn35Y1BwJgxQN2StVZQp9q";

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pilly-whales-"));
}

test("whales: add validates the address", () => {
  const dir = tmpDir();
  assert.equal(WHALES.add(dir, "not-an-address", "").ok, false);
  assert.equal(WHALES.add(dir, ADDR, "Big Whale").ok, true);
  assert.equal(WHALES.list(dir).length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("whales: cannot add the same wallet twice", () => {
  const dir = tmpDir();
  WHALES.add(dir, ADDR, "");
  const r = WHALES.add(dir, ADDR, "");
  assert.equal(r.ok, false);
  assert.match(r.error, /already/i);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("whales: snapshot reports only NEW mints", () => {
  const dir = tmpDir();
  WHALES.add(dir, ADDR, "");
  const first = WHALES.snapshot(dir, ADDR, ["mintA", "mintB"]);
  assert.equal(first.ok, true);
  assert.deepEqual(first.fresh.sort(), ["mintA", "mintB"]);
  const second = WHALES.snapshot(dir, ADDR, ["mintA", "mintB", "mintC"]);
  assert.deepEqual(second.fresh, ["mintC"]);
  const third = WHALES.snapshot(dir, ADDR, ["mintA", "mintB", "mintC"]);
  assert.deepEqual(third.fresh, []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("whales: remove unfollows", () => {
  const dir = tmpDir();
  WHALES.add(dir, ADDR, "");
  WHALES.remove(dir, ADDR);
  assert.equal(WHALES.list(dir).length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
