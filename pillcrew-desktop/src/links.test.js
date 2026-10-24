const test = require("node:test");
const assert = require("node:assert/strict");

const LINKS = require("./links");

test("every link is https and unique", () => {
  for (const l of LINKS.LINKS) {
    assert.match(l.url, /^https:\/\//, `${l.id} must be https`);
  }
  assert.equal(new Set(LINKS.IDS).size, LINKS.IDS.length, "ids are unique");
});

test("every link has a label in both languages", () => {
  for (const l of LINKS.LINKS) {
    assert.ok(l.id && l.en && l.zh, `${l.id || "a link"} has an id and both labels`);
    assert.ok(LINKS.list("en").some((x) => x.id === l.id && x.label === l.en));
    assert.ok(LINKS.list("zh").some((x) => x.id === l.id && x.label === l.zh));
  }
});

test("an unknown language falls back to English", () => {
  const auto = LINKS.list("auto");
  const en = LINKS.list("en");
  assert.deepEqual(auto, en);
});

test("the ids the app names by hand all exist", () => {
  for (const id of ["site", "docs", "buy", "game", "x", "github"]) {
    assert.ok(LINKS.byId(id), `${id} is on the list`);
    assert.ok(LINKS.url(id), `${id} has a url`);
  }
});

test("the project's own addresses are the ones shipped", () => {
  assert.equal(LINKS.url("site"), "https://pillcrew.fun");
  assert.equal(LINKS.url("game"), "https://game.pillcrew.fun");
  assert.equal(LINKS.url("x"), "https://x.com/PillCrewSol");
  assert.equal(LINKS.url("github"), "https://github.com/PillCrew/PillCrew");
});

test("anything not on the list has no url (the whitelist is the guard)", () => {
  assert.equal(LINKS.url("evil"), null);
  assert.equal(LINKS.url("https://example.com"), null);
  assert.equal(LINKS.url(""), null);
  assert.equal(LINKS.url(null), null);
  assert.equal(LINKS.byId("__proto__"), null);
});

test("the tray submenu never needs the url", () => {
  for (const item of LINKS.list("en")) {
    assert.deepEqual(Object.keys(item).sort(), ["id", "label"]);
  }
});
