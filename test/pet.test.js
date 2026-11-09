// Pilly on screen: the controller's own rules. No window is ever opened here - `start()` is the only thing that touches
// Electron, and this file tests the parts that decide where he is and what he does.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PetOverlay, clampToScreen, PET_W, PET_H, TICK_MS, SPEED_PX_PER_TICK, PET_EDGE_INSET } = require('../src/pet');

const WORK = { x: 0, y: 0, width: 1600, height: 900 };
const store = (patch = {}) => {
  let data = { ...patch };
  return { get: () => data, set: (p) => { data = { ...data, ...p }; return data; } };
};
const pet = (patch) => new PetOverlay({ store: store(patch), settings: () => store(patch).get() });

test('he never stands outside the screen he is put on', () => {
  assert.deepEqual(clampToScreen({ x: -400, y: -400 }, WORK), { x: 0, y: 0 });
  assert.deepEqual(clampToScreen({ x: 99999, y: 99999 }, WORK), { x: WORK.width - PET_W, y: WORK.height - PET_H });
  assert.deepEqual(clampToScreen({ x: 120.4, y: 80.6 }, WORK), { x: 120, y: 81 }, 'a position is whole pixels');
});

test('a walk moves him less than a pixel a step, and never off the edge', () => {
  const p = pet();
  // RULE CHANGED 2026-11-09: his own wander now turns around `PET_EDGE_INSET` short of the frame (the owner: "idzie do rogów
  // gdzie jej nie widac"), so this case starts him inside his walking range instead of one pixel from the screen's own edge.
  // The old assertion - a full step forward from `width - PET_W - 1` - is what the inset deliberately replaced.
  p.pos = { x: 400, y: 400 };
  p.dir = 1;
  const before = p.pos.x;
  p.step(1000, { x: 10, y: 10 }, WORK);
  assert.ok(p.pos.x >= before, 'he walks in his direction');
  p.pos = { x: WORK.width - PET_W - PET_EDGE_INSET - 0.05, y: 400 };
  p.step(2000, { x: 10, y: 10 }, WORK);
  assert.ok(p.pos.x <= WORK.width - PET_W, 'and stops at the edge: ' + p.pos.x);
  assert.ok(SPEED_PX_PER_TICK > 0 && SPEED_PX_PER_TICK < 1, 'a step is a fraction of a pixel: ' + SPEED_PX_PER_TICK);
  assert.ok(TICK_MS >= 16 && TICK_MS <= 40, 'the tick is a real animation rate: ' + TICK_MS);
});

test('at the edge he turns around instead of grinding against it', () => {
  const p = pet();
  p.pos = { x: WORK.width - PET_W, y: 300 };
  p.dir = 1;
  p.step(1000, { x: 10, y: 10 }, WORK);
  assert.strictEqual(p.dir, -1, 'the direction flipped');
  assert.ok(p.pauseUntil > 1000, 'and he stands a moment before walking back');
});

// The owner: "idzie do rogów gdzie jej nie widac". His own wander leaves the frame alone; only a hand can park him in the corner.
test('his own walk turns around short of the screen edge, not on it', () => {
  const p = pet();
  p.pos = { x: WORK.width - PET_W - PET_EDGE_INSET - 0.05, y: 300 };
  p.dir = 1;
  p.step(1000, { x: 10, y: 10 }, WORK);
  assert.strictEqual(p.dir, -1, 'he turned before reaching the edge');
  assert.strictEqual(p.pos.x, WORK.width - PET_W - PET_EDGE_INSET, 'and stands one inset away from it: ' + p.pos.x);
  for (let i = 0; i < 400; i++) p.step(2000 + i * TICK_MS, { x: 10, y: 10 }, WORK);
  assert.ok(p.pos.x <= WORK.width - PET_W - PET_EDGE_INSET, 'however long he walks, he never reaches the frame: ' + p.pos.x);
  // A tiny screen must not turn the inset into a negative walking range.
  const narrow = { x: 0, y: 0, width: 80, height: 200 };
  const q = pet();
  q.pos = { x: 10, y: 20 };
  q.dir = 1;
  for (let i = 0; i < 40; i++) q.step(1000 + i * TICK_MS, { x: 1, y: 1 }, narrow);
  assert.ok(q.pos.x >= narrow.x && q.pos.x <= narrow.width - PET_W, 'on a narrow screen he still stays inside: ' + q.pos.x);
});

test('a cursor resting on him keeps him still, a far one does not', () => {
  const p = pet();
  p.pos = { x: 400, y: 300 };
  const onHim = { x: p.pos.x + PET_W / 2, y: p.pos.y + PET_H };
  p.step(2000, onHim, WORK);
  const held = p.pos.x;
  p.step(2050, onHim, WORK);
  assert.strictEqual(p.pos.x, held, 'he does not walk out from under the cursor');
  const far = { x: 40, y: 40 };
  p.step(6000, far, WORK);
  assert.notStrictEqual(p.pos.x, held, 'and he walks on when the cursor leaves');
});

