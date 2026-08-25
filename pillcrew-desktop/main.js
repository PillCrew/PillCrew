// Pilly - a tiny green pill AI friend that lives in your Windows taskbar.
// Click the pill in the system tray to summon the chat (free AI, meme brain).
const {
  app, Tray, Menu, BrowserWindow, nativeImage, ipcMain, globalShortcut, screen, shell,
} = require("electron");
const path = require("path");
const fs = require("fs");

// Tiny .env loader (keeps keys out of the code).
function loadEnv() {
  try {
    const p = path.join(__dirname, ".env");
    if (!fs.existsSync(p)) return;
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch (e) { /* ignore */ }
}
loadEnv();

const AI = require("./src/ai");
const PILLY = require("./src/pilly");
const SETTINGS = require("./src/settings");
const COINS = require("./src/coins");

function userDataDir() {
  return app.getPath("userData");
}

// Effective AI options for a call (settings + env).
function aiOpts() {
  const s = SETTINGS.effective(userDataDir());
  return {
    tiers: s.tiers,
    temperature: s.temperature,
    maxTokens: s.maxTokens,
  };
}

function petOpts() {
  const s = SETTINGS.effective(userDataDir());
  return (s && s.pet) || { theme: "green", size: "md", bubbles: true, bubbleSize: "md", walkMode: "taskbar", stopFreq: "normal", questions: true };
}

function applyPetSettings() {
  const pet = petOpts();
  if (petWin && !petWin.isDestroyed()) petWin.webContents.send("pet:settings", pet);
  if (bubbleWin && !bubbleWin.isDestroyed()) bubbleWin.webContents.send("pet:settings", pet);
}

let tray = null;
let win = null;
let petWin = null;
let petTimer = null;
let petActive = false;
let petDir = 1;
let petX = 0;
let petState = "walk";
let petStateEnd = 0;
let petLastState = "";
let petY = 0;
let petTarget = null;
let petDragging = false;
let petQuestionTimer = null;
let lastPetQuestion = "";
let iconFrames = [];
let trayTimer = null;
let trayFrame = 0;
let isQuitting = false;

// ---- Pill icon frames (bobbing animation) ----
function loadFrames() {
  const dir = path.join(__dirname, "assets");
  const frames = [];
  for (let i = 0; i < 3; i++) {
    const p = path.join(dir, `pilly-${i}.png`);
    if (fs.existsSync(p)) frames.push(nativeImage.createFromPath(p));
  }
  return frames;
}

function createWindow() {
  win = new BrowserWindow({
    width: 380,
    height: 580,
    show: false,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    icon: iconFrames[0],
    backgroundColor: "#0b0f0d",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
  // If the window is ever fully destroyed (e.g. during quit races), drop the
  // stale reference so the next tray click can rebuild it instead of crashing
  // with "Object has been destroyed".
  win.on("closed", () => {
    win = null;
  });
}

// Return the live window, recreating it if it was closed/destroyed.
function ensureWindow() {
  if (win && !win.isDestroyed()) return win;
  createWindow();
  return win;
}

// Position the chat window right above the tray icon.
function positionWindow() {
  const w = ensureWindow();
  if (!w || !tray) return;
  try {
    const trayBounds = tray.getBounds();
    const area = screen.getPrimaryDisplay().workArea;
    const [wpx, hpx] = w.getSize();
    let x = trayBounds.x + trayBounds.width / 2 - wpx / 2;
    let y = trayBounds.y - hpx - 10;
    x = Math.max(area.x + 4, Math.min(x, area.x + area.width - wpx - 4));
    y = Math.max(area.y + 4, y);
    w.setPosition(Math.round(x), Math.round(y), false);
  } catch (e) { /* ignore */ }
}

function toggleWindow() {
  const w = ensureWindow();
  if (!w) return;
  if (w.isVisible()) {
    w.hide();
    return;
  }
  positionWindow();
  w.show();
  w.focus();
}

// ---- Taskbar pet: a tiny pill that walks along the taskbar ----
const PET_W = 60;
const PET_H = 64; // tall enough that a hop (up to ~21px above the pill top at lg scale) never clips

function createPetWindow() {
  petWin = new BrowserWindow({
    width: PET_W,
    height: PET_H,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  petWin.setAlwaysOnTop(true, "screen-saver");
  petWin.loadFile(path.join(__dirname, "renderer", "pet.html"));
  petWin.on("closed", () => { petWin = null; });
}

function startPet() {
  if (petActive) return;
  petActive = true;
  createPetWindow();
  const area = screen.getPrimaryDisplay().workArea;
  const pet = petOpts();
  petX = Math.floor(area.x + area.width * 0.4);
  petY = pet.walkMode === "screen"
    ? Math.floor(area.y + area.height * 0.35)
    : area.y + area.height - PET_H - 2;
  petDir = 1;
  petState = "walk";
  petStateEnd = Date.now() + 2000 + Math.random() * 2000;
  petTarget = null;
  petDragging = false;
  petWin.setPosition(petX, petY);
  petTimer = setInterval(() => {
    if (!petWin || petWin.isDestroyed()) { stopPet(); return; }
    const now = Date.now();
    // While the user is dragging Pilly, don't fight him - but keep the
    // speech bubble glued to him as he moves.
    if (petDragging) {
      if (bubbleWin && !bubbleWin.isDestroyed() && bubbleWin.isVisible()) positionBubble();
      return;
    }
    if (now >= petStateEnd) {
      const plan = randomPetState();
      petState = plan.mode;
      petStateEnd = now + plan.ms;
    }
    if (petState === "walk") {
      // Pick a new target when there isn't one (taskbar mode = along the
      // taskbar line, screen mode = anywhere on the monitor).
      if (!petTarget) petTarget = pickPetTarget(area);
      const dx = petTarget.x - petX;
      const dy = petTarget.y - petY;
      const dist = Math.hypot(dx, dy);
      if (dist < 2) {
        // Reached the target - stop and think for a bit instead of turning
        // around and marching corner to corner.
        petTarget = null;
        petState = "pause";
        petStateEnd = now + pauseMs();
      } else {
        const sp = petOpts().walkMode === "screen" ? 2.4 : 2;
        petX += (dx / dist) * sp;
        petY += (dy / dist) * sp;
        const nd = dx >= 0 ? 1 : -1;
        if (nd !== petDir) { petDir = nd; petWin.webContents.send("pet:dir", petDir); }
        petX = Math.max(area.x, Math.min(petX, area.x + area.width - PET_W));
        petY = Math.max(area.y - 8, Math.min(petY, area.y + area.height - PET_H));
      }
    }
    if (petState !== petLastState) {
      petLastState = petState;
      petWin.webContents.send("pet:state", petState);
    }
    petWin.setPosition(Math.round(petX), Math.round(petY));
    petWin.webContents.send("pet:dir", petDir);
    const cur = screen.getCursorScreenPoint();
    // Aim the pupils at the pill's center, not the window's center.
    petWin.webContents.send("pet:cursor", { x: cur.x - (petX + PET_W / 2), y: cur.y - (petY + PET_H - 22.5) });
    if (bubbleWin && !bubbleWin.isDestroyed() && bubbleWin.isVisible()) positionBubble();
  }, 24);
  // First joke after a few seconds, then every 2-3 minutes.
  if (petOpts().bubbles) {
    setTimeout(() => { if (petActive) { petJokeTick(); scheduleNextJoke(); } }, 8000);
  }
  // Pilly occasionally asks you something (first after ~2.5-3.5 min, then 3-5 min).
  if (petOpts().questions !== false) {
    setTimeout(() => { if (petActive) { petQuestionTick(); scheduleNextQuestion(); } }, 150000 + Math.random() * 60000);
  }
  // Tiny poops on the screen every 4-5 min (they vanish on their own).
  setTimeout(() => { if (petActive) { spawnPoop(); scheduleNextPoop(); } }, 150000 + Math.random() * 60000);
}

function stopPet() {
  petActive = false;
  if (petTimer) { clearInterval(petTimer); petTimer = null; }
  if (petJokeTimer) { clearInterval(petJokeTimer); petJokeTimer = null; }
  if (petQuestionTimer) { clearTimeout(petQuestionTimer); petQuestionTimer = null; }
  if (poopTimer) { clearTimeout(poopTimer); poopTimer = null; }
  if (bubbleTimer) { clearTimeout(bubbleTimer); bubbleTimer = null; }
  petDragging = false;
  petTarget = null;
  if (petWin && !petWin.isDestroyed()) petWin.destroy();
  petWin = null;
  if (bubbleWin && !bubbleWin.isDestroyed()) bubbleWin.destroy();
  bubbleWin = null;
}

// ---- Pet jokes: AI-generated (offline list as a fallback) ----
const PET_JOKES = [
  "why did the memecoin cross the road? to get to the other pump.",
  "buy high, sell never. the solana way.",
  "my portfolio is 90% hopium and 10% cope.",
  "when the chart goes up but your wallet says nope.",
  "rug pulls are just aggressive exits, bro.",
  "solana is fast, but my money leaves faster.",
  "dev said no rugs. dev lied. again.",
  "the only green candle in my life is the one i held too long.",
  "pump it, dump it, love it, never leave it.",
  "my stop loss is a meme. literally.",
  "solana block time: 400ms. my gains: gone in 1.",
  "i don't need a roadmap, i need a rocket.",
];
let bubbleWin = null;
let bubbleTimer = null;
let petJokeTimer = null;

function ensureBubbleWin() {
  if (bubbleWin && !bubbleWin.isDestroyed()) return bubbleWin;
  bubbleWin = new BrowserWindow({
    width: 180,
    height: 130,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  bubbleWin.setAlwaysOnTop(true, "screen-saver");
  bubbleWin.setIgnoreMouseEvents(true, { forward: true });
  bubbleWin.loadFile(path.join(__dirname, "renderer", "bubble.html"));
  bubbleWin.on("closed", () => { bubbleWin = null; });
  return bubbleWin;
}

function positionBubble() {
  if (!bubbleWin || bubbleWin.isDestroyed() || !petWin || petWin.isDestroyed()) return;
  const [px, py] = petWin.getPosition();
  const pet = petOpts();
  const ps = pet.size === "sm" ? 0.85 : pet.size === "lg" ? 1.2 : 1;
  // Pill top within the PET_H-tall pet window (pill is 23px tall, 11px from the bottom).
  const pillTop = PET_H - 11 - 23 * ps;
  // Bubble window is 130px tall and the bubble sits 4px above its bottom;
  // keep the bubble ~12px above the pill top for every pill size.
  const y = py + pillTop - 12 - 126;
  bubbleWin.setPosition(Math.round(px - 60), Math.round(y));
}

function showPetJoke(text) {
  if (!petActive) return;
  setBubbleClickable(false);
  const b = ensureBubbleWin();
  b.webContents.send("pet:joke", text);
  positionBubble();
  b.showInactive();
  if (bubbleTimer) clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => {
    if (bubbleWin && !bubbleWin.isDestroyed()) bubbleWin.hide();
  }, 9000);
}

function localPetJoke() {
  return PET_JOKES[Math.floor(Math.random() * PET_JOKES.length)];
}

// How long Pilly pauses depends on the "stopping" setting.
function pauseMs() {
  const f = petOpts().stopFreq || "normal";
  if (f === "often") return 2600 + Math.random() * 3600;
  if (f === "rare") return 700 + Math.random() * 900;
  return 1400 + Math.random() * 2200;
}

// Decide what Pilly does next: pause in place, do a little hop, or walk.
// "often" stopping makes Pilly hang out instead of marching corner to corner.
function randomPetState() {
  const f = petOpts().stopFreq || "normal";
  const pauseP = f === "often" ? 0.5 : f === "rare" ? 0.15 : 0.3;
  const r = Math.random();
  if (r < pauseP) return { mode: "pause", ms: pauseMs() };
  if (r < pauseP + 0.18) return { mode: "hop", ms: 900 + Math.random() * 600 };
  return { mode: "walk", ms: 2500 + Math.random() * 4000 };
}

// Where Pilly walks to next. Taskbar mode keeps it on the taskbar line;
// screen mode lets it wander anywhere on the monitor.
function pickPetTarget(area) {
  const m = 16;
  if (petOpts().walkMode === "screen") {
    return {
      x: area.x + m + Math.random() * Math.max(10, area.width - PET_W - m * 2),
      y: area.y + m + Math.random() * Math.max(10, area.height - PET_H - m),
    };
  }
  return {
    x: area.x + Math.random() * (area.width - PET_W),
    y: area.y + area.height - PET_H - 2,
  };
}

async function petJokeTick() {
  if (!petActive || !petOpts().bubbles) return;
  let joke = localPetJoke();
  try {
    const r = await AI.respond(
      "tell me a very short funny joke about solana pump.fun memecoins, one line, under 10 words",
      { task: "", ai: aiOpts() }
    );
    if (r && r.reply) {
      const j = String(r.reply).trim();
      if (j.length > 4) {
        joke = j.length > 70 ? j.slice(0, 70).replace(/\s+\S*$/, "") + "…" : j;
      }
    }
  } catch (e) { /* keep the local joke */ }
  if (petActive) showPetJoke(joke);
}

// Schedule the next joke 2-3 minutes after the current one.
function scheduleNextJoke() {
  if (!petActive || !petOpts().bubbles) return;
  const delay = 120000 + Math.floor(Math.random() * 60000);
  petJokeTimer = setTimeout(() => {
    if (!petActive || !petOpts().bubbles) return;
    petJokeTick();
    scheduleNextJoke();
  }, delay);
}

// ---- Pilly asks you questions about pump.fun / Solana (every 3-5 min) ----
const PET_QUESTIONS = [
  "what's the wildest pump.fun coin you've seen this week?",
  "if you had $50 for one memecoin, which one and why?",
  "is it still early, or are we all already late?",
  "what's your exit strategy? be honest.",
  "which dev are you trusting today - and why is it no one?",
  "what does your dream pump.fun ticker name sound like?",
  "solana or solana - is any other chain even real?",
  "what's the next meta after cats and dogs?",
  "how do you spot a rug before it pulls?",
  "best trade you never made? worst one you did?",
];

function localPetQuestion() {
  return PET_QUESTIONS[Math.floor(Math.random() * PET_QUESTIONS.length)];
}

// The bubble normally lets clicks pass through; questions make it clickable so
// the user can open the chat and answer.
function setBubbleClickable(on) {
  if (!bubbleWin || bubbleWin.isDestroyed()) return;
  bubbleWin.setIgnoreMouseEvents(!on, { forward: true });
}

async function petQuestionTick() {
  if (!petActive || petOpts().questions === false) return;
  let q = localPetQuestion();
  try {
    const r = await AI.respond(
      "You're Pilly. Ask the user ONE short, fun question about pump.fun, Solana memecoins or crypto. One line, under 15 words, ends with '?'. No labels, no intro.",
      { task: "", ai: aiOpts() }
    );
    if (r && r.reply) {
      const t = String(r.reply).trim();
      if (t.length > 4 && t.includes("?")) {
        q = t.length > 80 ? t.slice(0, 80).replace(/\s+\S*$/, "") + "…" : t;
      }
    }
  } catch (e) { /* keep the local question */ }
  if (!petActive) return;
  lastPetQuestion = q;
  showPetQuestion(q);
  const w = ensureWindow();
  if (w && !w.isDestroyed()) w.webContents.send("pilly:question", q);
}

// Show the question in the bubble (clickable - opens the chat) and hide it
// after a while.
function showPetQuestion(text) {
  if (!petActive) return;
  const b = ensureBubbleWin();
  b.webContents.send("pet:joke", "🤔 " + text);
  positionBubble();
  b.showInactive();
  setBubbleClickable(true);
  if (bubbleTimer) clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => {
    if (bubbleWin && !bubbleWin.isDestroyed()) {
      bubbleWin.hide();
      setBubbleClickable(false);
    }
  }, 12000);
}

// Schedule the next question 3-5 minutes after the current one.
function scheduleNextQuestion() {
  if (!petActive || petOpts().questions === false) return;
  const delay = 180000 + Math.floor(Math.random() * 120000);
  petQuestionTimer = setTimeout(() => {
    if (!petActive || petOpts().questions === false) return;
    petQuestionTick();
    scheduleNextQuestion();
  }, delay);
}

// ---- Tiny poops: Pilly drops a little pile on the screen every 4-5 min ----
const POOP_W = 22;
const POOP_H = 28;
let poopTimer = null;

function spawnPoop() {
  if (!petActive || !petWin || petWin.isDestroyed()) return;
  try {
    const poop = new BrowserWindow({
      width: POOP_W,
      height: POOP_H,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      focusable: false,
      hasShadow: false,
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    poop.setAlwaysOnTop(true, "screen-saver");
    poop.setIgnoreMouseEvents(true, { forward: true });
    poop.loadFile(path.join(__dirname, "renderer", "poop.html"));
    // Drop it right under Pilly's feet; it stays put and fades on its own.
    poop.setPosition(Math.round(petX + PET_W / 2 - POOP_W / 2), Math.round(petY + PET_H - POOP_H - 3));
    poop.showInactive();
    setTimeout(() => { if (!poop.isDestroyed()) poop.destroy(); }, 5200);
  } catch (e) { /* ignore */ }
}

function scheduleNextPoop() {
  if (!petActive) return;
  const delay = 240000 + Math.floor(Math.random() * 60000); // 4-5 min
  poopTimer = setTimeout(() => {
    if (!petActive) return;
    spawnPoop();
    scheduleNextPoop();
  }, delay);
}

function startTrayAnim() {
  if (trayTimer || iconFrames.length < 2) return;
  trayTimer = setInterval(() => {
    trayFrame = (trayFrame + 1) % iconFrames.length;
    if (tray && !isQuitting) tray.setImage(iconFrames[trayFrame]);
  }, 450);
}

function createTray() {
  if (!iconFrames.length) iconFrames = loadFrames();
  tray = new Tray(iconFrames[0] || nativeImage.createEmpty());
  tray.setToolTip("Pilly - tap to chat");

  const menu = Menu.buildFromTemplate([
    { label: "Open chat", click: () => toggleWindow() },
    { type: "separator" },
    {
      label: "Start with Windows",
      type: "checkbox",
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => { app.setLoginItemSettings({ openAtLogin: item.checked }); },
    },
    { type: "separator" },
    { label: "Quit Pilly", click: () => { isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.on("click", () => toggleWindow());
  startTrayAnim();
}

// ---- IPC: talk to Pilly ----
ipcMain.handle("pilly:chat", async (event, payload) => {
  const { text, task, history, coinContext } = payload || {};
  if (!text || typeof text !== "string" || !text.trim()) return { error: "empty" };
  try {
    return await AI.respond(text.trim(), {
      task: task || "",
      history: history || [],
      coinContext: coinContext || "",
      ai: aiOpts(),
    });
  } catch (e) {
    return { error: String((e && e.message) || e) };
  }
});

ipcMain.handle("pilly:meme", () => PILLY.MEME_PROMPTS);
ipcMain.handle("pilly:detect-task", (event, text) => require("./src/meme").detectTask(String(text || "")));

// ---- IPC: settings (own AI API) ----
ipcMain.handle("pilly:settings:get", () => SETTINGS.effective(userDataDir()));
ipcMain.handle("pilly:settings:save", (event, s) => {
  const r = SETTINGS.save(userDataDir(), s);
  applyPetSettings();
  return r;
});
ipcMain.handle("pilly:settings:test", async (event, s) => {
  const saved = s && Array.isArray(s.tiers) ? s : SETTINGS.effective(userDataDir());
  const tiers = (saved.tiers || []).filter((t) => t && t.url);
  if (!tiers.length) return { ok: false, error: "No API URL configured. Fill in at least one tier." };
  let firstError = "";
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i];
    try {
      const headers = { "Content-Type": "application/json" };
      if (t.auth === "bearer" && t.key) headers.Authorization = `Bearer ${t.key}`;
      else if (t.auth === "key" && t.key) headers["X-API-Key"] = t.key;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);
      const res = await fetch(t.url, {
        method: "POST",
        headers,
        signal: ctrl.signal,
        body: JSON.stringify({
          ...(t.model ? { model: t.model } : {}),
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 5,
        }),
      });
      clearTimeout(timer);
      if (res.ok) return { ok: true, tier: i + 1 };
      let detail = "";
      try {
        detail = (await res.text()).replace(/\s+/g, " ").slice(0, 180);
      } catch (e) { /* ignore */ }
      const hint = !t.model ? " Add a model - most providers (incl. OpenRouter) reject requests without one." : "";
      firstError = firstError || `API ${i + 1} responded ${res.status}${detail ? ": " + detail : ""}.${hint}`;
    } catch (e) {
      firstError = firstError || `API ${i + 1} unreachable: ${String((e && e.message) || e)}`;
    }
  }
  return { ok: false, error: firstError || "No tier answered." };
});

// Fetch the list of models a provider offers (free ones first where known).
ipcMain.handle("pilly:settings:models", async (event, t) => {
  if (!t || !t.url) return { ok: false, error: "Enter an API URL first." };
  const base = String(t.url).trim().replace(/\/+$/, "");
  const m = base.match(/^(.+?)\/chat\/completions$/i);
  const modelsUrl = m ? m[1] + "/models" : base + "/models";
  const headers = { Accept: "application/json" };
  if (t.auth === "bearer" && t.key) headers.Authorization = `Bearer ${t.key}`;
  else if (t.auth === "key" && t.key) headers["X-API-Key"] = t.key;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(modelsUrl, { headers, signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, error: `Models endpoint responded ${res.status}. Check the URL/key.` };
    const json = await res.json();
    const arr = Array.isArray(json.data) ? json.data : Array.isArray(json) ? json : [];
    const seen = new Set();
    const free = [];
    const paid = [];
    for (const item of arr) {
      const id = typeof item === "string" ? item : item && (item.id || item.name);
      if (!id || typeof id !== "string") continue;
      const norm = id.trim();
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);
      const pricing = (item && item.pricing) || {};
      const isFree = /:free$/i.test(norm) || String(pricing.prompt) === "0" || String(pricing.prompt) === "0.0";
      (isFree ? free : paid).push(norm);
    }
    free.sort((a, b) => a.localeCompare(b));
    paid.sort((a, b) => a.localeCompare(b));
    const models = [...free, ...paid];
    if (!models.length) return { ok: false, error: "No models found on that endpoint." };
    return { ok: true, models, free };
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, error: `Could not reach the models endpoint: ${String((e && e.message) || e)}` };
  }
});

// ---- IPC: live Solana data ----
ipcMain.handle("pilly:coin", async (event, mint) => {
  try {
    return await COINS.fetchCoinContext(String(mint || "").trim());
  } catch (e) {
    return null;
  }
});
ipcMain.handle("pilly:wallet", async (event, address) => {
  try {
    return await COINS.fetchWalletPortfolio(String(address || "").trim());
  } catch (e) {
    return null;
  }
});
ipcMain.handle("pilly:trending", async () => {
  try {
    return await COINS.fetchTrendingTop(10);
  } catch (e) {
    return { list: [], context: "trending unavailable" };
  }
});

// ---- IPC: taskbar pet ----
ipcMain.handle("pilly:pet:toggle", () => {
  if (petActive) stopPet();
  else startPet();
  return { active: petActive };
});
ipcMain.handle("pilly:pet:settings", () => petOpts());
ipcMain.handle("pilly:pet:apply", (event, pet) => {
  const p = Object.assign({}, petOpts(), pet || {});
  // Persist immediately (not only on "Save") so the pet choices survive a
  // restart - AND so the walking logic (which reads petOpts() live) switches
  // to whole-monitor mode / new stop frequency right away.
  try {
    const s = SETTINGS.effective(userDataDir());
    SETTINGS.save(userDataDir(), Object.assign({}, s, { pet: p }));
  } catch (e) { /* ignore */ }
  if (petWin && !petWin.isDestroyed()) petWin.webContents.send("pet:settings", p);
  if (bubbleWin && !bubbleWin.isDestroyed()) bubbleWin.webContents.send("pet:settings", p);
  return { ok: true };
});
// While walking across the monitor, the user can grab Pilly and drag it.
ipcMain.on("pet:drag", (event, payload) => {
  if (!petWin || petWin.isDestroyed()) return;
  const mode = payload && payload.mode;
  if (mode === "start") {
    petDragging = true;
    petTarget = null;
    petState = "pause";
    petLastState = "pause";
  } else if (mode === "end") {
    petDragging = false;
    petState = "pause";
    petStateEnd = Date.now() + pauseMs();
  } else if (mode === "move" && petDragging) {
    const dx = Number(payload.dx) || 0;
    const dy = Number(payload.dy) || 0;
    if (!dx && !dy) return;
    petX += dx;
    petY += dy;
    // Keep Pilly reachable even if dragged to the edge.
    const area = screen.getPrimaryDisplay().workArea;
    petX = Math.max(area.x - PET_W + 24, Math.min(petX, area.x + area.width - 24));
    petY = Math.max(area.y - 24, Math.min(petY, area.y + area.height - 24));
    petWin.setPosition(Math.round(petX), Math.round(petY));
  }
});
// Pilly complains when the user grabs and drags him around.
const DRAG_LINES = {
  start: [
    "hey! put me down!",
    "hands off!",
    "rude! i'm not a cursor.",
    "carrying me around??",
    "i'm not a toy!",
    "do i look like a mouse?",
  ],
  end: [
    "fine. but i'm watching you.",
    "finally.",
    "my back hurts now.",
    "we'll talk about this later.",
    "don't do that again.",
  ],
};
ipcMain.on("pet:react", (event, kind) => {
  if (!petActive) return;
  const lines = kind === "end" ? DRAG_LINES.end : DRAG_LINES.start;
  const line = lines[Math.floor(Math.random() * lines.length)];
  setBubbleClickable(false);
  const b = ensureBubbleWin();
  b.webContents.send("pet:joke", "😤 " + line);
  positionBubble();
  b.showInactive();
  if (bubbleTimer) clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => {
    if (bubbleWin && !bubbleWin.isDestroyed()) bubbleWin.hide();
  }, 3500);
});
ipcMain.handle("pilly:open-chat", () => {
  toggleWindow();
  return { ok: true };
});
ipcMain.handle("pilly:github", () => {
  shell.openExternal("https://github.com/PillCrew/PillCrew");
  return { ok: true };
});
ipcMain.handle("pilly:version", () => app.getVersion());
ipcMain.handle("pilly:quit", () => {
  isQuitting = true;
  app.quit();
  return { ok: true };
});

app.whenReady().then(() => {
  app.setAppUserModelId("fun.pillcrew.pilly");
  iconFrames = loadFrames();
  createWindow();
  createTray();
  globalShortcut.register("CommandOrControl+Shift+P", () => toggleWindow());
});

app.on("window-all-closed", () => { /* stay alive in the tray */ });
app.on("before-quit", () => { isQuitting = true; stopPet(); });
