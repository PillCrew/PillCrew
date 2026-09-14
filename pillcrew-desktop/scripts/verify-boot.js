// v1.1.2 end-to-end verification: boots the REAL main.js (not a copy of its
// window options), drives the shipped chat UI, and inspects the windows the app
// actually creates. Run with an isolated --user-data-dir.
const { app, BrowserWindow, ipcMain, screen, Tray, Menu, MenuItem } = require("electron");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SETTINGS = require(path.join(ROOT, "src", "settings.js"));

// Wait until a window stops moving on its own. A window that was just shown is
// placed by the app a moment later, and measuring it before that settles means
// measuring the app's placement instead of the thing under test.
async function settleBounds(read, tries = 8) {
  let prev = null;
  for (let i = 0; i < tries; i++) {
    await wait(120);
    const now = read();
    if (now && prev && now.x === prev.x && now.y === prev.y) return now;
    prev = now;
  }
  return prev;
}

function dataDir() {
  const a = process.argv.find((x) => x.startsWith("--user-data-dir="));
  return a ? a.split("=").slice(1).join("=") : "";
}
function savedPet() {
  try { return (SETTINGS.load(dataDir()).pet || {}); } catch (e) { return {}; }
}
function savedTiers() {
  try { return SETTINGS.load(dataDir()).tiers || []; } catch (e) { return []; }
}

const failures = [];
let checks = 0;
function check(name, ok, info) {
  checks++;
  if (!ok) failures.push(name);
  console.log(`${ok ? "PASS  " : "FAIL  "}${name}${info !== undefined ? "  -> " + JSON.stringify(info) : ""}`);
}

// A harness that hangs tells nobody anything, and a rejected step used to leave
// this process alive forever with no output. Both are now loud: errors print the
// moment they happen and a watchdog ends the boot with the usual DONE line.
const BOOT_STARTED = Date.now();
// Every line carries the time since boot: when something dies between two lines,
// the gap between the row that last worked and the row that failed is what says
// whether the app was busy or idle - measurable, not guessed.
const rawLog = console.log.bind(console);
console.log = (...a) => rawLog(`[${((Date.now() - BOOT_STARTED) / 1000).toFixed(2)}s]`, ...a);
let bootFinished = false;
// --focus-nudge adds a real focus session, a pet restart and a reminder that has
// to wait for the app's own 10 s poll, so it legitimately takes ~30 s longer.
const WATCHDOG_MS = Number(process.env.BOOT_VERIFY_TIMEOUT_MS ||
  (process.argv.includes("--focus-nudge") ? 210000 : 150000));
const watchdog = setTimeout(() => {
  if (bootFinished) return;
  check(`the boot finished within ${WATCHDOG_MS} ms`, false, { stuckFor: Date.now() - BOOT_STARTED });
  done(1);
}, WATCHDOG_MS);

function done(code) {
  if (bootFinished) return;
  bootFinished = true;
  clearTimeout(watchdog);
  console.log(`BOOT_VERIFY_DONE checks=${checks} failures=${failures.length} in ${((Date.now() - BOOT_STARTED) / 1000).toFixed(1)}s`);
  setTimeout(() => app.exit(code || (failures.length ? 1 : 0)), 150);
}

const mainErrors = [];
// Anything after BOOT_VERIFY_DONE is app.exit() tearing windows down - real, but
// not a boot failure, and printing it as one made a clean boot look broken.
function reportMainError(label, e) {
  const detail = (e && e.message) || e;
  if (bootFinished) {
    console.log(`INFO  post-boot ${label}: ${detail}`);
    return;
  }
  mainErrors.push(label + ": " + detail);
  console.log(`FAIL  ${label}: ${detail}\n${(e && e.stack) || "(no stack)"}`);
}
process.on("uncaughtException", (e) => reportMainError("uncaught main-process error", e));
process.on("unhandledRejection", (e) => reportMainError("unhandled rejection", e));

// window-all-closed must not quit the harness when the pet's parent closes.
app.on("window-all-closed", () => {});

// A boot that stops printing used to be indistinguishable from a hang. Whenever
// a window or a renderer dies mid-run, say so - with its name - so a future
// "Object has been destroyed" points at the window that actually vanished.
const gone = [];
app.on("web-contents-created", (e, wc) => {
  const name = () => {
    try { return wc.isDestroyed() ? "(destroyed)" : (wc.getURL() || "").split(/[\\/]/).pop() || "(blank)"; }
    catch { return "(gone)"; }
  };
  // v1.1.2: main.js reloads a renderer that dies (see watchWindowSurvival), so
  // this is reported as the symptom it is instead of a failed boot - the checks
  // below are what proves whether the app recovered.
  wc.on("render-process-gone", (ev, d) => {
    gone.push({ page: name(), reason: d && d.reason, exitCode: d && d.exitCode });
    console.log(`WARN  a renderer died -> ${JSON.stringify({ page: name(), ...d })}`);
  });
  wc.on("unresponsive", () => {
    gone.push({ page: name(), reason: "unresponsive" });
    console.log(`FAIL  a renderer went unresponsive -> ${JSON.stringify(gone[gone.length - 1])}`);
  });
});
// A GPU/utility/network process dying is invisible from webContents events, and
// a compositor crash is one of the ways a window can be torn down without ever
// going through its own close path. Only during the run: helper processes
// exiting is normal once the app is quitting.
app.on("child-process-gone", (e, d) => {
  if (bootFinished) return;
  console.log(`WARN  child-process-gone -> ${JSON.stringify(d)}`);
});

app.on("browser-window-created", (e, w) => {
  let label = "(unknown)";
  // Touching w.webContents after the window is gone throws "Object has been
  // destroyed" - which is exactly the error this diagnostics block exists to
  // explain, so it must never be the one that raises it.
  const remember = () => {
    try {
      const url = w.webContents.getURL();
      if (url) label = url.split(/[\\/]/).pop() || label;
    } catch { /* window already gone - keep the last known label */ }
  };
  try { w.webContents.on("did-finish-load", remember); w.webContents.on("did-navigate", remember); } catch { /* already gone */ }
  w.on("closed", () => console.log(`INFO  a window closed ${bootFinished ? "during shutdown" : "mid-boot"} -> ${label}`));
  w.on("close", (ev) => console.log(`INFO  close event on ${label} (defaultPrevented=${ev.defaultPrevented})`));
  w.on("unresponsive", () => console.log(`INFO  the window ${label} went unresponsive`));
  w.on("responsive", () => console.log(`INFO  the window ${label} is responsive again`));
});
app.on("before-quit", () => console.log("INFO  app before-quit"));
app.on("will-quit", () => console.log("INFO  app will-quit"));

// Every executeJavaScript in this file goes through js(), so a destroyed window
// becomes a named failure instead of an anonymous rejected promise that stops
// the boot with no output.
// v1.1.2: main.js repairs a window that loses its renderer surface (see
// watchWindowSurvival there), so a lost window is waited out rather than read as
// a corpse for the rest of the run. main() installs the reviver.
let reviveChat = null;
async function js(win, code, what) {
  if (!win || win.isDestroyed() || !win.webContents || win.webContents.isDestroyed()) {
    noteChatDeath(win, what);
    const revived = reviveChat ? await reviveChat(what) : null;
    if (!revived) {
      check(`${what} (its window was destroyed and never came back)`, false, "window gone");
      return null;
    }
    win = revived;
  }
  try {
    return await win.webContents.executeJavaScript(code);
  } catch (e) {
    check(`${what} (executeJavaScript failed)`, false, String((e && e.message) || e));
    return null;
  }
}

