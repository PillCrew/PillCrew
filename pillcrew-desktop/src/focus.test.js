const { test } = require("node:test");
const assert = require("node:assert");
const F = require("./focus");

const cfg = F.normalizeCfg();
const T0 = 1000000;

test("normalizeCfg: defaults and clamping", () => {
  assert.deepEqual(F.normalizeCfg(), F.DEFAULT_CFG);
  const c = F.normalizeCfg({ focusMin: 0, breakMin: -5, autoStart: false, sessionsBeforeLongBreak: "3" });
  assert.equal(c.focusMin, 25);
  assert.equal(c.breakMin, 5);
  assert.equal(c.autoStart, false);
  assert.equal(c.sessionsBeforeLongBreak, 3);
});

test("startPhase: sets a correct countdown", () => {
  const s = F.startPhase(F.emptyState(), "focus", T0, cfg);
  assert.equal(s.phase, "focus");
  assert.equal(s.plannedMin, 25);
  assert.equal(s.endsAt, T0 + 25 * 60000);
});

test("tickState: focus -> break and increments completed", () => {
  const s0 = F.startPhase(F.emptyState(), "focus", T0, cfg);
  const s1 = F.tickState(s0, s0.endsAt, cfg);
  assert.equal(s1.phase, "break");
  assert.equal(s1.completed, 1);
  assert.equal(s1.plannedMin, 5);
});

test("tickState: 4th focus rolls into a long break", () => {
  let s = { ...F.emptyState(), completed: 3 };
  s = F.startPhase(s, "focus", T0, cfg);
  s = F.tickState(s, s.endsAt, cfg);
  assert.equal(s.phase, "long_break");
  assert.equal(s.plannedMin, 15);
  assert.equal(s.completed, 4);
});

test("tickState: break -> idle", () => {
  const s0 = F.startPhase(F.emptyState(), "break", T0, cfg);
  const s1 = F.tickState(s0, s0.endsAt, cfg);
  assert.equal(s1.phase, "idle");
  assert.equal(s1.completed, 0);
});

test("stopState: goes idle and blocks auto-start for one break", () => {
  const s0 = F.startPhase(F.emptyState(), "focus", T0, cfg);
  const s1 = F.stopState(s0, T0 + 60000, cfg);
  assert.equal(s1.phase, "idle");
  assert.equal(s1.blockedUntil, T0 + 60000 + cfg.breakMin * 60000);
});

test("maybeAutoStartState: gates", () => {
  const idleMs = 6 * 60000;
  // starts when idle, enabled and past the block window
  const s1 = F.maybeAutoStartState(F.emptyState(), T0, cfg, idleMs);
  assert.equal(s1.phase, "focus");
  // blocked window
  const blocked = { ...F.emptyState(), blockedUntil: T0 + 1000 };
  assert.equal(F.maybeAutoStartState(blocked, T0, cfg, idleMs).phase, "idle");
  // disabled
  const off = F.normalizeCfg({ autoStart: false });
  assert.equal(F.maybeAutoStartState(F.emptyState(), T0, off, idleMs).phase, "idle");
  // not idle enough
  assert.equal(F.maybeAutoStartState(F.emptyState(), T0, cfg, 4 * 60000).phase, "idle");
  // already in a phase
  const active = F.startPhase(F.emptyState(), "break", T0, cfg);
  assert.equal(F.maybeAutoStartState(active, T0, cfg, idleMs).phase, "break");
});

test("remaining: reflects countdown", () => {
  const s = F.startPhase(F.emptyState(), "focus", T0, cfg);
  const r = F.remaining(s, T0 + 60000);
  assert.equal(r.phase, "focus");
  assert.equal(r.remainingMs, 24 * 60000);
  assert.equal(r.completed, 0);
  assert.equal(F.remaining(F.emptyState(), T0).phase, "idle");
});

test("pauseState + resumeState: freeze and continue the countdown", () => {
  const s0 = F.startPhase(F.emptyState(), "focus", T0, cfg);
  const paused = F.pauseState(s0, T0 + 60000);
  assert.equal(paused.paused, true);
  assert.equal(paused.pauseRemaining, 24 * 60000);
  // frozen: ticking far into the future does NOT roll the phase over
  assert.equal(F.tickState(paused, T0 + 999999999, cfg).phase, "focus");
  const resumed = F.resumeState(paused, T0 + 120000);
  assert.equal(resumed.paused, false);
  assert.equal(resumed.endsAt, T0 + 120000 + 24 * 60000);
  // remaining reports the frozen amount while paused
  assert.equal(F.remaining(paused, T0 + 60000).paused, true);
  assert.equal(F.remaining(paused, T0 + 60000).remainingMs, 24 * 60000);
});

test("pauseState: no-op when idle or already paused", () => {
  assert.equal(F.pauseState(F.emptyState(), T0).paused, false);
  const paused = F.pauseState(F.startPhase(F.emptyState(), "focus", T0, cfg), T0);
  assert.equal(F.pauseState(paused, T0 + 1).pauseRemaining, paused.pauseRemaining);
});