test('a saved spot is where he starts, and an absurd one is clamped', () => {
  const saved = new PetOverlay({ store: store({ petPos: { x: 120, y: 240 } }), settings: () => ({ petPos: { x: 120, y: 240 } }) });
  assert.deepEqual(clampToScreen(saved.settings().petPos, WORK), { x: 120, y: 240 });
  const absurd = new PetOverlay({ store: store({ petPos: { x: -9000, y: 99999 } }), settings: () => ({ petPos: { x: -9000, y: 99999 } }) });
  const spot = clampToScreen(absurd.settings().petPos, WORK);
  assert.ok(spot.x >= 0 && spot.x <= WORK.width - PET_W, 'x is on the screen: ' + spot.x);
  assert.ok(spot.y >= 0 && spot.y <= WORK.height - PET_H, 'y is on the screen: ' + spot.y);
});

test('nothing is opened until the operator asks for it', () => {
  const p = pet({ petOn: false });
  assert.strictEqual(p.isOn(), false, 'the pet is not on by default');
  assert.strictEqual(p.win, null, 'and no window exists');
  // stop() on a pet that was never started is harmless, and saying so is better than throwing.
  assert.deepEqual(p.stop(), { ok: true });
});

test('every mascot setting reaches the window it configures', () => {
  const { boxFor, petOptions } = require('../src/pet');
  assert.deepEqual(boxFor('md'), { w: 60, h: 64 });
  assert.deepEqual(boxFor('lg'), { w: 72, h: 77 }, 'large is the 1.2x of the art');
  assert.deepEqual(boxFor('sm'), { w: 45, h: 48 }, 'small is three quarters');
  const opts = petOptions({ petName: 'Bąbel', petTheme: 'plush', petSize: 'lg', petSpeed: 'fast', petWalkMode: 'taskbar', petStopFreq: 'often', petMood: 'happy', petBubbles: false, petBubbleSize: 'sm', petBubbleText: 'lg', petBubbleStyle: 'neon', petSounds: true, petSoundVol: 150, petQuestions: false, petReduceMotion: true });
  assert.deepEqual(opts, {
    name: 'Bąbel', theme: 'plush', size: 'lg', speed: 'fast', walkMode: 'taskbar', stopFreq: 'often', mood: 'happy',
    bubbles: false, bubbleSize: 'sm', bubbleText: 'lg', bubbleStyle: 'neon',
    sounds: true, soundVol: 100, questions: false, reduceMotion: true,
  }, 'his name, look, size, speed, walk, stops, mood, bubbles and the way they look, his voice, motion — all of it: ' + JSON.stringify(opts));
  // Anything unknown falls back to the shipped default rather than reaching the renderer as nothing.
  const sane = petOptions({ petSize: 'huge', petSpeed: 'warp', petStopFreq: 'always', petWalkMode: 'ceiling', petTheme: 'tartan', petBubbleStyle: 'gothic', petMood: 'furious' });
  assert.strictEqual(sane.size, 'md');
  assert.strictEqual(sane.speed, 'normal');
  assert.strictEqual(sane.stopFreq, 'normal');
  assert.strictEqual(sane.walkMode, 'screen');
  assert.strictEqual(sane.theme, 'ball');
  assert.strictEqual(sane.bubbleStyle, 'default');
  assert.strictEqual(sane.mood, '', 'no mood is "", which is what the page reads as neutral');
});

test('speed, mode and the stop frequency change the walk itself', () => {
  const run = (patch, ms = 4000) => {
    let data = { ...patch };
    const p = new PetOverlay({ store: { get: () => data, set: (x) => { data = { ...data, ...x }; } }, settings: () => data });
    p.pos = { x: 500, y: 300 };
    p.dir = 1;
    const from = p.pos.x;
    let stops = 0;
    for (let t = 1000; t < 1000 + ms; t += TICK_MS) {
      const before = p.state;
      p.step(t, { x: 5, y: 5 }, WORK);
      if (p.state === 'idle' && before === 'walk') stops++;
    }
    return { moved: p.pos.x - from, stops, pos: p.pos };
  };
  const slow = run({ petSpeed: 'slow' });
  const fast = run({ petSpeed: 'fast' });
  assert.ok(fast.moved > slow.moved * 2, `fast really is faster (${slow.moved.toFixed(1)} vs ${fast.moved.toFixed(1)})`);
  const still = run({ petReduceMotion: true });
  assert.strictEqual(still.moved, 0, 'reduce motion means he does not walk at all');
  const often = run({ petStopFreq: 'often' });
  const never = run({ petStopFreq: 'never' });
  assert.ok(often.stops >= never.stops, `stopping often is not rarer than never (${often.stops} vs ${never.stops})`);
  const taskbar = run({ petWalkMode: 'taskbar' });
  assert.strictEqual(taskbar.pos.y, WORK.height - 64, 'walking the taskbar keeps him on the bottom line: ' + taskbar.pos.y);
});

