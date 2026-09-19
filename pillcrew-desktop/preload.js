// Preload - exposes the app's API to every Pilly window. Most of the surface only
// makes sense in the chat (chat, settings, watchlist), but the overlays share this
// one file, so the bubble and the poop window get it too; they are internal
// windows loaded from local files, never remote content.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pilly", {
  chat: (payload) => ipcRenderer.invoke("pilly:chat", payload),
  memePrompts: () => ipcRenderer.invoke("pilly:meme"),
  detectTask: (text) => ipcRenderer.invoke("pilly:detect-task", text),
  homeToken: () => ipcRenderer.invoke("pilly:home-token"), // v1.1.3
  // settings
  settingsGet: () => ipcRenderer.invoke("pilly:settings:get"),
  settingsSave: (s) => ipcRenderer.invoke("pilly:settings:save", s),
  settingsTest: (s) => ipcRenderer.invoke("pilly:settings:test", s),
  settingsModels: (t) => ipcRenderer.invoke("pilly:settings:models", t),
  // live Solana data
  coin: (mint, silent) => ipcRenderer.invoke("pilly:coin", mint, silent),
  wallet: (address) => ipcRenderer.invoke("pilly:wallet", address),
  trending: () => ipcRenderer.invoke("pilly:trending"),
  // watchlist + alerts
  watchList: () => ipcRenderer.invoke("pilly:watch:list"),
  watchAdd: (coin) => ipcRenderer.invoke("pilly:watch:add", coin),
  watchRemove: (mint) => ipcRenderer.invoke("pilly:watch:remove", mint),
  watchAlert: (mint, pct) => ipcRenderer.invoke("pilly:watch:alert", mint, pct),
  watchPrices: () => ipcRenderer.invoke("pilly:watch:prices"),
  onWatchAlert: (cb) => { ipcRenderer.on("pilly:watch:alert", (e, m) => cb(m)); },
  onWatchRefresh: (cb) => { ipcRenderer.on("pilly:watch:refresh", () => cb()); },
  // PnL tracking (entry prices)
  pnlGet: (mint) => ipcRenderer.invoke("pilly:pnl:get", mint),
  pnlSet: (mint, entry) => ipcRenderer.invoke("pilly:pnl:set", mint, entry),
  pnlRemove: (mint) => ipcRenderer.invoke("pilly:pnl:remove", mint),
  pnlAll: () => ipcRenderer.invoke("pilly:pnl:all"),
  // radar + sparkline + external links
  picks: () => ipcRenderer.invoke("pilly:picks"),
  copyText: (text) => ipcRenderer.invoke("pilly:clipboard", text),
  whalesList: () => ipcRenderer.invoke("pilly:whales:list"),
  whaleAdd: (address, label) => ipcRenderer.invoke("pilly:whales:add", address, label),
  whaleRemove: (address) => ipcRenderer.invoke("pilly:whales:remove", address),
  whaleCheck: () => ipcRenderer.invoke("pilly:whales:check"),
  radar: () => ipcRenderer.invoke("pilly:radar"),
  spark: (mint) => ipcRenderer.invoke("pilly:spark", mint),
  openExternal: (url) => ipcRenderer.invoke("pilly:openExternal", url),
  img: (url) => ipcRenderer.invoke("pilly:img", url), // v1.1.2: logo fetch that bypasses CDN CORP blocks
  solPrice: () => ipcRenderer.invoke("pilly:solprice"),
  // reminders (v1.1.1)
  reminder: (text) => ipcRenderer.invoke("pilly:reminder", text),
  remindersList: () => ipcRenderer.invoke("pilly:reminders:list"),
  reminderRemove: (id) => ipcRenderer.invoke("pilly:reminders:remove", id),
  onReminderFired: (cb) => { ipcRenderer.on("pilly:reminder-fired", (e, r) => cb(r)); },
  // focus sessions + activity diary (v1.1.1)
  focusStatus: () => ipcRenderer.invoke("pilly:focus:status"),
  focusConfig: () => ipcRenderer.invoke("pilly:focus:config"),
  focusStart: (minutes, breakMinutes) => ipcRenderer.invoke("pilly:focus:start", minutes, breakMinutes),
  focusStop: () => ipcRenderer.invoke("pilly:focus:stop"),
  focusPause: () => ipcRenderer.invoke("pilly:focus:pause"),
  focusResume: () => ipcRenderer.invoke("pilly:focus:resume"),
  activityToday: () => ipcRenderer.invoke("pilly:activity:today"),
  activityYesterday: () => ipcRenderer.invoke("pilly:activity:yesterday"),
  activityStreak: () => ipcRenderer.invoke("pilly:activity:streak"),
  onFocusStatus: (cb) => { ipcRenderer.on("pilly:focus:status", (e, s) => cb(s)); },
  // taskbar pet
  petToggle: () => ipcRenderer.invoke("pilly:pet:toggle"),
  onPetActive: (cb) => { ipcRenderer.on("pilly:pet:active", (e, on) => cb(on)); }, // v1.1.2
  openChat: () => ipcRenderer.invoke("pilly:open-chat"),
  hideChat: () => ipcRenderer.invoke("pilly:hide-chat"), // v1.1.2
  setAlwaysOnTop: (on) => ipcRenderer.invoke("pilly:win:ontop", on),
  quit: () => ipcRenderer.invoke("pilly:quit"),
  github: () => ipcRenderer.invoke("pilly:github"),
  version: () => ipcRenderer.invoke("pilly:version"),
  resetWindow: () => ipcRenderer.invoke("pilly:reset-window"),
  // auto-updates (v1.1.0)
  updateCheck: () => ipcRenderer.invoke("pilly:update:check"),
  updateInstall: () => ipcRenderer.invoke("pilly:update:install"),
  updateState: () => ipcRenderer.invoke("pilly:update:state"),
  updateOpen: () => ipcRenderer.invoke("pilly:update:open"),
  onUpdateStatus: (cb) => { ipcRenderer.on("pilly:update:status", (e, s) => cb(s)); },
  onPetDir: (cb) => { ipcRenderer.on("pet:dir", (e, d) => cb(d)); },
  onPetJoke: (cb) => { ipcRenderer.on("pet:joke", (e, text) => cb(text)); },
  onPetCursor: (cb) => { ipcRenderer.on("pet:cursor", (e, pos) => cb(pos)); },
  onPetState: (cb) => { ipcRenderer.on("pet:state", (e, s) => cb(s)); },
  petSettings: () => ipcRenderer.invoke("pilly:pet:settings"),
  petApply: (pet) => ipcRenderer.invoke("pilly:pet:apply", pet),
  onPetSettings: (cb) => { ipcRenderer.on("pet:settings", (e, s) => cb(s)); },
  onPetOrient: (cb) => { ipcRenderer.on("pet:orient", (e, o) => cb(o)); },
  petDrag: (p) => ipcRenderer.send("pet:drag", p),
  petDragCursorOver: () => ipcRenderer.invoke("pet:drag-cursor-over"),
  petReact: (kind) => ipcRenderer.send("pet:react", kind),
  resizeBubble: (h) => ipcRenderer.send("bubble:resize", h),
  closeBubble: () => ipcRenderer.send("bubble:close"),
  petMood: (m) => ipcRenderer.invoke("pilly:pet:mood", m),
  petBattery: (info) => ipcRenderer.invoke("pilly:pet:battery", info), // v1.1.1
  onPetTalking: (cb) => { ipcRenderer.on("pet:talking", (e, on) => cb(on)); },
  onPetMarket: (cb) => { ipcRenderer.on("pet:market", (e, m) => cb(m)); },
  onPetMood: (cb) => { ipcRenderer.on("pet:mood", (e, m) => cb(m)); },
  onPetSpook: (cb) => { ipcRenderer.on("pet:spook", (e, t) => cb(t)); },
  onPetPlay: (cb) => { ipcRenderer.on("pet:play", (e, type) => cb(type)); },
  onPetGreet: (cb) => { ipcRenderer.on("pet:greet", () => cb()); }, // v1.1.2
  onPetFocus: (cb) => { ipcRenderer.on("pet:focus", (e, p) => cb(p)); }, // v1.1.2
  onPetNudge: (cb) => { ipcRenderer.on("pet:nudge", (e, n) => cb(n)); }, // v1.1.2
  setUiPrefs: (prefs) => ipcRenderer.send("ui:prefs", prefs), // v1.1.2
  onLoadCoin: (cb) => { ipcRenderer.on("pilly:load-coin", (e, coin) => cb(coin)); },
  onQuestion: (cb) => { ipcRenderer.on("pilly:question", (e, t) => cb(t)); },
});
