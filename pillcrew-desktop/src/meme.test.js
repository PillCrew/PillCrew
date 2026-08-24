const { test } = require("node:test");
const assert = require("node:assert");
const { detectTask } = require("./meme");
const { clampShort } = require("./ai");
const { detectMint } = require("./coins");

test("detectTask: rewrite mode", () => {
  assert.deepEqual(detectTask("can you meme this for me"), { task: "rewrite", prefix: "meme this" });
});

test("detectTask: name mode", () => {
  assert.equal(detectTask("give me a name for my token").task, "name");
});

test("detectTask: roast mode", () => {
  assert.equal(detectTask("roast me").task, "roast");
});

test("detectTask: null for normal chat", () => {
  assert.equal(detectTask("hello how are you"), null);
});

test("clampShort keeps replies screenshot-sized", () => {
  const out = clampShort("x".repeat(1000));
  assert.ok(out.length <= 341);
  assert.ok(out.endsWith("…"));
});

test("clampShort passes short text through", () => {
  assert.equal(clampShort("yo"), "yo");
});

test("detectMint: bare pump.fun mint", () => {
  assert.equal(
    detectMint("check ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82"),
    "ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82"
  );
});

test("detectMint: pump.fun link", () => {
  assert.equal(
    detectMint("https://pump.fun/coin/ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82 pls"),
    "ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82"
  );
});

test("detectMint: null for normal chat", () => {
  assert.equal(detectMint("hello world"), null);
});