test('every mascot field is stored, never merely checked', () => {
  const { cleanPetSetting, PET_SETTINGS } = require('../src/pet');
  const { DEFAULTS } = require('../src/engine');
  const fromSettings = Object.keys(DEFAULTS).filter((k) => k.startsWith('pet') && k !== 'petOn');
  assert.deepEqual([...PET_SETTINGS].sort(), fromSettings.sort(), 'the list of mascot fields is the settings\' own list');
  // The bug this test exists for: a field was validated and then NOT written, so a size change was silently ignored and the
  // panel kept showing a value the app was not using. Every field must come back with a value, equal to what was asked.
  const asked = { petName: 'Bąbel', petSize: 'lg', petSpeed: 'fast', petWalkMode: 'taskbar', petStopFreq: 'often',
    petBubbles: false, petBubbleSize: 'lg', petSounds: false, petSoundVol: 85, petQuestions: false, petReduceMotion: true,
    petPos: { x: 12.4, y: 90.6 } };
  const stored = {};
  for (const [k, v] of Object.entries(asked)) stored[k] = cleanPetSetting(k, v);
  assert.deepEqual(stored, { ...asked, petPos: { x: 12, y: 91 } }, 'every field survives the check: ' + JSON.stringify(stored));
  // And nothing reaches him through a value the app does not understand.
  for (const [k, v] of [['petSize', 'huge'], ['petSpeed', 'warp'], ['petWalkMode', 'ceiling'], ['petStopFreq', 'always'],
    ['petBubbleSize', 'xl'], ['petSoundVol', 140], ['petSoundVol', -1], ['petBubbles', 'yes'], ['petPos', { x: 'left' }]]) {
    assert.throws(() => cleanPetSetting(k, v), /./, `${k} refuses ${JSON.stringify(v)}`);
  }
  assert.strictEqual(cleanPetSetting('petName', '   '), 'Pilly', 'a blank name is the default, not an empty bubble');
  assert.strictEqual(cleanPetSetting('petName', '<b>Pilly</b>'), 'bPilly/b', 'markup is stripped out of his name');
  assert.strictEqual(cleanPetSetting('petWhatever', 'x'), undefined, 'an unknown field is not silently accepted');
});

test('the bubble stays on screen and its tail always points at him', () => {
  const { bubblePlacement, Bubble } = require('../src/pet');
  const work = { x: 0, y: 0, width: 1280, height: 800 };
  const bubble = { w: 190, h: 160 };

  // In the middle of the screen: above him, tail dead centre.
  const middle = bubblePlacement({ pos: { x: 600, y: 400 }, size: 'md', work, bubble });
  assert.strictEqual(middle.orient, 'above');
  assert.ok(middle.y + bubble.h <= 400 + 32, 'it sits above his head, tail touching it: ' + (middle.y + bubble.h));
  assert.strictEqual(middle.tail.tx, 0, 'and points straight down at him');

  // Against the left edge: beside him, never off the screen.
  const left = bubblePlacement({ pos: { x: 0, y: 400 }, size: 'md', work, bubble });
  assert.strictEqual(left.orient, 'right');
  assert.ok(left.x >= work.x, 'not off the left edge: ' + left.x);
  assert.ok(left.x + bubble.w <= work.width, 'and not off the right one: ' + left.x);

  // At the top: it flips below him rather than clipping.
  const top = bubblePlacement({ pos: { x: 400, y: 0 }, size: 'md', work, bubble });
  assert.strictEqual(top.orient, 'below');
  assert.ok(top.y >= 0);

  // A corner clamp must not lose the tail: the numbers still point at his centre.
  const corner = bubblePlacement({ pos: { x: 1280 - 60, y: 700 }, size: 'md', work, bubble });
  assert.ok(corner.x + bubble.w <= work.width && corner.y + bubble.h <= work.height, 'the window is inside the screen');
  assert.ok(Math.abs(corner.tail.tx) <= 95, 'the tail slides to stay on his head (max half the bubble): ' + corner.tail.tx);

  // A big pet needs a bigger bubble anchor, and the rule is the same.
  const big = bubblePlacement({ pos: { x: 300, y: 300 }, size: 'lg', work, bubble });
  assert.strictEqual(big.orient, 'above');
});

