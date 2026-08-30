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
    bubbleText: "md", // sm | md | lg (font size in pet bubbles)
    bubbleStyle: "default", // default | light | glass | neon | comic | minimal
    soundVol: 60, // 0-100
    walkMode: "taskbar",
    stopFreq: "normal",
    questions: true,
    sounds: true,
    // Proactive features (v1.1.0)
    hotAlerts: true, // Pilly scans trending and flags hot 5m movers
    hotPct: 10, // minimum 5m move % to flag a hot coin
    alertSound: true, // ding when a watchlist alert fires
    dailyBrief: true, // morning summary (SOL + your PnL)
    pillyPick: true, // Pilly's AI pick of the day (every ~6h)
    sniper: true, // v1.2.0: snipe just-launched coins
    whaleAlerts: true, // v1.2.0: alert when a followed whale opens a position
    portfolioMood: true, // v1.2.0: Pilly reacts to your own PnL
  },
  chat: {
    bubble: "sharp", // sharp | rounded | glass | neon | minimal
    alwaysOnTop: true,
    fontSize: "normal", // sm | normal | lg
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
        chat: {
          ...DEFAULT_SETTINGS.chat,
          ...(raw.chat || {}),
        },
        pet: {
          ...DEFAULT_SETTINGS.pet,
          ...(raw.pet || {}),
        },
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
      bubbleText: ["sm", "md", "lg"].includes(settings.pet && settings.pet.bubbleText)
        ? settings.pet.bubbleText
        : "md",
      bubbleStyle: ["default", "light", "glass", "neon", "comic", "minimal"].includes(
        settings.pet && settings.pet.bubbleStyle
      )
        ? settings.pet.bubbleStyle
        : "default",
      soundVol: (() => {
        const v = Number(settings.pet && settings.pet.soundVol);
        return isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : 60;
      })(),
      walkMode: String((settings.pet && settings.pet.walkMode) || "taskbar"),
      stopFreq: String((settings.pet && settings.pet.stopFreq) || "normal"),
      questions: !settings.pet || settings.pet.questions !== false,
      sounds: !settings.pet || settings.pet.sounds !== false,
      hotAlerts: !settings.pet || settings.pet.hotAlerts !== false,
      hotPct: (() => {
        const v = Number(settings.pet && settings.pet.hotPct);
        return isFinite(v) && v > 0 ? Math.min(100, Math.round(v)) : 10;
      })(),
      alertSound: !settings.pet || settings.pet.alertSound !== false,
      dailyBrief: !settings.pet || settings.pet.dailyBrief !== false,
      pillyPick: !settings.pet || settings.pet.pillyPick !== false,
      sniper: !settings.pet || settings.pet.sniper !== false,
      whaleAlerts: !settings.pet || settings.pet.whaleAlerts !== false,
      portfolioMood: !settings.pet || settings.pet.portfolioMood !== false,
    },
    chat: {
      bubble: ["sharp", "rounded", "glass", "neon", "minimal"].includes(
        settings.chat && settings.chat.bubble
      )
        ? settings.chat.bubble
        : "sharp",
      alwaysOnTop: !settings.chat || settings.chat.alwaysOnTop !== false,
      fontSize: ["sm", "normal", "lg"].includes(settings.chat && settings.chat.fontSize)
        ? settings.chat.fontSize
        : "normal",
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
