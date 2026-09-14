const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const SETTINGS = require("./settings");

// Each test gets its own profile, and it is removed when the test ends (even if
// it fails) so the suite stops leaving pilly-settings-* directories in %TEMP%.
function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pilly-settings-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function written(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, "pilly-settings.json"), "utf8"));
}

test("settings: pet.on survives a save/load round trip", (t) => {
  const dir = tmpDir(t);
  const base = SETTINGS.effective(dir);
  const r = SETTINGS.save(dir, Object.assign({}, base, { pet: Object.assign({}, base.pet, { on: true }) }));
  assert.equal(r.ok, true);
  assert.equal(written(dir).pet.on, true);
});

test("settings: pet.on defaults to off, so a first launch stays quiet", (t) => {
  const dir = tmpDir(t);
  assert.equal(SETTINGS.DEFAULT_SETTINGS.pet.on, false);
  SETTINGS.save(dir, { tiers: [], pet: { name: "Pilly" } });
  assert.equal(written(dir).pet.on, false);
});

test("settings: unrelated pet fields still save with the flag", (t) => {
  const dir = tmpDir(t);
  SETTINGS.save(dir, { tiers: [], pet: { name: "Pilly", on: true, walkMode: "screen", stopFreq: "rare" } });
  const p = written(dir).pet;
  assert.equal(p.on, true);
  assert.equal(p.walkMode, "screen");
  assert.equal(p.stopFreq, "rare");
  assert.equal(p.name, "Pilly");
});

test("settings: pet.pos round-trips so Pilly wakes up where he was left", (t) => {
  const dir = tmpDir(t);
  const base = SETTINGS.effective(dir);
  const pet = Object.assign({}, base.pet, { on: true, pos: { x: 1280, y: 1012 } });
  const r = SETTINGS.save(dir, Object.assign({}, base, { pet }));
  assert.equal(r.ok, true);
  assert.deepEqual(written(dir).pet.pos, { x: 1280, y: 1012 });
  assert.deepEqual(SETTINGS.effective(dir).pet.pos, { x: 1280, y: 1012 });
});

test("settings: negative coordinates survive, because monitors can sit left of the primary one", (t) => {
  const dir = tmpDir(t);
  // A monitor arranged to the left of the main display reports negative x.
  SETTINGS.save(dir, { tiers: [], pet: { name: "Pilly", on: true, pos: { x: -1720.6, y: 980.4 } } });
  assert.deepEqual(written(dir).pet.pos, { x: -1721, y: 980 });
});

test("settings: a bogus pet.pos is dropped instead of parking him off-screen", (t) => {
  const dir = tmpDir(t);
  SETTINGS.save(dir, { tiers: [], pet: { name: "Pilly", pos: { x: NaN, y: 10 } } });
  assert.equal(written(dir).pet.pos, null);
  SETTINGS.save(dir, { tiers: [], pet: { name: "Pilly", pos: "42,10" } });
  assert.equal(written(dir).pet.pos, null);
  SETTINGS.save(dir, { tiers: [], pet: { name: "Pilly", pos: { x: Infinity, y: 0 } } });
  assert.equal(written(dir).pet.pos, null);
});

test("settings: pet.pos defaults to null on a fresh profile", (t) => {
  const dir = tmpDir(t);
  assert.equal(SETTINGS.DEFAULT_SETTINGS.pet.pos, null);
  SETTINGS.save(dir, { tiers: [], pet: { name: "Pilly" } });
  assert.equal(written(dir).pet.pos, null);
});

test("settings: the cache is keyed by profile, so a second profile is not served the first one's file", (t) => {
  const a = tmpDir(t);
  const b = tmpDir(t);
  SETTINGS.save(a, { tiers: [], pet: { name: "Alpha", on: true } });
  SETTINGS.save(b, { tiers: [], pet: { name: "Beta", on: false } });
  assert.equal(SETTINGS.load(b).pet.name, "Beta");
  assert.equal(SETTINGS.load(a).pet.name, "Alpha");
});

test("settings: a fresh profile gets defaults the app cannot permanently rewrite", (t) => {
  const a = tmpDir(t);
  const b = tmpDir(t);
  const first = SETTINGS.load(a); // no file yet -> defaults
  first.pet.theme = "neon";
  assert.equal(SETTINGS.load(b).pet.theme, "green", "the fallback must not hand out DEFAULT_SETTINGS itself");
  assert.equal(SETTINGS.DEFAULT_SETTINGS.pet.theme, "green");
});

test("settings: save() is strict, so callers must carry a known pos over (main.js does)", (t) => {
  const dir = tmpDir(t);
  SETTINGS.save(dir, { tiers: [], pet: { name: "Pilly", on: true, pos: { x: 300, y: 400 } } });
  assert.deepEqual(written(dir).pet.pos, { x: 300, y: 400 });
  // Without a pos the whitelist writes null - which is exactly why every save
  // path in main.js merges the live position in first.
  SETTINGS.save(dir, { tiers: [], pet: { name: "Pilly", on: true } });
  assert.equal(written(dir).pet.pos, null);
});

test("settings: a pet write never copies .env credentials onto disk", (t) => {
  const dir = tmpDir(t);
  const hadUrl = process.env.PILLY_TIER1_URL;
  const hadKey = process.env.PILLY_TIER1_KEY;
  process.env.PILLY_TIER1_URL = "https://env.example/v1/chat/completions";
  process.env.PILLY_TIER1_KEY = "env-only-secret";
  t.after(() => {
    if (hadUrl === undefined) delete process.env.PILLY_TIER1_URL;
    else process.env.PILLY_TIER1_URL = hadUrl;
    if (hadKey === undefined) delete process.env.PILLY_TIER1_KEY;
    else process.env.PILLY_TIER1_KEY = hadKey;
  });
  // The app can *use* the env tier before anything is saved...
  assert.equal(SETTINGS.effective(dir).tiers.length, 1);
  // ...but toggling the pet is not the user typing a key, so it must not
  // write that key down (and must not switch the app off .env for good).
  SETTINGS.savePet(dir, { on: true });
  assert.equal(written(dir).pet.on, true);
  for (const tier of written(dir).tiers) {
    assert.equal(tier.url, "", "the .env endpoint must not be written to disk");
    assert.equal(tier.key, "", "the .env key must not be written to disk");
  }
  assert.equal(SETTINGS.effective(dir).tiers.length, 1);
  assert.equal(SETTINGS.effective(dir).tiers[0].key, "env-only-secret");
});

test("settings: a pet write keeps the tiers the user saved in Settings", (t) => {
  const dir = tmpDir(t);
  SETTINGS.save(dir, {
    tiers: [{ url: "https://saved.example/v1", key: "saved-key", model: "m", auth: "bearer" }],
    pet: { name: "Pilly" },
  });
  SETTINGS.savePet(dir, { on: true, pos: { x: 10, y: 20 } });
  const w = written(dir);
  assert.equal(w.tiers.length, 1);
  assert.equal(w.tiers[0].key, "saved-key");
  assert.equal(w.pet.on, true);
  assert.deepEqual(w.pet.pos, { x: 10, y: 20 });
  assert.equal(w.pet.name, "Pilly", "a pet patch must not reset the fields it does not mention");
});

test("settings: toggling the pet carries the saved position over", (t) => {
  const dir = tmpDir(t);
  SETTINGS.savePet(dir, { pos: { x: 640, y: 1000 }, on: true });
  SETTINGS.savePet(dir, { on: false });
  assert.deepEqual(written(dir).pet.pos, { x: 640, y: 1000 });
  assert.equal(written(dir).pet.on, false);
});