// The chat window is built once at boot and must survive the whole run. If it
// ever dies, say when and record it once - a bare "Object has been destroyed"
// from a later step told us nothing about which window vanished or when.
//
// v1.1.2: a window can be torn down by something outside the app (on Windows a
// WM_DESTROY with no WM_CLOSE, which no Electron event reports). main.js repairs
// that, so a death per boot is a reported symptom rather than a failure - and the
// recovery it must lead to is what gets checked. A repeat is a heavier symptom
// (the platform teardown is recurring), so the count stays in the check details;
// main.js caps itself at four repairs a minute, so it cannot spin either way.
let chatDeath = null;
let chatDeaths = 0;
// How many of those losses the app actually repaired (reviveChatWindow found a
// live replacement). Losing a window is a symptom; losing one and never getting
// it back is the failure.
let chatRepairs = 0;
const deadWindows = [];
// The harness tears a window down on purpose at the end of the run; that must not
// count as the app losing one.
let deliberateKill = false;
function noteChatDeath(win, what) {
  if (deliberateKill) {
    console.log(`INFO  a window was destroyed by the harness -> ${what}`);
    return;
  }
  // app.exit() tears the windows down after the run is already over, and calling
  // that a mid-boot death made a clean boot read like a broken one.
  if (bootFinished) {
    console.log(`INFO  a window died during shutdown -> ${JSON.stringify({ what, url: label(win) })}`);
    return;
  }
  if (win && deadWindows.includes(win)) return; // same window, already reported
  if (win) deadWindows.push(win);
  chatDeaths++;
  const record = { at: ((Date.now() - BOOT_STARTED) / 1000).toFixed(1), what, url: label(win) };
  if (!chatDeath) chatDeath = record;
  // WARN, not FAIL: this is the known rare teardown (see watchWindowSurvival in
  // main.js). It is the app's job to bring the window back, and whether it did is
  // what the checks below measure - so a second loss in one boot is reported, not
  // failed, as long as it was repaired too.
  console.log(`WARN  a window died mid-boot -> ${JSON.stringify(record)}`);
}
// getBounds() throws on a destroyed window, which used to abort the run and
// hide every check after it.
function safeBounds(win) {
  try { return win && !win.isDestroyed() ? win.getBounds() : null; } catch { return null; }
}

// The pet window is created inside startPet(), which sets its position
// synchronously - but the first 24 ms tick already starts walking him. A
// setTimeout(0) lands exactly between the two, so this is his spawn spot.
let petSpawnBounds = null;
app.on("browser-window-created", (e, w) => {
  if (petSpawnBounds) return;
  setTimeout(() => {
    if (petSpawnBounds) return;
    try {
      const b = w.getBounds();
      if (b.width === 60 && b.height === 64) petSpawnBounds = b;
    } catch (err) { /* window already gone */ }
  }, 0);
});
// v1.1.2: the tray icon must stop bobbing when the OS asks for reduced motion,
// and that preference can only be read inside a renderer. Capture both halves of
// the trip: the message main receives, and the Tray.setImage calls it makes.
const uiPrefsSeen = [];
ipcMain.on("ui:prefs", (e, p) => uiPrefsSeen.push(p));
const traySetImageCalls = { n: 0 };
// The tooltip is the other half of "quiet when healthy, loud when broken": the
// RPC note may only ever appear while the endpoint is slow or dead, so every
// tooltip string the app sets is recorded and checked against that rule.
const trayTooltips = [];
try {
  const origSetToolTip = Tray.prototype.setToolTip;
  Tray.prototype.setToolTip = function (t) {
    trayTooltips.push(String(t));
    return origSetToolTip.apply(this, arguments);
  };
} catch (e) {
  console.log("INFO  could not wrap Tray.setToolTip: " + (e && e.message));
}
try {
  const origSetImage = Tray.prototype.setImage;
  Tray.prototype.setImage = function (...a) { traySetImageCalls.n++; return origSetImage.apply(this, a); };
} catch (e) {
  console.log("INFO  could not wrap Tray.setImage: " + (e && e.message));
}
// v1.1.2: the tray menu gained a Solana RPC health line. buildFromTemplate is the
// only place that label exists as plain text before it is on screen, so every
// template is recorded here and the line is read back out of it. This is also how
// the label is watched for its first real answer: it starts at "checking…".
const trayMenus = [];
try {
  const origBuildTemplate = Menu.buildFromTemplate;
  Menu.buildFromTemplate = function (tpl) {
    try { trayMenus.push(tpl); } catch (err) { /* not inspectable - the checks below report it */ }
    return origBuildTemplate.call(this, tpl);
  };
} catch (e) {
  console.log("INFO  could not wrap Menu.buildFromTemplate: " + (e && e.message));
}
const RPC_LINE_PREFIX = "Solana RPC: ";
const RPC_LINE_OK = /^Solana RPC: (checking…|unreachable|slow · [\d.]+ s|ok · \d+ ms)$/;
function rpcMenuLines() {
  const out = [];
  for (const tpl of trayMenus) {
    for (const item of tpl || []) {
      const l = item && typeof item.label === "string" ? item.label : "";
      if (l.startsWith(RPC_LINE_PREFIX)) out.push(l);
    }
  }
  return out;
}
// Up to 15 s: the probe answers in milliseconds when the endpoint is up and gives
// up after its own 6 s timeout when it is not, so either way it settles here.
async function waitForRpcLine() {
  for (let i = 0; i < 60; i++) {
    const lines = rpcMenuLines();
    const last = lines[lines.length - 1];
    if (last && !last.endsWith("checking…")) return last;
    await wait(250);
  }
  const lines = rpcMenuLines();
  return lines[lines.length - 1] || "";
}
// v1.1.2: pet:focus / pet:nudge / pet:state are pushes from main to the pet
// window. verify-anim.js proves the renderer draws a ring (or an emoji) from a
// payload; recording the real sends here is the only way to prove main produces
// that payload, and on which of its three paths: a focus session starting or
// stopping, a reminder coming due, or a pet window that loads while a session is
// already running (did-finish-load, where nothing broadcasts at all). Windows
// are hooked as they are created, so a pet window born mid-run is covered from
// its first frame.
const petSends = [];
const PET_CHANNELS = new Set(["pet:focus", "pet:nudge", "pet:state"]);
// v1.1.2: two pushes exist only for the chat transcript - a reminder that fires
// while Pilly is off (there is no bubble to carry it) and the line that narrates a
// focus session started from the tray. Recording them here, and reading the
// transcript back below, is what proves the whole chain (main -> preload ->
// renderer) instead of just the renderer half.
const chatSends = [];
const CHAT_CHANNELS = new Set(["pilly:reminder-fired", "pilly:focus:status"]);
app.on("browser-window-created", (e, w) => {
  try {
    const wc = w.webContents;
    if (!wc || wc.__pillyHarnessHooked) return;
    wc.__pillyHarnessHooked = true;
    const origSend = wc.send.bind(wc);
    wc.send = (ch, ...a) => {
      if (PET_CHANNELS.has(ch)) {
        const last = petSends[petSends.length - 1];
        // pet:state repeats on every 24 ms tick; only the changes are recorded.
        const repeat = ch === "pet:state" && last && last.ch === ch && last.arg === a[0];
        if (!repeat) petSends.push({ at: Date.now() - BOOT_STARTED, ch, arg: a[0] });
      }
      if (CHAT_CHANNELS.has(ch)) chatSends.push({ at: Date.now() - BOOT_STARTED, ch, arg: a[0] });
      return origSend(ch, ...a);
    };
  } catch (err) { /* window already gone */ }
});

// This harness drives the real UI: it starts and stops the pet, drags him, and
// presses Save in Settings. Without its own profile it would do all of that to
// whoever happens to be developing Pilly, so it refuses to run without one.
if (!dataDir()) {
  console.error("verify-boot: refusing to run on the real profile - pass --user-data-dir=<throwaway dir>");
  process.exit(2);
}

require(path.join(ROOT, "main.js"));

// Never throws: it is called from patched close/destroy paths where the window
// may already be gone, and that is the error this file exists to explain.
const label = (w) => { try { return (w.webContents.getURL() || "").split(/[\\/]/).pop() || "(blank)"; } catch { return "(gone)"; } };

app.whenReady().then(() => main().catch(async (e) => {
  // A rejected step used to abort the whole boot silently. Now it is a named
  // failure with the exact line, and the boot still closes with its DONE line.
  check("the boot steps ran to completion", false, String((e && e.stack) || e));
  await finish();
}));

