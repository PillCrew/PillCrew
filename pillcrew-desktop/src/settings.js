// src/settings.js - Pilly's own API settings, saved on disk (userData).
// Lets the user paste their own AI endpoints/keys/models (e.g. any provider
// with a chat-completions API) without touching code or .env.

const fs = require("fs");
const path = require("path");

// Default tiers (empty until the user saves settings).
const DEFAULT_SETTINGS = {
  tiers: [
    { url: "", key: "", model: "", auth: "bearer" },
    { url: "", key: "", model: "", auth: "bearer" },
    { url: "", key: "", model: "", auth: "bearer" },
  ],
  temperature: 0.8,
  maxTokens: 240,
  pet: {
    name: "Pilly",
    mood: "neutral",
    theme: "green",
    size: "md",
    bubbles: true,
    bubbleSize: "md",
    walkMode: "taskbar",
    stopFreq: "normal",
    questions: true,
    sounds: true,
  },
};

let cache = null;

function settingsPath(userDataDir) {
  return path.join(userDataDir, "pilly-settings.json");
}

// Load settings (cached). Falls back to defaults.
function load(userDataDir) {
  if (cache) return cache;
  try {
    const p = settingsPath(userDataDir);
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, "utf8"));
      const merged = {
        ...DEFAULT_SETTINGS,
        ...raw,
        tiers: Array.isArray(raw.tiers) && raw.tiers.length
          ? raw.tiers.slice(0, 6)
          : DEFAULT_SETTINGS.tiers,
      };
      cache = merged;
      return cache;
    }
  } catch (e) { /* ignore */ }
  cache = DEFAULT_SETTINGS;
  return cache;
}

// Persist settings.
function save(userDataDir, settings) {
  const clean = {
    tiers: (settings.tiers || []).slice(0, 6).map((t) => ({
      url: String(t.url || "").trim(),
      key: String(t.key || "").trim(),
      model: String(t.model || "").trim(),
      auth: String(t.auth || "bearer"),
    })),
    temperature: Number.isFinite(Number(settings.temperature)) ? Number(settings.temperature) : 0.8,
    maxTokens: Number.isFinite(Number(settings.maxTokens)) ? Number(settings.maxTokens) : 240,
    pet: {
      name: String((settings.pet && settings.pet.name) || "Pilly").slice(0, 14),
      mood: String((settings.pet && settings.pet.mood) || "neutral"),
      theme: String((settings.pet && settings.pet.theme) || "green"),
      size: String((settings.pet && settings.pet.size) || "md"),
      bubbles: !settings.pet || settings.pet.bubbles !== false,
      bubbleSize: String((settings.pet && settings.pet.bubbleSize) || "md"),
      walkMode: String((settings.pet && settings.pet.walkMode) || "taskbar"),
      stopFreq: String((settings.pet && settings.pet.stopFreq) || "normal"),
      questions: !settings.pet || settings.pet.questions !== false,
      sounds: !settings.pet || settings.pet.sounds !== false,
    },
  };
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(settingsPath(userDataDir), JSON.stringify(clean, null, 2), "utf8");
    cache = clean;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

// Settings usable right now: saved settings first, then .env tiers.
function effective(userDataDir) {
  const s = load(userDataDir);
  const tiers = s.tiers.filter((t) => t.url).map((t) => t);
  // Fall back to env tiers if the user hasn't configured any.
  if (!tiers.length) {
    for (let i = 1; i <= 6; i++) {
      const url = process.env[`PILLY_TIER${i}_URL`];
      if (!url) continue;
      tiers.push({
        url,
        key: process.env[`PILLY_TIER${i}_KEY`] || "",
        model: process.env[`PILLY_TIER${i}_MODEL`] || "",
        auth: process.env[`PILLY_TIER${i}_AUTH`] || "bearer",
      });
    }
  }
  return { ...s, tiers };
}

module.exports = { load, save, effective, DEFAULT_SETTINGS };
