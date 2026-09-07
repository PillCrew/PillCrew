const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const R = require("./reminders");

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pilly-rem-"));
}

test("parseReminder: relative minutes with 'to'", () => {
  const now = Date.now();
  const r = R.parseReminder("remind me in 10 minutes to check SOL");
  assert.ok(r, "should parse");
  assert.equal(r.message, "check SOL");
  assert.ok(r.at > now + 9 * 60000 && r.at <= now + 10 * 60000 + 1000);
});

test("parseReminder: abbreviated hours without connector", () => {
  const now = Date.now();
  const r = R.parseReminder("remind me in 2h buy the dip");
  assert.ok(r);
  assert.equal(r.message, "buy the dip");
  assert.ok(r.at > now + 2 * 3600000 - 1000 && r.at <= now + 2 * 3600000 + 1000);
});

test("parseReminder: 'that' connector and 'about' connector", () => {
  assert.equal(R.parseReminder("set a reminder in 1 hour that dinner is ready").message, "dinner is ready");
  assert.equal(R.parseReminder("ping me in 30 sec about the launch").message, "the launch");
});

test("parseReminder: absolute clock time", () => {
  const r = R.parseReminder("remind me at 14:30 to take profit");
  assert.ok(r);
  assert.equal(r.message, "take profit");
  const d = new Date(r.at);
  assert.equal(d.getHours(), 14);
  assert.equal(d.getMinutes(), 30);
  assert.ok(r.at > Date.now()); // today or tomorrow, always future
});

test("parseReminder: rejects non-reminder chat", () => {
  assert.equal(R.parseReminder("what's hot right now"), null);
  assert.equal(R.parseReminder("hello pilly"), null);
  assert.equal(R.parseReminder(""), null);
});

test("parseReminder: rejects absurdly short times", () => {
  assert.equal(R.parseReminder("remind me in 1 sec to breathe"), null);
});

test("parseReminder: bare reminder falls back to a default message", () => {
  const r = R.parseReminder("remind me in 1 min");
  assert.ok(r, "should parse without a 'to ...' message");
  assert.equal(r.message, "Pilly reminder");
  assert.ok(r.at > Date.now());
});

test("add/list/remove persist and sort by due time", () => {
  const dir = tmpDir();
  const later = R.add(dir, { message: "check SOL", at: Date.now() + 3600000 });
  const sooner = R.add(dir, { message: "stretch", at: Date.now() + 60000 });
  assert.ok(later.ok && sooner.ok);
  const items = R.list(dir);
  assert.equal(items.length, 2);
  assert.equal(items[0].id, sooner.reminder.id); // soonest first
  R.remove(dir, sooner.reminder.id);
  assert.deepEqual(R.list(dir).map((r) => r.id), [later.reminder.id]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("dueNow fires once and removes fired reminders", () => {
  const dir = tmpDir();
  const now = Date.now();
  R.add(dir, { message: "soon", at: now + 30000 });
  R.add(dir, { message: "later", at: now + 600000 });
  const due = R.dueNow(dir, now + 60000);
  assert.equal(due.length, 1);
  assert.equal(due[0].message, "soon");
  assert.equal(R.dueNow(dir, now + 60000).length, 0); // not fired twice
  assert.equal(R.list(dir).length, 1); // only the "later" one remains
  fs.rmSync(dir, { recursive: true, force: true });
});
