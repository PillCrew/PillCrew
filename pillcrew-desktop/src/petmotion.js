"use strict";
// Pilly's reflex rules, kept pure and unit tested because they decide whether a
// click ever reaches the pet window. They run inside the pet tick (main.js, every
// 24 ms) - a threshold buried in the middle of that tick is a threshold nobody
// can reason about, and the first version of these numbers is why clicking Pilly
// "sometimes" did nothing at all: a normal approach spooked him out of the way,
// so the click landed on the desktop instead of on him.

// How fast the cursor has to travel for it to read as a poke. This is a flick
// (~1600 px/s), not a reach: at 0.5 px/ms a hand moving in to click him spooked
// him every time, and he fled 90 px before the click could land.
const SPOOK_SPEED_PX_PER_MS = 1.6;
// Where "on him" starts. This radius is measured to his pupil anchor (his feet
// area), not to the centre of the 60x64 window - most of that window is
// transparent padding, and a click on the padding is not a click on Pilly.
const SPOOK_RADIUS_PX = 46;
// After one scare he stays brave this long, so a user who is trying to click him
// cannot be kept away by a second flick before they get there.
const SPOOK_COOLDOWN_MS = 4000;
// Inside this radius the cursor means "I am aiming at you", and Pilly stops
// walking. A window this small drifting at ~100 px/s is a target that keeps
// escaping the click that is already on its way.
const CURSOR_HOLD_RADIUS_PX = 30;
// How long he waits after the cursor leaves before picking up where he was.
// Long enough not to jitter while the pointer is only just off him.
const CURSOR_HOLD_RESUME_MS = 400;

// A poke: close, fast and off cooldown. Everything else is either someone
// walking past or someone reaching in - neither may move him.
function shouldSpook({ dist, speed, now, cooldownUntil }) {
  if (!(dist < SPOOK_RADIUS_PX)) return false;
  if (!(speed > SPOOK_SPEED_PX_PER_MS)) return false;
  return now > cooldownUntil;
}

// Standing still on purpose. Screen mode only: on the taskbar line the cursor
// crosses him all day long and a pet that freezes every time would look broken.
function shouldStandStill({ dist, dragging, walkMode, state }) {
  if (dragging) return false;
  if (walkMode !== "screen") return false;
  if (state === "sleep") return false;
  return dist < CURSOR_HOLD_RADIUS_PX;
}

module.exports = {
  SPOOK_SPEED_PX_PER_MS,
  SPOOK_RADIUS_PX,
  SPOOK_COOLDOWN_MS,
  CURSOR_HOLD_RADIUS_PX,
  CURSOR_HOLD_RESUME_MS,
  shouldSpook,
  shouldStandStill,
};