// The macOS application menu, checked here because macOS is the one platform
// this gate cannot boot. Electron accepts an unknown role silently: it becomes a
// menu item with an empty label that does nothing when clicked, so a typo would
// ship as a dead entry in the menu bar and nothing on Windows or Linux would
// notice. A role Electron knows always resolves to a label - which is what makes
// the menu checkable off-macOS.
function checkMacAppMenu() {
  const { macAppMenuTemplate, menuItems, menuAppName, DEV_ROLES } = require(path.join(ROOT, "src", "macmenu.js"));
  let opened = 0;
  let template;
  // Electron answers app.name with "Electron" whenever it cannot see the app's
  // package.json, and on macOS that string is what the menu bar prints as the
  // application name - so the menu must not take its label from app.name.
  const name = menuAppName(require(path.join(ROOT, "package.json")));
  check("the macOS menu bar is labelled with the app, never with the toolkit",
    name === "Pilly", { menuName: name, appName: app.name });
  try {
    template = macAppMenuTemplate({
      appName: "Pilly",
      openChat: () => { opened++; },
      resetWindowPosition: () => {},
    });
  } catch (e) {
    check("the macOS app menu template builds without throwing", false, e && e.message);
    return;
  }
  const items = menuItems(template);
  const unresolved = [];
  for (const it of items) {
    if (!it.role) continue;
    let label = "";
    // MenuItem, not Menu.buildFromTemplate: the tray-menu spy wraps the latter
    // and this check must not add a template of its own to that list.
    try { label = new MenuItem({ role: it.role }).label || ""; } catch (e) { /* counted as unresolved */ }
    if (!label) unresolved.push(it.role);
  }
  check("every macOS menu role is one Electron can resolve", unresolved.length === 0, unresolved);
  const dev = items.filter((i) => DEV_ROLES.has(String(i.role || ""))
    || /reload|devtools|dev tools/i.test(String(i.label || "")));
  check("the macOS menu carries no reload / devtools entries", dev.length === 0, dev.map((i) => i.label || i.role));
  const roles = items.map((i) => String(i.role || "").toLowerCase());
  check("the macOS menu keeps the standard editing and quit roles",
    ["undo", "redo", "cut", "copy", "paste", "selectall", "quit", "hide", "about"].every((r) => roles.includes(r)), roles);
  const appCommands = items.filter((i) => i.menu === "Pet" && !i.role).map((i) => i.label);
  check("the macOS menu offers the app's own two commands",
    appCommands.length === 2 && appCommands.includes("Open chat") && appCommands.includes("Reset window position"), appCommands);
  const titles = template.map((m) => m.label);
  check("no two macOS menus share a title", new Set(titles).size === titles.length, titles);
  const openChat = items.find((i) => i.label === "Open chat");
  if (openChat && typeof openChat.click === "function") {
    try { openChat.click(); } catch (e) { /* reported through `opened` */ }
  }
  check("the macOS menu's Open chat is wired to the running app", opened === 1, { opened });
}

