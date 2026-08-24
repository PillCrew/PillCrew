// src/ai.js - Pilly's free AI brain.
//
// Two ways to talk:
//   A) PILLY_API_URL set -> route through the PillCrew web API (its own
//      free pipeline). Needs no keys here.
//   B) Direct tier chain -> tries PILLY_TIER1_URL .. PILLY_TIER5_URL in order
//      (cheapest/free first) until one answers. Fully generic: the endpoints
//      and models come from .env, so no provider names live in code.
//
// Every reply is clamped short (meme-native, screenshot-sized).

const fs = require("fs");
const path = require("path");

// ---- tiny .env loader (also loads for main) ----
function loadEnv() {
  try {
    const p = path.join(__dirname, "..", ".env");
    if (!fs.existsSync(p)) return;
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch (e) { /* ignore */ }
}
loadEnv();

const MAX_TRIES = 3;
const SHORT_MAX = 340; // chars - replies stay screenshot-sized

// Collect the configured tiers: from an explicit options object (settings UI)
// first, then the environment, then nothing.
function getTiers(optsTiers) {
  if (Array.isArray(optsTiers) && optsTiers.some((t) => t && t.url)) {
    return optsTiers.filter((t) => t && t.url);
  }
  const tiers = [];
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
  return tiers;
}

// Clamp a reply to a screenshot-sized length, keeping the punchline.
function clampShort(text, max = SHORT_MAX) {
  if (!text) return "";
  let t = String(text).trim();
  if (t.length > max) {
    const cut = t.slice(0, max).replace(/\s+\S*$/, "");
    t = cut.replace(/[.,;:]$/, "") + "…";
  }
  return t;
}

async function fetchJson(url, options, ms = 25000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Route through the PillCrew web API as a fallback (its free pipeline).
// Uses the site's Meme Alchemist agent - Pilly's own persona comes from the
// direct tiers; this is just a safety net when no local keys are configured.
async function viaSite(messages, system) {
  const base = (process.env.PILLY_API_URL || "").replace(/\/+$/, "");
  const key = process.env.PILLY_API_KEY || "";
  if (!base) return null;
  const history = messages.map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: String(m.content || ""),
  }));
  const res = await fetchJson(`${base}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify({ history, agentId: "meme" }),
  });
  if (!res) return null;
  return res.content || res.reply || res.message || null;
}

// Direct tier chain - free/cheap first, first success wins.
async function viaTiers(messages, system, opts = {}) {
  const tiers = getTiers(opts.tiers);
  const temperature = Number(
    opts.temperature != null ? opts.temperature : process.env.PILLY_TEMPERATURE || 0.8
  );
  const maxTokens = Number(opts.maxTokens != null ? opts.maxTokens : process.env.PILLY_MAX_TOKENS || 240);
  for (const tier of tiers) {
    for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
      const headers = { "Content-Type": "application/json" };
      if (tier.auth === "bearer" && tier.key) headers.Authorization = `Bearer ${tier.key}`;
      else if (tier.auth === "key" && tier.key) headers["X-API-Key"] = tier.key;
      const body = {
        ...(tier.model ? { model: tier.model } : {}),
        messages: [{ role: "system", content: system }, ...messages],
        temperature,
        max_tokens: maxTokens,
        stream: false,
      };
      const json = await fetchJson(tier.url, { method: "POST", headers, body: JSON.stringify(body) });
      if (!json) continue;
      // Common shapes: choices[0].message.content, or content, or output
      const content =
        json?.choices?.[0]?.message?.content ||
        json?.choices?.[0]?.text ||
        json?.message?.content ||
        json?.content ||
        json?.output ||
        json?.data?.content ||
        null;
      if (content) return String(content);
    }
  }
  return null;
}

/**
 * Send a chat to Pilly.
 * @param {string} text user message
 * @param {object} [opts]
 * @param {string} [opts.task] "" | "rewrite" | "caption" | "name" | "react" | "roast" | "coin" | "trending"
 * @param {Array}  [opts.history] previous [{role, content}] (max ~12)
 * @param {string} [opts.coinContext] live coin snapshot (COIN MODE)
 * @param {object} [opts.ai] settings: { tiers, temperature, maxTokens, useSiteFallback }
 * @returns {Promise<{reply: string, error?: string}>}
 */
async function respond(text, opts = {}) {
  const PILLY = require("./pilly");
  const task = opts.task || "";
  const history = Array.isArray(opts.history) ? opts.history : [];
  const coinContext = opts.coinContext || "";
  const system = PILLY.systemPrompt(task, coinContext);
  const messages = [...history.slice(-12), { role: "user", content: text }];

  // Direct tiers FIRST - they carry Pilly's OWN persona (short, meme-native).
  // The web API is only a fallback when no local keys are configured.
  let reply = await viaTiers(messages, system, opts.ai || {});
  const useSite = !opts.ai || opts.ai.useSiteFallback !== false;
  if (!reply && useSite) reply = await viaSite(messages, system);

  if (!reply) {
    return { error: "Pilly couldn't reach any AI right now. Add your API in settings (⚙️) and try again." };
  }
  return { reply: clampShort(reply) };
}

module.exports = { respond, clampShort, getTiers };
