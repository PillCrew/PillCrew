// Pilly - a tiny green pill AI friend that lives in your Windows taskbar.
// Click the pill in the system tray to summon the chat (free AI, meme brain).
const {
  app, Tray, Menu, BrowserWindow, nativeImage, ipcMain, globalShortcut, screen, shell, Notification, clipboard, powerMonitor, dialog, net,
} = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { macAppMenuTemplate, menuAppName } = require("./src/macmenu");
const { chatIsOpen, chatToggle } = require("./src/windowstate");
const { SPOOK_COOLDOWN_MS, CURSOR_HOLD_RESUME_MS, shouldSpook, shouldStandStill } = require("./src/petmotion");

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
const TREND = require("./src/trendcache");
const WATCH = require("./src/watchlist");
const PNL = require("./src/pnl");
const PICKS = require("./src/picks");
const WHALES = require("./src/whales");
const REMINDERS = require("./src/reminders");
const FOCUS = require("./src/focus");
const ACTIVITY = require("./src/activity");
const RPC = require("./src/rpc");
const { autoUpdater } = require("electron-updater");

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
  return (s && s.pet) || { theme: "ball", size: "md", bubbles: true, bubbleSize: "md", walkMode: "taskbar", stopFreq: "normal", questions: true };
}

// ---- v1.1.3: main-process UI language (tray menu, tooltip, notifications).
// The renderer has its own full i18n; the main process only needs the few
// strings it shows outside the chat window. ----
const MAIN_DICT = {
  en: {
    openChat: "Open chat",
    summonTaken: "Summon hotkey taken by another app",
    petOnTaskbar: "Pilly on the taskbar",
    focusMenu: "Focus",
    focusStart: "Start focus",
    focusPause: "Pause focus",
    focusResume: "Resume focus",
    focusStop: "Stop focus",
    resetWindow: "Reset window position",
    startWithWindows: "Start with Windows",
    startAtLogin: "Start at login",
    quit: "Quit Pilly",
    watched: "watched",
    focusShort: "focus",
    breakShort: "break",
    homeShort: "PILLY",
    alertCrossed: ({ pct }) => `crossed your ${pct}% alert.`,
    reminderTitle: "Pilly reminder",
    reminderPrefix: "reminder",
    updReady: "Ready.",
    updChecking: "Checking for updates…",
    updAvailableFn: (v) => `Update ${v} is available. Downloading…`,
    updLatest: "You're on the latest version.",
    updDownloadingFn: (pct) => `Downloading update… ${pct}%`,
    updDownloaded: "Update downloaded. Restart to install it.",
    updInstallFailedFn: (target) => `Update ${target} could not be installed. Download it from GitHub instead.`,
    updFailedGenericFn: (target) => `Pilly could not update to ${target}.`,
    updDetailFn: (blame) => `${blame}\n\nThe update itself was downloaded fine - only the install step failed. Download the newest installer from GitHub and run it: it is the same file the updater already fetched.`,
    updBlameWin: "Windows (Smart App Control) blocked the downloaded installer.",
    updBlameOs: "The operating system blocked the downloaded installer.",
    updTitle: "Pilly update",
    updOpenPage: "Open download page",
    updOk: "OK",
    updMacManual: "This Mac build isn't signed with a Developer ID, so it can't update itself. Grab the newest version from GitHub.",
    updDevBuild: "Updates only work in the installed app (the dev build doesn't self-update).",
    updPortable: "This is the portable build — it can't update itself. Download the newest installer from GitHub.",
    updCheckFailed: "Update check failed.",
    updNoDownloaded: "No downloaded update to install yet.",
    remParse: 'Couldn\'t understand that. Try: "remind me in 10 minutes to check SOL".',
    remPast: "That time is already in the past.",
    in24h: "(24h)",
  },
  zh: {
    openChat: "打开聊天",
    summonTaken: "召唤快捷键已被其他应用占用",
    petOnTaskbar: "让 Pilly 待在任务栏",
    focusMenu: "专注",
    focusStart: "开始专注",
    focusPause: "暂停专注",
    focusResume: "继续专注",
    focusStop: "结束专注",
    resetWindow: "重置窗口位置",
    startWithWindows: "开机自启动",
    startAtLogin: "登录时启动",
    quit: "退出 Pilly",
    watched: "个自选",
    focusShort: "专注",
    breakShort: "休息",
    homeShort: "PILLY",
    alertCrossed: ({ pct }) => `已触发你设置的 ${pct}% 提醒。`,
    reminderTitle: "Pilly 提醒",
    reminderPrefix: "提醒",
    updReady: "就绪。",
    updChecking: "正在检查更新…",
    updAvailableFn: (v) => `新版本 ${v} 可用，正在下载…`,
    updLatest: "已经是最新版本。",
    updDownloadingFn: (pct) => `正在下载更新… ${pct}%`,
    updDownloaded: "更新已下载。重启即可安装。",
    updInstallFailedFn: (target) => `更新 ${target} 无法安装。请从 GitHub 下载。`,
    updFailedGenericFn: (target) => `Pilly 无法更新到 ${target}。`,
    updDetailFn: (blame) => `更新本身下载正常——只有安装步骤失败了。请从 GitHub 下载最新安装包并运行：它和更新器下载的是同一个文件。\n\n${blame}`,
    updBlameWin: "Windows（Smart App Control）阻止了下载的安装程序。",
    updBlameOs: "操作系统阻止了下载的安装程序。",
    updTitle: "Pilly 更新",
    updOpenPage: "打开下载页",
    updOk: "好的",
    updMacManual: "这个 Mac 版本没有用 Developer ID 签名，所以无法自动更新。请从 GitHub 下载最新版本。",
    updDevBuild: "只有安装版支持自动更新（开发版不能自更新）。",
    updPortable: "这是便携版——无法自更新。请从 GitHub 下载最新安装包。",
    updCheckFailed: "检查更新失败。",
    updNoDownloaded: "还没有已下载的更新。",
    remParse: "没听懂。试试：「10 分钟后提醒我查看 SOL」。",
    remPast: "那个时间已经过去了。",
    in24h: "（24 小时）",
  },
};

// The chat window language setting also drives the bits the main process says.
function chatLang() {
  try {
    const s = SETTINGS.load(userDataDir());
    return ["zh", "en"].includes(s.chat && s.chat.language) ? s.chat.language : "auto";
  } catch (e) {
    return "auto";
  }
}

// Main-process translation lookup. "auto" renders English (Pilly still matches
// the user's language in chat replies).
function L(key, vars) {
  const lang = chatLang() === "zh" ? "zh" : "en";
  const entry = (MAIN_DICT[lang] || MAIN_DICT.en)[key];
  if (typeof entry === "function") return entry(vars || {});
  return entry != null ? entry : key;
}

// Every background tick is launched from a timer, so there is nothing left to
// catch a rejected promise - and Electron's Node only *prints* a warning for an
// unhandled rejection, which is exactly how a broken tick stays invisible for
// weeks. A few of these ticks had no guard at all, so a single network hiccup or
// a missing settings file failed silently. They all go through here now: the
// failure is named in the log and the pet carries on.
function bgTick(name, p) {
  if (!p || typeof p.catch !== "function") return;
  p.catch((e) => console.warn(`[pilly] the ${name} tick failed:`, (e && e.stack) || e));
}

// A bare timer callback runs outside any surrounding try/catch, so one throw
// inside would be an uncaught exception. Anything scheduled by hand uses this.
function safely(what, fn) {
  try { fn(); } catch (e) { console.warn(`[pilly] ${what} failed:`, (e && e.stack) || e); }
}

// shell.openExternal() hands back a promise that rejects wherever the platform has
// no registered handler for the URL (a Linux session without xdg-open, say). Called
// bare, a failed click looked like success and left an unhandled rejection in the
// log; every caller gets a plain yes/no now and can say so in the UI.
async function openExternal(url) {
  try {
    await shell.openExternal(url);
    return true;
  } catch (e) {
    console.warn("[pilly] could not open", url, "-", (e && e.message) || e);
    return false;
  }
}

// v1.1.2: Pilly is a pet, not a widget - he should still be on the taskbar after
// a restart instead of needing the pet button every single launch.
function rememberPetOn(on) {
  try {
    SETTINGS.savePet(userDataDir(), { on: !!on });
  } catch (e) { /* ignore */ }
}

// Where Pilly is standing, once the user has parked him somewhere. Debounced
// because a drag fires a move event per mouse sample.
let petPosTimer = null;
function rememberPetPos(flush) {
  if (petPosTimer) { clearTimeout(petPosTimer); petPosTimer = null; }
  const write = () => {
    try {
      SETTINGS.savePet(userDataDir(), { pos: { x: Math.round(petX), y: Math.round(petY) } });
    } catch (e) { /* ignore */ }
  };
  if (flush) write();
  else petPosTimer = setTimeout(write, 900);
}

// Which monitor is that point actually on? Multi-monitor is the norm for
// traders, and Pilly used to be hard-wired to the primary display: he could
// not be dragged onto a second screen (the clamp snapped him back) and his
// walking area was the primary workArea even when he stood elsewhere.
function workAreaFor(x, y) {
  try {
    return screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) }).workArea;
  } catch (e) {
    return screen.getPrimaryDisplay().workArea;
  }
}