async function main() {
  checkMacAppMenu();

  // --- multi-monitor: does a restart put him back where the user parked him? ---
  // This has to run before any waiting: startPet() runs inside whenReady and he
  // starts walking on the very first tick, so the spawn position is only
  // observable for a few milliseconds.
  if (process.argv.includes("--expect-parked")) {
    const saved = savedPet().pos;
    // petSpawnBounds is captured in a setTimeout(0) - let that macrotask run,
    // but not long enough for the 24 ms walk tick to have moved him.
    for (let i = 0; i < 6 && !petSpawnBounds; i++) await wait(3);
    const b = petSpawnBounds;
    const wa = screen.getPrimaryDisplay().workArea;
    console.log(`INFO  parked=${JSON.stringify(saved)}  spawn=${JSON.stringify(b)}`);
    check("the pet window is back after a restart", !!b, !!b);
    check("a restart puts Pilly back on the exact spot he was parked on",
      !!saved && !!b && b.x === saved.x && b.y === saved.y, { saved, spawn: b });
    if (savedPet().walkMode !== "screen") {
      check("taskbar mode still lands him back on the taskbar line",
        !!b && b.y === wa.y + wa.height - 64 - 2, { y: b && b.y, expected: wa.y + wa.height - 66 });
    }
    await wait(300);
    await finish();
    return;
  }

  await wait(4000);
  let wins = BrowserWindow.getAllWindows();
  check("real main.js booted and created the chat window", wins.some((w) => label(w) === "index.html"), wins.map(label));

  let chat = wins.find((w) => label(w) === "index.html");
  const rendererErrors = [];
  // v1.1.2: the chat window is watched through one helper, because the app can
  // replace it (see reviveChatWindow below) - the replacement needs the same
  // watching as the original.
  const watchChat = (w) => {
    try { w.webContents.on("console-message", (e, level, msg) => { if (level >= 3) rendererErrors.push(msg); }); } catch (e) { /* ignore */ }
    w.on("closed", () => { if (chat === w) noteChatDeath(w, "closed"); });
  };
  if (chat) watchChat(chat);
  const chatAlive = () => !!chat && !chat.isDestroyed() && !chat.webContents.isDestroyed();
  // A window is only known to be the chat window once its URL has committed, and
  // a freshly built one is "blank" for a moment - so width is the fallback: 380 px
  // is the chat window and nothing else in this app is that width.
  const findChatWindow = () => {
    const live = BrowserWindow.getAllWindows().filter((w) => {
      if (w.isDestroyed()) return false;
      const l = label(w);
      return l === "index.html" || l === "(blank)";
    });
    const named = live.find((w) => label(w) === "index.html");
    if (named) return named;
    return live.find((w) => { const b = safeBounds(w); return !!b && b.width === 380; }) || null;
  };
  // A window that died mid-run must be reported once, with the step it died in -
  // and must not abort the run, or every later check silently disappears.
  const cb = () => {
    // Take the app's replacement the moment it exists: a check that runs before
    // the reviver got a turn should still measure a live window.
    if (!chatAlive()) {
      const found = findChatWindow();
      if (found && found !== chat) { chat = found; watchChat(found); }
    }
    const b = safeBounds(chat);
    if (!b) noteChatDeath(chat, "reading its bounds");
    return b;
  };
  // The window the app rebuilt after losing its renderer surface, or null when it
  // never came back. main.js repairs ~300 ms after the loss, so this waits it out
  // instead of failing every later step against a window that no longer exists.
  const reviveChatWindow = async (what) => {
    const stale = chat;
    for (let i = 0; i < 40; i++) {
      const found = findChatWindow();
      if (found && found !== stale && !found.webContents.isDestroyed()) {
        chat = found;
        watchChat(found);
        chatRepairs++;
        check("the app rebuilt the chat window it lost", true, { after: what, newWindow: found.id });
        return found;
      }
      await wait(100);
    }
    check("the app rebuilt the chat window it lost", false, { after: what, waitedMs: 4000 });
    return null;
  };
  reviveChat = reviveChatWindow;

  // v1.1.2: Solana RPC health in the tray - checked before the per-mode branches
  // so every boot covers it, including a fresh-profile launch that never starts
  // the pet. The line has to be there from the first menu build (so "checking…"
  // is a real state, not a line that appears out of nowhere), it has to settle on
  // a real answer, and the tooltip rule has to hold in both directions: silent
  // when the endpoint is fine, explicit when it is not - a tooltip that always
  // says "ok" is noise, one that says "slow" is the diagnosis for an otherwise
  // empty balance.
  const rpcLine = await waitForRpcLine();
  console.log(`INFO  Solana RPC menu line: ${rpcLine || "(missing)"}`);
  check("the tray menu carries a Solana RPC health line", rpcLine.startsWith(RPC_LINE_PREFIX), rpcLine || rpcMenuLines());
  check("the RPC line matches one of the four known states", RPC_LINE_OK.test(rpcLine), rpcLine);
  // The probe was kicked off at launch, so by now it cannot still be probing -
  // that is what proves the boot-time probe actually ran.
  const rpcSettled = rpcLine !== "" && !rpcLine.endsWith("checking…");
  check("the boot-time RPC probe settled instead of staying on 'checking…'", rpcSettled, rpcLine);
  check("the RPC line is informational, never clickable",
    trayMenus.some((tpl) => (tpl || []).some((i) => i && i.label === rpcLine && i.enabled === false)),
    rpcMenuLines());

  // The tooltip side of the same rule, both directions.
  const rpcTooltips = trayTooltips.filter((t) => /RPC /.test(t));
  console.log(`INFO  tooltips seen: ${trayTooltips.length}, mentioning RPC: ${rpcTooltips.length}` +
    (rpcTooltips.length ? ` (${rpcTooltips[rpcTooltips.length - 1]})` : ""));
  check("the tray tooltip never advertises a healthy RPC",
    !rpcTooltips.some((t) => /RPC ok · /.test(t)), rpcTooltips.slice(0, 3));
  const rpcHealthy = /(ok · \d+ ms)$/.test(rpcLine);
  if (rpcHealthy) {
    check("a healthy RPC is absent from the tooltip (silent when it is fine)", rpcTooltips.length === 0, rpcTooltips);
  } else if (rpcSettled) {
    // The note is written straight from the probe result, with no price fetch in
    // front of it, so a misbehaving endpoint shows up here without a long wait.
    check("a slow or dead RPC is named in the tooltip (loud when it is broken)",
      rpcTooltips.some((t) => /RPC (unreachable|slow · )/.test(t)), rpcTooltips.slice(-3));
  } else {
    console.log("INFO  the RPC probe never settled on this machine - the tooltip rule was not exercised");
  }

  if (process.argv.includes("--park-pet")) {
    // Drag him through the REAL ipcMain handler (the shipped preload path) and
    // check that the position is written, then that quitting flushes the very
    // latest spot instead of a stale debounce.
    const okClick = await js(chat,
      `(() => { const b = document.getElementById("petBtn"); if (!b) return false; b.click(); return true; })()`,
      "--park-pet: clicking the pet button");
    await wait(2500);
    const petw = BrowserWindow.getAllWindows().find((w) => label(w) === "pet.html");
    check("--park-pet: the pet button started the pet", okClick === true && !!petw, !!petw);
    if (!petw) { await finish(); return; }
    const startX = petw.getBounds().x;
    ipcMain.emit("pet:drag", {}, { mode: "start" });
    ipcMain.emit("pet:drag", {}, { mode: "move", dx: 40, dy: 0 });
    await wait(1400); // rememberPetPos debounces at 900 ms
    const p1 = savedPet().pos;
    check("dragging Pilly remembers where he was parked", !!p1 && Math.abs(p1.x - (startX + 40)) <= 2,
      { startX, saved: p1 });
    // v1.1.2: a hand that holds him perfectly still reports "hold" instead of
    // moving him. Main's 4 s carry watchdog cannot tell a still hand from a lost
    // release, so without that report it let go of a grab that never ended and he
    // walked out of the hand that was still holding him.
    ipcMain.emit("pet:drag", {}, { mode: "move", dx: -5000, dy: 0 }); // far left: exact maths, no clamp
    const parkedLeft = petw.getBounds().x;
    const dropped = [];
    const realWarn = console.warn;
    console.warn = (...a) => {
      const line = a.join(" ");
      if (/drag stopped reporting/.test(line)) dropped.push(line);
      else realWarn(...a);
    };
    const heartbeat = setInterval(() => ipcMain.emit("pet:drag", {}, { mode: "hold" }), 500);
    await wait(4300);
    clearInterval(heartbeat);
    console.warn = realWarn;
    check("a still hold is never mistaken for a lost release", dropped.length === 0, dropped);
    check("...and he is still exactly where the hand left him",
      petw.getBounds().x === parkedLeft, { parkedLeft, now: petw.getBounds().x });
    // The counter-case: when the reports really do stop, the watchdog has to let
    // go - and the next real move must pick the carry back up instead of ignoring
    // the hand that is already holding him.
    const dropped2 = [];
    console.warn = (...a) => {
      const line = a.join(" ");
      if (/drag stopped reporting/.test(line)) dropped2.push(line);
      else realWarn(...a);
    };
    await wait(4300);
    console.warn = realWarn;
    check("a carry nobody reports is still released by the watchdog", dropped2.length === 1, dropped2);
    const beforeRescue = petw.getBounds().x;
    ipcMain.emit("pet:drag", {}, { mode: "move", dx: 40, dy: 0 });
    check("a move after that release picks the carry back up", petw.getBounds().x === beforeRescue + 40,
      { beforeRescue, now: petw.getBounds().x });
    // Now shove him to the far right edge and quit before the debounce fires.
    ipcMain.emit("pet:drag", {}, { mode: "move", dx: 5000, dy: 0 });
    app.on("before-quit", () => {
      const wa = screen.getPrimaryDisplay().workArea;
      const expected = wa.x + wa.width - 24;
      const p2 = savedPet().pos;
      check("quitting flushes his current spot, not a stale debounce",
        !!p2 && p2.x === expected && (!p1 || p2.x !== p1.x), { saved: p2, expected, before: p1 });
      done();
    });
    app.quit();
    return;
  }

  // Start the pet exactly the way a user does: click the button in the UI.
  const wantClick = process.argv.includes("--click-pet");
  const petAlreadyThere = BrowserWindow.getAllWindows().some((w) => label(w) === "pet.html");
  console.log(`INFO  pet window present right after boot: ${petAlreadyThere}`);
  // On a profile that already has Pilly switched on he auto-starts, so clicking
  // the button means "switch him off" - only click when he is not there yet.
  const shouldClick = wantClick && !petAlreadyThere;
  if (wantClick && petAlreadyThere) {
    check("the pet auto-starts on a profile where he was left switched on", true, { petAlreadyThere });
  }
  const clicked = shouldClick && (await js(chat,
    `(() => { const b = document.getElementById("petBtn"); if (!b) return false; b.click(); return true; })()`,
    "the pet button"));
  if (shouldClick) {
    check("the pet button exists in the shipped renderer", clicked === true);
    // Switching him on writes the settings file. That write has to start from the
    // saved settings, never from the effective ones: effective() folds the .env
    // tiers in, so a pet write based on it would copy the API key out of .env into
    // pilly-settings.json and freeze it there. Boot D feeds a throwaway .env tier
    // so this is measurable instead of assumed.
    const envKey = process.env.PILLY_TIER1_KEY;
    if (envKey) {
      await wait(600);
      const tiers = savedTiers();
      check("switching the pet on does not copy the .env API key onto disk",
        !tiers.some((t) => t && t.key === envKey),
        { tiersWithAKey: tiers.filter((t) => t && t.key).length, tierCount: tiers.length });
    }
  }
  if (!wantClick) {
    // Only meaningful if a previous boot actually left the pet switched on;
    // a first launch on a fresh profile must legitimately start pet-less.
    const wanted = !!savedPet().on;
    console.log(`INFO  saved pet.on for this profile: ${wanted}`);
    check("the pet is running again after a restart (state is restored)", wanted ? petAlreadyThere : !petAlreadyThere,
      { savedPetOn: wanted, petWindow: petAlreadyThere });
    if (process.argv.includes("--click-save")) {
      // A plain settings Save must not switch the pet off - and must never wipe
      // API keys. Drive the real UI: the gear opens Settings, the tier row is
      // filled in, and Save posts readSettings() through the real IPC handler.
      const before = savedPet();
      const opened = await js(chat,
        `(() => { const b = document.getElementById("gearBtn"); if (!b) return false; b.click(); return true; })()`,
        "the gear button");
      await wait(900);
      const overlay = await js(chat,
        `(() => { const s = document.getElementById("settings"); return !!s && !s.classList.contains("hidden"); })()`,
        "the settings overlay");
      check("the gear button opens Settings through the shipped UI", opened === true && overlay === true, { opened, overlay });
      const filled = await js(chat,
        `(() => {
           const row = document.getElementById("tierRows").children[0];
           if (!row) return false;
           row.querySelector(".t-url").value = "https://api.example.test/v1/chat/completions";
           row.querySelector(".t-key").value = "sk-harness-regression-key";
           row.querySelector(".t-model").value = "harness-model";
           return true;
         })()`, "the tier row");
      const saved = await js(chat,
        `(async () => { const b = document.getElementById("saveBtn"); if (!b) return false; b.click(); return true; })()`,
        "the Save button");
      await wait(1500);
      const after = savedPet();
      check("saving settings keeps the pet enabled", saved === true && filled === true && after.on === true,
        { saved, filled, before: before.on, after: after.on });
      check("saving settings keeps Pilly's parked position",
        !!before.pos && !!after.pos && before.pos.x === after.pos.x && before.pos.y === after.pos.y,
        { before: before.pos, after: after.pos });
      check("saving settings keeps the API keys the user typed",
        (savedTiers()[0] || {}).key === "sk-harness-regression-key",
        { tier1: savedTiers()[0] });

      // Now the dangerous case: Save pressed while the tier rows do not exist.
      // readSettings() must not throw there, and must re-post the tiers that were
      // last saved rather than inventing empty ones (which would wipe the key).
      const errsBefore = rendererErrors.length;
      await js(chat,
        `(() => { document.getElementById("settingsClose").click(); return true; })()`,
        "the settings close button");
      await wait(400);
      await js(chat,
        `(() => { document.getElementById("saveBtn").click(); return true; })()`,
        "the Save button with the rows closed");
      await wait(1500);
      check("Save with the settings rows closed keeps the saved API key",
        (savedTiers()[0] || {}).key === "sk-harness-regression-key", { tier1: savedTiers()[0] });
      check("Save with the settings rows closed does not throw in the renderer",
        rendererErrors.length === errsBefore, rendererErrors.slice(errsBefore)
      );
    }
    // With Pilly running, keep going into the window checks below.
    if (!petAlreadyThere) {
      await wait(500);
      await finish();
      return;
    }
  }
  await wait(3000);

  wins = BrowserWindow.getAllWindows();
  // let, not const: the --focus-nudge section restarts Pilly and the checks after
  // it (reduce motion, display changes) must follow the window that is alive.
  let pet = wins.find((w) => label(w) === "pet.html");
  if (shouldClick) check("clicking the pet button creates a pet window through the real IPC path", !!pet, wins.map(label));
  check("the pet window is up and running", !!pet, wins.map(label));
  if (!pet) { await finish(); return; }

  // webContents.backgroundThrottling is the runtime reflection of the window's
  // webPreferences flag (getLastWebPreferences() only lists a subset).
  console.log("INFO  pet backgroundThrottling=" + pet.webContents.backgroundThrottling +
    "  chat backgroundThrottling=" + chat.webContents.backgroundThrottling);
  check("the real pet window opts out of background throttling", pet.webContents.backgroundThrottling === false, pet.webContents.backgroundThrottling);
  check("the chat window keeps Chromium's default throttling (it is a heavy page)", chat.webContents.backgroundThrottling === true, chat.webContents.backgroundThrottling);
  check("the real pet window is on screen (so it keeps painting)", pet.isVisible(), pet.isVisible());

  const probe = await js(pet, `new Promise((resolve) => {
    const c = document.getElementById("pet");
    const hashes = new Set();
    let ticks = 0, opaque = 0;
    const tick = () => { ticks++; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    const id = setInterval(() => {
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let h = 0; opaque = 0;
      for (let i = 0; i < d.length; i += 97) h = (h * 31 + d[i]) | 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) opaque++;
      hashes.add(h);
    }, 100);
    setTimeout(() => { clearInterval(id); resolve({ ticks, distinct: hashes.size, opaque }); }, 1500);
  })`, "the pet animation probe");
  check("the real pet window runs its rAF loop at full speed", probe && probe.ticks >= 45, probe && probe.ticks);
  check("the real pet window visibly changes frame to frame", probe && probe.distinct >= 8,
    probe && { distinct: probe.distinct, opaque: probe.opaque });

  // v1.1.2: he notices when you come back to the app. Guarded by a one-minute
  // cooldown in the main process so alt-tabbing cannot turn him twitchy, and by
  // "you have to leave first" - a focus that never followed a blur is the launch
  // itself. Whether this harness process can really take OS focus is up to the
  // desktop, so the blur/focus pair is emitted as well as performed: a check that
  // passes or fails with the window manager is a check nobody can trust. The
  // events are the same ones main.js wires a real alt-tab to.
  if (chat) {
    await js(pet,
      `(() => { window.__greets = 0; window.pilly.onPetGreet(() => { window.__greets++; }); return true; })()`,
      "the greet hook");
    if (!chat.isVisible()) { chat.show(); await wait(600); }
    // 1) A plain focus with no return behind it must stay silent - that is the
    // launch, and greeting one second after start-up is not "coming back".
    chat.emit("focus");
    await wait(250);
    const launchGreet = await js(pet, "window.__greets", "the greet count after a bare focus");
    check("a focus that never followed a blur does not greet (the launch is not a return)",
      launchGreet === 0, { launchGreet });
    // 2) Leaving and coming back does greet.
    chat.emit("blur");
    if (!chat.isDestroyed()) chat.focus();
    chat.emit("focus");
    await wait(400);
    const firstGreet = await js(pet, "window.__greets", "the first greet");
    // 3) Same pair seconds apart: the cooldown must swallow the second return.
    chat.emit("blur");
    chat.emit("focus");
    await wait(300);
    const secondGreet = await js(pet, "window.__greets", "the second greet");
    check("coming back to the app window makes Pilly greet you", firstGreet === 1, { firstGreet, secondGreet });
    check("a second return inside the cooldown is suppressed", secondGreet === 1, { firstGreet, secondGreet });
    check("the pet is still healthy after greeting",
      !pet.isDestroyed() && pet.isVisible() && !pet.webContents.isDestroyed(), pet.isDestroyed() ? "gone" : pet.isVisible());
  }

  // v1.1.2: the ring over his head and the reminder hop are both "main pushes a
  // payload, the renderer draws it". Only the renderer half had ever been
  // exercised, so this section drives the shipped IPC and checks the payload
  // main sends, the pixels that actually appear in the live window, and the one
  // path with no broadcast behind it at all: a pet window that loads while a
  // session is already running.
  if (process.argv.includes("--focus-nudge") && chatAlive()) {
    // Rows 3..12 and columns 23..37 of the 60x64 canvas are where the ring's top
    // arc lives (cx 30, cy 13, r 7) and where nothing else Pilly draws ever
    // goes: his body starts at y=30, and a hop lifts it to y=12 at most, so a
    // *minimum* over a few frames cannot be faked by a hop or by an emoji
    // particle (those are drawn at x=44 or rise through y=18+). Fractions, not
    // pixels, because the canvas backing store is scaled by devicePixelRatio.
    const ringBand = async (what) => js(pet, `new Promise((resolve) => {
      const c = document.getElementById("pet");
      const ctx = c.getContext("2d");
      const x = Math.round(c.width * 0.38), w = Math.max(1, Math.round(c.width * 0.62) - x);
      const y = Math.round(c.height * 0.04), h = Math.max(1, Math.round(c.height * 0.20) - y);
      let min = Infinity, n = 0;
      const id = setInterval(() => {
        const d = ctx.getImageData(x, y, w, h).data;
        let opaque = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 0) opaque++;
        if (opaque < min) min = opaque;
        if (++n >= 4) { clearInterval(id); resolve(min); }
      }, 90);
    })`, what);

    const off1 = await ringBand("--focus-nudge: the canvas before any session");
    check("--focus-nudge: nothing is drawn above his head while no session runs",
      typeof off1 === "number" && off1 <= 8, off1);

    const markFocus = petSends.length;
    const started = await js(chat, "window.pilly.focusStart(25)", "--focus-nudge: starting a focus session");
    check("--focus-nudge: the shipped IPC starts a 25-minute focus session",
      !!started && started.phase === "focus" && started.plannedMin === 25,
      started && { phase: started.phase, plannedMin: started.plannedMin });
    await wait(600);
    const pushed = petSends.slice(markFocus).filter((s) => s.ch === "pet:focus").pop();
    check("--focus-nudge: main pushes the running session to the pet window",
      !!pushed && !!pushed.arg && pushed.arg.phase === "focus" && pushed.arg.paused === false, pushed && pushed.arg);
    check("--focus-nudge: the pushed session carries the real time left",
      !!pushed && !!pushed.arg && Math.abs(pushed.arg.remainingMs - 25 * 60000) < 5000,
      pushed && pushed.arg && pushed.arg.remainingMs);

    const on = await ringBand("--focus-nudge: the canvas with the session running");
    check("--focus-nudge: the live pet window paints the focus ring",
      typeof on === "number" && typeof off1 === "number" && on >= 20 && on >= off1 + 15, { off: off1, on });

    const markPause = petSends.length;
    await js(chat, "window.pilly.focusPause()", "--focus-nudge: pausing the session");
    await wait(500);
    const paused = petSends.slice(markPause).filter((s) => s.ch === "pet:focus").pop();
    check("--focus-nudge: pausing the session is pushed to the pet window",
      !!paused && !!paused.arg && paused.arg.paused === true && paused.arg.phase === "focus", paused && paused.arg);
    await js(chat, "window.pilly.focusResume()", "--focus-nudge: resuming the session");
    await wait(400);

    // The path that no broadcast covers: he is switched off mid-session and back
    // on again, so the new window is born while the session is already running.
    // pet:focus can only come from did-finish-load in that window.
    const markReload = petSends.length;
    const switchedOff = await js(chat, "window.pilly.petToggle()", "--focus-nudge: switching Pilly off");
    let petGone = false;
    for (let i = 0; i < 12 && !petGone; i++) {
      await wait(200);
      petGone = !BrowserWindow.getAllWindows().some((w) => label(w) === "pet.html");
    }
    check("--focus-nudge: switching Pilly off closes his window",
      !!switchedOff && switchedOff.active === false && petGone, { switchedOff, petGone });
    const switchedOn = await js(chat, "window.pilly.petToggle()", "--focus-nudge: switching Pilly back on");
    let reborn = null;
    for (let i = 0; i < 15 && !reborn; i++) {
      await wait(300);
      reborn = BrowserWindow.getAllWindows().find((w) => label(w) === "pet.html") || null;
    }
    check("--focus-nudge: switching him back on recreates the pet window",
      !!switchedOn && switchedOn.active === true && !!reborn, { switchedOn, petWindow: !!reborn });
    if (reborn) pet = reborn; // every later check follows the live window
    await wait(900);
    const onLoad = petSends.slice(markReload).filter((s) => s.ch === "pet:focus").pop();
    check("a pet window that loads mid-session is told about it (did-finish-load)",
      !!onLoad && !!onLoad.arg && onLoad.arg.phase === "focus" && onLoad.arg.paused === false, onLoad && onLoad.arg);
    const rebornBand = reborn ? await ringBand("--focus-nudge: the restarted window's canvas") : null;
    check("--focus-nudge: the restarted pet window paints the ring with no broadcast at all",
      typeof rebornBand === "number" && rebornBand >= 20, rebornBand);

    // The other push: main's 10 s poll finds a due reminder and hops him with a
    // clock over his head. Four seconds is the parser's own floor ("too soon to
    // be useful" below that), so this waits at most one poll plus slack.
    await js(chat, "window.pilly.focusStop()", "--focus-nudge: stopping the session");
    await wait(300);
    const markNudge = petSends.length;
    const said = await js(chat, `window.pilly.reminder("remind me in 4 seconds to check SOL")`,
      "--focus-nudge: setting a reminder due in 4 seconds");
    check("--focus-nudge: the shipped reminder IPC accepts a reminder due in 4 seconds",
      !!said && said.ok === true, said && { ok: said.ok, message: said.message });
    let nudge = null;
    for (let i = 0; i < 60 && !nudge; i++) {
      await wait(300);
      nudge = petSends.slice(markNudge).find((s) => s.ch === "pet:nudge") || null;
    }
    check("--focus-nudge: a due reminder hops Pilly with a clock over his head",
      !!nudge && !!nudge.arg && nudge.arg.glyph === "⏰", nudge && nudge.arg);
    check("--focus-nudge: the hop itself reaches the renderer's state channel",
      petSends.slice(markNudge).some((s) => s.ch === "pet:state" && s.arg === "hop"),
      petSends.slice(markNudge).map((s) => `${s.ch}=${JSON.stringify(s.arg)}`).slice(0, 6));

    // The ⏰ particle rises from y=18 and lives ~1.1 s, so give it time to clear
    // the band - otherwise the "ring is gone" measurement below would be reading
    // the reminder's own emoji.
    await wait(1700);
    const off2 = await ringBand("--focus-nudge: the canvas after the session");
    check("--focus-nudge: stopping the session takes the ring away again",
      typeof off2 === "number" && typeof off1 === "number" && typeof on === "number" &&
      off2 <= 8 && on > off2, { before: off1, during: on, after: off2 });
    check("--focus-nudge: the pet window survived the whole round trip",
      !pet.isDestroyed() && pet.isVisible() && !pet.webContents.isDestroyed(), { visible: pet.isVisible() });

    // v1.1.2: with Pilly off there is no bubble to carry a fired reminder, so it
    // has to be pushed to the chat and written into the transcript. Before this
    // the text only ever reached the OS notification - which a desktop in Do Not
    // Disturb (or a machine with notifications off) swallowed whole.
    await js(chat, "window.pilly.petToggle()", "--focus-nudge: switching Pilly off for the reminder test");
    await wait(500);
    const markChat = chatSends.length;
    const second = await js(chat, `window.pilly.reminder("remind me in 4 seconds to claim the airdrop")`,
      "--focus-nudge: setting a second reminder");
    check("--focus-nudge: a second reminder is accepted while Pilly is off",
      !!second && second.ok === true, second && { ok: second.ok, message: second.message });
    let fired = null;
    for (let i = 0; i < 60 && !fired; i++) {
      await wait(300);
      fired = chatSends.slice(markChat).find((s) => s.ch === "pilly:reminder-fired") || null;
    }
    check("--focus-nudge: with Pilly off, a due reminder is pushed to the chat",
      !!fired && !!(fired.arg && fired.arg.message), fired && fired.arg);
    const transcript = await js(chat, `document.getElementById("messages").textContent`,
      "--focus-nudge: reading the chat transcript");
    check("--focus-nudge: the reminder is written into the chat transcript",
      typeof transcript === "string" && transcript.indexOf("claim the airdrop") >= 0,
      String(transcript).slice(-90));

    // The tray's Focus submenu is the one focus path the chat cannot see for
    // itself (anything typed there prints its own line), so a tray click has to
    // narrate itself into the same transcript.
    const focusMenu = (trayMenus.map((tpl) => (tpl || []).find((i) => i && i.label === "Focus")).find(Boolean) || {}).submenu || [];
    const startItem = focusMenu.find((i) => i && i.label === "Start focus");
    check("--focus-nudge: the tray still carries its Focus submenu",
      typeof (startItem || {}).click === "function", focusMenu.map((i) => i && i.label));
    const markTray = chatSends.length;
    if (startItem) startItem.click({ checked: true, label: "Start focus" });
    await wait(600);
    const narrated = chatSends.slice(markTray).filter((s) => s.ch === "pilly:focus:status").pop();
    check("--focus-nudge: a focus session started from the tray is announced to the chat",
      !!narrated && !!(narrated.arg && narrated.arg.announce && narrated.arg.announce.indexOf("tray") >= 0),
      narrated && narrated.arg);
    const trayLine = await js(chat, `document.getElementById("messages").textContent`,
      "--focus-nudge: reading the tray's focus line");
    check("--focus-nudge: the tray's focus line lands in the transcript",
      typeof trayLine === "string" && trayLine.indexOf("Focus started from the tray") >= 0,
      String(trayLine).slice(-90));
    await js(chat, "window.pilly.focusStop()", "--focus-nudge: stopping the tray's session");

    // Switch him back on and re-resolve the window, exactly as the mode above
    // does: every check after this point reads `pet`, so a stale reference here
    // would only show up much further down as a display-recovery failure.
    const backOn = await js(chat, "window.pilly.petToggle()", "--focus-nudge: switching Pilly back on");
    let rebornAgain = null;
    for (let i = 0; i < 15 && !rebornAgain; i++) {
      await wait(300);
      rebornAgain = BrowserWindow.getAllWindows().find((w) => label(w) === "pet.html") || null;
    }
    check("--focus-nudge: Pilly is back on after the chat-only reminder test",
      !!backOn && backOn.active === true && !!rebornAgain, { backOn, petWindow: !!rebornAgain });
    if (rebornAgain) pet = rebornAgain; // every later check follows the live window
  }

  // v1.1.2: reduce motion, end to end - real preload, real IPC, real tray. The
  // renderers own this preference because main has no cross-platform way to read
  // it, so if the wiring breaks the tray icon just keeps bobbing forever.
  const lastPref = uiPrefsSeen[uiPrefsSeen.length - 1];
  check("a renderer reports the OS motion preference to the app",
    !!lastPref && typeof lastPref.reduceMotion === "boolean", uiPrefsSeen);
  if (chat) {
    const before = traySetImageCalls.n;
    await wait(1400);
    const moving = traySetImageCalls.n - before;
    await js(chat, "window.pilly.setUiPrefs({ reduceMotion: true })", "turning reduce motion on");
    await wait(150);
    const parked = traySetImageCalls.n; // the handler re-parks the icon on frame 0
    await wait(1400);
    const whileParked = traySetImageCalls.n - parked;
    await js(chat, "window.pilly.setUiPrefs({ reduceMotion: false })", "turning reduce motion off");
    await wait(1500);
    const resumed = traySetImageCalls.n - parked - whileParked;
    check("the tray icon bobs while motion is allowed", moving >= 1, moving);
    check("reduce-motion parks the tray icon and freezes it", whileParked === 0, whileParked);
    check("turning reduce-motion off lets the tray icon move again", resumed >= 1, resumed);
  }

  // v1.1.2: the fresh-launch floor. The radar is the one place Pilly presents
  // pump.fun launches as snipe material, so it must never hand back a sub-$7K coin
  // - and it has to report the floor it applied, because the panel states the rule
  // and an empty list (normal: launches start near $2.8K) must not read as broken.
  // The network may be down here; the contract holds either way, so this does not
  // depend on the feed answering.
  if (chatAlive()) {
    const radar = await js(chat, "window.pilly.radar()", "reading the fresh-launch radar");
    const rows = radar && Array.isArray(radar.list) ? radar.list : null;
    check("the radar reports the fresh-launch floor it applied",
      !!radar && Number(radar.floor) === 7000, radar && { floor: radar.floor, hidden: radar.hidden });
    check("the radar never lists a launch below the floor",
      !!rows && rows.every((c) => Number(c.mcap) >= 7000), rows && rows.map((c) => ({ s: c.symbol, mcap: c.mcap })));
  }

  // A laptop undocked from a desk monitor used to strand Pilly (and the chat
  // window) on a display that no longer exists. Drive the real handlers.
  const wa = screen.getPrimaryDisplay().workArea;
  const petBefore = safeBounds(pet);
  const chatBefore = safeBounds(chat);
  screen.emit("display-metrics-changed", {}, screen.getPrimaryDisplay(), ["bounds", "workArea"]);
  screen.emit("display-removed", {}, screen.getPrimaryDisplay());
  screen.emit("display-added", {}, screen.getPrimaryDisplay());
  await wait(500);
  const petAfter = safeBounds(pet);
  const petOnScreen = (b) => !!b && b.x >= wa.x - 60 + 24 - 2 && b.x <= wa.x + wa.width - 24 + 2 &&
    b.y >= wa.y - 24 - 2 && b.y <= wa.y + wa.height - 24 + 2;
  check("display changes never strand the pet off-screen", petOnScreen(petAfter),
    { before: petBefore, after: petAfter, wa });
  check("display changes leave the pet alive and painting", pet.isVisible() && !pet.webContents.isDestroyed(),
    { visible: pet.isVisible() });
  // The native teardown above can land anywhere in a run, so the app is given the
  // ~300 ms it needs to put the window back before this is read as a dead one: what
  // the check is for is that a display change never costs the user their chat
  // window, and a window the app cannot revive fails loudly on its own.
  if (!chatAlive()) await reviveChatWindow("the display changes");
  check("the chat window survives every window-related change", chatAlive(),
    { firstDeath: chatDeath, deaths: chatDeaths, repairs: chatRepairs });
  if (chatAlive()) {
    const chatAfter = safeBounds(chat);
    check("display changes keep the chat window on-screen",
      chatAfter.x >= wa.x && chatAfter.x + chatAfter.width <= wa.x + wa.width + 1,
      { before: chatBefore, after: chatAfter, wa });

    // The pet has a 24 ms tick that re-clamps him, but the chat window does not:
    // a monitor vanishing used to leave it invisible until the user quit the app.
    // The recovery only applies to a window the user actually has open (a hidden
    // one is re-clamped by positionWindow() the next time the tray shows it), so
    // open it first, park it off-screen by hand, then report a display change.
    const wasVisible = chat.isVisible();
    if (!wasVisible) { chat.show(); }
    // Showing a window makes the app place it, so park it only once the position
    // has stopped moving - otherwise the app's own placement lands after ours and
    // the test measures the app instead of the recovery we are checking.
    await settleBounds(cb);
    console.log(`INFO  chat visible before the stray test: ${chat.isVisible()} (was ${wasVisible})`);
    const park = { x: wa.x + wa.width + 400, y: wa.y + 200, width: chatAfter.width, height: chatAfter.height };
    chat.setBounds(park);
    await wait(200);
    let strayed = cb();
    if (!strayed || strayed.x <= wa.x + wa.width - 1) {
      // Give the app one honest retry before calling it a failure.
      console.log(`INFO  the app moved the chat window off the requested spot: ${JSON.stringify(strayed)}`);
      chat.setBounds(park);
      await wait(400);
      strayed = cb();
    }
    const reallyStrayed = !!strayed && strayed.x > wa.x + wa.width - 1;
    screen.emit("display-metrics-changed", {}, screen.getPrimaryDisplay(), ["bounds", "workArea"]);
    await wait(400);
    const back = cb();
    console.log(`INFO  chat stray=${JSON.stringify(strayed)} (applied=${reallyStrayed})  after=${JSON.stringify(back)}`);
    check("the chat window can be parked off-screen for the recovery test", reallyStrayed, strayed);
    check("a display change pulls the off-screen chat window back into view",
      !!back && back.x >= wa.x - 1 && back.x + back.width <= wa.x + wa.width + 1, { strayed, back });

    // And a window that was hidden while off-screen must still come back on
    // screen when the user reopens it from the tray - that path goes through
    // positionWindow(), which clamps the remembered bounds again.
    if (chatAlive()) {
      chat.setBounds({ x: wa.x + wa.width + 400, y: wa.y + 200, width: chatAfter.width, height: chatAfter.height });
      await wait(700); // let the debounced bounds write land on disk
      chat.hide();
      await wait(250);
      const hiddenStray = cb();
      screen.emit("display-metrics-changed", {}, screen.getPrimaryDisplay(), ["bounds", "workArea"]);
      await wait(250);
      const afterHidden = cb();
      check("a hidden chat window is left alone by display changes",
        !!hiddenStray && !!afterHidden && afterHidden.x === hiddenStray.x, { hiddenStray, after: afterHidden });
      app.emit("activate"); // same handler as a Dock/tray reopen
      await wait(600);
      const reopened = cb();
      console.log(`INFO  chat reopened=${JSON.stringify(reopened)} visible=${chatAlive() && chat.isVisible()}`);
      check("reopening the chat from the tray brings it back on screen",
        chatAlive() && chat.isVisible() && !!reopened &&
        reopened.x >= wa.x - 1 && reopened.x + reopened.width <= wa.x + wa.width + 1,
        { hiddenStray, reopened });
    }
  }
  check("no main-process errors from display changes", mainErrors.length === 0, mainErrors.slice(0, 3));

  check("no renderer console errors in the chat window", rendererErrors.length === 0, rendererErrors.slice(0, 3));
  check("no uncaught main-process errors", mainErrors.length === 0, mainErrors.slice(0, 3));
  // The whole point of the survival net: a lost window is only acceptable while
  // the app puts it back. If the chat window is alive right now, then every loss
  // this boot was repaired - if it is not, something was lost for good. Asking the
  // app for its replacement first is not leniency: the revive below fails its own
  // check when the window never comes back.
  if (chatDeaths > 0 && !chatAlive()) await reviveChatWindow("the survival check");
  check("every window the app lost came back",
    chatDeaths === 0 || chatAlive(), { deaths: chatDeaths, repairs: chatRepairs, aliveNow: chatAlive() });

  // --- v1.1.2: the header's hide button must hide him, not tear the window down
  // window.close() from the renderer destroyed the chat window on Windows without
  // ever emitting the window's "close" event, so nothing recorded that the user
  // wanted him hidden: the survival net rebuilt the chat and re-showed it, and
  // hiding him took several clicks - each one spending a repair until the budget
  // ran out. The button now sends the intent to main first, so a teardown that
  // follows it leaves him hidden. This is that path, end to end.
  {
    const deathsBefore = chatDeaths;
    if (!chatAlive()) await reviveChatWindow("the header hide check");
    if (chatAlive() && !chat.isVisible()) { chat.show(); await settleBounds(cb); }
    const opened = chatAlive() && chat.isVisible();
    if (opened) await js(chat, "window.pilly.hideChat()", "clicking the header's hide button");
    // Past the ~300 ms the survival net needs to rebuild a window it believes was
    // lost: a chat window on screen after that is the bug coming back.
    await wait(1400);
    const onScreen = BrowserWindow.getAllWindows().filter((w) => {
      if (w.isDestroyed() || !w.isVisible()) return false;
      const b = safeBounds(w);
      return label(w) === "index.html" || (!!b && b.width === 380);
    });
    console.log(`INFO  after the header hide: chat windows on screen=${onScreen.length}, window alive=${chatAlive()}, deaths=${chatDeaths - deathsBefore}`);
    check("the header's hide button leaves no chat window on screen",
      opened && onScreen.length === 0 && !(chatAlive() && chat.isVisible()),
      { opened, onScreen: onScreen.length, alive: chatAlive() });
    // And he has to still be reachable: hidden, not dead. Opening him again is both
    // what the user falls back on and the proof that hiding did not cost a window.
    app.emit("activate");
    await wait(600);
    check("a chat window the user hid opens again from the tray",
      chatAlive() && chat.isVisible(), { alive: chatAlive(), visible: chatAlive() && chat.isVisible() });

    // ...and the same has to hold for a window the OS left minimised. On macOS a
    // miniaturised window still reports itself visible, so every reveal path used
    // to decide "it is already open" and leave the user with a window he could
    // not reach - which is exactly "I have to switch the pet off and on again".
    // Windows reports it hidden instead, which is why the decision itself is
    // unit-tested in src/windowstate.test.js; what runs here is the whole reveal
    // path - restore, re-position, show, focus - through the same entry point the
    // Dock icon, the tray and the pet all use.
    if (chatAlive()) {
      chat.minimize();
      await wait(500);
      const mini = { visible: chat.isVisible(), minimized: chat.isMinimized() };
      app.emit("activate");
      await wait(900);
      check("a chat window the user minimised opens again from the tray",
        chatAlive() && chat.isVisible() && !chat.isMinimized(),
        { mini, now: { visible: chatAlive() && chat.isVisible(), minimized: chatAlive() && chat.isMinimized() } });
    }

    // ...and the menu entry that says "Open chat" has to open it. Both the tray item
    // and the macOS menu item carried that label and both toggled, so with the chat
    // already up the entry put it away - the exact opposite of what it says, and it
    // loaded a pending hot-coin into a hidden window on the way. The tray item is
    // reachable here because every template the app builds goes through the
    // buildFromTemplate spy, so this clicks the real one, not a copy. The search runs
    // newest-first over every template: the app rebuilds the tray menu whenever its
    // dynamic lines change, and nothing guarantees the newest template is the tray's.
    const clickTrayOpenChat = () => {
      for (let i = trayMenus.length - 1; i >= 0; i--) {
        const tpl = trayMenus[i];
        const item = Array.isArray(tpl) ? tpl.find((x) => x && x.label === "Open chat") : null;
        if (item && typeof item.click === "function") {
          console.log(`INFO  clicking "Open chat" from tray template ${i} of ${trayMenus.length} ` +
            `(labels: ${tpl.filter((x) => x && x.label).map((x) => x.label).join(" | ")})`);
          item.click();
          return true;
        }
      }
      console.log(`INFO  no tray template carries "Open chat" (templates: ${trayMenus.length}, ` +
        `last labels: ${((trayMenus[trayMenus.length - 1] || []).filter((x) => x && x.label).map((x) => x.label).join(" | ") || "none")})`);
      return false;
    };
    if (chatAlive() && chat.isVisible()) {
      const wired = clickTrayOpenChat();
      await wait(500);
      check("the tray's Open chat never puts away a chat that is already open",
        wired && chatAlive() && chat.isVisible(),
        { wired, visible: chatAlive() && chat.isVisible() });
      await js(chat, "window.pilly.hideChat()", "hiding the chat before the tray check");
      await wait(400);
      const hiddenFirst = !(chatAlive() && chat.isVisible());
      clickTrayOpenChat();
      await wait(700);
      check("...and it opens a chat the user had hidden",
        hiddenFirst && chatAlive() && chat.isVisible(),
        { hiddenFirst, visible: chatAlive() && chat.isVisible() });
      // Hand the app back the way this section found it. The teardown block below
      // compares visibility before and after, and the survival net deliberately
      // ignores a teardown behind a hidden window - so a chat left hidden here would
      // silently turn that check into "the app rebuilt nothing", which is not a bug
      // in the app but in this file.
      if (!(chatAlive() && chat.isVisible())) {
        app.emit("activate");
        await wait(900);
        console.log(`INFO  chat visible before the teardown section: ${chatAlive() && chat.isVisible()}`);
      }
    }
  }

  // --- v1.1.2: a window that is torn down comes back -------------------------
  // A native teardown that never goes through a close path has been observed
  // taking the chat window down mid-boot (on Windows: WM_DESTROY with no WM_CLOSE
  // and no Electron close event). main.js repairs that class of failure now, and
  // this proves the repair exists instead of waiting for the flake to fire: the
  // harness destroys both windows the way the OS did, and both have to be back and
  // working. It runs last because it deliberately costs the app its windows.
  deliberateKill = true;
  {
    // 60x64 is the pet window; nothing else in this app is that size, and a freshly
    // built window has no URL yet, so size is what identifies him right after a rebuild.
    const isPetWin = (w) => {
      if (w.isDestroyed()) return false;
      if (label(w) === "pet.html") return true;
      const b = safeBounds(w);
      return !!b && b.width === 60 && b.height === 64;
    };
    const petBefore = BrowserWindow.getAllWindows().find(isPetWin);
    // The visibility check below compares before and after, so the window torn down
    // here has to be the live one and not a corpse the app already replaced -
    // otherwise "was it open?" is answered by a window that can no longer say.
    if (!chatAlive()) await reviveChatWindow("the deliberate teardown");
    const chatWasVisible = chatAlive() && chat.isVisible();
    const lost = chat;
    console.log(`INFO  killing the chat window on purpose (it was ${chatWasVisible ? "open" : "hidden"}, pet window ${petBefore ? petBefore.id : "absent"})`);
    if (lost && !lost.isDestroyed()) lost.destroy();
    const revived = await reviveChatWindow("the harness destroyed it");
    const usable = revived ? await js(revived, "1 + 1", "the rebuilt chat window runs its UI") : null;
    check("a torn-down chat window is rebuilt and usable", !!revived && usable === 2, { revived: !!revived, result: usable });
    // The app has to remember whether the user had the window open: a rebuild of a
    // window the user had closed would pop the chat up out of nowhere.
    check("the rebuilt chat window keeps the state the user left it in",
      !revived || revived.isVisible() === chatWasVisible, { was: chatWasVisible, now: revived ? revived.isVisible() : null });

    if (petBefore && !petBefore.isDestroyed()) {
      petBefore.destroy();
      let petBack = null;
      for (let i = 0; i < 40 && !petBack; i++) {
        await wait(100);
        const found = BrowserWindow.getAllWindows().find((w) => w !== petBefore && isPetWin(w));
        if (found && !found.webContents.isDestroyed()) petBack = found;
      }
      const size = petBack ? safeBounds(petBack) : null;
      check("a torn-down Pilly window is rebuilt (the pet is not switched off by an OS teardown)",
        !!petBack && !!size && size.width === 60 && size.height === 64 && petBack.isVisible(),
        { rebuilt: !!petBack, bounds: size });
      // "Rebuilt" is not enough - he has to still be alive over there. Count real
      // animation frames and confirm the canvas is actually painted.
      const walking = petBack
        ? await js(petBack, `(async () => {
            const c = document.getElementById('pet');
            if (!c) return { canvas: false };
            const frames = await new Promise((res) => {
              let n = 0; const t0 = performance.now();
              const step = () => { n++; performance.now() - t0 < 300 ? requestAnimationFrame(step) : res(n); };
              requestAnimationFrame(step);
            });
            let painted = 0;
            try {
              const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
              for (let i = 3; i < d.length; i += 37) if (d[i]) painted++;
            } catch (e) { return { canvas: true, frames, painted: -1 }; }
            return { canvas: true, frames, painted };
          })()`, "the rebuilt Pilly window keeps animating")
        : null;
      check("the rebuilt Pilly window keeps animating",
        !!walking && walking.canvas === true && walking.frames >= 5 && walking.painted > 0, walking);
    } else {
      console.log("INFO  no pet window at the end of this run - skipping the pet teardown test");
    }
  }
  deliberateKill = false;

  await finish();
}

async function finish() {
  done(failures.length ? 1 : 0);
}