test('a wide bubble is made from the look, not a fixed 190 px window', () => {
  const { bubbleBox } = require('../src/pet');
  assert.strictEqual(bubbleBox({ bubbleSize: 'md', bubbleText: 'md' }).w, 194, 'the default is Pilly\'s own 190 px plus its margins');
  const big = bubbleBox({ bubbleSize: 'lg', bubbleText: 'lg' }).w;
  assert.ok(big > bubbleBox({ bubbleSize: 'md', bubbleText: 'md' }).w + 30, 'large text gets a wider window, or it wraps to eleven characters a line: ' + big);
  assert.ok(bubbleBox({ bubbleSize: 'sm', bubbleText: 'sm' }).w < 190, 'and the smallest look is narrower');
  assert.strictEqual(bubbleBox({ bubbleSize: 'huge', bubbleText: 'warp' }).w, bubbleBox({ bubbleSize: 'md', bubbleText: 'md' }).w, 'an unknown look falls back to the default');
});

test('a bubble that is switched off, or has no pet under it, says nothing', () => {
  const { Bubble } = require('../src/pet');
  const off = new Bubble({ settings: () => ({ petBubbles: false }), pet: { isOn: () => true, send: () => {} } });
  assert.strictEqual(off.say('hello').ok, false);
  const noPet = new Bubble({ settings: () => ({ petBubbles: true }), pet: { isOn: () => false, send: () => {} } });
  assert.strictEqual(noPet.say('hello').ok, false);
  const empty = new Bubble({ settings: () => ({ petBubbles: true }), pet: { isOn: () => true, send: () => {} } });
  assert.strictEqual(empty.say('   ').ok, false, 'an empty line is not a bubble');
});

test('a carried pet follows the hand by the deltas the page sends, and cannot be lost', () => {
  const { PetOverlay, boxFor } = require('../src/pet');
  const s = store({ petSize: 'md' });
  const p = new PetOverlay({ store: s, settings: () => s.get() });
  p.pos = { x: 500, y: 400 };
  const work = { x: 0, y: 0, width: 1280, height: 800 };
  const box = boxFor('md');

  p.dragStart();
  assert.strictEqual(p.dragging, true, 'a hand on him stops the walk');
  p.dragMove(-40, 0, work);
  assert.strictEqual(p.pos.x, 460, 'he follows the hand: ' + p.pos.x);
  p.dragMove(0, -30, work);
  assert.strictEqual(p.pos.y, 370);
  p.dragHold();
  assert.strictEqual(p.dragging, true, 'a still hand does not drop him');
  p.dragEnd();
  assert.strictEqual(p.dragging, false, 'and putting him down lets him walk again');

  // Dragged into the left edge he stops flush against it: never half off the screen, never cut.
  p.pos = { x: 10, y: 400 };
  p.dragMove(-500, 0, work);
  assert.strictEqual(p.pos.x, work.x, 'flush against the left edge, whole: ' + p.pos.x);
  // …and the same at the top, which is where he used to be clipped.
  p.pos = { x: 400, y: 10 };
  p.dragMove(0, -500, work);
  assert.strictEqual(p.pos.y, work.y, 'his whole window stays on the screen: ' + p.pos.y);
  // The far edges stop him with his last pixel inside.
  p.pos = { x: 1200, y: 760 };
  p.dragMove(500, 500, work);
  assert.strictEqual(p.pos.x, work.width - box.w);
  assert.strictEqual(p.pos.y, work.height - box.h);
});

test('a drag remembers where he was left, once, and not on every step', async () => {
  const s = store({});
  const p = new PetOverlay({ store: s, settings: () => s.get() });
  p.pos = { x: 100, y: 100 };
  p.dragTo({ x: 300, y: 250 }, WORK);
  assert.deepEqual(p.pos, { x: 300, y: 250 });
  await new Promise((r) => setTimeout(r, 1100));
  assert.deepEqual(s.get().petPos, { x: 300, y: 250 }, 'the spot is saved: ' + JSON.stringify(s.get().petPos));
});

// The owner: "ją ucina na górze". His hat sits 13 px below the top of the 64 px window (measured off the real canvas), so a hop
// taller than that is drawn outside the window. The page caps every lift and asks for a hop that fits; this holds both numbers.
test('the hop fits in the window, so his hat is never cut off', () => {
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'renderer', 'pet.html'), 'utf8');
  const head = /const PET_HEADROOM = (\d+)/.exec(html);
  const hop = /const hopLift = theme\.ball \? ballLift\(\d+, ps\) : (\d+)/.exec(html);
  assert.ok(head && hop, 'the cap and the hop are both in the page');
  assert.ok(Number(hop[1]) <= Number(head[1]), `a hop of ${hop[1]} px fits under a cap of ${head[1]} px`);
  assert.ok(Number(head[1]) <= 13, `the cap is the air above his hat, measured at 13 px (cap ${head[1]})`);
});
