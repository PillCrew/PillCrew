// The pet window and the chat header draw the same character, and they keep
// their palettes in two places: THEMES in renderer/pet.html (the browser page
// that paints the taskbar pet) and PET_THEMES in renderer/renderer.js (which
// also feeds the --c1/--c2/--c3 CSS variables behind the chat avatar and the UI
// accents).
//
// v1.1.6: they had already drifted - the plush look was darker in the header
// than on the taskbar - and that is the same class of bug that once left a teal
// avatar next to a green mascot. Neither file can require() the other, so this
// test is the seam: edit one palette and it fails here instead of shipping two
// different Pillys.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", "renderer", file), "utf8");
const PET = read("pet.html");
const RENDERER = read("renderer.js");

// "name: { c1: "#rrggbb", c2: "#rrggbb", c3: "#rrggbb"" - the first three stops
// are the body gradient, and they are the part both files must agree on.
function triple(src, name) {
  const re = new RegExp(
    "\\b" + name + ":\\s*\\{\\s*c1:\\s*\"(#[0-9a-fA-F]{6})\"\\s*,\\s*c2:\\s*\"(#[0-9a-fA-F]{6})\"\\s*,\\s*c3:\\s*\"(#[0-9a-fA-F]{6})\""
  );
  const m = src.match(re);
  return m ? [m[1].toLowerCase(), m[2].toLowerCase(), m[3].toLowerCase()] : null;
}

const LOOKS = ["green", "blue", "purple", "pink", "orange", "plush", "ball"];

test("every look is defined in both files", () => {
  for (const name of LOOKS) {
    assert.ok(triple(PET, name), `pet.html has no ${name} palette`);
    assert.ok(triple(RENDERER, name), `renderer.js has no ${name} palette`);
  }
});

test("the pet and the chat avatar paint the same colours", () => {
  for (const name of LOOKS) {
    assert.deepEqual(triple(RENDERER, name), triple(PET, name), `${name} drifted between pet.html and renderer.js`);
  }
});

test("the default look is the brand ball, everywhere", () => {
  // The settings default decides what a fresh install sees; the two renderers
  // decide what it looks like. A mismatch here is a mascot that changes colour
  // the moment the pet window loads.
  const settings = fs.readFileSync(path.join(__dirname, "settings.js"), "utf8");
  assert.match(settings, /theme:\s*"ball"/, "settings.js does not default to the ball");
  assert.match(PET, /let theme = THEMES\.ball;/, "pet.html does not start on the ball");
  assert.match(RENDERER, /let activePetTheme = "ball";/, "renderer.js does not start on the ball");
});

test("the ball is the brand mark's green, not a leftover teal", () => {
  // Sampled from pillcrew.fun/brand/logo-mark-1024.png: #81f428 / #4ecb16 /
  // #158526. The shipped stops keep that hue (the light stop is pulled a little
  // brighter for the small canvas).
  const ball = triple(PET, "ball");
  const lum = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  for (const hex of ball) {
    const [r, g, b] = lum(hex);
    assert.ok(g > 120 && g > r + 40 && g > b + 60, `${hex} is not the brand green`);
  }
});
