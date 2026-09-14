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

test("whales: the first poll only seeds the baseline", () => {
  const dir = tmpDir();
  WHALES.add(dir, ADDR, "");
  // A whale who has held A and B for months must not be reported as having
  // "just bought" both of them the moment you follow him.
  const seed = WHALES.snapshot(dir, ADDR, ["mintA", "mintB"]);
  assert.equal(seed.ok, true);
  assert.equal(seed.seeded, true);
  assert.deepEqual(seed.fresh, []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("whales: snapshot reports only NEW mints", () => {
  const dir = tmpDir();
  WHALES.add(dir, ADDR, "");
  WHALES.snapshot(dir, ADDR, ["mintA", "mintB"]);
  const second = WHALES.snapshot(dir, ADDR, ["mintA", "mintB", "mintC"]);
  assert.equal(second.seeded, false);
  assert.deepEqual(second.fresh, ["mintC"]);
  const third = WHALES.snapshot(dir, ADDR, ["mintA", "mintB", "mintC"]);
  assert.deepEqual(third.fresh, []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("whales: a bag that dips out of the top ten is not a new position", () => {
  const dir = tmpDir();
  WHALES.add(dir, ADDR, "");
  WHALES.snapshot(dir, ADDR, ["mintA", "mintB"]);
  assert.deepEqual(WHALES.snapshot(dir, ADDR, ["mintA", "mintB", "mintC"]).fresh, ["mintC"]);
  // The portfolio read only ever returns the ten largest tokens, so a small bag
  // drops in and out of the list on its own without the whale selling anything.
  assert.deepEqual(WHALES.snapshot(dir, ADDR, ["mintA", "mintB"]).fresh, []);
  assert.deepEqual(WHALES.snapshot(dir, ADDR, ["mintA", "mintB", "mintC"]).fresh, []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("whales: a file written before the known list existed is migrated", () => {
  const dir = tmpDir();
  WHALES.add(dir, ADDR, "");
  const file = path.join(dir, "pillcrew-whales.json");
  const arr = JSON.parse(fs.readFileSync(file, "utf8"));
  arr[0].mints = ["mintA", "mintB"];
  arr[0].lastSeen = Date.now() - 60000;
  delete arr[0].known;
  fs.writeFileSync(file, JSON.stringify(arr));
  // mintA and mintB are already in the last snapshot, so they stay quiet and
  // only the genuinely new mintC is reported.
  assert.deepEqual(WHALES.snapshot(dir, ADDR, ["mintA", "mintB", "mintC"]).fresh, ["mintC"]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("whales: remove unfollows", () => {
  const dir = tmpDir();
  WHALES.add(dir, ADDR, "");
  WHALES.remove(dir, ADDR);
  assert.equal(WHALES.list(dir).length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
