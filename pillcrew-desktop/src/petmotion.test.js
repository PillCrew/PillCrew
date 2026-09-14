const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  SPOOK_SPEED_PX_PER_MS,
  CURSOR_HOLD_RADIUS_PX,
  shouldSpook,
  shouldStandStill,
} = require("./petmotion");

const near = { dist: 10, now: 1000, cooldownUntil: 0 };

test("a hand reaching in for him does not spook him", () => {
  // ~500 px/s: a deliberate move towards the pill, the one a click is made of.
  assert.equal(shouldSpook({ ...near, speed: 0.5 }), false);
  // Small trackpad correction just before the click.
  assert.equal(shouldSpook({ ...near, speed: 1.2 }), false);
  assert.equal(shouldSpook({ ...near, speed: SPOOK_SPEED_PX_PER_MS }), false);
});

test("a real flick still spooks him", () => {
  assert.equal(shouldSpook({ ...near, speed: 2.5 }), true);
});

test("a flick somewhere else on the screen leaves him alone", () => {
  assert.equal(shouldSpook({ ...near, speed: 9, dist: 300 }), false);
});

test("the cooldown has to expire before he can be scared again", () => {
  assert.equal(shouldSpook({ ...near, speed: 9, now: 999, cooldownUntil: 2000 }), false);
  assert.equal(shouldSpook({ ...near, speed: 9, now: 3000, cooldownUntil: 2000 }), true);
});

test("a cursor sitting on him keeps him still", () => {
  const base = { dragging: false, walkMode: "screen", state: "walk" };
  assert.equal(shouldStandStill({ ...base, dist: 4 }), true);
  assert.equal(shouldStandStill({ ...base, dist: CURSOR_HOLD_RADIUS_PX - 1 }), true);
  assert.equal(shouldStandStill({ ...base, dist: CURSOR_HOLD_RADIUS_PX }), false);
});

test("being carried, asleep or walking the taskbar all still move", () => {
  assert.equal(shouldStandStill({ dist: 4, dragging: true, walkMode: "screen", state: "walk" }), false);
  assert.equal(shouldStandStill({ dist: 4, dragging: false, walkMode: "screen", state: "sleep" }), false);
  assert.equal(shouldStandStill({ dist: 4, dragging: false, walkMode: "taskbar", state: "walk" }), false);
});
