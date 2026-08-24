// Pilly - a tiny green pill AI friend that lives in your Windows taskbar.
// Click the pill in the system tray to summon the chat (free AI, meme brain).
const {
  app, Tray, Menu, BrowserWindow, nativeImage, ipcMain, globalShortcut, screen,
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
    useSiteFallback: s.useSiteFallback,
  };
}

let tray = null;
let win = null;
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

function startTrayAnim() {
  if (trayTimer || iconFrames.length < 2) return;
  trayTimer = setInterval(() => {
    trayFrame = (trayFrame + 1) % iconFrames.length;
    if (tray && !isQuitting) tray.setImage(iconFrames[trayFrame]);
  }, 450);
}

function createTray() {
  iconFrames = loadFrames();
  tray = new Tray(iconFrames[0] || nativeImage.createEmpty());
  tray.setToolTip("Pilly - tap to chat");

  const menu = Menu.buildFromTemplate([
    { label: "💬 Open chat", click: () => toggleWindow() },
    {
      label: "🎭 Meme mode",
      click: () => {
        const w = ensureWindow();
        if (w && !w.isDestroyed()) w.webContents.send("pilly:suggest", "meme");
        toggleWindow();
      },
    },
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

// ---- IPC: settings (own AI API) ----
ipcMain.handle("pilly:settings:get", () => SETTINGS.effective(userDataDir()));
ipcMain.handle("pilly:settings:save", (event, s) => SETTINGS.save(userDataDir(), s));
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
ipcMain.handle("pilly:trending", async () => {
  try {
    return await COINS.fetchTrendingTop(8);
  } catch (e) {
    return { list: [], context: "trending unavailable" };
  }
});

app.whenReady().then(() => {
  app.setAppUserModelId("fun.pillcrew.pilly");
  createWindow();
  createTray();
  globalShortcut.register("CommandOrControl+Shift+P", () => toggleWindow());
});

app.on("window-all-closed", () => { /* stay alive in the tray */ });
app.on("before-quit", () => { isQuitting = true; });
