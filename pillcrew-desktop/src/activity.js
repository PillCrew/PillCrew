// src/activity.js - local-only activity diary for Pilly (v1.1.1).
// One row per minute: { t: minute-start ms, active: bool }, derived from the
// system idle time (never what the user typed or clicked). Retention trims to
// the last 90 days. Pure helpers + a tiny JSON store (pilly-activity.json).

const fs = require("fs");
const path = require("path");

const RETENTION_DAYS = 90;
const DAY_MS = 86400000;

function filePath(userData) {
  return path.join(userData, "pilly-activity.json");
}

function minuteStart(ts) {
  return Math.floor(Number(ts) / 60000) * 60000;
}

function load(userData) {
  try {
    const j = JSON.parse(fs.readFileSync(filePath(userData), "utf8"));
    if (j && Array.isArray(j.minutes)) {
      return {
        minutes: j.minutes.filter(
          (m) => m && Number.isFinite(m.t) && typeof m.active === "boolean"
        ),
      };
    }
  } catch (e) {
    /* start fresh */
  }
  return { minutes: [] };
}

function save(userData, data) {
  try {
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(filePath(userData), JSON.stringify({ minutes: data.minutes }), "utf8");
    return true;
  } catch (e) {
    return false;
  }
}

function trim(minutes, now, days = RETENTION_DAYS) {
  const cutoff = minuteStart(now) - days * DAY_MS;
  return minutes.filter((m) => m.t >= cutoff);
}

// Upsert the current minute and drop anything older than the retention window.
function record(userData, ts, active) {
  const data = load(userData);
  const t = minuteStart(ts);
  const idx = data.minutes.findIndex((m) => m.t === t);
  if (idx >= 0) data.minutes[idx].active = !!active;
  else data.minutes.push({ t, active: !!active });
  data.minutes.sort((a, b) => a.t - b.t);
  data.minutes = trim(data.minutes, Date.now());
  save(userData, data);
  return data;
}

function inRange(m, from, to) {
  return m.t >= minuteStart(from) && m.t <= minuteStart(to);
}

function stats(minutes, from, to) {
  const rows = minutes.filter((m) => inRange(m, from, to));
  const active = rows.filter((m) => m.active).length;
  return {
    total: rows.length,
    active,
    rest: rows.length - active,
    pct: rows.length ? Math.round((active / rows.length) * 100) : 0,
  };
}

function todayStats(userData, now) {
  const data = load(userData);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return stats(data.minutes, start.getTime(), now);
}

function yesterdayStats(userData, now) {
  const data = load(userData);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const yStart = today.getTime() - DAY_MS;
  return stats(data.minutes, yStart, today.getTime() - 1);
}

function dayKey(ms) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// Consecutive days with at least one active minute, ending today (or yesterday
// if today hasn't seen activity yet - the streak is still alive until midnight).
function streakDays(userData, now) {
  const data = load(userData);
  const activeDays = new Set();
  for (const m of data.minutes) {
    if (m.active) activeDays.add(dayKey(m.t));
  }
  const today = dayKey(now);
  let cursor = activeDays.has(today) ? today : today - DAY_MS;
  let streak = 0;
  while (activeDays.has(cursor)) {
    streak++;
    cursor -= DAY_MS;
  }
  return streak;
}

module.exports = {
  RETENTION_DAYS,
  DAY_MS,
  filePath,
  minuteStart,
  load,
  save,
  trim,
  record,
  stats,
  todayStats,
  yesterdayStats,
  streakDays,
};
