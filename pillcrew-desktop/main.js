// Pilly - a tiny green pill AI friend that lives in your Windows taskbar.
// Click the pill in the system tray to summon the chat (free AI, meme brain).
const {
  app, Tray, Menu, BrowserWindow, nativeImage, ipcMain, globalShortcut, screen, shell, Notification, clipboard,
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
const WATCH = require("./src/watchlist");
const PNL = require("./src/pnl");
const PICKS = require("./src/picks");
const WHALES = require("./src/whales");

const SOL_MINT = "So11111111111111111111111111111111111111112";

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

// ---- Etap 5: Pilly's memory & stats (persisted in userData) ----
let STATS = null;
function statsPath() { return path.join(userDataDir(), "pilly-stats.json"); }
function loadStats() {
  if (STATS) return STATS;
  try {
    if (fs.existsSync(statsPath())) STATS = JSON.parse(fs.readFileSync(statsPath(), "utf8"));
  } catch (e) { /* ignore */ }
  if (!STATS || typeof STATS !== "object") {
    STATS = { firstSeen: Date.now(), lastSeen: Date.now(), jokes: 0, questions: 0, spooks: 0, drags: 0, poops: 0, alerts: 0, chats: 0, coins: 0, wallets: 0, trends: 0, happy: 0, sad: 0 };
  }
  STATS.lastSeen = Date.now();
  STATS.days = Math.max(1, Math.ceil((Date.now() - STATS.firstSeen) / 86400000));
  try { fs.writeFileSync(statsPath(), JSON.stringify(STATS)); } catch (e) { /* ignore */ }
  return STATS;
}
function bumpStat(key, n) {
  const s = loadStats();
  s[key] = (s[key] || 0) + (n || 1);
  try { fs.writeFileSync(statsPath(), JSON.stringify(s)); } catch (e) { /* ignore */ }
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
let petStateStart = 0;
let petLastState = "";
let petY = 0;
let petTarget = null;
let petDragging = false;
let petCursorPrev = { x: 0, y: 0, t: 0 };
let petSpookCooldownUntil = 0;
let marketAlertTimer = null;
let pillyPickTimer = null;
let sniperTimer = null;
let whaleTimer = null;
let portfolioMoodTimer = null;
let dailyBriefDone = false; // once per session
let pendingHotCoin = null; // { mint, symbol, name } for the clickable hot bubble
const hotCooldown = new Map(); // mint -> last flagged time (no repeat within 30 min)
const sniperCooldown = new Map(); // mint -> last sniper-flagged time
let pillyPickNext = 0; // ms when the next "Pilly's pick" is allowed
let weatherMood = null;
let weatherNext = 0;
let cursorIdleAt = Date.now();
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
  const chatSettings = SETTINGS.effective(userDataDir()).chat || {};
  win = new BrowserWindow({
    width: 380,
    height: 580,
    minWidth: 380,
    maxWidth: 380, // chat stays narrow - it only stretches vertically
    minHeight: 360,
    maxHeight: 1200,
    show: false,
    frame: false,
    resizable: true,
    alwaysOnTop: chatSettings.alwaysOnTop !== false,
    skipTaskbar: true,
    icon: iconFrames[0],
    backgroundColor: "#0b0f0d",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      saveWinBounds();
      win.hide();
    }
  });
  // Remember where the user left the window (position + height).
  win.on("resize", scheduleWinSave);
  win.on("move", scheduleWinSave);
  // If the window is ever fully destroyed (e.g. during quit races), drop the
  // stale reference so the next tray click can rebuild it instead of crashing
  // with "Object has been destroyed".
  win.on("closed", () => {
    win = null;
  });
}

// ---- Window bounds memory (open where you left it, keep the height you set) ----
let winSaveTimer = null;
function scheduleWinSave() {
  if (winSaveTimer) clearTimeout(winSaveTimer);
  winSaveTimer = setTimeout(() => {
    winSaveTimer = null;
    saveWinBounds();
  }, 400);
}
function saveWinBounds() {
  try {
    if (!win || win.isDestroyed()) return;
    const b = win.getBounds();
    fs.mkdirSync(userDataDir(), { recursive: true });
    fs.writeFileSync(
      path.join(userDataDir(), "pilly-window.json"),
      JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height }),
      "utf8"
    );
  } catch (e) { /* ignore */ }
}
function loadWinBounds() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(userDataDir(), "pilly-window.json"), "utf8"));
    if (j && [j.x, j.y, j.width, j.height].every((v) => Number.isFinite(v))) return j;
  } catch (e) { /* ignore */ }
  return null;
}

// Return the live window, recreating it if it was closed/destroyed.
function ensureWindow() {
  if (win && !win.isDestroyed()) return win;
  createWindow();
  return win;
}

