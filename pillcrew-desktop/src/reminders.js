// src/reminders.js - one-shot reminders set from chat ("remind me in 10 min to
// check SOL"). Pure logic + persistence; the main process polls for due items
// and fires a native notification + a Pilly bubble when one comes due.
const fs = require("fs");
const path = require("path");

function filePath(userData) {
  return path.join(userData, "pilly-reminders.json");
}

// items: [{ id, message, at (ms epoch), createdAt }]
function load(userData) {
  try {
    const j = JSON.parse(fs.readFileSync(filePath(userData), "utf8"));
    if (j && Array.isArray(j.items)) return j;
  } catch (e) {
    /* ignore - start fresh */
  }
  return { items: [] };
}

function save(userData, data) {
  try {
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(filePath(userData), JSON.stringify(data, null, 2), "utf8");
  } catch (e) {
    /* ignore */
  }
}

function list(userData) {
  return load(userData).items;
}

function add(userData, input) {
  const d = load(userData);
  const message = String((input && input.message) || "").trim().slice(0, 160);
  const at = Number(input && input.at);
  if (!message || !isFinite(at) || at <= Date.now()) {
    return { ok: false, items: d.items, error: "invalid" };
  }
  const reminder = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    message,
    at: Math.round(at),
    createdAt: Date.now(),
  };
  d.items.push(reminder);
  d.items.sort((a, b) => a.at - b.at);
  save(userData, d);
  return { ok: true, items: d.items, reminder };
}

function remove(userData, id) {
  const d = load(userData);
  d.items = d.items.filter((r) => r.id !== id);
  save(userData, d);
  return d.items;
}

// Fire-once semantics: return every reminder whose time has come and drop it
// from storage so it can't fire again.
function dueNow(userData, now) {
  const d = load(userData);
  const n = Number(now) || Date.now();
  const due = d.items.filter((r) => r.at <= n);
  if (due.length) {
    const ids = new Set(due.map((r) => r.id));
    d.items = d.items.filter((r) => !ids.has(r.id));
    save(userData, d);
  }
  return due;
}

// Millisecond values for the time units we accept in relative reminders.
const UNIT_MS = {
  s: 1000, sec: 1000, secs: 1000, second: 1000, seconds: 1000,
  m: 60000, min: 60000, mins: 60000, minute: 60000, minutes: 60000,
  h: 3600000, hr: 3600000, hrs: 3600000, hour: 3600000, hours: 3600000,
  d: 86400000, day: 86400000, days: 86400000,
};

const INTENT_RE = /(^|\s)(remind me|set a reminder|reminder|nag me|ping me)(\s|$)/i;

// Strip the "remind me in 10 minutes to ..." scaffolding and return just the
// thing to be reminded about.
function extractMessage(original, matchedFragment) {
  const idx = original.toLowerCase().indexOf(matchedFragment.toLowerCase());
  if (idx < 0) return "";
  let rest = original.slice(idx + matchedFragment.length);
  rest = rest.replace(/^[\s,;:!?.-]+/, "");
  rest = rest.replace(/^(to|that|about|of)\s+/i, "");
  return rest.replace(/^[\s,;:!?.-]+/, "").trim();
}

/**
 * Parse a natural-language reminder request.
 * Supports relative times ("in 10 minutes", "in 2h", "in 45 sec") and an
 * absolute clock time ("at 14:30", "at 9pm").
 * @returns {{ message: string, at: number } | null}
 */
function parseReminder(text) {
  const s = String(text || "").trim();
  if (!s) return null;
  if (!INTENT_RE.test(" " + s + " ")) return null;
  const lower = s.toLowerCase();
  const now = Date.now();

  // Relative: "in N unit" (unit may be abbreviated, e.g. "in 2h").
  const rel = lower.match(/\bin\s+(\d+(?:[.,]\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d)\b/);
  if (rel) {
    const amount = parseFloat(rel[1].replace(",", "."));
    const ms = Math.round(amount * (UNIT_MS[rel[2]] || 60000));
    if (!isFinite(ms) || ms < 3000) return null; // too soon to be useful
    // A bare "remind me in 5 min" still works - fall back to a friendly message.
    const message = extractMessage(s, rel[0]) || "Pilly reminder";
    return { message, at: now + ms };
  }

  // Absolute: "at 14:30" / "at 9pm" / "at 9:05 pm".
  const at = lower.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (at) {
    let hh = parseInt(at[1], 10);
    const mm = at[2] ? parseInt(at[2], 10) : 0;
    const ap = at[3];
    if (ap === "pm" && hh < 12) hh += 12;
    if (ap === "am" && hh === 12) hh = 0;
    if (hh > 23 || mm > 59) return null;
    const message = extractMessage(s, at[0]) || "Pilly reminder";
    const d = new Date();
    d.setHours(hh, mm, 0, 0);
    if (d.getTime() <= now + 30000) d.setDate(d.getDate() + 1); // already passed -> tomorrow
    return { message, at: d.getTime() };
  }

  return null;
}

module.exports = { list, add, remove, dueNow, parseReminder };