// ---- Stage 5: Pilly's memory & stats (persisted in userData) ----
let STATS = null;
function statsPath() { return path.join(userDataDir(), "pilly-stats.json"); }
// Every key lives here and the file on disk is merged over these defaults. The
// loaded file used to be taken as-is, so any key added in a later build came back
// undefined for an existing user - and the little stat chatter printed it out
// ("undefined sad ones"). Adding a key is now safe on an old file, and a
// hand-edited or half-written counter is coerced back to a number.
function statsDefaults() {
  return {
    firstSeen: Date.now(), lastSeen: Date.now(), days: 1,
    jokes: 0, questions: 0, spooks: 0, drags: 0, pets: 0, poops: 0, alerts: 0,
    chats: 0, coins: 0, wallets: 0, trends: 0, happy: 0, sad: 0,
    // These six are written by later features (reminders, hot radar, Pilly's pick,
    // the focus timer, the radar). They have to be listed here or the coercion pass
    // below never sees them - and a hand-edited counter would then reach bumpStat as
    // a string, where "5" + 1 is "51" instead of 6.
    reminders: 0, hotpicks: 0, pillypick: 0, focusStarted: 0, focusDone: 0, radar: 0,
  };
}
function loadStats() {
  if (STATS) return STATS;
  let loaded = null;
  try {
    if (fs.existsSync(statsPath())) loaded = JSON.parse(fs.readFileSync(statsPath(), "utf8"));
  } catch (e) { /* a corrupt file is not worth a dialog - start over */ }
  const defaults = statsDefaults();
  STATS = Object.assign(defaults, loaded && typeof loaded === "object" ? loaded : {});
  for (const key of Object.keys(defaults)) {
    const n = Number(STATS[key]);
    STATS[key] = Number.isFinite(n) && n >= 0 ? n : defaults[key];
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
// Whether the summon shortcut could actually be claimed. Another app owning
// Ctrl/Cmd+Alt+P used to be completely invisible to the user (v1.1.2 fix).
let summonHotkeyOk = null;
let win = null;
// v1.1.2: whether the user has the chat window open, tracked so the window can be
// rebuilt in the state they left it in (see watchWindowSurvival / createWindow).
let chatWanted = false;
let petWin = null;
let petTimer = null;
let petActive = false;
// Whether pet.html has finished loading, so the renderer is listening. A greet
// sent before that is dropped on the floor by Chromium, and arming the cooldown
// for it would silence the first real greeting for a minute.
let petLoaded = false;
let petDir = 1;
let petDirSent = null; // last direction pushed to the renderer (IPC de-dup)
let petX = 0;
let petState = "walk";
let petStateEnd = 0;
let petStateStart = 0;
let petLastState = "";
let petY = 0;
let petTarget = null;
let petDragging = false;
// When the renderer last told us it was still dragging. A drag lives only as long
// as those reports keep coming (see the watchdog in the pet tick).
let petDragSeenAt = 0;
// When the carry started, so the hard carry-limit watchdog (v1.1.4) can end a
// drag that keeps reporting forever.
let petDragStartAt = 0;
// Last cursor offset pushed to the renderer, so a still mouse next to a still Pilly
// stops costing an IPC message every 24 ms (pet:dir is de-duped the same way).
let petCursorSentX = null;
let petCursorSentY = null;
let petCursorPrev = { x: 0, y: 0, t: 0 };
let petSpookCooldownUntil = 0;
// Live poop overlays. They fade out on their own after ~5 s, but switching Pilly
// off in the meantime used to leave one stranded on the screen.
const poopWins = new Set();
let marketAlertTimer = null;
let pillyPickTimer = null;
let sniperTimer = null;
let whaleTimer = null;
let portfolioMoodTimer = null;
// v1.1.2: the one-shot "warm-up" timers startPet() arms (first joke, first
// question, the morning greeting...). They used to be fire-and-forget, so a quick
// off→on toggle left the old ones armed; each then fired into the *new* session and
// started a second copy of its self-rearming chain, doubling Pilly's chatter for
// the rest of the run. They are tracked here so stopPet() can cancel them.
let petWarmTimers = [];
let reminderTimer = null;
let dailyBriefDone = false; // once per session
// ---- v1.1.1: focus sessions + activity diary ----
let focusDoc = { cfg: FOCUS.normalizeCfg(), state: FOCUS.emptyState(), digestDay: 0 };
let focusTickTimer = null;
let lastIdleSec = null; // powerMonitor.getSystemIdleTime() previous sample
let batteryWarned = false; // one low-battery bubble per discharge cycle (v1.1.1)
let pendingHotCoin = null; // { mint, symbol, name } for the clickable hot bubble
let hotBubbleUntil = 0; // while a hot bubble is live, jokes/questions must not stomp it
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
// The live menu object, kept so the macOS right-click handler and a menu rebuild
// always agree on what to show (v1.1.2).
let trayMenuRef = null;
// v1.1.2: whether the OS asks for reduced motion. Reported by the renderers
// (there is no cross-platform main-process API for it) and used to keep the
// tray icon still instead of bobbing forever.
let reduceMotionPref = false;
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

// v1.1.2: macOS draws a tray image at its own point size, so a raw 32x32 frame
// filled the whole menu bar and looked soft on a Retina display. Give the menu
// bar a 16pt image with a real 2x representation (the same pixels, described
// honestly) - and leave Windows/Linux, which already got it right, untouched.
const trayIcons = [];
const trayIconSrc = [];
function trayIconFor(i) {
  const img = iconFrames[i];
  if (process.platform !== "darwin" || !img || img.isEmpty()) return img;
  if (trayIcons[i] && trayIconSrc[i] === img) return trayIcons[i];
  try {
    const icon = nativeImage.createEmpty();
    icon.addRepresentation({ scaleFactor: 1, buffer: img.resize({ width: 16, height: 16, quality: "best" }).toPNG() });
    icon.addRepresentation({ scaleFactor: 2, buffer: img.resize({ width: 32, height: 32, quality: "best" }).toPNG() });
    trayIcons[i] = icon;
  } catch (e) {
    trayIcons[i] = img; // never trade a cosmetic win for a working tray
  }
  trayIconSrc[i] = img;
  return trayIcons[i];
}

function createWindow() {
  const chatSettings = SETTINGS.effective(userDataDir()).chat || {};
  const created = new BrowserWindow({
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
    // macOS: a background window eats the click that activates it, so the first
    // click on Pilly after using another app would only bring the app forward
    // and the user had to click again. The pet and the bubble already carry this.
    acceptFirstMouse: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win = created;
  created.setMenuBarVisibility(false);
  created.loadFile(path.join(__dirname, "renderer", "index.html"));
  created.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      saveWinBounds();
      created.hide();
    }
  });
  // Remember where the user left the window (position + height).
  created.on("resize", scheduleWinSave);
  created.on("move", scheduleWinSave);
  // v1.1.2: greet the user when the app window takes focus.
  wireGreetOnFocus(created);
  // If the window is ever fully destroyed (e.g. during quit races), drop the
  // stale reference so the next tray click can rebuild it instead of crashing
  // with "Object has been destroyed". Only clear it while it still *is* this
  // window: a window rebuilt after a teardown must not be forgotten by the
  // dead window's own handler.
  created.on("closed", () => {
    if (win === created) win = null;
  });
  // v1.1.2: whether the user has this window open has to be known *before* it is
  // torn down - by the time a window dies it can no longer say, and a window the
  // user had closed must not pop back up (see watchWindowSurvival).
  created.on("show", () => { chatWanted = true; });
  created.on("hide", () => { chatWanted = false; });
  // v1.1.2: a window that loses its renderer surface (see watchWindowSurvival)
  // is rebuilt, otherwise a native teardown leaves the user with nothing to open
  // from the tray until they restart the app. Only while the user actually has it
  // open, though: a teardown behind a hidden window costs nothing (the next tray
  // click rebuilds it and positions it), and announcing a "repair" that the user
  // cannot see - at every quit, say - is how a log stops being trusted.
  watchWindowSurvival(created, "the chat window", () => {
    ensureWindow();
    if (!win || win.isDestroyed()) return;
    // Restore where the user had it whether or not it was open, so the next tray
    // click does not open a rebuilt window at some default spot.
    positionWindow();
    if (chatWanted) win.show();
  }, () => chatWanted);
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

// ---- Survival net ---------------------------------------------------------
// A window can lose its renderer surface to something that is not a close: a
// renderer process that dies, a compositor that tears a view down, or the OS
// pulling a window out from under a long-running process (observed on Windows as
// a WM_DESTROY with no WM_CLOSE, which no Electron event reports). Pilly is a
// companion and an always-on-top overlay, so "the window silently vanished" is
// the worst possible outcome - it is repaired instead of logged and forgotten.
const repairStamps = [];
// A window that keeps dying must not spin the app into a rebuild loop; four
// repairs a minute is already pathological, past that we stop and stay loud.
function repairAllowed() {
  const now = Date.now();
  while (repairStamps.length && now - repairStamps[0] > 60000) repairStamps.shift();
  if (repairStamps.length >= 4) return false;
  repairStamps.push(now);
  return true;
}

function watchWindowSurvival(w, what, rebuild, wanted) {
  let wc;
  try { wc = w.webContents; } catch (e) { return; }
  wc.on("render-process-gone", (e, details) => {
    if (isQuitting) return;
    const reason = (details && details.reason) || "unknown";
    console.warn(`[pilly] the renderer of ${what} is gone (${reason}) - reloading it`);
    if (!repairAllowed()) return;
    // A reload is enough: the window, its position and its bounds all survive.
    setTimeout(() => { try { if (!wc.isDestroyed()) wc.reload(); } catch (err) { /* ignore */ } }, 400);
  });
  // A renderer can also stop answering without crashing (a wedged animation
  // loop, a GPU hang): no event fires for that, the window keeps painting its
  // last frame and every click on it dies - "clicking Pilly sometimes does
  // nothing until the pet is switched off and on again". Crash it on purpose
  // so the recovery above takes over.
  wc.on("unresponsive", () => {
    if (isQuitting) return;
    console.warn(`[pilly] the renderer of ${what} stopped responding - forcing a restart`);
    try { wc.forcefullyCrashRenderer(); } catch (err) { /* ignore */ }
  });
  wc.on("destroyed", () => {
    if (isQuitting) return;
    // Tearing a window down on purpose (switching the pet off, quitting) is not a
    // crash worth announcing - and it must not spend the repair budget either.
    if (wanted && !wanted()) return;
    if (!repairAllowed()) {
      console.warn(`[pilly] ${what} keeps losing its window - not rebuilding in a loop`);
      return;
    }
    // Read the intent now: once the window is gone it can no longer say whether
    // the user had it open, and a window they had closed must stay closed.
    let wasVisible = false;
    try { wasVisible = !w.isDestroyed() && w.isVisible(); } catch (e) { /* ignore */ }
    console.warn(`[pilly] ${what} lost its window${wasVisible ? " while open" : ""} - rebuilding it`);
    // Let the dead window's own handlers run first (its "closed" handler clears
    // the reference the rebuild then needs to be clear).
    setTimeout(() => { try { rebuild(wasVisible); } catch (e) { console.error("[pilly] rebuild failed:", (e && e.message) || e); } }, 300);
  });
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
  // First run (or after "Reset window position"): sit near the tray icon.
  // macOS puts the tray in the top menu bar (open below it); Linux tray icons
  // don't expose getBounds() at all (fall back to the bottom-right corner).
  try {
    const trayBounds = typeof tray.getBounds === "function" ? tray.getBounds() : null;
    const area = screen.getPrimaryDisplay().workArea;
    const [wpx, hpx] = w.getSize();
    const hasTrayBounds = trayBounds && (trayBounds.width > 0 || trayBounds.height > 0);
    let x;
    let y;
    if (process.platform === "darwin") {
      x = hasTrayBounds ? trayBounds.x + trayBounds.width / 2 - wpx / 2 : area.x + area.width - wpx - 8;
      y = hasTrayBounds ? trayBounds.y + trayBounds.height + 6 : area.y + 8;
    } else if (process.platform === "linux" && !hasTrayBounds) {
      x = area.x + area.width - wpx - 8;
      y = area.y + area.height - hpx - 8;
    } else {
      x = trayBounds.x + trayBounds.width / 2 - wpx / 2;
      y = trayBounds.y - hpx - 10;
    }
    x = Math.max(area.x + 4, Math.min(x, area.x + area.width - wpx - 4));
    y = Math.max(area.y + 4, y);
    w.setPosition(Math.round(x), Math.round(y), false);
  } catch (e) { /* ignore */ }
}

// Forget the remembered bounds so the next show snaps back above the tray.
function resetWindowPosition() {
  try { fs.rmSync(path.join(userDataDir(), "pilly-window.json"), { force: true }); } catch (e) { /* ignore */ }
}

// Is the chat in front of the user right now? The platform answers the two halves
// of that question differently, so the decision lives in src/windowstate.js where
// `npm test` can cover the macOS answer as well.
function chatState(w) {
  if (!w || w.isDestroyed()) return null;
  return { visible: w.isVisible(), minimized: w.isMinimized() };
}

// The one way back to the chat window: the pet, the bubble, the tray, the
// hotkey, a second launch and the Dock icon all end up here, so "the chat did not
// open" can never be one reveal path's opinion against another's. A minimised
// window used to be the trap - on macOS it still reports itself visible, so every
// caller decided "already open, leave it alone" and the user had a window they
// could not reach without switching the pet off and on again.
function revealWindow(force) {
  let w = ensureWindow();
  if (!w || w.isDestroyed()) {
    // The survival net may be tearing the window down right now (native
    // teardown, then a rebuild a moment later). ensureWindow() is idempotent,
    // so ask again before giving up on the click.
    w = ensureWindow();
    if (!w || w.isDestroyed()) return null;
  }
  // Every step is best effort on its own: a window can die between two calls
  // here, and a click that fell into that gap must not throw and vanish.
  try { if (w.isMinimized()) w.restore(); } catch (e) { /* ignore */ }
  positionWindow();
  try {
    if (force || !w.isVisible()) w.show();
  } catch (e) {
    // The window died mid-reveal; the survival net rebuilds it and (because
    // chatWanted survives) shows it again. Nothing else to do here.
  }
  raiseWindow(w);
  return w;
}

// Putting the chat back in front of whatever is covering it. `focus()` on its own
// is not enough: another always-on-top overlay (Pilly himself, a chat from another
// app) keeps sitting in front, and a click that leaves the chat exactly where it
// was reads as "nothing happened". Both calls are best effort - the window can be
// on its way down while this runs, and the click still did what it could.
function raiseWindow(w) {
  if (!w || w.isDestroyed()) return;
  try { w.moveTop(); } catch (e) { /* raising is best effort */ }
  try { w.focus(); } catch (e) { /* focus is best effort */ }
}

// "Open chat" everywhere means OPEN, never hide. The tray item and the macOS menu
// item both carry that label, and both used to toggle: a menu entry that promises
// to open a window that is already up put the window *away* instead, which is the
// opposite of what it says. A minimised window counts as closed here, because on
// macOS it still reports itself visible and showing it does not bring it back.
// The tray icon click and the summon hotkey are still toggles - a summon that
// answers a second press by hiding is what a summon reflex expects.
function openChatWindow() {
  const w = ensureWindow();
  if (w && chatIsOpen(chatState(w))) raiseWindow(w);
  else revealWindow(true);
  // Hot-coin / pick bubbles open the chat PRE-LOADED with that coin.
  const pending = pendingHotCoin;
  if (pending && pending.mint) {
    pendingHotCoin = null;
    setTimeout(() => sendToChat("pilly:load-coin", pending), 500);
  }
  return w;
}

function toggleWindow() {
  const w = ensureWindow();
  if (!w) return;
  if (chatToggle(chatState(w)) === "hide") {
    w.hide();
    return;
  }
  revealWindow(true);
}

// ---- Taskbar pet: a tiny pill that walks along the taskbar ----
const PET_W = 60;
const PET_H = 64; // tall enough that a hop (up to ~21px above the pill top at lg scale) never clips

// A floating pet has to follow the user. On macOS he is otherwise stranded on
// the Space he was spawned on (switching desktops just leaves him behind), and
// he stays under a full-screen app. Linux (X11) has the same "sticky window"
// concept; on Windows this is a no-op because the pet is already global.
function pinToAllWorkspaces(w) {
  if (!w || w.isDestroyed()) return;
  if (process.platform !== "darwin" && process.platform !== "linux") return;
  const apply = () => {
    try { w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch (e) { /* ignore */ }
  };
  apply();
  // macOS silently drops the flag when a window is hidden and shown again,
  // so re-assert it every time the window comes back.
  w.on("show", apply);
}

// Unplugging a monitor (or changing its resolution) used to strand Pilly on a
// display that no longer exists - an invisible pet whose only fix was to switch
// him off and on again. The chat window had the same problem.
function clampPetToDisplays() {
  if (!petWin || petWin.isDestroyed()) return;
  const area = screen.getDisplayMatching(petWin.getBounds()).workArea;
  const x = Math.max(area.x - PET_W + 24, Math.min(petX, area.x + area.width - 24));
  const y = Math.max(area.y - 24, Math.min(petY, area.y + area.height - 24));
  if (x === petX && y === petY) return;
  petX = x;
  petY = y;
  petTarget = null; // whatever he was walking to is gone with the monitor
  petWin.setPosition(Math.round(petX), Math.round(petY));
}

function clampChatToDisplays() {
  if (!win || win.isDestroyed() || !win.isVisible()) return;
  const b = win.getBounds();
  const area = screen.getDisplayMatching(b).workArea;
  const x = Math.max(area.x + 4, Math.min(b.x, area.x + area.width - b.width - 4));
  const y = Math.max(area.y + 4, Math.min(b.y, area.y + area.height - b.height - 4));
  if (x === b.x && y === b.y) return;
  win.setBounds({ x: Math.round(x), y: Math.round(y), width: b.width, height: b.height });
}

function createPetWindow() {
  const created = new BrowserWindow({
    width: PET_W,
    height: PET_H,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: false,
    // macOS: a non-focusable window cannot become key, and by default the first
    // click on such a window is spent trying to activate it - i.e. swallowed.
    // Pilly must react to the first tap. Ignored on Windows/Linux.
    acceptFirstMouse: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Pilly is an always-on-top overlay that must keep animating even when the
      // OS considers him occluded - on macOS that happens as soon as the user
      // switches Space or opens a full-screen app, and Chromium would otherwise
      // throttle requestAnimationFrame down to ~1fps and freeze him mid-motion.
      backgroundThrottling: false,
    },
  });
  petWin = created;
  petLoaded = false;
  created.setAlwaysOnTop(true, "screen-saver");
  pinToAllWorkspaces(created);
  created.loadFile(path.join(__dirname, "renderer", "pet.html"));
  // A pet window created *after* a focus session started - he was switched on
  // mid-pomodoro, or he was restarted while one was running - still has to show
  // the session. pet:focus carries it, and this is the one push the state
  // machine does not cover on its own.
  created.webContents.on("did-finish-load", () => {
    try {
      petLoaded = true;
      if (!petWin || petWin.isDestroyed()) return;
      if (focusDoc) petWin.webContents.send("pet:focus", focusStatusPayload());
    } catch (e) { /* ignore */ }
  });
  // Same rule as the chat window: only clear the reference while it still is this
  // window, so a rebuilt pet is not nulled out by the window that died.
  created.on("closed", () => { if (petWin === created) petWin = null; });
  watchWindowSurvival(created, "Pilly's window", () => rebuildPetWindow(), () => petActive);
}

// Pilly's window lost its renderer surface. He is not switched off - that is a
// user decision (the tray toggle calls stopPet(), which clears petActive first) -
// so the window is replaced in place and he keeps walking from where he was.
function rebuildPetWindow() {
  if (!petActive || isQuitting) return;
  // The 24 ms walk tick notices a dead window too, and whichever of the two gets
  // here second must not rebuild him a second time.
  try {
    if (petWin && !petWin.isDestroyed() && !petWin.webContents.isDestroyed()) return;
  } catch (e) { /* fall through and rebuild */ }
  const keep = { x: petX, y: petY, state: petState, dir: petDir };
  if (petWin && !petWin.isDestroyed()) {
    try { petWin.destroy(); } catch (e) { /* already gone */ }
  }
  petWin = null;
  createPetWindow();
  if (!petWin || petWin.isDestroyed()) return;
  petX = keep.x;
  petY = keep.y;
  petState = keep.state;
  petDir = keep.dir;
  petDirSent = null; // the fresh renderer has no facing yet
  petWin.setPosition(Math.round(petX), Math.round(petY));
  try {
    petWin.webContents.once("did-finish-load", () => {
      try {
        if (petWin && !petWin.isDestroyed()) petWin.webContents.send("pet:state", petState);
      } catch (e) { /* ignore */ }
    });
  } catch (e) { /* ignore */ }
  // He is still wearing the same speech bubble, so it has to follow him.
  if (bubbleWin && !bubbleWin.isDestroyed() && bubbleWin.isVisible()) positionBubble();
}

// A one-shot timer that stopPet() knows about (see petWarmTimers).
function petWarm(fn, delay) {
  const t = setTimeout(() => {
    petWarmTimers = petWarmTimers.filter((x) => x !== t);
    fn();
  }, delay);
  petWarmTimers.push(t);
}

// A self-rearming scheduler has to cancel its own previous handle: overwriting it
// would leave two chains running and each keeps re-arming itself for good.
function rearm(handle, fn, delay) {
  if (handle) clearTimeout(handle);
  return setTimeout(fn, delay);
}

function startPet() {
  if (petActive) return;
  petActive = true;
  createPetWindow();
  const pet = petOpts();
  // Spawn on the monitor the user is actually working on (not always the
  // primary one), then let a remembered position win - clamped into whatever
  // display exists now, so a monitor that has since been unplugged can't put
  // him off-screen.
  const spawn = workAreaFor(screen.getCursorScreenPoint().x, screen.getCursorScreenPoint().y);
  petX = Math.floor(spawn.x + spawn.width * 0.4);
  petY = pet.walkMode === "screen"
    ? Math.floor(spawn.y + spawn.height * 0.35)
    : spawn.y + spawn.height - PET_H - 2;
  const savedPos = pet.pos && Number.isFinite(pet.pos.x) && Number.isFinite(pet.pos.y) ? pet.pos : null;
  if (savedPos) {
    const area = workAreaFor(savedPos.x + PET_W / 2, savedPos.y + PET_H / 2);
    petX = Math.max(area.x - PET_W + 24, Math.min(savedPos.x, area.x + area.width - 24));
    petY = pet.walkMode === "screen"
      ? Math.max(area.y - 24, Math.min(savedPos.y, area.y + area.height - 24))
      : area.y + area.height - PET_H - 2; // taskbar mode always lands back on the bar
  }
  petDir = 1;
  petDirSent = null;
  petCursorSentX = null;
  petCursorSentY = null;
  petState = "walk";
  petStateEnd = Date.now() + 2000 + Math.random() * 2000;
  petStateStart = Date.now();
  petTarget = null;
  petDragging = false;
  petDragSeenAt = 0;
  petDragStartAt = 0;
  // petLastState has to be cleared too, or an off→on toggle where the last state
  // was "walk" makes the tick's de-dup skip the very first pet:state - and the
  // freshly created renderer never hears which state to draw.
  petLastState = "";
  petWin.setPosition(petX, petY);
  petTimer = setInterval(() => safely("the pet tick", () => {
    if (!petWin || petWin.isDestroyed()) {
      // A window can be torn down by something outside the app. That used to read
      // as "the pet is gone" and switch him off for good; it now rebuilds him.
      // stopPet() is the only other way petWin disappears - and it is always
      // preceded by petActive = false - so a dead window while he is on is never
      // a user decision.
      if (petActive && !isQuitting) rebuildPetWindow();
      else stopPet();
      return;
    }
    const now = Date.now();
    // A drag lives only as long as the renderer keeps reporting it. A pointerup
    // that never arrives - the button released outside the 60x64 pet window, a
    // system dialog stealing focus, a renderer that reloads - used to leave
    // petDragging stuck true for the rest of the session: Pilly stopped walking,
    // stopped reacting and ignored every state change until he was switched off
    // and on again. Every "move" refreshes the stamp, so a real drag never trips
    // this.
    if (petDragging && now - petDragSeenAt > 4000) {
      petDragging = false;
      petDragSeenAt = 0;
      petDragStartAt = 0;
      petTarget = null;
      console.warn("[pilly] the drag stopped reporting - Pilly released");
    }
    // v1.1.4 backstop: even a renderer that keeps saying "hold" forever (a
    // hover that never got its mouseout) cannot keep him stuck - a carry has a
    // hard maximum length. The renderer's own cursor check ends it first; this
    // one only ever fires if that handshake is somehow broken. A cursor that is
    // still on him is a real still hold, which must survive, so the backstop
    // re-arms instead of dropping him.
    if (petDragging && now - petDragStartAt > 12000) {
      if (!cursorOverPet()) {
        petDragging = false;
        petDragSeenAt = 0;
        petDragStartAt = 0;
        petTarget = null;
        console.warn("[pilly] the drag outlived its carry limit - Pilly released");
      } else {
        petDragStartAt = now;
      }
    }
    // While the user is dragging Pilly, don't fight him - but keep the
    // speech bubble glued to him as he moves.
    if (petDragging) {
      if (bubbleWin && !bubbleWin.isDestroyed() && bubbleWin.isVisible()) positionBubble();
      return;
    }
    // Pilly's walking area follows the monitor he is actually standing on, so
    // he can live on any screen instead of the primary one only.
    const area = workAreaFor(petX + PET_W / 2, petY + PET_H / 2);
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
    // Screen mode: Pilly plays cat-and-mouse with the cursor. A FLICK spooks him
    // (jump + "!" + a short scared dash), then he stops and lets you click him.
    // Both thresholds are in src/petmotion.js: the old "any cursor faster than a
    // crawl, any time" rule meant a normal approach scared him off mid-click, so
    // the click landed on the desktop and the chat never opened.
    let cursorOnHim = false;
    if (!petDragging && petOpts().walkMode === "screen" && petState !== "sleep") {
      const c = screen.getCursorScreenPoint();
      const dtC = now - petCursorPrev.t;
      let cSpeed = 0;
      if (petCursorPrev.t && dtC > 0) cSpeed = Math.hypot(c.x - petCursorPrev.x, c.y - petCursorPrev.y) / dtC;
      const d = Math.hypot(c.x - (petX + PET_W / 2), c.y - (petY + PET_H - 20));
      cursorOnHim = shouldStandStill({ dist: d, dragging: petDragging, walkMode: petOpts().walkMode, state: petState });
      if (shouldSpook({ dist: d, speed: cSpeed, now, cooldownUntil: petSpookCooldownUntil })) {
        petState = "flee";
        petStateStart = now;
        petStateEnd = now + 800;
        petSpookCooldownUntil = now + SPOOK_COOLDOWN_MS;
        bumpStat("spooks");
        petWin.webContents.send("pet:spook", now);
        pickFleeTarget(c, 90);
      }
    }
    // A cursor parked on him is "about to click": he stops walking instead of
    // sliding out from under the pointer, and carries on shortly after it leaves.
    // Standing still is also the honest animation for it - walking on the spot
    // looked like a bug. An in-progress flee is left alone so the scared dash
    // still plays out; the movement block below parks him once it is over.
    if (cursorOnHim && petState === "walk") {
      petState = "pause";
      petStateStart = now;
      petStateEnd = now + CURSOR_HOLD_RESUME_MS;
    }
    if ((petState === "walk" || petState === "flee") && !cursorOnHim) {
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
        if (nd !== petDir) petDir = nd;
        petX = Math.max(area.x, Math.min(petX, area.x + area.width - PET_W));
        petY = Math.max(area.y - 8, Math.min(petY, area.y + area.height - PET_H));
      }
    }
    if (petState !== petLastState) {
      petLastState = petState;
      petWin.webContents.send("pet:state", petState);
    }
    petWin.setPosition(Math.round(petX), Math.round(petY));
    // Only push the direction when it actually changes (or on the first tick,
    // so a freshly-created window syncs up). This used to fire on every tick -
    // ~40 IPC messages a second carrying one unchanged number.
    if (petDir !== petDirSent) {
      petDirSent = petDir;
      petWin.webContents.send("pet:dir", petDir);
    }
    const cur = screen.getCursorScreenPoint();
    // Track how long the mouse has been still (ambient sleep logic).
    if (Math.abs(cur.x - petCursorPrev.x) + Math.abs(cur.y - petCursorPrev.y) > 3) cursorIdleAt = now;
    petCursorPrev = { x: cur.x, y: cur.y, t: now };
    // Aim the pupils at the pill's center, not the window's center. The offset can
    // only change when the cursor or Pilly himself moves, so a still mouse next to
    // a standing Pilly costs nothing - this used to be one of the ~40 IPC messages
    // a second the pet:dir de-dup was added to avoid.
    const cx = cur.x - (petX + PET_W / 2);
    const cy = cur.y - (petY + PET_H - 22.5);
    if (cx !== petCursorSentX || cy !== petCursorSentY) {
      petCursorSentX = cx;
      petCursorSentY = cy;
      petWin.webContents.send("pet:cursor", { x: cx, y: cy });
    }
    if (bubbleWin && !bubbleWin.isDestroyed() && bubbleWin.isVisible()) positionBubble();
  }), 24);
  // First joke after a few seconds, then every 2-3 minutes.
  if (petOpts().bubbles) {
    petWarm(() => { if (petActive) { bgTick("joke", petJokeTick()); scheduleNextJoke(); } }, 8000);
  }
  // Pilly occasionally asks you something (first after ~2.5-3.5 min, then 3-5 min).
  if (petOpts().questions !== false) {
    petWarm(() => { if (petActive) { bgTick("question", petQuestionTick()); scheduleNextQuestion(); } }, 150000 + Math.random() * 60000);
  }
  // Tiny poops on the screen every 4-5 min (they vanish on their own).
  petWarm(() => { if (petActive) { spawnPoop(); scheduleNextPoop(); } }, 150000 + Math.random() * 60000);
  // Stage 4: proactive market alerts + ambient (morning greeting, weather).
  scheduleMarketAlert();
  // v1.0.5: daily brief (SOL + your PnL) once per session.
  if (petOpts().dailyBrief !== false && !dailyBriefDone) {
    petWarm(() => { if (petActive) bgTick("daily brief", dailyBrief()); }, 25000);
  }
  // v1.0.5: Pilly's AI pick of the day (first after ~2 min, then every 6h).
  schedulePillyPick();
  // v1.0.5: Sniper mode - watches for coins that JUST launched.
  scheduleSniper();
  // v1.0.5: Whale follow - alerts when a followed whale opens a new position.
  scheduleWhalePoll();
  // v1.0.5: Portfolio mood - Pilly reacts to YOUR bags.
  schedulePortfolioMood();
  const h = new Date().getHours();
  if (h >= 5 && h < 11) {
    petWarm(() => {
      safely("the morning greeting", () => {
        if (!petActive || !petOpts().bubbles) return;
        showPetJoke(`☕ gm anon. ${(petOpts().name || "Pilly")} ready for some pumps?`);
        sendPetMarket({ kind: "up", name: "morning" });
      });
    }, 12000);
  }
  weatherNext = Date.now() + 90000;
  petWarm(() => { if (petActive) bgTick("weather", weatherTick()); }, 90000);
}

function stopPet() {
  petActive = false;
  if (petTimer) { clearInterval(petTimer); petTimer = null; }
  if (petJokeTimer) { clearTimeout(petJokeTimer); petJokeTimer = null; }
  for (const t of petWarmTimers) clearTimeout(t);
  petWarmTimers = [];
  if (petQuestionTimer) { clearTimeout(petQuestionTimer); petQuestionTimer = null; }
  if (poopTimer) { clearTimeout(poopTimer); poopTimer = null; }
  if (marketAlertTimer) { clearTimeout(marketAlertTimer); marketAlertTimer = null; }
  if (pillyPickTimer) { clearTimeout(pillyPickTimer); pillyPickTimer = null; }
  if (sniperTimer) { clearTimeout(sniperTimer); sniperTimer = null; }
  if (whaleTimer) { clearTimeout(whaleTimer); whaleTimer = null; }
  if (portfolioMoodTimer) { clearTimeout(portfolioMoodTimer); portfolioMoodTimer = null; }
  if (bubbleTimer) { clearTimeout(bubbleTimer); bubbleTimer = null; }
  // A poop overlay fades and destroys itself after ~5 s, but turning Pilly off in
  // the meantime left it stranded on the screen with nothing to remove it.
  for (const w of poopWins) { if (!w.isDestroyed()) w.destroy(); }
  poopWins.clear();
  petDragging = false;
  petDragSeenAt = 0;
  petDragStartAt = 0;
  petTarget = null;
  petLoaded = false;
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

// v1.1.3: the same jokes for Pilly's Chinese users (his own words).
const PET_JOKES_ZH = [
  "meme币为什么过马路？为了去对面的 pump。",
  "高买低卖是理论，高买不卖是信仰。",
  "我的仓位 90% 是希望，10% 是安慰。",
  "K线往上走，钱包却原地不动。",
  "rug pull 只是比较激进的出场方式。",
  "Solana 很快，但我的钱跑得更快。",
  "dev 说不 rug。dev 又骗人。",
  "我唯一拿住的绿蜡烛，是拿得太久的那根。",
  "pump 它、dump 它、爱它、绝不离开它。",
  "我的止损线是个表情包，字面意思。",
  "Solana 出块 400 毫秒，我的利润 1 秒清零。",
  "我不需要路线图，我需要火箭。",
];
let bubbleWin = null;
let bubbleTimer = null;
let petJokeTimer = null;
// Where the bubble sits relative to the pill. "above" (tail points down) and
// "below" (tail points up) handle the top/bottom edges; "right"/"left" put the
// bubble BESIDE the pill (tail points sideways) when he hugs the left/right edge
// of the screen. Tracks the current side so we only push it to the renderer when
// it actually changes.
let bubbleOrient = "above";
// Where the bubble tail should point, relative to the bubble window's centre.
// positionBubble() recomputes this every pet tick so the tail stays glued to
// Pilly's head (or side) even when the window is clamped at a screen corner.
let bubbleTail = { tx: 0, ty: 0 };
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
    // Same first-click reason as the pet window: the bubble becomes clickable
    // when it carries a question, and that one tap has to register.
    acceptFirstMouse: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Same reason as the pet window: a bubble stranded on another Space has to
      // finish its fade instead of stuttering at 1fps.
      backgroundThrottling: false,
    },
  });
  bubbleWin.setAlwaysOnTop(true, "screen-saver");
  // The bubble is glued to the pet, so it has to cross Spaces with him.
  pinToAllWorkspaces(bubbleWin);
  bubbleWin.setIgnoreMouseEvents(true, { forward: true });
  bubbleReady = false;
  bubbleOrient = "above";
  bubbleWin.loadFile(path.join(__dirname, "renderer", "bubble.html"));
  bubbleWin.webContents.on("did-finish-load", () => {
    bubbleReady = true;
    // Push the current side so a freshly-created window always matches where
    // the bubble actually sits (it can't be oriented otherwise).
    if (bubbleWin && !bubbleWin.isDestroyed()) {
      bubbleWin.webContents.send("pet:orient", { o: bubbleOrient, tx: bubbleTail.tx, ty: bubbleTail.ty });
    }
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
  const [bw, bh] = bubbleWin.getSize();
  const area = screen.getDisplayNearestPoint({ x: px, y: py }).workArea;

  const pillLeftAbs = px;                        // left edge of the pill
  const pillRightAbs = px + PET_W;               // right edge of the pill
  const pillTopAbs = py + pillTop;               // top edge of the pill
  const pillBottomAbs = py + PET_H - 11;         // bottom edge of the pill
  const spaceAbove = pillTopAbs - area.y;
  const spaceBelow = area.y + area.height - pillBottomAbs;
  const spaceLeft = pillLeftAbs - area.x;
  const spaceRight = area.x + area.width - pillRightAbs;

  // Pilly docked against the LEFT or RIGHT edge: a bubble above/below him would
  // be pushed back on-screen, so put the bubble BESIDE him instead (tail points
  // at his side). A small margin still counts as "docked" so a pill a few px off
  // the edge gets it too. Only when he is NOT also hugging the top/bottom edge
  // (e.g. taskbar mode at the bottom-left corner) - there the above/below flip
  // is better, and the tail slide below keeps the tip pointing at his head.
  const EDGE = 24;
  const nearLeft = spaceLeft < EDGE;
  const nearRight = spaceRight < EDGE;
  const nearTop = spaceAbove < EDGE;
  const nearBottom = spaceBelow < EDGE;
  let orient;
  if (nearLeft && !nearTop && !nearBottom) orient = "right";
  else if (nearRight && !nearTop && !nearBottom) orient = "left";
  else if (spaceAbove >= bh) orient = "above";
  else if (spaceBelow >= bh) orient = "below";
  else orient = spaceBelow > spaceAbove ? "below" : "above";

  let x, y;
  if (orient === "right" || orient === "left") {
    // Bubble beside the pill, vertically centred on him so the tail lines up.
    const pillMid = (pillTopAbs + pillBottomAbs) / 2;
    y = Math.round(pillMid - bh / 2);
    // The tail tip sits 8px inside the window's near edge; back off 2px so the
    // tip ends up ~6px from Pilly's side (matches the above/below gap).
    x = orient === "right" ? pillRightAbs - 2 : pillLeftAbs - bw + 2;
  } else {
    if (orient === "above") {
      // Bubble above the pill, tail pointing down at its top.
      y = pillTopAbs - 12 - (bh - 14);
    } else {
      // Bubble below the pill, tail pointing up at its bottom.
      y = pillBottomAbs - 2;
    }
    x = Math.round(px - (bw - PET_W) / 2); // centred on the pill
  }
  // NEVER let the bubble window leave the screen.
  x = Math.max(area.x + 2, Math.min(x, area.x + area.width - bw - 2));
  y = Math.max(area.y, Math.min(y, area.y + area.height - bh));
  // After that clamp the tail may no longer point at Pilly (the window parks at
  // a corner while he hugs the edge). Tell the renderer where his head (or his
  // side, for left/right bubbles) sits relative to the window centre - it then
  // slides the bubble and the tail so the tip stays glued to him.
  const nx = Math.round(x);
  const ny = Math.round(y);
  const tail = orient === "right" || orient === "left"
    ? { tx: 0, ty: Math.round((pillTopAbs + pillBottomAbs) / 2 - (ny + bh / 2)) }
    : { tx: Math.round(px + PET_W / 2 - (nx + bw / 2)), ty: 0 };
  const tailMoved = Math.abs(tail.tx - bubbleTail.tx) >= 2 || Math.abs(tail.ty - bubbleTail.ty) >= 2;
  if (orient !== bubbleOrient || tailMoved) {
    bubbleOrient = orient;
    bubbleTail = tail;
    if (bubbleWin && !bubbleWin.isDestroyed()) {
      bubbleWin.webContents.send("pet:orient", { o: orient, tx: tail.tx, ty: tail.ty });
    }
  }
  bubbleWin.setPosition(nx, ny);
}

// The bubble content measures itself and asks for a taller/shorter window so
// text is never clipped. After resizing, re-anchor on the pill: for above/below
// this keeps the anchored edge (and the tail) glued to him, for side bubbles it
// keeps them vertically centred.
ipcMain.on("bubble:resize", (event, h) => {
  if (!bubbleWin || bubbleWin.isDestroyed()) return;
  const hh = Math.max(160, Math.min(340, Math.round(Number(h) || 160)));
  const [, oldH] = bubbleWin.getSize();
  if (hh === oldH) return;
  bubbleWin.setSize(190, hh);
  positionBubble();
});

// v1.1.4: a tapped bubble must not linger over Pilly. The bubble window stays
// clickable for its full 12 s otherwise, and while it sits on top of the pet
// every click that looks like it is on Pilly lands on the invisible bubble
// instead - the "tap to snipe, then Pilly ignores me" freeze. A tap means the
// user acted on it, so the bubble's job is done.
function dismissBubble() {
  if (bubbleTimer) { clearTimeout(bubbleTimer); bubbleTimer = null; }
  hotBubbleUntil = 0;
  if (bubbleWin && !bubbleWin.isDestroyed()) {
    bubbleWin.hide();
    setBubbleClickable(false);
  }
  sendPetTalking(false);
}
ipcMain.on("bubble:close", () => dismissBubble());

function showPetJoke(text) {
  if (!petActive) return;
  // v1.1.4: a live hot/snipe bubble is time-sensitive - a joke must not walk
  // over it, or the "tap to snipe" signal disappears and the tap does nothing.
  if (Date.now() < hotBubbleUntil) return;
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
  const list = chatLang() === "zh" ? PET_JOKES_ZH : PET_JOKES;
  return list[Math.floor(Math.random() * list.length)];
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
  const area = workAreaFor(petX + PET_W / 2, petY + PET_H / 2);
  const ang = Math.atan2((petY + PET_H - 20) - c.y, (petX + PET_W / 2) - c.x);
  petTarget = {
    x: Math.max(area.x, Math.min(petX + Math.cos(ang) * dist, area.x + area.width - PET_W)),
    y: Math.max(area.y, Math.min(petY + Math.sin(ang) * dist * 0.75, area.y + area.height - PET_H)),
  };
}

async function petJokeTick() {
  if (!petActive || !petOpts().bubbles) return;
  let joke = localPetJoke();
  // Stage 5: sometimes Pilly shares a little fact from his memory instead.
  if (Math.random() < 0.18) {
    const s = loadStats();
    const zh = chatLang() === "zh";
    const facts = zh
      ? [
        `一起第 ${s.days} 天了。我讲过 ${s.jokes} 个笑话，扛过 ${s.spooks} 次鼠标突袭。`,
        `小数据：查过 ${s.coins} 个币，${s.happy} 次开心，${s.sad} 次难过。`,
        `我们在一起 ${s.days} 天了。我的笑话仍然免费。`,
        `你摸过我 ${s.pets} 次，拖过我 ${s.drags} 次。我都记得。`,
      ]
      : [
        `day ${s.days} together. i've told ${s.jokes} jokes and survived ${s.spooks} cursor scares.`,
        `little stat: ${s.coins} coins checked, ${s.happy} good moods, ${s.sad} sad ones.`,
        `we've been at this for ${s.days} day${s.days === 1 ? "" : "s"}. my jokes are still free.`,
        `you've petted me ${s.pets} time${s.pets === 1 ? "" : "s"} and dragged me ${s.drags}. i remember both.`,
      ];
    joke = facts[(Math.random() * facts.length) | 0];
  } else {
    try {
      const zh = chatLang() === "zh";
      const r = await AI.respond(
        zh
          ? "用中文讲一个关于 solana pump.fun meme 币的超短笑话，一句话，不超过 15 个字。"
          : "tell me a very short funny joke about solana pump.fun memecoins, one line, under 10 words",
        { task: "", ai: aiOpts(), language: chatLang() }
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
  petJokeTimer = rearm(petJokeTimer, () => {
    if (!petActive || !petOpts().bubbles) return;
    bgTick("joke", petJokeTick());
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

// v1.1.3: Chinese question list - same vibe, Pilly's own words.
const PET_QUESTIONS_ZH = [
  "这周你见过最野的 pump.fun 币是哪个？",
  "给你 50 刀买一个 meme 币，你买谁？为什么？",
  "现在还算早，还是我们已经全晚了？",
  "你的出场策略是什么？说真话。",
  "今天你信哪个 dev？——答案是没人。",
  "你梦想的 pump.fun 币叫什么名字？",
  "Solana 还是 Solana，别的链真的存在吗？",
  "猫和狗之后，下一个热点会是什么？",
  "你怎么在 rug 之前就发现它是 rug？",
  "你没做的最赚的一笔是什么？做的最亏的呢？",
];

function localPetQuestion() {
  const list = chatLang() === "zh" ? PET_QUESTIONS_ZH : PET_QUESTIONS;
  return list[Math.floor(Math.random() * list.length)];
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

// Stage 2: Pilly reacts to live market data - green = happy, red = sad.
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

// v1.1.2: he notices when you come back to the app. Called when the chat window
// regains focus, rate-limited to one greeting a minute so it reads as affection
// and not as a twitch. The renderer decides whether he is in the mood for it.
let petGreetAt = 0;
// Did the window lose focus since the last greeting? A focus that was never
// preceded by a blur is the launch itself, and "welcome back" one second after
// the app starts is noise - it also spent the one-a-minute cooldown on a greeting
// the user never came back for.
let chatLostFocus = false;
function greetPet() {
  try {
    if (!petActive || !petWin || petWin.isDestroyed()) return;
    // Nobody is listening yet while pet.html loads, and a greet that was never
    // heard must not start the cooldown - that is how "he greets you when you come
    // back" stayed silent for the first minute after a launch that focused the
    // chat window before the pet had painted.
    if (!petLoaded || petWin.webContents.isLoading()) return;
    const now = Date.now();
    if (now - petGreetAt < 60000) return;
    petGreetAt = now;
    petWin.webContents.send("pet:greet");
  } catch (e) { /* ignore */ }
}

// v1.1.2: he reacts the moment the app window comes back - from another app,
// from the tray, from being minimised - which is the most common way people
// return to Pilly. Wired from createWindow(); blur/focus/minimize/restore are
// cheap and idempotent.
function wireGreetOnFocus(win) {
  if (!win || win.isDestroyed() || win.__greetWired) return;
  win.__greetWired = true;
  win.on("blur", () => { chatLostFocus = true; });
  win.on("minimize", () => { chatLostFocus = true; });
  const cameBack = () => {
    if (!chatLostFocus) return;
    chatLostFocus = false;
    greetPet();
  };
  win.on("focus", cameBack);
  win.on("restore", cameBack);
}

// v1.1.1: Pilly munches a coin he just found (Pilly Pick / Sniper). The pet
// state machine picks this up on the next tick and the renderer plays a short
// "eat" animation before drifting back to its normal walk/pause cycle.
function petEat() {
  if (!petActive || !petWin || petWin.isDestroyed()) return;
  const now = Date.now();
  petState = "eat";
  petStateStart = now;
  petStateEnd = now + 1600;
  petTarget = null;
}

// v1.1.2: a due reminder is an event about *you*, so he hops and rings instead
// of leaving it to a system toast on the other side of the screen. Same shape as
// petEat(): the state machine forwards "hop" on its next tick and the renderer
// plays the jump; the glyph rides along on its own channel because the state
// machine only carries a state name.
function petNudge(glyph) {
  if (!petActive || !petWin || petWin.isDestroyed()) return;
  const now = Date.now();
  petState = "hop";
  petStateStart = now;
  petStateEnd = now + 900;
  petTarget = null;
  petWin.webContents.send("pet:nudge", { glyph: glyph || "🔔" });
}

// v1.1.1: reminders - fire once, then vanish. Native notification + a Pilly
// bubble (when the pet is on) + a ding. Works even with the pet turned off.
function checkReminders() {
  let due;
  try {
    due = REMINDERS.dueNow(userDataDir(), Date.now());
  } catch (e) {
    return;
  }
  for (const r of due || []) {
    bumpStat("reminders");
    try {
      if (Notification.isSupported()) {
        new Notification({ title: L("reminderTitle"), body: r.message }).show();
      }
    } catch (e) { /* ignore */ }
    if (petActive && petOpts().bubbles) {
      showPetJoke(`⏰ ${L("reminderPrefix")}: ${r.message}`);
    } else {
      sendToChat("pilly:reminder-fired", r);
    }
    playPetSound("alert");
    petNudge("⏰");
  }
}

async function petQuestionTick() {
  if (!petActive || petOpts().questions === false) return;
  if (focusBusy()) return; // v1.1.1: no idle chatter during a focus session
  let q = localPetQuestion();
  try {
    const zh = chatLang() === "zh";
    const r = await AI.respond(
      zh
        ? "你是 Pilly。用中文问用户一个简短有趣的关于 pump.fun、Solana meme 币或加密的问题。一句话，不超过 20 个字，以问号结尾。不要任何开场白。"
        : "You're Pilly. Ask the user ONE short, fun question about pump.fun, Solana memecoins or crypto. One line, under 15 words, ends with '?'. No labels, no intro.",
      { task: "", ai: aiOpts(), language: chatLang() }
    );
    if (r && r.reply) {
      const t = String(r.reply).trim();
      if (t.length > 4 && (zh ? t.includes("？") || t.includes("?") : t.includes("?"))) {
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
  // v1.1.4: same as jokes - a question is never allowed to cover a live
  // hot/snipe bubble.
  if (Date.now() < hotBubbleUntil) return;
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
  petQuestionTimer = rearm(petQuestionTimer, () => {
    if (!petActive || petOpts().questions === false) return;
    if (focusBusy()) { scheduleNextQuestion(); return; } // v1.1.1: skip chatter during focus
    bgTick("question", petQuestionTick());
    scheduleNextQuestion();
  }, delay);
}

// ---- Tiny poops: Pilly drops a little pile on the screen every 4-5 min ----
const POOP_W = 22;
// Tall enough for the stink puff's whole rise: the cloud starts ~15px above
// the poop and floats up another 20px (see poop.html). A shorter window clips
// the cloud flat at the top edge, which reads as a broken "chmurka".
const POOP_H = 50;
let poopTimer = null;

function spawnPoop() {
  if (!petActive || !petWin || petWin.isDestroyed()) return;
  try {
    const pet = petOpts();
    const ps = pet.size === "sm" ? 0.85 : pet.size === "lg" ? 1.2 : 1;
    const pw = Math.round(POOP_W * ps);
    const ph = Math.round(POOP_H * ps);
    const poop = new BrowserWindow({
      width: pw,
      height: ph,
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
        // Consistent with the other overlays: finish the fade on any Space.
        backgroundThrottling: false,
      },
    });
    poop.setAlwaysOnTop(true, "screen-saver");
    pinToAllWorkspaces(poop);
    poop.setIgnoreMouseEvents(true, { forward: true });
    poop.loadFile(path.join(__dirname, "renderer", "poop.html"));
    poop.webContents.on("did-finish-load", () => {
      // Emoji sizes and the puff's flight path are CSS px, so zoom keeps the
      // whole gag proportional to Pilly instead of a fixed-size glyph.
      if (!poop.isDestroyed()) poop.webContents.setZoomFactor(ps);
    });
    // Drop it right under Pilly's feet; it stays put and fades on its own.
    poop.setPosition(Math.round(petX + PET_W / 2 - pw / 2), Math.round(petY + PET_H - ph - 3));
    poop.showInactive();
    bumpStat("poops");
    // Tracked so stopPet() can take it down with the rest of the pet (see poopWins).
    poopWins.add(poop);
    poop.once("closed", () => poopWins.delete(poop));
    setTimeout(() => { if (!poop.isDestroyed()) poop.destroy(); }, 5200);
  } catch (e) { /* ignore */ }
}

function scheduleNextPoop() {
  if (!petActive) return;
  const delay = 240000 + Math.floor(Math.random() * 60000); // 4-5 min
  poopTimer = rearm(poopTimer, () => {
    if (!petActive) return;
    spawnPoop();
    scheduleNextPoop();
  }, delay);
}

// ---- Stage 4: proactive market alerts - Pilly watches trending and shouts
// when something really moves (pure data, no AI round-trip). ----
function scheduleMarketAlert() {
  if (!petActive || !petOpts().bubbles) return;
  const delay = 300000 + Math.floor(Math.random() * 240000); // 5-9 min
  marketAlertTimer = rearm(marketAlertTimer, () => {
    if (!petActive || !petOpts().bubbles) return;
    bgTick("market alert", marketAlertTick());
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
    // HOT RADAR (v1.0.5): fresh 5m movers are the freshest signal - flag the
    // hottest coin with a CLICKABLE bubble that opens the chat pre-loaded.
    // Gated by the "Hot coin radar" setting (pet.hotAlerts).
    if (pet.hotAlerts !== false) {
      const hotPct = Number(pet.hotPct) || 10;
      const withM5 = data.list.filter(
        // Same dust floor as the launch radar: a sub-$7K coin "moving" 10% is a
        // bot or a rug, not a signal worth pinging a trader about.
        (c) => c.change5m != null && isFinite(c.change5m) && COINS.aboveFreshFloor(c)
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
        showHotCoin(`🚀 ${hot.symbol || hot.name} +${hot.change5m.toFixed(0)}% in 5m. tap me for the details.`);
        sendPetMarket({ kind: "up", name: hot.symbol || hot.name });
        return;
      }
    }
    // Fallback: 24h extremes (existing behavior) - same floor, because naming a
    // $3K coin as the day's mover is the same embarrassment in a different bubble.
    const withChg = data.list.filter((c) => c.change24h != null && isFinite(c.change24h) && COINS.aboveFreshFloor(c));
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
  hotBubbleUntil = Date.now() + 12000;
  playPetSound("coin");
  if (bubbleTimer) clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => {
    hotBubbleUntil = 0;
    if (bubbleWin && !bubbleWin.isDestroyed()) {
      bubbleWin.hide();
      setBubbleClickable(false);
    }
    sendPetTalking(false);
  }, 12000);
}

// v1.0.5: morning brief - SOL price + average PnL across your tracked positions.
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

// v1.0.5: Pilly's AI pick of the day - asks the model for the best setup from
// the trending list, then shows a clickable bubble with that coin loaded.
const PILLY_PICK_INTERVAL = 6 * 3600 * 1000;
function schedulePillyPick() {
  if (!petActive || petOpts().pillyPick === false) return;
  const now = Date.now();
  const delay = pillyPickNext > now ? pillyPickNext - now : 120000 + Math.random() * 60000;
  pillyPickTimer = rearm(pillyPickTimer, () => {
    if (!petActive || petOpts().pillyPick === false) return;
    bgTick("pick of the day", pillyPickTick());
    pillyPickNext = Date.now() + PILLY_PICK_INTERVAL;
    schedulePillyPick();
  }, delay);
}
async function pillyPickTick() {
  try {
    const data = await COINS.fetchTrendingTop(10);
    if (!data || !Array.isArray(data.list)) return;
    // The model can only pick from what it is shown, so the floor is applied
    // before the prompt: Pilly does not recommend coins nobody has bought yet.
    const clean = data.list.filter((c) => COINS.aboveFreshFloor(c));
    if (!clean.length) return;
    const lines = clean.map(
      (c, i) =>
        `${i + 1}. ${c.name}${c.symbol ? ` (${c.symbol})` : ""} ${COINS.fmtUsd(c.price)}${c.change24h != null ? ` ${COINS.fmtPct(c.change24h)}` : ""}${c.mcap != null ? ` mcap ${COINS.fmtUsd(c.mcap)}` : ""}${c.volume24h != null ? ` vol ${COINS.fmtUsd(c.volume24h)}` : ""}`
    );
    const r = await AI.respond(
      `You're Pilly. From this trending list, pick ONE coin with the best setup right now. Reply with ONLY: SYMBOL - one-line why (under 12 words).\n${lines.join("\n")}`,
      { task: "", ai: aiOpts() }
    );
    if (!r || !r.reply) return;
    const m = String(r.reply).match(/\b([A-Za-z0-9$._-]{1,12})\b/);
    if (!m) return;
    const sym = m[1].replace(/[^A-Za-z0-9$._-]/g, "").toUpperCase();
    const coin = clean.find((c) => (c.symbol || "").toUpperCase() === sym);
    if (!coin || !coin.mint) return;
    pendingHotCoin = { mint: coin.mint, symbol: coin.symbol, name: coin.name };
    bumpStat("pillypick");
    PICKS.record(userDataDir(), { mint: coin.mint, symbol: coin.symbol, name: coin.name, price: coin.price, source: "pick" });
    petEat();
    showHotCoin(`🎯 my pick: ${coin.symbol}${coin.change24h != null ? ` (${coin.change24h >= 0 ? "+" : ""}${coin.change24h.toFixed(0)}% 24h)` : ""}. tap me for the details.`);
  } catch (e) { /* ignore */ }
}

// v1.0.5: Sniper mode - pump.fun coins that JUST launched (younger than a few
// minutes) get a clickable "JUST LAUNCHED" bubble so the user can snipe the
// entry before the pack. Gated by the pet.sniper setting.
const SNIPER_MAX_AGE = 3 * 60000; // launch window: younger than 3 min
// The shared launch floor (src/coins.js): dust launches are not signals. Kept as a
// second gate here even though fetchNewCoins already filtered, so the bubble can
// never point at something below it.
const SNIPER_MIN_MCAP = COINS.MIN_FRESH_MCAP;
function scheduleSniper() {
  if (!petActive || petOpts().sniper === false) return;
  sniperTimer = rearm(sniperTimer, () => {
    if (!petActive || petOpts().sniper === false) return;
    bgTick("sniper", sniperTick());
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
          c.mcap >= SNIPER_MIN_MCAP
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
    petEat();
    showHotCoin(
      `🔫 JUST LAUNCHED: ${target.symbol || target.name}${target.mcap != null ? ` · mcap ${fmtCompact(target.mcap)}` : ""} - tap to snipe it.`
    );
  } catch (e) { /* ignore */ }
}

// v1.0.5: Whale follow - diff each followed wallet's holdings and pop a
// clickable bubble when a whale opens a brand-new position.
function scheduleWhalePoll() {
  if (!petActive || petOpts().whaleAlerts === false) return;
  whaleTimer = rearm(whaleTimer, () => {
    if (!petActive || petOpts().whaleAlerts === false) return;
    bgTick("whale poll", whalePoll());
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
      if (!res || !res.ok) continue;
      if (res.seeded) {
        // Say it out loud: the first poll after following records the baseline,
        // so a silent panel here is expected and not a broken alert.
        console.log(`[pilly] whale baseline recorded for ${w.label || w.address} (${mints.length} tokens)`);
      }
      if (!res.fresh.length) continue;
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

// v1.0.5: Portfolio mood - aggregate PnL% across your tracked positions and
// make the pet genuinely react to YOUR bags (green = confetti, red = tears).
function schedulePortfolioMood() {
  if (!petActive || petOpts().portfolioMood === false) return;
  portfolioMoodTimer = rearm(portfolioMoodTimer, () => {
    if (!petActive || petOpts().portfolioMood === false) return;
    bgTick("portfolio mood", portfolioMoodTick());
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

// ---- Stage 4: ambient weather mood (free wttr.in, IP-based, no key) ----
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
      safely("the weather bubble", () => {
        if (!petActive || !petOpts().bubbles) return;
        if (weatherMood === "wet") {
          showPetJoke("☔ it's raining out there... my mood matches.");
          sendPetMarket({ kind: "down", name: "weather" });
        } else if (weatherMood === "sunny") {
          showPetJoke("☀️ sunny vibes today. green candles incoming.");
          sendPetMarket({ kind: "up", name: "weather" });
        }
      });
    }, 1500);
  }
}

function startTrayAnim() {
  if (trayTimer || iconFrames.length < 2) return;
  trayTimer = setInterval(() => {
    trayFrame = (trayFrame + 1) % iconFrames.length;
    // Reduce motion: keep counting frames so he carries on from the right place
    // if the user turns the setting back off, but leave the icon alone.
    if (reduceMotionPref) return;
    if (tray && !isQuitting) tray.setImage(trayIconFor(trayFrame));
  }, 450);
}

// ---- Cross-platform "start at login" (v1.1.1) ----
// Windows and macOS use Electron's login-item API. Linux has no such API, so
// we manage an XDG autostart .desktop entry instead.
function linuxAutostartPath() {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(base, "autostart", "pilly.desktop");
}
function getAutoLaunch() {
  if (process.platform === "linux") return fs.existsSync(linuxAutostartPath());
  return app.getLoginItemSettings().openAtLogin;
}
function setAutoLaunch(enabled) {
  if (process.platform === "linux") {
    try {
      const p = linuxAutostartPath();
      if (enabled) {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        // AppImage runs from a temporary mount, so process.execPath is
        // ephemeral. Prefer the stable $APPIMAGE path when available (deb
        // installs fall back to the real binary at process.execPath).
        const bin = process.env.APPIMAGE || process.execPath;
        fs.writeFileSync(p, [
          "[Desktop Entry]",
          "Type=Application",
          "Name=Pilly",
          "Comment=Pilly - a tiny green pill AI friend",
          `Exec="${bin}"`,
          "Terminal=false",
          "X-GNOME-Autostart-enabled=true",
          "",
        ].join("\n"), "utf8");
      } else {
        fs.rmSync(p, { force: true });
      }
      return true;
    } catch (e) {
      return false;
    }
  }
  try {
    // macOS refuses to register a login item for a bundle it cannot verify
    // (an unsigned build, most of the time) and says so by throwing inside a
    // menu click - which used to surface as the main-process crash dialog.
    app.setLoginItemSettings({ openAtLogin: enabled });
    return true;
  } catch (e) {
    console.warn("[pilly] could not change the login item:", (e && e.message) || e);
    return false;
  }
}

function createTray() {
  if (!iconFrames.length) iconFrames = loadFrames();
  tray = new Tray(trayIconFor(0) || nativeImage.createEmpty());
  tray.setToolTip("Pilly - tap to chat");
  applyTrayMenu();
  if (process.platform === "darwin") {
    // macOS: a set context menu swallows left-clicks, so the chat window would
    // never open. Left-click toggles the window; right-click shows the menu.
    tray.on("click", () => toggleWindow());
    tray.on("right-click", () => tray.popUpContextMenu(trayMenuRef));
    // macOS fires two clicks for a double click, so an impatient double tap
    // opened the chat and immediately closed it again.
    tray.setIgnoreDoubleClickEvents(true);
  } else {
    tray.on("click", () => toggleWindow());
  }
  startTrayAnim();
}

// The menu is built in one place so it can be rebuilt without replacing the tray
// icon itself - building a second Tray would leave a second icon behind.
function applyTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  trayMenuRef = Menu.buildFromTemplate(trayMenuTemplate());
  if (process.platform !== "darwin") tray.setContextMenu(trayMenuRef);
}

// macOS always shows an application menu in the bar, and Electron's default one
// carries Reload and Toggle DevTools - acceptable in a dev build, sloppy in a
// menu bar app that a Solana dev keeps open all day. This is the curated one:
// nothing in it can drop the user into a half-loaded renderer, the standard
// editing keys still work while typing in the chat, and Cmd+W hides the chat
// (the close handler hides it instead of destroying the window).
function applyMacAppMenu() {
  if (process.platform !== "darwin") return; // Windows/Linux keep their frameless look
  try {
    // Not app.name: Electron answers "Electron" whenever it cannot see the app's
    // package.json, and that name is what macOS prints in the menu bar.
    let pkg = null;
    try { pkg = require("./package.json"); } catch (e) { /* menuAppName falls back */ }
    Menu.setApplicationMenu(Menu.buildFromTemplate(
      macAppMenuTemplate({
        appName: menuAppName(pkg),
        openChat: () => openChatWindow(),
        resetWindowPosition: () => resetWindowPosition(),
      })
    ));
  } catch (e) {
    // A menu is a convenience; Pilly must start even if the platform rejects it.
    console.warn("[pilly] could not install the macOS app menu:", e && e.message ? e.message : e);
  }
}

function trayMenuTemplate() {
  return [
    { label: L("openChat"), click: () => openChatWindow() },
    // Only shown when the shortcut could not be claimed, so nobody keeps pressing
    // a key that a different app silently owns.
    ...(summonHotkeyOk === false
      ? [{ label: L("summonTaken"), enabled: false }]
      : []),
    // Information, not an action - and always present, so "checking…" is a
    // visible state rather than a line that appears out of nowhere.
    { label: rpcHealthLine(), enabled: false },
    { type: "separator" },
    // v1.1.2: the pet button lives inside the chat window, and Windows/macOS start
    // tray-first with that window hidden - so on a fresh launch there was no way to
    // call Pilly back without opening the chat first. This writes the same saved
    // state the pet button does, so the two cannot disagree across a restart.
    {
      label: L("petOnTaskbar"),
      type: "checkbox",
      checked: petActive,
      click: (item) => setPetOn(!!item.checked),
    },
    { label: L("focusMenu"), submenu: [
      { label: L("focusStart"), click: () => trayFocus("start") },
      { label: L("focusPause"), click: () => trayFocus("pause") },
      { label: L("focusResume"), click: () => trayFocus("resume") },
      { label: L("focusStop"), click: () => trayFocus("stop") },
    ] },
    { label: L("resetWindow"), click: () => resetWindowPosition() },
    { type: "separator" },
    {
      label: process.platform === "win32" ? L("startWithWindows") : L("startAtLogin"),
      type: "checkbox",
      checked: getAutoLaunch(),
      click: (item) => { setAutoLaunch(item.checked); },
    },
    { type: "separator" },
    { label: L("quit"), click: () => { isQuitting = true; app.quit(); } },
  ];
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
  // v1.1.3: the home token rides in the same batch so Pilly can keep an eye on
  // his own coin in the tray tooltip (no extra round trip).
  const mints = items.map((i) => i.mint);
  if (!mints.includes(PILLY.HOME_TOKEN.mint)) mints.push(PILLY.HOME_TOKEN.mint);
  const prices = await COINS.fetchPrices(mints);
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
              title: `${it.symbol || it.name || "Coin"} ${sign}${chg.toFixed(1)}% ${L("in24h")}`,
              body: `${it.name || it.symbol || "Watched coin"} ${L("alertCrossed", { pct: it.alertPct })}`,
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

// v1.1.2: Solana RPC health. Every on-chain screen (balance, whale diff, rug
// check) uses the same public endpoint, and when it is rate-limited those
// screens just come back empty - indistinguishable from a dead mint. One cheap
// getSlot per minute answers "is it me or is it the endpoint?".
//
// The probe is cached because the menu is rebuilt on every focus tick: probing
// once per rebuild would hammer the very endpoint we are measuring. Only a
// change in the label touches the tray, so a healthy endpoint is silent.
const RPC_TTL_MS = 60000;
let rpcHealth = { state: "unknown" };
let rpcHealthAt = 0;
let rpcHealthBusy = null;

function rpcHealthLine() {
  return `Solana RPC: ${RPC.label(rpcHealth)}`;
}

function refreshRpcHealth(force) {
  if (rpcHealthBusy) return rpcHealthBusy; // de-dupe: boot probe + first tick can overlap
  if (!force && Date.now() - rpcHealthAt < RPC_TTL_MS) return Promise.resolve(rpcHealth);
  const before = rpcHealthLine();
  rpcHealthBusy = RPC.probe()
    .then((h) => {
      rpcHealth = h;
      rpcHealthAt = Date.now();
      if (h.state === "down" || h.state === "slow") {
        console.warn(`[pilly] Solana RPC ${RPC.label(h)}${h.error ? ` (${h.error})` : ""}`);
      }
      if (!isQuitting && rpcHealthLine() !== before) {
        applyTrayMenu();
        // Rebuilt from the values already on screen. Going through
        // updateTrayInfo() would re-fetch the SOL price first, and on the very
        // endpoint being measured that fetch can hang for 30 s - the note that
        // explains a broken endpoint must not wait for the endpoint.
        applyTooltip();
      }
      return h;
    })
    .catch((e) => {
      // A probe never rejects, so this is a bug in the tray rebuild - name it
      // instead of leaving a warning nothing can be traced back to.
      console.warn("[pilly] the RPC health refresh failed:", (e && e.stack) || e);
      return rpcHealth;
    })
    .finally(() => { rpcHealthBusy = null; });
  return rpcHealthBusy;
}

// Everything the tooltip can say without a network round trip: the SOL price if
// we already have one, the first watched coin, and the RPC note (only while the
// endpoint is slow or dead - see refreshRpcHealth).
let lastPrices = null;

function tooltipParts(sol) {
  const parts = [];
  const s = sol || (lastPrices && lastPrices[SOL_MINT]);
  if (s && s.price) {
    parts.push(`SOL ${fmtCompact(s.price)}${s.change24h != null ? ` (${s.change24h >= 0 ? "+" : ""}${s.change24h.toFixed(1)}%)` : ""}`);
  }
  const items = WATCH.list(userDataDir());
  const w0 = items[0];
  if (w0 && lastPrices && lastPrices[w0.mint]) {
    const p = lastPrices[w0.mint];
    parts.push(`${w0.symbol || w0.name || "coin"} ${fmtCompact(p.price)}${p.change24h != null ? ` (${p.change24h >= 0 ? "+" : ""}${p.change24h.toFixed(1)}%)` : ""}`);
  }
  if (items.length > 1) parts.push(`+${items.length - 1} ${L("watched")}`);
  // v1.1.3: Pilly keeps an eye on his own token - it rides along in the price
  // batch, so the tooltip shows it whenever the data is there.
  if (lastPrices && lastPrices[PILLY.HOME_TOKEN.mint]) {
    const h = lastPrices[PILLY.HOME_TOKEN.mint];
    if (h && h.price) {
      parts.push(`💊 ${L("homeShort")} ${fmtCompact(h.price)}${h.change24h != null ? ` (${h.change24h >= 0 ? "+" : ""}${h.change24h.toFixed(1)}%)` : ""}`);
    }
  }
  // v1.1.1: surface a running focus countdown in the tooltip.
  const focus = focusDoc.state.phase !== "idle" ? FOCUS.remaining(focusDoc.state, Date.now()) : null;
  if (focus && focus.remainingMs > 0) {
    const mm = Math.ceil(focus.remainingMs / 60000);
    parts.push(`🍅 ${focus.phase === "focus" ? L("focusShort") : L("breakShort")} ${mm}m`);
  }
  // v1.1.2: only mention the endpoint when it is actually a problem. A tooltip
  // permanently reading "RPC ok" is noise; one that reads "RPC slow" is a
  // diagnosis, and it explains an otherwise empty balance at a glance.
  if (RPC.unhealthy(rpcHealth)) parts.push(`RPC ${RPC.label(rpcHealth)}`);
  return parts;
}

function applyTooltip(sol) {
  if (!tray || tray.isDestroyed() || isQuitting) return;
  try {
    const parts = tooltipParts(sol);
    tray.setToolTip(parts.length ? `Pilly · ${parts.join(" · ")}` : "Pilly - tap to chat");
  } catch (e) { /* a tooltip is never worth an error */ }
}

// Tray tooltip: SOL price + first watched coin (glanceable without opening chat).
async function updateTrayInfo(prices) {
  if (!tray || isQuitting) return;
  try {
    if (prices) lastPrices = prices;
    let sol = prices && prices[SOL_MINT];
    if (!sol) {
      const r = await COINS.fetchSolPrice();
      sol = r;
      if (r) lastPrices = { ...(lastPrices || {}), [SOL_MINT]: r };
    }
    applyTooltip(sol);
  } catch (e) { /* ignore */ }
}

// ---- v1.1.1: focus sessions + activity diary ----
function focusBusy() {
  return focusDoc.state.phase !== "idle";
}

function focusStatusPayload() {
  return { ...FOCUS.remaining(focusDoc.state, Date.now()), cfg: focusDoc.cfg };
}

function broadcastFocusStatus() {
  const payload = focusStatusPayload();
  sendToChat("pilly:focus:status", payload);
  if (petWin && !petWin.isDestroyed()) petWin.webContents.send("pet:focus", payload);
  return payload;
}

function focusStart(minutes, breakMinutes) {
  if (focusDoc.state.phase === "focus") {
    return broadcastFocusStatus(); // already going - don't reset the clock
  }
  // Optional one-off override from chat ("start focus 50" / "pomodoro 25/5").
  let cfg = focusDoc.cfg;
  const m = Math.round(Number(minutes));
  if (Number.isFinite(m) && m > 0) {
    cfg = { ...focusDoc.cfg, focusMin: Math.min(180, m) };
    const b = Math.round(Number(breakMinutes));
    if (Number.isFinite(b) && b > 0) cfg.breakMin = Math.min(60, b);
  }
  focusDoc.state = FOCUS.startPhase(focusDoc.state, "focus", Date.now(), cfg);
  FOCUS.saveDoc(userDataDir(), focusDoc);
  bumpStat("focusStarted");
  const payload = broadcastFocusStatus();
  showPetJoke(`🍅 Focus on! ${payload.plannedMin} min — I'll keep quiet.`);
  playPetSound("coin");
  return payload;
}

function focusStop() {
  focusDoc.state = FOCUS.stopState(focusDoc.state, Date.now(), focusDoc.cfg);
  FOCUS.saveDoc(userDataDir(), focusDoc);
  return broadcastFocusStatus();
}

function focusPause() {
  const before = focusDoc.state;
  focusDoc.state = FOCUS.pauseState(focusDoc.state, Date.now());
  if (focusDoc.state !== before) FOCUS.saveDoc(userDataDir(), focusDoc);
  return broadcastFocusStatus();
}

function focusResume() {
  const before = focusDoc.state;
  focusDoc.state = FOCUS.resumeState(focusDoc.state, Date.now());
  if (focusDoc.state !== before) FOCUS.saveDoc(userDataDir(), focusDoc);
  return broadcastFocusStatus();
}

// The tray's Focus submenu drives the same sessions the chat does, and a tray
// click is the one focus change the chat window cannot see for itself (anything
// typed there prints its own line). So a tray click narrates itself into the
// transcript through the status channel, with an `announce` field on top of the
// payload. The 60s status tick never sets that field, so the tick stays quiet
// instead of writing a line into the chat every minute.
function trayFocus(kind) {
  const before = focusDoc.state.phase;
  const run = {
    start: () => focusStart(),
    pause: () => focusPause(),
    resume: () => focusResume(),
    stop: () => focusStop(),
  }[kind];
  if (!run) return null;
  let p;
  try { p = run(); } catch (e) { return null; }
  if (!p) return p;
  const mm = Math.max(0, Math.ceil((Number(p.remainingMs) || 0) / 60000));
  let line;
  if (kind === "start") {
    line = before === "focus"
      ? `🍅 already focusing — about ${mm} min left.`
      : `🍅 Focus started from the tray — ${p.plannedMin} min. I'll keep the chatter down.`;
  } else if (kind === "stop") {
    line = before === "idle"
      ? "🍅 No session was running — nothing to stop."
      : "🛑 Focus off. Go stretch, then come back when you're ready.";
  } else if (kind === "pause") {
    line = p.paused
      ? `⏸️ Focus paused — ${mm} min left whenever you're ready.`
      : "🍅 Nothing is running to pause.";
  } else {
    line = p.phase === "idle"
      ? "🍅 Nothing to resume — start a session first."
      : `▶️ Back at it — about ${mm} min left.`;
  }
  sendToChat("pilly:focus:status", { ...p, announce: line });
  return p;
}

// Runs every 60s: samples system idle time to (a) record this minute in the
// local activity diary and (b) roll the pomodoro machine over. Privacy-safe -
// it only ever sees idle duration, never what the user typed or clicked.
function focusTick() {
  const now = Date.now();

  let idleSec = null;
  try {
    idleSec = powerMonitor.getSystemIdleTime();
  } catch (e) {
    idleSec = null;
  }

  let active = true;
  if (idleSec != null) {
    active = idleSec < 60;
    // Returning to the keyboard after a long silence quietly starts a focus.
    const resumeEdge =
      lastIdleSec != null &&
      lastIdleSec >= focusDoc.cfg.idleResumeMin * 60 &&
      idleSec < 10;
    if (resumeEdge) {
      focusDoc.state = FOCUS.maybeAutoStartState(focusDoc.state, now, focusDoc.cfg, lastIdleSec * 1000);
    }
    lastIdleSec = idleSec;
  }

  ACTIVITY.record(userDataDir(), now, active);

  const before = focusDoc.state.phase;
  focusDoc.state = FOCUS.tickState(focusDoc.state, now, focusDoc.cfg);
  if (focusDoc.state.phase !== before) {
    FOCUS.saveDoc(userDataDir(), focusDoc);
    if (focusDoc.state.phase === "break" || focusDoc.state.phase === "long_break") {
      const long = focusDoc.state.phase === "long_break";
      const mins = long ? focusDoc.cfg.longBreakMin : focusDoc.cfg.breakMin;
      showPetJoke(`🍅 Nice focus! ${long ? "Long" : "Short"} break — ${mins} min.`);
      playPetSound("coin");
      bumpStat("focusDone");
    }
  }
  broadcastFocusStatus();
  updateTrayInfo(null).catch(() => {});

  // Morning digest: yesterday's activity, once per day after 05:00.
  const nowDate = new Date(now);
  const dayStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).getTime();
  if (focusDoc.digestDay !== dayStart && nowDate.getHours() >= 5) {
    focusDoc.digestDay = dayStart;
    FOCUS.saveDoc(userDataDir(), focusDoc);
    const y = ACTIVITY.yesterdayStats(userDataDir(), now);
    if (y.total > 0) {
      const streak = ACTIVITY.streakDays(userDataDir(), now);
      const streakTxt = streak > 0 ? ` 🔥 ${streak}-day streak!` : "";
      showPetJoke(`📊 Yesterday: ${y.active} active min (${y.pct}%) — ${focusDoc.state.completed} 🍅 done.${streakTxt}`);
    }
  }
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
      language: chatLang(), // v1.1.3: "zh" locks replies to Chinese
    });
  } catch (e) {
    return { error: String((e && e.message) || e) };
  }
});

// v1.1.3: Pilly's own home token (the project's coin) - the renderer uses this
// for the 💊 PillCrew chip.
ipcMain.handle("pilly:home-token", () => PILLY.HOME_TOKEN);

ipcMain.handle("pilly:meme", () => PILLY.MEME_PROMPTS);
ipcMain.handle("pilly:detect-task", (event, text) => require("./src/meme").detectTask(String(text || "")));

// ---- IPC: settings (own AI API) ----
ipcMain.handle("pilly:settings:get", () => SETTINGS.effective(userDataDir()));
ipcMain.handle("pilly:settings:save", (event, s) => {
  // The settings form knows nothing about whether Pilly is currently running, or
  // where he is standing, so carry both over - otherwise a plain "Save" would
  // switch the pet off on the next launch and teleport him back to default.
  const prevLang = chatLang();
  const cur = petOpts();
  const merged = Object.assign({}, s || {}, {
    pet: Object.assign({}, (s && s.pet) || {}, { on: !!cur.on, pos: cur.pos || null }),
  });
  const r = SETTINGS.save(userDataDir(), merged);
  // v1.1.3: the tray menu is translated, so a language switch must rebuild it.
  if (chatLang() !== prevLang) applyTrayMenu();
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
    // v1.1.3: when the user checks the project's own token, Pilly knows his
    // family - the AI read gets a home-token note so it speaks with pride.
    if (data && data.coin && data.context && String(mint).trim() === PILLY.HOME_TOKEN.mint) {
      data.coin.home = true;
      data.context += `\n\nNOTE: this is ${PILLY.HOME_TOKEN.name} ($${PILLY.HOME_TOKEN.symbol}) - PILLY'S OWN home token, the project's coin. Speak of it with warm, proud familiarity (meme-pro, never fake numbers, one casual 'not financial advice').`;
    }
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
// The last trending read that actually worked - see src/trendcache.js for why a
// blip turns into an old-but-labelled list instead of a dead end.
let lastTrendingGood = null;
ipcMain.handle("pilly:trending", async () => {
  try {
    bumpStat("trends");
    const data = await COINS.fetchTrendingTop(10);
    const fresh = TREND.trendingToStore(data);
    if (!fresh) {
      const stale = TREND.trendingFallback(lastTrendingGood, data);
      return (
        stale || { list: [], context: "trending unavailable", rateLimited: !!(data && data.rateLimited) }
      );
    }
    lastTrendingGood = fresh;
    const chgs = fresh.list.map((c) => c.change24h).filter((c) => c != null && isFinite(c));
    if (chgs.length) {
      const avg = chgs.reduce((s, c) => s + c, 0) / chgs.length;
      sendPetMarket({ kind: avg >= 0.5 ? "up" : avg <= -0.5 ? "down" : "flat", name: "trending" });
    }
    return { list: fresh.list, context: fresh.context, rateLimited: !!(data && data.rateLimited) };
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
  try {
    const prices = await COINS.fetchPrices(items.map((i) => i.mint));
    return { items, prices };
  } catch (e) {
    // Every other network handler answers with a shape the renderer can read.
    // Without this, a timeout here came back as a rejected invoke and the
    // watchlist said it could not load instead of showing the coins unpriced.
    console.warn("[pilly] the watchlist price poll failed:", (e && e.message) || e);
    return { items, prices: {} };
  }
});

// ---- IPC: PnL tracking (entry prices) ----
ipcMain.handle("pilly:pnl:get", (event, mint) => PNL.get(userDataDir(), String(mint || "").trim()));
ipcMain.handle("pilly:pnl:set", (event, mint, entry) =>
  PNL.set(userDataDir(), String(mint || "").trim(), Number(entry))
);
ipcMain.handle("pilly:pnl:remove", (event, mint) => PNL.remove(userDataDir(), String(mint || "").trim()));
ipcMain.handle("pilly:pnl:all", () => PNL.all(userDataDir()));

// ---- IPC: reminders (v1.1.1) ----
ipcMain.handle("pilly:reminder", (event, text) => {
  const parsed = REMINDERS.parseReminder(String(text || ""));
  if (!parsed) {
    return { ok: false, message: L("remParse") };
  }
  const r = REMINDERS.add(userDataDir(), parsed);
  if (!r.ok) return { ok: false, message: L("remPast") };
  return { ok: true, reminder: r.reminder };
});
ipcMain.handle("pilly:reminders:list", () => REMINDERS.list(userDataDir()));
ipcMain.handle("pilly:reminders:remove", (event, id) => REMINDERS.remove(userDataDir(), String(id || "").trim()));

// ---- IPC: focus + activity diary (v1.1.1) ----
ipcMain.handle("pilly:focus:status", () => focusStatusPayload());
ipcMain.handle("pilly:focus:config", () => focusDoc.cfg);
ipcMain.handle("pilly:focus:start", (event, minutes, breakMinutes) => focusStart(minutes, breakMinutes));
ipcMain.handle("pilly:focus:stop", () => focusStop());
ipcMain.handle("pilly:focus:pause", () => focusPause());
ipcMain.handle("pilly:focus:resume", () => focusResume());
ipcMain.handle("pilly:activity:today", () => ACTIVITY.todayStats(userDataDir(), Date.now()));
ipcMain.handle("pilly:activity:yesterday", () => ACTIVITY.yesterdayStats(userDataDir(), Date.now()));
ipcMain.handle("pilly:activity:streak", () => ACTIVITY.streakDays(userDataDir(), Date.now()));

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
  // A wallet that cannot be checked must not turn the whole list into an error
  // for the renderer, but it should still be visible in the log.
  await whalePoll().catch((e) => console.warn("[pilly] checking the whale list failed:", (e && e.stack) || e));
  return WHALES.list(userDataDir());
});

// ---- IPC: radar (fresh launches) + sparkline + open external ----
ipcMain.handle("pilly:radar", async () => {
  try {
    bumpStat("radar");
    // `floor` travels with the data so the panel can state the rule it is applying.
    return { ...(await COINS.fetchNewCoins(12)), floor: COINS.MIN_FRESH_MCAP };
  } catch (e) {
    return { list: [], context: "radar unavailable right now", hidden: 0, floor: COINS.MIN_FRESH_MCAP };
  }
});
ipcMain.handle("pilly:spark", async (event, mint) => {
  try {
    return await COINS.fetchSpark(String(mint || "").trim());
  } catch (e) {
    return null;
  }
});
ipcMain.handle("pilly:openExternal", async (event, url) => {
  const u = String(url || "");
  if (!/^https?:\/\//i.test(u)) return { ok: false };
  return { ok: await openExternal(u) };
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
// One switch, two ways in (the chat's heart button and the tray checkbox), so the
// saved state, the tray tick and the chat button can never drift apart.
function setPetOn(on) {
  if (on) startPet();
  else stopPet();
  rememberPetOn(petActive);
  applyTrayMenu();
  sendToChat("pilly:pet:active", petActive);
  return petActive;
}

ipcMain.handle("pilly:pet:toggle", () => {
  return { active: setPetOn(!petActive) };
});
ipcMain.handle("pilly:pet:settings", () => petOpts());
ipcMain.handle("pilly:pet:apply", (event, pet) => {
  const p = Object.assign({}, petOpts(), pet || {});
  // Persist immediately (not only on "Save") so the pet choices survive a
  // restart - AND so the walking logic (which reads petOpts() live) switches
  // to whole-monitor mode / new stop frequency right away.
  try {
    SETTINGS.savePet(userDataDir(), p);
  } catch (e) { /* ignore */ }
  if (petWin && !petWin.isDestroyed()) petWin.webContents.send("pet:settings", p);
  if (bubbleWin && !bubbleWin.isDestroyed()) bubbleWin.webContents.send("pet:settings", p);
  return { ok: true };
});
// Stage 3: the chat renderer tells Pilly the mood of the conversation.
ipcMain.handle("pilly:pet:mood", (event, m) => {
  const k = m && m.kind;
  if (k === "happy") bumpStat("happy");
  else if (k === "sad") bumpStat("sad");
  if (petActive && petWin && !petWin.isDestroyed()) {
    petWin.webContents.send("pet:mood", m || { kind: "flat" });
  }
  return { ok: true };
});
// v1.1.1: the pet window reports battery state; warn once per discharge cycle.
ipcMain.handle("pilly:pet:battery", (event, info) => {
  const low = !!(info && info.low);
  if (low && !batteryWarned) {
    batteryWarned = true;
    showPetJoke("🔋 battery's low — plug me in!");
  } else if (!low) {
    batteryWarned = false; // charging again -> re-arm for the next cycle
  }
  return { ok: true };
});
// v1.1.2: the renderers report the OS "reduce motion" preference, because the
// main process cannot read it on every platform. Today it keeps the tray icon
// still; any future main-process animation should consult it too.
ipcMain.on("ui:prefs", (event, prefs) => {
  if (!prefs || typeof prefs.reduceMotion !== "boolean") return;
  if (reduceMotionPref === prefs.reduceMotion) return;
  reduceMotionPref = prefs.reduceMotion;
  // Park the icon on frame 0, so a user who just turned the setting on does not
  // get stuck looking at a half-turned pill.
  if (reduceMotionPref && tray && !isQuitting) {
    trayFrame = 0;
    tray.setImage(trayIconFor(0));
  }
});
// While walking across the monitor, the user can grab Pilly and drag it.
// The OS cursor is the one witness that cannot lie about a carry: the renderer
// asks whether the cursor is still on the pet when a hover looks suspiciously
// long (v1.1.4 - the window can slide out from under a captured press and the
// mouseout is lost, which used to freeze him in mid-air until he was switched
// off and on). A hand still on him keeps the carry alive.
function cursorOverPet() {
  try {
    if (!petWin || petWin.isDestroyed()) return false;
    const c = screen.getCursorScreenPoint();
    const b = petWin.getBounds();
    const m = 10; // a hand on his edge is still a hand on him
    return c.x >= b.x - m && c.x <= b.x + b.width + m && c.y >= b.y - m && c.y <= b.y + b.height + m;
  } catch (e) {
    return false;
  }
}
ipcMain.handle("pet:drag-cursor-over", () => cursorOverPet());
ipcMain.on("pet:drag", (event, payload) => {
  if (!petWin || petWin.isDestroyed()) return;
  const mode = payload && payload.mode;
  if (mode === "start") {
    petDragging = true;
    petDragSeenAt = Date.now();
    petDragStartAt = Date.now();
    petTarget = null;
    petState = "pause";
    petStateStart = Date.now();
    petLastState = "pause";
  } else if (mode === "end") {
    petDragging = false;
    petDragSeenAt = 0;
    petDragStartAt = 0;
    petState = "pause";
    petStateStart = Date.now();
    petStateEnd = Date.now() + pauseMs();
    rememberPetPos(true); // the user just decided where Pilly lives
  } else if (mode === "move" || mode === "hold") {
    if (mode === "move") {
      const dx = Number(payload.dx) || 0;
      const dy = Number(payload.dy) || 0;
      if (!dx && !dy) return;
      petX += dx;
      petY += dy;
      // Keep Pilly reachable - and let him be parked on ANY monitor: the old
      // clamp used the primary workArea, so dragging him to a second screen
      // snapped him back to the first one.
      const area = workAreaFor(petX + PET_W / 2, petY + PET_H / 2);
      petX = Math.max(area.x - PET_W + 24, Math.min(petX, area.x + area.width - 24));
      petY = Math.max(area.y - 24, Math.min(petY, area.y + area.height - 24));
      petWin.setPosition(Math.round(petX), Math.round(petY));
      rememberPetPos();
    }
    // Any report is a hand on him, so the 4 s watchdog above can never drop a
    // carry the renderer is still reporting. "hold" is the renderer saying "still
    // holding, not moving": without it, holding him perfectly still for four
    // seconds read as a lost release and he walked out of the hand carrying him.
    if (!petDragging) {
      petDragging = true;
      petDragStartAt = Date.now();
      petState = "pause";
      petStateStart = Date.now();
      petLastState = "pause";
    }
    // The walk target is meaningless after being carried: without this he set off
    // again towards wherever he was heading before you grabbed him.
    petTarget = null;
    petDragSeenAt = Date.now();
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
// Being petted has no downside, so these are short - and he only says one now
// and then (see petReactQuietUntil). A pet that narrates every stroke is noise:
// the point of the animation is that it does not need words.
const PET_LINES = [
  "ok. five more minutes.",
  "not a word about this.",
  "that's... acceptable.",
  "who's a good trader? me.",
  "purrr. i mean - noted.",
  "keep going, i'm not counting.",
  "fine. you've earned a point.",
];
// One spoken reaction per cuddle. Without it every stroke sample that starts a
// new cuddle would queue another line and the bubble would flicker.
let petReactQuietUntil = 0;
ipcMain.on("pet:react", (event, kind) => {
  if (!petActive) return;
  // pet.html sends "dragstart"/"dragend" - normalize so the stat and the
  // correct line set fire (drag stat stayed 0 and end-lines never showed).
  const k = kind === "dragstart" ? "start" : kind === "dragend" ? "end" : kind;
  // v1.1.2 touch reactions. This used to be "end" versus *everything else*, so a
  // new kind came out as the drag complaint ("hey! put me down!") - which is
  // exactly what petting him would have said. An explicit switch is the only way
  // that stays honest as more reactions get added.
  if (k === "pet") {
    bumpStat("pets");
    if (Date.now() < petReactQuietUntil) return;
    petReactQuietUntil = Date.now() + 20000;
    const line = PET_LINES[Math.floor(Math.random() * PET_LINES.length)];
    setBubbleClickable(false);
    const b = ensureBubbleWin();
    sendBubbleJoke("💗 " + line);
    positionBubble();
    b.showInactive();
    sendPetTalking(true);
    if (bubbleTimer) clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => {
      if (bubbleWin && !bubbleWin.isDestroyed()) bubbleWin.hide();
      sendPetTalking(false);
    }, 3000);
    return;
  }
  if (k === "wake") {
    // He was asleep. The renderer owns the stroke, main owns the state, so the
    // renderer asks and main answers - and the answer has to be a real pet:state
    // push: the renderer's own copy is still "sleep" and it gates the whole
    // petting animation on it. Silent by design, being woken up is a state change
    // and not a remark. petLastState is set too, so the tick loop does not send
    // the same value a second time.
    petState = "pause";
    petStateStart = Date.now();
    petStateEnd = Date.now() + pauseMs();
    petLastState = "pause";
    if (petWin && !petWin.isDestroyed()) petWin.webContents.send("pet:state", "pause");
    return;
  }
  if (k !== "start" && k !== "end") return; // unknown kind: do not guess
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
// v1.1.2: hiding from the chat's own header has to be *intent*, not a close.
// A renderer window.close() tears the window down on Windows (observed: the
// window's "close" event never fires, the webContents is destroyed instead), so
// the guard in createWindow() never got to record that the user wanted the
// window gone - chatWanted stayed true, and the survival net rebuilt the chat
// and re-showed it. That is the "I have to minimise him several times" bug: the
// user hides him, he pops back up ~300 ms later. Record the intent first and
// hide, so a teardown - native or deliberate - leaves him hidden.
ipcMain.handle("pilly:hide-chat", () => {
  chatWanted = false;
  if (win && !win.isDestroyed()) {
    saveWinBounds();
    win.hide();
  }
  return { ok: true };
});
ipcMain.handle("pilly:open-chat", () => {
  try {
    openChatWindow();
    return { ok: true };
  } catch (e) {
    // Nothing on the renderer side listens to this promise, so a throw here would
    // reject into nowhere and the click would look like it did nothing at all.
    console.warn("[pilly] could not open the chat:", (e && e.message) || e);
    return { ok: false };
  }
});
ipcMain.handle("pilly:github", async () => {
  return { ok: await openExternal("https://github.com/PillCrew/PillCrew") };
});
ipcMain.handle("pilly:version", () => app.getVersion());

// Coin APIs hand out avatars on CDNs that refuse the browser (CORP/ORB headers,
// 403 challenge pages) while the bytes themselves are fine. The renderer's
// <img> can never get past those, so the main process fetches instead - no page
// context, no CORP - and hands back a data URL the img paints directly. Tight
// timeout, https-only and an image/* sniff so a dead link can never stall a
// card or paint junk into the chat.
ipcMain.handle("pilly:img", async (e, url) => {
  if (typeof url !== "string" || !/^https:\/\//i.test(url)) return { ok: false };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await net.fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
        Accept: "image/*",
      },
    });
    if (!res.ok) return { ok: false };
    const type = (res.headers.get("content-type") || "").toLowerCase();
    if (!type.startsWith("image/")) return { ok: false };
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > 2 * 1024 * 1024) return { ok: false };
    return { ok: true, src: `data:${type};base64,${buf.toString("base64")}` };
  } catch (err) {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
});

// Forget the remembered window bounds so the next show snaps above the tray.
ipcMain.handle("pilly:reset-window", () => {
  resetWindowPosition();
  return { ok: true };
});

// ---- Auto-updates from GitHub (v1.1.0) ----
// electron-updater checks the PillCrew/PillCrew releases for a newer version
// than the installed one, downloads it in the background and (after the user
// confirms) restarts into the new build. Windows (NSIS) and signed macOS
// builds self-update; the portable build and unsigned macOS builds can't
// replace themselves, so they get a friendly pointer to GitHub instead of a
// cryptic updater error.
let updateState = { state: "idle", version: app.getVersion(), message: L("updReady") };

// macOS auto-update only works on a Developer ID signed bundle - the updater
// verifies the signature before swapping the .app out. An unsigned/ad-hoc
// build fails deep inside the updater with an unreadable error, so we detect
// it up front and downgrade to a "download it yourself" message. Result cached
// because spawning codesign on every check is wasteful.
let macSignCheck = null;
function macCanSelfUpdate() {
  if (process.platform !== "darwin") return true;
  if (macSignCheck !== null) return macSignCheck;
  try {
    // codesign writes its details to stderr, so capture both streams.
    const r = require("child_process").spawnSync(
      "codesign", ["-dv", "--verbose=4", app.getPath("exe")], { encoding: "utf8" }
    );
    const text = `${r.stdout || ""}${r.stderr || ""}`;
    macSignCheck = /Authority=Developer ID Application/.test(text);
  } catch (e) {
    macSignCheck = true; // can't tell -> don't block updates
  }
  return macSignCheck;
}

function sendUpdateStatus() {
  try {
    if (win && !win.isDestroyed()) win.webContents.send("pilly:update:status", updateState);
  } catch (e) { /* ignore */ }
}

function setUpdateStatus(patch) {
  updateState = { ...updateState, ...patch };
  sendUpdateStatus();
}

// ---- Update install recovery (v1.1.2) ----
// quitAndInstall() hands the pending installer to the OS and quits; when the OS
// blocks that installer (Windows Smart App Control, an antivirus verdict) the
// app silently vanishes and the user stays on the old version with no idea why.
// A marker parked before quitting turns that silence into a readable dialog on
// the next start: same version as when we left = the install never happened.
function updateMarkerPath() {
  return path.join(userDataDir(), "update-attempt.json");
}

function writeUpdateAttemptMarker(targetVersion) {
  try {
    fs.writeFileSync(updateMarkerPath(), JSON.stringify({
      fromVersion: app.getVersion(),
      targetVersion: String(targetVersion || ""),
      at: Date.now(),
    }));
  } catch (e) { /* a marker failure must never block the update itself */ }
}

function handleUpdateAttemptMarker() {
  let marker = null;
  try { marker = JSON.parse(fs.readFileSync(updateMarkerPath(), "utf8")); } catch (e) { return; }
  const from = String(marker.fromVersion || "");
  const target = String(marker.targetVersion || "");
  const now = app.getVersion();
  if (!from || !target || from !== now || target === now) {
    // The version moved on since the marker was written (the update worked), or
    // the marker is stale/unreadable: nothing to recover.
    try { fs.rmSync(updateMarkerPath(), { force: true }); } catch (e) { /* ignore */ }
    return;
  }
  // Still on the version that started the update: the installer never ran.
  const blame = process.platform === "win32" ? L("updBlameWin") : L("updBlameOs");
  setUpdateStatus({
    state: "error",
    version: target,
    message: L("updInstallFailedFn", target),
  });
  dialog.showMessageBox({
    type: "warning",
    title: L("updTitle"),
    message: L("updFailedGenericFn", target),
    detail: L("updDetailFn", blame),
    buttons: [L("updOpenPage"), L("updOk")],
  }).then((r) => {
    if (r.response === 0) openExternal("https://github.com/PillCrew/PillCrew/releases");
  }).catch(() => { /* the dialog is best effort */ }).finally(() => {
    // Only after the user has been told: a crash before the dialog must
    // re-announce on the next start, not be lost.
    try { fs.rmSync(updateMarkerPath(), { force: true }); } catch (e) { /* ignore */ }
  });
}

let updaterIsBusy = false;
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

autoUpdater.on("checking-for-update", () => setUpdateStatus({ state: "checking", message: L("updChecking") }));
autoUpdater.on("update-available", (info) => setUpdateStatus({
  state: "available",
  version: info && info.version,
  message: L("updAvailableFn", info && info.version ? info.version : ""),
}));
autoUpdater.on("update-not-available", (info) => setUpdateStatus({
  state: "latest",
  version: (info && info.version) || app.getVersion(),
  message: L("updLatest"),
}));
autoUpdater.on("download-progress", (p) => {
  const pct = p && p.percent != null ? Math.round(p.percent) : 0;
  setUpdateStatus({ state: "downloading", message: L("updDownloadingFn", pct) });
});
autoUpdater.on("update-downloaded", (info) => setUpdateStatus({
  state: "ready",
  version: info && info.version,
  message: L("updDownloaded"),
}));
autoUpdater.on("error", (err) => {
  const raw = err && err.message ? err.message : L("updCheckFailed");
  // The updater's signature failures are unreadable; swap in plain language.
  const sig = process.platform === "darwin" && /code ?sign|signature|codesign/i.test(raw);
  setUpdateStatus({ state: "error", message: sig ? L("updMacManual") : raw });
});

function checkForUpdates(manual) {
  if (!app.isPackaged) {
    if (manual) setUpdateStatus({ state: "error", message: L("updDevBuild") });
    return;
  }
  // The portable build can't replace itself while running, so it can't
  // auto-update. Point the user at GitHub instead of raising a cryptic error.
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    if (manual) setUpdateStatus({ state: "error", message: L("updPortable") });
    return;
  }
  // Unsigned macOS builds: fail fast with something readable.
  if (!macCanSelfUpdate()) {
    if (manual) setUpdateStatus({ state: "error", message: L("updMacManual") });
    return;
  }
  if (updaterIsBusy) return;
  updaterIsBusy = true;
  autoUpdater.checkForUpdates()
    .catch((err) => setUpdateStatus({ state: "error", message: err && err.message ? err.message : L("updCheckFailed") }))
    .finally(() => { updaterIsBusy = false; });
}

ipcMain.handle("pilly:update:check", () => {
  checkForUpdates(true);
  return { ok: true, state: updateState };
});
ipcMain.handle("pilly:update:install", () => {
  if (updateState.state === "ready") {
    // Park the expectation first: if the installer the OS runs for us is
    // blocked (Smart App Control, an antivirus), the app vanishes with nothing
    // installed - the marker makes the next start say so out loud.
    writeUpdateAttemptMarker(updateState.version);
    isQuitting = true;
    autoUpdater.quitAndInstall(false, true);
    return { ok: true };
  }
  return { ok: false, message: L("updNoDownloaded") };
});
ipcMain.handle("pilly:update:state", () => updateState);
ipcMain.handle("pilly:update:open", async () => {
  return { ok: await openExternal("https://github.com/PillCrew/PillCrew/releases") };
});

ipcMain.handle("pilly:quit", () => {
  isQuitting = true;
  app.quit();
  return { ok: true };
});

// Linux + Wayland (Ubuntu 22.04+/24.04 default): without this Chromium feature
// flag, globalShortcut silently fails to register when Electron runs on the
// native Wayland backend. Harmless under X11/XWayland.
if (process.platform === "linux") {
  app.commandLine.appendSwitch("enable-features", "GlobalShortcutsPortal");
}

// A second Pilly would mean a second tray icon, a second pet walking the
// taskbar, duplicate alerts - and two processes writing the same settings and
// position files on top of each other. A second launch therefore hands the
// request to the running app and exits instead of building a rival copy.
const isPrimaryInstance = app.requestSingleInstanceLock();
if (!isPrimaryInstance) {
  app.exit(0);
} else {
  app.on("second-instance", () => {
    // A second launch means "put him in front of me" - a window that is already
    // open keeps its place, a minimised one comes back.
    revealWindow(false);
  });
}

app.whenReady().then(() => {
  if (!isPrimaryInstance) return; // the other instance owns the tray
  if (process.platform === "win32") app.setAppUserModelId("fun.pillcrew.pilly");
  applyMacAppMenu();
  iconFrames = loadFrames();
  createWindow();
  // The tray is a convenience, not a prerequisite: a Linux session without
  // AppIndicator support (or a theme-less tray host) makes `new Tray()` throw,
  // and an exception here used to take the rest of startup with it - a running
  // process with no icon, no pet and no chat window.
  safely("creating the tray", createTray);
  // v1.1.2: bring Pilly back if he was on the taskbar when the app last closed.
  if (petOpts().on) startPet();
  // v1.1.2: a monitor going away (laptop undocked at the desk) must not take
  // Pilly or the chat window with it.
  const onDisplaysChanged = () => { clampPetToDisplays(); clampChatToDisplays(); };
  screen.on("display-removed", onDisplaysChanged);
  screen.on("display-added", onDisplaysChanged);
  screen.on("display-metrics-changed", onDisplaysChanged);
  // Linux: GNOME hides tray icons unless the AppIndicator extension is
  // installed, so a tray-only app looks like it never started. Surface the
  // chat window once at launch on Linux.
  if (process.platform === "linux") {
    revealWindow(true);
  }
  // v1.1.2: CommandOrControl+Alt+P - the old Ctrl/Cmd+Shift+P collided with
  // VS Code's command palette (a dealbreaker for the Solana dev crowd).
  // The result used to be thrown away, which made a conflict with another app
  // completely silent: the user just pressed a dead key forever. Now the tray
  // menu says so instead.
  summonHotkeyOk = globalShortcut.register("CommandOrControl+Alt+P", () => toggleWindow());
  if (!summonHotkeyOk) {
    console.warn("[pilly] the summon hotkey (Ctrl/Cmd+Alt+P) is already owned by another app");
    applyTrayMenu();
  }
  // Watchlist alerts poll + tray live-price tooltip + RPC health.
  watchTimer = setInterval(() => { watchPoll().catch(() => {}); }, 30000);
  trayInfoTimer = setInterval(() => {
    updateTrayInfo(null).catch(() => {});
    bgTick("RPC health", refreshRpcHealth());
  }, 60000);
  watchPoll().catch(() => {});
  // Probe straight away so the menu does not sit on "checking…" for a minute.
  bgTick("RPC health", refreshRpcHealth());
  // Reminders poll every 10s (fire-once, then removed).
  reminderTimer = setInterval(checkReminders, 10000);
  checkReminders();
  // Focus sessions + activity diary: sample idle time every minute (v1.1.1).
  focusDoc = FOCUS.loadDoc(userDataDir());
  focusTickTimer = setInterval(focusTick, 60000);
  focusTick();
  // Look for a newer Pilly on GitHub (installed builds only).
  checkForUpdates(false);
  // v1.1.2: if the previous session quit to install an update and the version
  // did not change, the installer was blocked - say so instead of staying mute.
  handleUpdateAttemptMarker();
  // Windows and Linux do not emit before-quit when the machine is shut down or
  // the user logs out (Electron documents that for Windows), so without this the
  // window-survival watchers read the OS tearing our windows down as a crash:
  // they log a repair, and rebuilding a window in the last second of the session
  // is wasted work. Registered here because powerMonitor is only usable once the
  // app is ready. macOS has no shutdown event; the listener is harmless there.
  powerMonitor.on("shutdown", () => { isQuitting = true; });
}).catch((e) => {
  // Nothing above is optional enough to wrap one by one, but a throw in here
  // must not end as a silently rejected promise: that leaves a living process
  // with no window and no explanation.
  console.warn("[pilly] startup failed:", (e && e.stack) || e);
});

app.on("window-all-closed", () => { /* stay alive in the tray */ });
// macOS: clicking the Dock icon must re-open the chat, not silently no-op.
// (A hidden window has no Dock-visible surface otherwise.)
app.on("activate", () => {
  // A window the survival net had to destroy leaves win null, and the old guard
  // then did nothing at all - a Dock icon that is simply dead. An already open
  // window stays a no-op, so a Dock click never hides what you are looking at -
  // but a minimised window is "open" to AppKit and not to the user, which is the
  // macOS way to end up with a chat you cannot bring back at all.
  if (chatIsOpen(chatState(win))) return;
  revealWindow(true);
});
app.on("before-quit", () => {
  isQuitting = true;
  // Park him where he actually is, not only where he was last dragged to - a
  // pet who wanders off to the right edge should come back there.
  if (petWin && !petWin.isDestroyed()) rememberPetPos(true);
  stopPet();
});
// Electron asks for this explicitly, and it matters on macOS: the OS keeps a
// hotkey bound to a process that never released it far more stubbornly than
// Windows does.
app.on("will-quit", () => globalShortcut.unregisterAll());
