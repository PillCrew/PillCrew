const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const A = require("./activity");

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pilly-act-"));
}

test("minuteStart aligns to the minute boundary", () => {
  assert.equal(A.minuteStart(60000), 60000);
  assert.equal(A.minuteStart(61000), 60000);
  assert.equal(A.minuteStart(119999), 60000);
});

test("record + load round-trip, upserting the same minute", () => {
  const dir = tmpDir();
  const now = Date.now();
  A.record(dir, now, true);
  A.record(dir, now, false); // same minute -> overwrite active flag
  A.record(dir, now + 60000, true);
  const data = A.load(dir);
  assert.equal(data.minutes.length, 2);
  assert.deepEqual(data.minutes[0], { t: A.minuteStart(now), active: false });
  assert.deepEqual(data.minutes[1], { t: A.minuteStart(now + 60000), active: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

test("trim drops minutes older than the retention window", () => {
  const now = Date.now();
  const cutoff = A.minuteStart(now) - 90 * A.DAY_MS;
  const minutes = [
    { t: cutoff - 60000, active: true }, // too old
    { t: cutoff, active: false }, // edge: kept
    { t: A.minuteStart(now), active: true }, // recent: kept
  ];
  const kept = A.trim(minutes, now);
  assert.equal(kept.length, 2);
  assert.deepEqual(kept.map((m) => m.t), [cutoff, A.minuteStart(now)]);
});

test("stats computes active/rest/pct", () => {
  const minutes = [
    { t: 0, active: true },
    { t: 60000, active: false },
    { t: 120000, active: true },
    { t: 180000, active: true },
  ];
  const s = A.stats(minutes, 0, 180000);
  assert.equal(s.total, 4);
  assert.equal(s.active, 3);
  assert.equal(s.rest, 1);
  assert.equal(s.pct, 75);
});

test("yesterdayStats is bounded to the previous calendar day", () => {
  const dir = tmpDir();
  const now = Date.now();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const yStart = today.getTime() - A.DAY_MS;
  A.record(dir, yStart + 60000, true); // yesterday
  A.record(dir, today.getTime() + 60000, true); // today
  const y = A.yesterdayStats(dir, now);
  assert.equal(y.total, 1);
  assert.equal(y.active, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("streakDays counts consecutive active days", () => {
  const dir = tmpDir();
  const now = Date.now();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  // active minutes: today, yesterday and the day before -> streak of 3
  A.record(dir, today.getTime() + 60000, true);
  A.record(dir, today.getTime() - A.DAY_MS + 60000, true);
  A.record(dir, today.getTime() - 2 * A.DAY_MS + 60000, true);
  assert.equal(A.streakDays(dir, now), 3);
  // a rest-only minute on a day does NOT count as active
  A.record(dir, today.getTime() - 2 * A.DAY_MS + 120000, false);
  assert.equal(A.streakDays(dir, now), 3);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("streakDays survives a not-yet-active today", () => {
  const dir = tmpDir();
  const now = Date.now();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  A.record(dir, today.getTime() - A.DAY_MS + 60000, true); // yesterday only
  assert.equal(A.streakDays(dir, now), 1);
  fs.rmSync(dir, { recursive: true, force: true });
});