// Position the chat window: restore where the user last left it (clamped to
// the visible work area), or above the tray icon on first run.
function positionWindow() {
  const w = ensureWindow();
  if (!w || !tray) return;
  try {
    const saved = loadWinBounds();
    if (saved) {
      const area = screen.getDisplayMatching({ x: saved.x, y: saved.y, width: saved.width, height: saved.height }).workArea;
      const x = Math.max(area.x + 4, Math.min(saved.x, area.x + area.width - saved.width - 4));
      const y = Math.max(area.y + 4, Math.min(saved.y, area.y + area.height - saved.height - 4));
      const h = Math.max(360, Math.min(saved.height, area.height - 24));
      w.setBounds({ x: Math.round(x), y: Math.round(y), width: 380, height: Math.round(h) });
      return;
    }
  } catch (e) { /* ignore */ }
  // First run (or after "Reset window position"): sit above the tray icon.
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

// Forget the remembered bounds so the next show snaps back above the tray.
function resetWindowPosition() {
  try { fs.rmSync(path.join(userDataDir(), "pilly-window.json"), { force: true }); } catch (e) { /* ignore */ }
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
      sandbox: true,
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
  petStateStart = Date.now();
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
      petStateStart = now;
    }
    // Long pause -> Pilly dozes off (sleep state with zzz). At night - or
    // when the mouse has been idle for minutes - he nods off much sooner.
    const nightNow = isNight();
    const idleLong = now - cursorIdleAt > 240000;
    if (!petDragging && petState === "pause" && now - petStateStart > (nightNow || idleLong ? 5500 : 12000)) {
      petState = "sleep";
      petStateEnd = now + (nightNow ? 13000 : 9000) + Math.random() * 9000;
      petStateStart = now;
    }
    // Screen mode: Pilly plays cat-and-mouse with the cursor. A FAST poke
    // spooks him (jump + "!" + a short scared dash), then he stops and lets
    // you click him. A cooldown + speed check means slowly hovering over him
    // to open the chat never triggers it.
    if (!petDragging && petOpts().walkMode === "screen" && petState !== "sleep") {
      const c = screen.getCursorScreenPoint();
      const dtC = now - petCursorPrev.t;
      let cSpeed = 0;
      if (petCursorPrev.t && dtC > 0) cSpeed = Math.hypot(c.x - petCursorPrev.x, c.y - petCursorPrev.y) / dtC;
      const d = Math.hypot(c.x - (petX + PET_W / 2), c.y - (petY + PET_H - 20));
      if (d < 46 && cSpeed > 0.5 && now > petSpookCooldownUntil) {
        petState = "flee";
        petStateStart = now;
        petStateEnd = now + 800;
        petSpookCooldownUntil = now + 4000;
        bumpStat("spooks");
        petWin.webContents.send("pet:spook", now);
        pickFleeTarget(c, 90);
      }
    }
    if (petState === "walk" || petState === "flee") {
      // Pick a new target when there isn't one (taskbar mode = along the
      // taskbar line, screen mode = anywhere on the monitor).
      if (!petTarget) petTarget = petState === "flee" ? { x: petX, y: petY - 20 } : pickPetTarget(area);
      const dx = petTarget.x - petX;
      const dy = petTarget.y - petY;
      const dist = Math.hypot(dx, dy);
      if (dist < 2 || (petState === "flee" && now >= petStateEnd)) {
        // Reached the target (or done fleeing) - stop and think for a bit
        // instead of turning around and marching corner to corner.
        petTarget = null;
        petState = "pause";
        petStateEnd = now + pauseMs();
      } else {
        const base = petOpts().walkMode === "screen" ? 2.4 : 2;
        const sp = petState === "flee" ? 3.6 : nightNow ? base * 0.65 : base;
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
    // Track how long the mouse has been still (ambient sleep logic).
    if (Math.abs(cur.x - petCursorPrev.x) + Math.abs(cur.y - petCursorPrev.y) > 3) cursorIdleAt = now;
    petCursorPrev = { x: cur.x, y: cur.y, t: now };
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
  // Etap 4: proactive market alerts + ambient (morning greeting, weather).
  scheduleMarketAlert();
  // v1.1.0: daily brief (SOL + your PnL) once per session.
  if (petOpts().dailyBrief !== false && !dailyBriefDone) {
    setTimeout(() => { if (petActive) dailyBrief(); }, 25000);
  }
  // v1.1.0: Pilly's AI pick of the day (first after ~2 min, then every 6h).
  schedulePillyPick();
  // v1.2.0: Sniper mode - watches for coins that JUST launched.
  scheduleSniper();
  // v1.2.0: Whale follow - alerts when a followed whale opens a new position.
  scheduleWhalePoll();
  // v1.2.0: Portfolio mood - Pilly reacts to YOUR bags.
  schedulePortfolioMood();
  const h = new Date().getHours();
  if (h >= 5 && h < 11) {
    setTimeout(() => {
      if (!petActive || !petOpts().bubbles) return;
      showPetJoke(`☕ gm anon. ${(petOpts().name || "Pilly")} ready for some pumps?`);
      sendPetMarket({ kind: "up", name: "morning" });
    }, 12000);
  }
  weatherNext = Date.now() + 90000;
  setTimeout(() => { if (petActive) weatherTick(); }, 90000);
}

function stopPet() {
  petActive = false;
  if (petTimer) { clearInterval(petTimer); petTimer = null; }
  if (petJokeTimer) { clearInterval(petJokeTimer); petJokeTimer = null; }
  if (petQuestionTimer) { clearTimeout(petQuestionTimer); petQuestionTimer = null; }
  if (poopTimer) { clearTimeout(poopTimer); poopTimer = null; }
  if (marketAlertTimer) { clearTimeout(marketAlertTimer); marketAlertTimer = null; }
  if (pillyPickTimer) { clearTimeout(pillyPickTimer); pillyPickTimer = null; }
  if (sniperTimer) { clearTimeout(sniperTimer); sniperTimer = null; }
  if (whaleTimer) { clearTimeout(whaleTimer); whaleTimer = null; }
  if (portfolioMoodTimer) { clearTimeout(portfolioMoodTimer); portfolioMoodTimer = null; }
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
// The very first bubble of a session used to lose its text: the window is
// created lazily and the pet:joke was sent before bubble.html finished loading.
// Queue the text here and deliver it on did-finish-load.
let bubbleReady = false;
let bubblePendingJoke = null;

function sendBubbleJoke(text) {
  if (!bubbleWin || bubbleWin.isDestroyed()) return;
  if (bubbleReady) bubbleWin.webContents.send("pet:joke", text);
  else bubblePendingJoke = text;
}

function ensureBubbleWin() {
  if (bubbleWin && !bubbleWin.isDestroyed()) return bubbleWin;
  bubbleWin = new BrowserWindow({
    width: 190,
    height: 160,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    // MUST be resizable:true - Windows freezes a non-resizable window to its
    // last size (min=max=current), so the auto-shrink of the bubble would never
    // work. It's frameless, transparent and click-through, so the user can't
    // resize it anyway.
    resizable: true,
    focusable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  bubbleWin.setAlwaysOnTop(true, "screen-saver");
  bubbleWin.setIgnoreMouseEvents(true, { forward: true });
  bubbleReady = false;
  bubbleWin.loadFile(path.join(__dirname, "renderer", "bubble.html"));
  bubbleWin.webContents.on("did-finish-load", () => {
    bubbleReady = true;
    if (bubblePendingJoke) {
      const t = bubblePendingJoke;
      bubblePendingJoke = null;
      if (bubbleWin && !bubbleWin.isDestroyed()) bubbleWin.webContents.send("pet:joke", t);
    }
  });
  bubbleWin.on("closed", () => { bubbleReady = false; bubbleWin = null; });
  return bubbleWin;
}

function positionBubble() {
  if (!bubbleWin || bubbleWin.isDestroyed() || !petWin || petWin.isDestroyed()) return;
  const [px, py] = petWin.getPosition();
  const pet = petOpts();
  const ps = pet.size === "sm" ? 0.85 : pet.size === "lg" ? 1.2 : 1;
  // Pill top within the PET_H-tall pet window (pill is 23px tall, 11px from the bottom).
  const pillTop = PET_H - 11 - 23 * ps;
  // The bubble sits 14px above the window's bottom edge. Use the CURRENT
  // window height (it auto-grows to fit the text) so the bubble stays glued
  // ~12px above the pill top no matter how tall the window became.
  const [, bh] = bubbleWin.getSize();
  const area = screen.getDisplayNearestPoint({ x: px, y: py }).workArea;
  let y = py + pillTop - 12 - (bh - 14);
  // NEVER let the bubble window leave the screen: a tall bubble next to a pet
  // near the top of the monitor used to get its TOP clipped by the screen edge.
  y = Math.max(area.y, Math.min(y, area.y + area.height - bh));
  bubbleWin.setPosition(Math.round(px - 65), Math.round(y));
}

// The bubble content measures itself and asks for a taller/shorter window so
// text is never clipped. Bottom edge stays anchored (tail still points at the
// pill); positionBubble() then places it correctly for any height.
ipcMain.on("bubble:resize", (event, h) => {
  if (!bubbleWin || bubbleWin.isDestroyed()) return;
  const hh = Math.max(160, Math.min(340, Math.round(Number(h) || 160)));
  const [x, y] = bubbleWin.getPosition();
  const [, oldH] = bubbleWin.getSize();
  if (hh === oldH) return;
  bubbleWin.setSize(190, hh);
  let ny = y + oldH - hh; // keep the bottom edge fixed
  const area = screen.getDisplayNearestPoint({ x, y }).workArea;
  ny = Math.max(area.y, Math.min(ny, area.y + area.height - hh));
  bubbleWin.setPosition(x, ny);
});

function showPetJoke(text) {
  if (!petActive) return;
  setBubbleClickable(false);
  const b = ensureBubbleWin();
  sendBubbleJoke(text);
  positionBubble();
  b.showInactive();
  sendPetTalking(true);
  if (bubbleTimer) clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => {
    if (bubbleWin && !bubbleWin.isDestroyed()) bubbleWin.hide();
    sendPetTalking(false);
  }, 9000);
}

function localPetJoke() {
  return PET_JOKES[Math.floor(Math.random() * PET_JOKES.length)];
}

// Pilly is a creature of habit: late night hours make him sleepy, daytime peppy.
function isNight() {
  const h = new Date().getHours();
  return h >= 22 || h < 7;
}

// How long Pilly pauses depends on the "stopping" setting.
function pauseMs() {
  const f = petOpts().stopFreq || "normal";
  if (f === "often") return 2600 + Math.random() * 3600;
  if (f === "rare") return 700 + Math.random() * 900;
  return 1400 + Math.random() * 2200;
}

// Decide what Pilly does next: pause in place, do a little hop, dance, or walk.
// "often" stopping makes Pilly hang out instead of marching corner to corner.
// At night Pilly gets lazier - pauses more, moves less.
function randomPetState() {
  const f = petOpts().stopFreq || "normal";
  const night = isNight();
  let pauseP = f === "often" ? 0.5 : f === "rare" ? 0.15 : 0.3;
  if (night) pauseP = Math.min(0.8, pauseP + 0.25);
  const r = Math.random();
  if (r < pauseP) return { mode: "pause", ms: pauseMs() };
  if (r < pauseP + 0.16) return { mode: "hop", ms: (night ? 700 : 900) + Math.random() * 600 };
  if (r < pauseP + 0.2) return { mode: "dance", ms: (night ? 2200 : 4000) + Math.random() * 3000 };
  return { mode: "walk", ms: (night ? 1800 : 2500) + Math.random() * 4000 };
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

// Where Pilly dashes when the cursor pokes him - a short hop always away
// from the cursor, so he stays clickable afterwards.
function pickFleeTarget(c, dist) {
  const area = screen.getPrimaryDisplay().workArea;
  const ang = Math.atan2((petY + PET_H - 20) - c.y, (petX + PET_W / 2) - c.x);
  petTarget = {
    x: Math.max(area.x, Math.min(petX + Math.cos(ang) * dist, area.x + area.width - PET_W)),
    y: Math.max(area.y, Math.min(petY + Math.sin(ang) * dist * 0.75, area.y + area.height - PET_H)),
  };
}

async function petJokeTick() {
  if (!petActive || !petOpts().bubbles) return;
  let joke = localPetJoke();
  // Etap 5: sometimes Pilly shares a little fact from his memory instead.
  if (Math.random() < 0.18) {
    const s = loadStats();
    const facts = [
      `day ${s.days} together. i've told ${s.jokes} jokes and survived ${s.spooks} cursor scares.`,
      `little stat: ${s.coins} coins checked, ${s.happy} good moods, ${s.sad} sad ones.`,
      `we've been at this for ${s.days} day${s.days === 1 ? "" : "s"}. my jokes are still free.`,
    ];
    joke = facts[(Math.random() * facts.length) | 0];
  } else {
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
  }
  if (petActive) {
    showPetJoke(joke);
    bumpStat("jokes");
  }
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

// Tell the pet renderer whether Pilly is "speaking" so his mouth animates.
function sendPetTalking(on) {
  if (petWin && !petWin.isDestroyed()) petWin.webContents.send("pet:talking", !!on);
}

// Etap 2: Pilly reacts to live market data - green = happy, red = sad.
function sendPetMarket(m) {
  if (petActive && petWin && !petWin.isDestroyed()) {
    petWin.webContents.send("pet:market", m || { kind: "flat" });
  }
}

// Play one of Pilly's WebAudio sounds (hop/spook/coin/alert...) in the pet.
function playPetSound(type) {
  try {
    if (petActive && petWin && !petWin.isDestroyed()) {
      petWin.webContents.send("pet:play", type || "coin");
    }
  } catch (e) { /* ignore */ }
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
  bumpStat("questions");
  const w = ensureWindow();
  if (w && !w.isDestroyed()) w.webContents.send("pilly:question", q);
}

// Show the question in the bubble (clickable - opens the chat) and hide it
// after a while.
function showPetQuestion(text) {
  if (!petActive) return;
  const b = ensureBubbleWin();
  sendBubbleJoke("🤔 " + text);
  positionBubble();
  b.showInactive();
  setBubbleClickable(true);
  sendPetTalking(true);
  if (bubbleTimer) clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => {
    if (bubbleWin && !bubbleWin.isDestroyed()) {
      bubbleWin.hide();
      setBubbleClickable(false);
    }
    sendPetTalking(false);
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
        sandbox: true,
      },
    });
    poop.setAlwaysOnTop(true, "screen-saver");
    poop.setIgnoreMouseEvents(true, { forward: true });
    poop.loadFile(path.join(__dirname, "renderer", "poop.html"));
    // Drop it right under Pilly's feet; it stays put and fades on its own.
    poop.setPosition(Math.round(petX + PET_W / 2 - POOP_W / 2), Math.round(petY + PET_H - POOP_H - 3));
    poop.showInactive();
    bumpStat("poops");
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

// ---- Etap 4: proactive market alerts - Pilly watches trending and shouts
// when something really moves (pure data, no AI round-trip). ----
function scheduleMarketAlert() {
  if (!petActive || !petOpts().bubbles) return;
  const delay = 300000 + Math.floor(Math.random() * 240000); // 5-9 min
  marketAlertTimer = setTimeout(() => {
    if (!petActive || !petOpts().bubbles) return;
    marketAlertTick();
    scheduleMarketAlert();
  }, delay);
}
async function marketAlertTick() {
  try {
    const data = await COINS.fetchTrendingTop(30);
    if (!data || !Array.isArray(data.list) || !data.list.length) return;
    const pet = petOpts();
    const now = Date.now();
    // Prune the 30-min hot-coin cooldown map so it can't grow forever.
    if (hotCooldown.size > 200) {
      for (const [m, t] of hotCooldown) if (now - t > 30 * 60000) hotCooldown.delete(m);
    }
    // HOT RADAR (v1.1.0): fresh 5m movers are the freshest signal - flag the
    // hottest coin with a CLICKABLE bubble that opens the chat pre-loaded.
    // Gated by the "Hot coin radar" setting (pet.hotAlerts).
    if (pet.hotAlerts !== false) {
      const hotPct = Number(pet.hotPct) || 10;
      const withM5 = data.list.filter(
        (c) => c.change5m != null && isFinite(c.change5m) && c.mcap != null && c.mcap > 3000
      );
      let hot = null;
      for (const c of withM5) {
        if (c.change5m >= hotPct && now - (hotCooldown.get(c.mint) || 0) > 30 * 60000) {
          if (!hot || c.change5m > hot.change5m) hot = c;
        }
      }
      if (hot) {
        hotCooldown.set(hot.mint, now);
        pendingHotCoin = { mint: hot.mint, symbol: hot.symbol, name: hot.name };
        bumpStat("hotpicks");
        PICKS.record(userDataDir(), { mint: hot.mint, symbol: hot.symbol, name: hot.name, price: hot.price, source: "hot" });
        showHotCoin(`🚀 ${hot.symbol || hot.name} +${hot.change5m.toFixed(0)}% in 5m. tap me for the details.`, hot);
        sendPetMarket({ kind: "up", name: hot.symbol || hot.name });
        return;
      }
    }
    // Fallback: 24h extremes (existing behavior).
    const withChg = data.list.filter((c) => c.change24h != null && isFinite(c.change24h));
    if (!withChg.length) return;
    const gainer = withChg.reduce((a, b) => (b.change24h > a.change24h ? b : a));
    const loser = withChg.reduce((a, b) => (b.change24h < a.change24h ? b : a));
    if (gainer.change24h >= 18) {
      const pct = `${gainer.change24h >= 0 ? "+" : ""}${gainer.change24h.toFixed(0)}%`;
      bumpStat("alerts");
      showPetJoke(`🚀 ${gainer.name} ${pct}! ${Math.random() < 0.5 ? "incoming pump?" : "calling it now."}`);
      sendPetMarket({ kind: "up", name: gainer.name });
    } else if (loser.change24h <= -18) {
      const pct = `${loser.change24h.toFixed(0)}%`;
      bumpStat("alerts");
      showPetJoke(`☠️ ${loser.name} ${pct}... that's rough.`);
      sendPetMarket({ kind: "down", name: loser.name });
    }
  } catch (e) { /* ignore */ }
}

// Clickable bubble for hot coins / Pilly's pick - opens the chat pre-loaded.
function showHotCoin(text) {
  if (!petActive) return;
  const b = ensureBubbleWin();
  sendBubbleJoke(text);
  positionBubble();
  b.showInactive();
  setBubbleClickable(true);
  sendPetTalking(true);
  playPetSound("coin");
  if (bubbleTimer) clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => {
    if (bubbleWin && !bubbleWin.isDestroyed()) {
      bubbleWin.hide();
      setBubbleClickable(false);
    }
    sendPetTalking(false);
  }, 12000);
}

// v1.1.0: morning brief - SOL price + average PnL across your tracked positions.
async function dailyBrief() {
  if (!petActive || petOpts().dailyBrief === false) return;
  dailyBriefDone = true;
  try {
    const sol = await COINS.fetchSolPrice();
    const entries = PNL.all(userDataDir());
    const mints = Object.keys(entries).filter((m) => entries[m] > 0);
    let pnlText = "";
    if (mints.length) {
      const prices = await COINS.fetchPrices(mints);
      const rows = mints
        .map((m) => {
          const p = prices[m];
          return p && p.price ? ((p.price / entries[m]) - 1) * 100 : null;
        })
        .filter((v) => v != null && isFinite(v));
      if (rows.length) {
        const avg = rows.reduce((s, v) => s + v, 0) / rows.length;
        pnlText = ` · ${rows.length} position${rows.length > 1 ? "s" : ""} ${avg >= 0 ? "+" : ""}${avg.toFixed(1)}% avg`;
      }
    }
    const solTxt = sol && sol.price ? `SOL ${fmtCompact(sol.price)}${sol.change24h != null ? ` (${sol.change24h >= 0 ? "+" : ""}${sol.change24h.toFixed(1)}%)` : ""}` : "";
    if (petActive && petOpts().bubbles) {
      showPetJoke(`📊 ${solTxt}${pnlText}. ${Math.random() < 0.5 ? "the tape's alive." : "check your bags."}`);
      sendPetMarket({ kind: "up", name: "brief" });
    }
  } catch (e) { /* ignore */ }
}

// v1.1.0: Pilly's AI pick of the day - asks the model for the best setup from
// the trending list, then shows a clickable bubble with that coin loaded.
const PILLY_PICK_INTERVAL = 6 * 3600 * 1000;
function schedulePillyPick() {
  if (!petActive || petOpts().pillyPick === false) return;
  const now = Date.now();
  const delay = pillyPickNext > now ? pillyPickNext - now : 120000 + Math.random() * 60000;
  pillyPickTimer = setTimeout(() => {
    if (!petActive || petOpts().pillyPick === false) return;
    pillyPickTick();
    pillyPickNext = Date.now() + PILLY_PICK_INTERVAL;
    schedulePillyPick();
  }, delay);
}
async function pillyPickTick() {
  try {
    const data = await COINS.fetchTrendingTop(10);
    if (!data || !data.context) return;
    const r = await AI.respond(
      `You're Pilly. From this trending list, pick ONE coin with the best setup right now. Reply with ONLY: SYMBOL - one-line why (under 12 words).\n${data.context}`,
      { task: "", ai: aiOpts() }
    );
    if (!r || !r.reply) return;
    const m = String(r.reply).match(/\b([A-Za-z0-9$._-]{1,12})\b/);
    if (!m) return;
    const sym = m[1].replace(/[^A-Za-z0-9$._-]/g, "").toUpperCase();
    const coin = data.list.find((c) => (c.symbol || "").toUpperCase() === sym);
    if (!coin || !coin.mint) return;
    pendingHotCoin = { mint: coin.mint, symbol: coin.symbol, name: coin.name };
    bumpStat("pillypick");
    PICKS.record(userDataDir(), { mint: coin.mint, symbol: coin.symbol, name: coin.name, price: coin.price, source: "pick" });
    showHotCoin(`🎯 my pick: ${coin.symbol}${coin.change24h != null ? ` (${coin.change24h >= 0 ? "+" : ""}${coin.change24h.toFixed(0)}% 24h)` : ""}. tap me for the details.`);
  } catch (e) { /* ignore */ }
}

// v1.2.0: Sniper mode - pump.fun coins that JUST launched (younger than a few
// minutes) get a clickable "JUST LAUNCHED" bubble so the user can snipe the
// entry before the pack. Gated by the pet.sniper setting.
const SNIPER_MAX_AGE = 3 * 60000; // launch window: younger than 3 min
const SNIPER_MIN_MCAP = 5000; // ignore dust launches
function scheduleSniper() {
  if (!petActive || petOpts().sniper === false) return;
  sniperTimer = setTimeout(() => {
    if (!petActive || petOpts().sniper === false) return;
    sniperTick();
    scheduleSniper();
  }, 60000 + Math.random() * 60000); // first scan after 60-120s, then every 2 min
}
async function sniperTick() {
  try {
    const data = await COINS.fetchNewCoins(12);
    const list = Array.isArray(data && data.list) ? data.list : [];
    const now = Date.now();
    // Prune the sniper cooldown map so it can't grow forever.
    if (sniperCooldown.size > 200) {
      for (const [m, t] of sniperCooldown) if (now - t > 30 * 60000) sniperCooldown.delete(m);
    }
    const fresh = list
      .filter(
        (c) =>
          c.createdAt != null &&
          now - c.createdAt <= SNIPER_MAX_AGE &&
          c.mcap != null &&
          c.mcap > SNIPER_MIN_MCAP
      )
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const target = fresh.find((c) => !sniperCooldown.has(c.mint));
    if (!target || !target.mint) return;
    sniperCooldown.set(target.mint, now);
    pendingHotCoin = { mint: target.mint, symbol: target.symbol, name: target.name };
    bumpStat("hotpicks");
    PICKS.record(userDataDir(), {
      mint: target.mint,
      symbol: target.symbol,
      name: target.name,
      price: target.price,
      source: "sniper",
    });
    showHotCoin(
      `🔫 JUST LAUNCHED: ${target.symbol || target.name}${target.mcap != null ? ` · mcap ${fmtCompact(target.mcap)}` : ""} - tap to snipe it.`
    );
  } catch (e) { /* ignore */ }
}

// v1.2.0: Whale follow - diff each followed wallet's holdings and pop a
// clickable bubble when a whale opens a brand-new position.
function scheduleWhalePoll() {
  if (!petActive || petOpts().whaleAlerts === false) return;
  whaleTimer = setTimeout(() => {
    if (!petActive || petOpts().whaleAlerts === false) return;
    whalePoll();
    scheduleWhalePoll();
  }, 150000 + Math.random() * 90000); // first after 2.5-4 min, then every 4 min
}
async function whalePoll() {
  const whales = WHALES.list(userDataDir());
  if (!whales.length || petOpts().whaleAlerts === false) return;
  for (const w of whales) {
    try {
      const data = await COINS.fetchWalletPortfolio(w.address);
      if (!data || !data.ok) continue;
      const mints = (data.tokens || []).map((t) => t.mint).filter(Boolean);
      const res = WHALES.snapshot(userDataDir(), w.address, mints);
      if (!res || !res.ok || !res.fresh.length) continue;
      for (const mint of res.fresh.slice(0, 2)) {
        const t = (data.tokens || []).find((x) => x.mint === mint);
        if (!t || !t.name) continue;
        pendingHotCoin = { mint, symbol: t.symbol, name: t.name };
        bumpStat("hotpicks");
        PICKS.record(userDataDir(), {
          mint,
          symbol: t.symbol,
          name: t.name,
          price: t.price != null ? t.price : null,
          source: "whale",
        });
        showHotCoin(`🐋 ${w.label || "whale"} just bought ${t.symbol || t.name} - tap to check it out.`);
      }
    } catch (e) { /* ignore */ }
  }
}

// v1.2.0: Portfolio mood - aggregate PnL% across your tracked positions and
// make the pet genuinely react to YOUR bags (green = confetti, red = tears).
function schedulePortfolioMood() {
  if (!petActive || petOpts().portfolioMood === false) return;
  portfolioMoodTimer = setTimeout(() => {
    if (!petActive || petOpts().portfolioMood === false) return;
    portfolioMoodTick();
    schedulePortfolioMood();
  }, 240000 + Math.random() * 120000); // first after 4-6 min, then every ~8 min
}
async function portfolioMoodTick() {
  try {
    const entries = PNL.all(userDataDir());
    const mints = Object.keys(entries || {}).filter((m) => m && Number(entries[m]) > 0);
    if (!mints.length) return;
    const prices = await COINS.fetchPrices(mints);
    let sum = 0;
    let n = 0;
    for (const m of mints) {
      const raw = prices && prices[m];
      const cur = raw != null ? (typeof raw === "object" ? raw.price : Number(raw)) : null;
      if (cur != null && isFinite(cur) && cur > 0) {
        sum += ((cur - Number(entries[m])) / Number(entries[m])) * 100;
        n++;
      }
    }
    if (!n) return;
    const avg = sum / n;
    if (!petActive || petOpts().portfolioMood === false) return;
    if (avg >= 5) {
      sendPetMarket({ kind: "up", name: "your bags" });
      if (petOpts().bubbles && Math.random() < 0.5) {
        showPetJoke(`💚 your bags are up ${avg.toFixed(1)}% avg. keep it up, anon.`);
      }
    } else if (avg <= -5) {
      sendPetMarket({ kind: "down", name: "your bags" });
      if (petOpts().bubbles && Math.random() < 0.5) {
        showPetJoke(`💔 your bags are down ${avg.toFixed(1)}% avg... we go again.`);
      }
    }
  } catch (e) { /* ignore */ }
}

// ---- Etap 4: ambient weather mood (free wttr.in, IP-based, no key) ----
async function refreshWeather() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch("https://wttr.in/?format=j1", { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return;
    const j = await res.json();
    const cc = j && j.current_condition && j.current_condition[0];
    const desc = String((cc && cc.weatherDesc && cc.weatherDesc[0] && cc.weatherDesc[0].value) || "").toLowerCase();
    weatherMood = /rain|drizzle|storm|thunder|snow|sleet|shower/.test(desc) ? "wet"
      : /clear|sunny/.test(desc) ? "sunny" : null;
  } catch (e) { /* ignore */ }
}
async function weatherTick() {
  if (!petActive) return;
  if (Date.now() < weatherNext) return;
  weatherNext = Date.now() + 45 * 60 * 1000;
  await refreshWeather();
  if (weatherMood && Math.random() < 0.35) {
    setTimeout(() => {
      if (!petActive || !petOpts().bubbles) return;
      if (weatherMood === "wet") {
        showPetJoke("☔ it's raining out there... my mood matches.");
        sendPetMarket({ kind: "down", name: "weather" });
      } else if (weatherMood === "sunny") {
        showPetJoke("☀️ sunny vibes today. green candles incoming.");
        sendPetMarket({ kind: "up", name: "weather" });
      }
    }, 1500);
  }
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
    { label: "Reset window position", click: () => resetWindowPosition() },
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

// ---- Watchlist + price alerts + live tray tooltip (v1.0.5) ----
let watchTimer = null;
let trayInfoTimer = null;
const alertCooldown = new Map(); // mint -> last fire time (no spam within 6h)

function sendToChat(channel, payload) {
  try {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  } catch (e) { /* ignore */ }
}

function fmtCompact(v) {
  const n = Number(v);
  if (!isFinite(n) || n <= 0) return "-";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  if (n >= 1) return `$${n.toFixed(4)}`;
  const dec = Math.min(8, Math.max(2, Math.ceil(-Math.log10(n)) + 2));
  return `$${n.toFixed(dec)}`;
}

// One poll: prices for the watchlist, fire alerts, refresh the tray tooltip.
async function watchPoll() {
  const items = WATCH.list(userDataDir());
  const prices = await COINS.fetchPrices(items.map((i) => i.mint));
  const now = Date.now();
  // Prune the 6h alert cooldown map so it can't grow forever.
  if (alertCooldown.size > 200) {
    for (const [m, t] of alertCooldown) if (now - t > 6 * 3600000) alertCooldown.delete(m);
  }
  // Resolve Pilly's open scorecard picks against the same price batch.
  PICKS.update(userDataDir(), prices);
  let fired = 0;
  for (const it of items) {
    const p = prices[it.mint];
    if (!p || p.change24h == null) continue;
    const chg = p.change24h;
    if (it.alertPct && Math.abs(chg) >= it.alertPct) {
      const last = alertCooldown.get(it.mint) || 0;
      if (now - last > 6 * 3600000) {
        alertCooldown.set(it.mint, now);
        const sign = chg >= 0 ? "+" : "";
        try {
          if (Notification.isSupported()) {
            new Notification({
              title: `${it.symbol || it.name || "Coin"} ${sign}${chg.toFixed(1)}% (24h)`,
              body: `${it.name || it.symbol || "Watched coin"} crossed your ${it.alertPct}% alert.`,
              icon: iconFrames[0],
            }).show();
          }
          if (petOpts().alertSound !== false) playPetSound("alert");
        } catch (e) { /* ignore */ }
        bumpStat("alerts");
        fired++;
        sendToChat("pilly:watch:alert", { mint: it.mint, symbol: it.symbol, chg });
      }
    }
  }
  if (fired) sendToChat("pilly:watch:refresh", {});
  await updateTrayInfo(prices);
}

// Tray tooltip: SOL price + first watched coin (glanceable without opening chat).
async function updateTrayInfo(prices) {
  if (!tray || isQuitting) return;
  try {
    let sol = prices && prices[SOL_MINT];
    if (!sol) {
      const r = await COINS.fetchSolPrice();
      sol = r;
    }
    const items = WATCH.list(userDataDir());
    const parts = [];
    if (sol && sol.price) {
      parts.push(`SOL ${fmtCompact(sol.price)}${sol.change24h != null ? ` (${sol.change24h >= 0 ? "+" : ""}${sol.change24h.toFixed(1)}%)` : ""}`);
    }
    const w0 = items[0];
    if (w0 && prices && prices[w0.mint]) {
      const p = prices[w0.mint];
      parts.push(`${w0.symbol || w0.name || "coin"} ${fmtCompact(p.price)}${p.change24h != null ? ` (${p.change24h >= 0 ? "+" : ""}${p.change24h.toFixed(1)}%)` : ""}`);
    }
    if (items.length > 1) parts.push(`+${items.length - 1} watched`);
    tray.setToolTip(parts.length ? `Pilly · ${parts.join(" · ")}` : "Pilly - tap to chat");
  } catch (e) { /* ignore */ }
}

// ---- IPC: talk to Pilly ----
ipcMain.handle("pilly:chat", async (event, payload) => {
  const { text, task, history, coinContext, coinRead } = payload || {};
  if (!text || typeof text !== "string" || !text.trim()) return { error: "empty" };
  bumpStat("chats");
  try {
    return await AI.respond(text.trim(), {
      task: task || "",
      history: history || [],
      coinContext: coinContext || "",
      fallback: coinRead || "",
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
  // Apply window preferences immediately.
  try {
    const chat = SETTINGS.effective(userDataDir()).chat || {};
    const w = ensureWindow();
    if (w && !w.isDestroyed()) w.setAlwaysOnTop(chat.alwaysOnTop !== false);
  } catch (e) { /* ignore */ }
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
ipcMain.handle("pilly:coin", async (event, mint, silent) => {
  try {
    // Background refreshes (the 15s card tick) pass silent=true so they don't
    // spam the "coins" stat or make the taskbar pet react to every card.
    if (!silent) bumpStat("coins");
    const data = await COINS.fetchCoinContext(String(mint || "").trim());
    if (!silent && data && data.coin && data.coin.change24h != null && isFinite(data.coin.change24h)) {
      const chg = data.coin.change24h;
      sendPetMarket({ kind: chg >= 0.5 ? "up" : chg <= -0.5 ? "down" : "flat", name: data.coin.name || "" });
    }
    return data;
  } catch (e) {
    return null;
  }
});
ipcMain.handle("pilly:wallet", async (event, address) => {
  try {
    bumpStat("wallets");
    const data = await COINS.fetchWalletPortfolio(String(address || "").trim());
    if (data && data.ok && data.change24h != null && isFinite(data.change24h)) {
      const chg = data.change24h;
      sendPetMarket({ kind: chg >= 0.5 ? "up" : chg <= -0.5 ? "down" : "flat", name: "your wallet" });
    }
    return data;
  } catch (e) {
    return null;
  }
});
ipcMain.handle("pilly:trending", async () => {
  try {
    bumpStat("trends");
    const data = await COINS.fetchTrendingTop(10);
    if (data && Array.isArray(data.list)) {
      const chgs = data.list.map((c) => c.change24h).filter((c) => c != null && isFinite(c));
      if (chgs.length) {
        const avg = chgs.reduce((s, c) => s + c, 0) / chgs.length;
        sendPetMarket({ kind: avg >= 0.5 ? "up" : avg <= -0.5 ? "down" : "flat", name: "trending" });
      }
    }
    return data;
  } catch (e) {
    return { list: [], context: "trending unavailable" };
  }
});

// ---- IPC: watchlist + alerts ----
ipcMain.handle("pilly:watch:list", () => WATCH.list(userDataDir()));
ipcMain.handle("pilly:watch:add", (event, coin) => WATCH.add(userDataDir(), coin || {}));
ipcMain.handle("pilly:watch:remove", (event, mint) => WATCH.remove(userDataDir(), String(mint || "").trim()));
ipcMain.handle("pilly:watch:alert", (event, mint, pct) =>
  WATCH.setAlert(userDataDir(), String(mint || "").trim(), pct)
);
ipcMain.handle("pilly:watch:prices", async () => {
  const items = WATCH.list(userDataDir());
  const prices = await COINS.fetchPrices(items.map((i) => i.mint));
  return { items, prices };
});

// ---- IPC: PnL tracking (entry prices) ----
ipcMain.handle("pilly:pnl:get", (event, mint) => PNL.get(userDataDir(), String(mint || "").trim()));
ipcMain.handle("pilly:pnl:set", (event, mint, entry) =>
  PNL.set(userDataDir(), String(mint || "").trim(), Number(entry))
);
ipcMain.handle("pilly:pnl:remove", (event, mint) => PNL.remove(userDataDir(), String(mint || "").trim()));
ipcMain.handle("pilly:pnl:all", () => PNL.all(userDataDir()));

// ---- IPC: Pilly's scorecard (track record) + clipboard ----
ipcMain.handle("pilly:picks", () => {
  const picks = PICKS.list(userDataDir());
  const stats = PICKS.stats(userDataDir());
  const general = loadStats();
  return { picks, stats, general };
});
ipcMain.handle("pilly:clipboard", (event, text) => {
  try {
    clipboard.writeText(String(text || ""));
    return { ok: true };
  } catch (e) {
    return { ok: false };
  }
});

// ---- IPC: whale follow ----
ipcMain.handle("pilly:whales:list", () => WHALES.list(userDataDir()));
ipcMain.handle("pilly:whales:add", (event, address, label) => WHALES.add(userDataDir(), address, label));
ipcMain.handle("pilly:whales:remove", (event, address) => WHALES.remove(userDataDir(), String(address || "").trim()));
ipcMain.handle("pilly:whales:check", async () => {
  await whalePoll();
  return WHALES.list(userDataDir());
});

// ---- IPC: radar (fresh launches) + sparkline + open external ----
ipcMain.handle("pilly:radar", async () => {
  try {
    bumpStat("radar");
    return await COINS.fetchNewCoins(12);
  } catch (e) {
    return { list: [], context: "radar unavailable right now" };
  }
});
ipcMain.handle("pilly:spark", async (event, mint) => {
  try {
    return await COINS.fetchSpark(String(mint || "").trim());
  } catch (e) {
    return null;
  }
});
ipcMain.handle("pilly:openExternal", (event, url) => {
  const u = String(url || "");
  if (/^https?:\/\//i.test(u)) shell.openExternal(u);
});
ipcMain.handle("pilly:solprice", async () => {
  try {
    return await COINS.fetchSolPrice();
  } catch (e) {
    return null;
  }
});

// ---- IPC: window controls ----
ipcMain.handle("pilly:win:ontop", (event, on) => {
  try {
    const w = ensureWindow();
    if (w && !w.isDestroyed()) w.setAlwaysOnTop(!!on);
  } catch (e) { /* ignore */ }
  return !!on;
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
// Etap 3: the chat renderer tells Pilly the mood of the conversation.
ipcMain.handle("pilly:pet:mood", (event, m) => {
  const k = m && m.kind;
  if (k === "happy") bumpStat("happy");
  else if (k === "sad") bumpStat("sad");
  if (petActive && petWin && !petWin.isDestroyed()) {
    petWin.webContents.send("pet:mood", m || { kind: "flat" });
  }
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
    petStateStart = Date.now();
    petLastState = "pause";
  } else if (mode === "end") {
    petDragging = false;
    petState = "pause";
    petStateStart = Date.now();
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
  // pet.html sends "dragstart"/"dragend" - normalize so the stat and the
  // correct line set fire (drag stat stayed 0 and end-lines never showed).
  const k = kind === "dragstart" ? "start" : kind === "dragend" ? "end" : kind;
  if (k === "start") bumpStat("drags");
  const lines = k === "end" ? DRAG_LINES.end : DRAG_LINES.start;
  const line = lines[Math.floor(Math.random() * lines.length)];
  setBubbleClickable(false);
  const b = ensureBubbleWin();
  sendBubbleJoke("😤 " + line);
  positionBubble();
  b.showInactive();
  sendPetTalking(true);
  if (bubbleTimer) clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => {
    if (bubbleWin && !bubbleWin.isDestroyed()) bubbleWin.hide();
    sendPetTalking(false);
  }, 3500);
});
ipcMain.handle("pilly:open-chat", () => {
  // Bubble click must OPEN the chat - if it's already visible, leave it open
  // (toggleWindow() would HIDE it and the coin would load into a hidden window).
  const w = ensureWindow();
  if (w && !w.isVisible()) {
    positionWindow();
    w.show();
    w.focus();
  }
  // Hot-coin / pick bubbles open the chat PRE-LOADED with that coin.
  const pending = pendingHotCoin;
  if (pending && pending.mint) {
    pendingHotCoin = null;
    setTimeout(() => sendToChat("pilly:load-coin", pending), 500);
  }
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
  // Watchlist alerts poll + tray live-price tooltip.
  watchTimer = setInterval(() => { watchPoll().catch(() => {}); }, 30000);
  trayInfoTimer = setInterval(() => { updateTrayInfo(null).catch(() => {}); }, 60000);
  watchPoll().catch(() => {});
});

app.on("window-all-closed", () => { /* stay alive in the tray */ });
app.on("before-quit", () => { isQuitting = true; stopPet(); });
