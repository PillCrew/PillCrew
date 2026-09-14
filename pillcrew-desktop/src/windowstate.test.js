const { test } = require("node:test");
const assert = require("node:assert/strict");
const { chatIsOpen, chatToggle } = require("./windowstate");

test("a window that does not exist is not open", () => {
  assert.equal(chatIsOpen(null), false);
  assert.equal(chatIsOpen(undefined), false);
});

test("a destroyed window is not open", () => {
  assert.equal(chatIsOpen({ visible: true, minimized: false, destroyed: true }), false);
});

test("a hidden window is not open", () => {
  assert.equal(chatIsOpen({ visible: false, minimized: false }), false);
});

// The macOS case: AppKit reports isVisible === true for a minimised window, so on
// a Mac only isMinimized() tells the truth. If this regresses, clicking Pilly on
// macOS silently stops working - and macOS is the one platform CI cannot run.
test("a minimised window is not open even when the OS calls it visible (macOS)", () => {
  assert.equal(chatIsOpen({ visible: true, minimized: true }), false);
  assert.equal(chatToggle({ visible: true, minimized: true }), "reveal");
});

// The Windows case: the same window reports isVisible === false while minimised.
test("a minimised window is not open when the OS also calls it hidden (Windows)", () => {
  assert.equal(chatIsOpen({ visible: false, minimized: true }), false);
  assert.equal(chatToggle({ visible: false, minimized: true }), "reveal");
});

test("a parked, unobscured window is open and a click puts it away", () => {
  assert.equal(chatIsOpen({ visible: true, minimized: false }), true);
  assert.equal(chatToggle({ visible: true, minimized: false }), "hide");
});

test("toggle never asks for both at once", () => {
  const states = [
    null, {}, { visible: false }, { visible: true }, { visible: true, minimized: true },
    { visible: true, minimized: false }, { visible: true, minimized: false, destroyed: true },
  ];
  for (const s of states) assert.ok(["hide", "reveal"].includes(chatToggle(s)), JSON.stringify(s));
});
