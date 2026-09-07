// src/focus.js - Pomodoro focus/break sessions for Pilly (v1.1.1).
// A pure state machine (no Electron, no timers - main.js drives it with
// Date.now()) plus a tiny JSON store (pilly-focus.json in userData) so a
// running session survives an app restart.

const fs = require("fs");
const path = require("path");

const DEFAULT_CFG = {
  focusMin: 25,
  breakMin: 5,
  longBreakMin: 15,
  sessionsBeforeLongBreak: 4,
  autoStart: true,
  idleResumeMin: 5,
};

// Phases: "idle" | "focus" | "break" | "long_break".
function emptyState() {
  return {
    phase: "idle",
    startedAt: 0,
    endsAt: 0,
    plannedMin: 0,
    completed: 0,
    blockedUntil: 0,
    paused: false,
    pauseRemaining: 0,
  };
}

function posInt(v, d) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : d;
}

function normalizeCfg(cfg) {
  const c = cfg || {};
  return {
    focusMin: posInt(c.focusMin, DEFAULT_CFG.focusMin),
    breakMin: posInt(c.breakMin, DEFAULT_CFG.breakMin),
    longBreakMin: posInt(c.longBreakMin, DEFAULT_CFG.longBreakMin),
    sessionsBeforeLongBreak: posInt(c.sessionsBeforeLongBreak, DEFAULT_CFG.sessionsBeforeLongBreak),
    autoStart: c.autoStart !== false,
    idleResumeMin: posInt(c.idleResumeMin, DEFAULT_CFG.idleResumeMin),
  };
}

function phaseMinutes(phase, cfg, completed) {
  if (phase === "focus") return cfg.focusMin;
  if (phase === "long_break") return cfg.longBreakMin;
  return cfg.breakMin;
}

// Begin a phase at `now` (immutably returns the next state).
function startPhase(state, phase, now, cfg) {
  const c = normalizeCfg(cfg);
  const plannedMin = phaseMinutes(phase, c, state.completed);
  return { ...state, phase, startedAt: now, endsAt: now + plannedMin * 60000, plannedMin, paused: false, pauseRemaining: 0 };
}

// Advance the machine: when a timed phase elapses, roll it over.
function tickState(state, now, cfg) {
  const c = normalizeCfg(cfg);
  if (state.phase === "idle") return state;
  if (state.paused) return state; // frozen until resume
  if (now < state.endsAt) return state;
  if (state.phase === "focus") {
    const completed = state.completed + 1;
    const next = completed % c.sessionsBeforeLongBreak === 0 ? "long_break" : "break";
    return startPhase({ ...state, completed }, next, now, c);
  }
  // break / long_break ended -> back to idle.
  return { ...state, phase: "idle", startedAt: 0, endsAt: 0, plannedMin: 0 };
}

// "Not now": go idle and block auto-start for one break's worth of time.
function stopState(state, now, cfg) {
  const c = normalizeCfg(cfg);
  return {
    ...state,
    phase: "idle",
    startedAt: 0,
    endsAt: 0,
    plannedMin: 0,
    blockedUntil: now + c.breakMin * 60000,
    paused: false,
    pauseRemaining: 0,
  };
}

// Freeze the current countdown (focus/break/long_break only).
function pauseState(state, now) {
  if (state.phase === "idle" || state.paused) return state;
  return { ...state, paused: true, pauseRemaining: Math.max(0, state.endsAt - now) };
}

// Unfreeze: the countdown continues from where it was paused.
function resumeState(state, now) {
  if (!state.paused) return state;
  return { ...state, paused: false, startedAt: now, endsAt: now + state.pauseRemaining, pauseRemaining: 0 };
}

// Auto-start a focus phase after a long idle stretch (privacy-safe: it only
// sees idle duration, never what the user typed or clicked).
function maybeAutoStartState(state, now, cfg, idleMs) {
  const c = normalizeCfg(cfg);
  if (state.phase !== "idle") return state;
  if (!c.autoStart) return state;
  if (now < state.blockedUntil) return state;
  if (idleMs < c.idleResumeMin * 60000) return state;
  return startPhase(state, "focus", now, c);
}

function remaining(state, now) {
  if (state.phase === "idle") {
    return { phase: "idle", remainingMs: 0, plannedMin: 0, completed: state.completed, paused: false };
  }
  if (state.paused) {
    return {
      phase: state.phase,
      remainingMs: state.pauseRemaining,
      plannedMin: state.plannedMin,
      completed: state.completed,
      totalMs: state.plannedMin * 60000,
      paused: true,
    };
  }
  return {
    phase: state.phase,
    remainingMs: Math.max(0, state.endsAt - now),
    plannedMin: state.plannedMin,
    completed: state.completed,
    totalMs: state.endsAt - state.startedAt,
    paused: false,
  };
}

// ---- file store ----
function filePath(userData) {
  return path.join(userData, "pilly-focus.json");
}

// doc = { cfg, state, digestDay }
function loadDoc(userData) {
  let cfg = normalizeCfg();
  let state = emptyState();
  let digestDay = 0;
  try {
    const j = JSON.parse(fs.readFileSync(filePath(userData), "utf8"));
    if (j && typeof j === "object") {
      cfg = normalizeCfg(j.cfg);
      if (j.state && typeof j.state === "object") {
        const completed = Number.isFinite(Number(j.state.completed))
          ? Math.max(0, Math.round(Number(j.state.completed)))
          : 0;
        state = { ...emptyState(), ...j.state, completed };
      }
      digestDay = Number.isFinite(Number(j.digestDay)) ? Number(j.digestDay) : 0;
    }
  } catch (e) {
    /* defaults */
  }
  return { cfg, state, digestDay };
}

function saveDoc(userData, doc) {
  try {
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(filePath(userData), JSON.stringify(doc, null, 2), "utf8");
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = {
  DEFAULT_CFG,
  emptyState,
  normalizeCfg,
  startPhase,
  tickState,
  stopState,
  pauseState,
  resumeState,
  maybeAutoStartState,
  remaining,
  filePath,
  loadDoc,
  saveDoc,
};
