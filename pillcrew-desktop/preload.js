// Preload - exposes a tiny, safe API to the chat window.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pilly", {
  chat: (payload) => ipcRenderer.invoke("pilly:chat", payload),
  memePrompts: () => ipcRenderer.invoke("pilly:meme"),
  detectTask: (text) => ipcRenderer.invoke("pilly:detect-task", text),
  onSuggest: (cb) => {
    ipcRenderer.on("pilly:suggest", (e, type) => cb(type));
  },
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
  solPrice: () => ipcRenderer.invoke("pilly:solprice"),
  // taskbar pet
  petToggle: () => ipcRenderer.invoke("pilly:pet:toggle"),
  openChat: () => ipcRenderer.invoke("pilly:open-chat"),
  setAlwaysOnTop: (on) => ipcRenderer.invoke("pilly:win:ontop", on),
  quit: () => ipcRenderer.invoke("pilly:quit"),
  github: () => ipcRenderer.invoke("pilly:github"),
  version: () => ipcRenderer.invoke("pilly:version"),
  onPetDir: (cb) => { ipcRenderer.on("pet:dir", (e, d) => cb(d)); },
  onPetJoke: (cb) => { ipcRenderer.on("pet:joke", (e, text) => cb(text)); },
  onPetCursor: (cb) => { ipcRenderer.on("pet:cursor", (e, pos) => cb(pos)); },
  onPetState: (cb) => { ipcRenderer.on("pet:state", (e, s) => cb(s)); },
  petSettings: () => ipcRenderer.invoke("pilly:pet:settings"),
  petApply: (pet) => ipcRenderer.invoke("pilly:pet:apply", pet),
  onPetSettings: (cb) => { ipcRenderer.on("pet:settings", (e, s) => cb(s)); },
  petDrag: (p) => ipcRenderer.send("pet:drag", p),
  petReact: (kind) => ipcRenderer.send("pet:react", kind),
  resizeBubble: (h) => ipcRenderer.send("bubble:resize", h),
  petMood: (m) => ipcRenderer.invoke("pilly:pet:mood", m),
  onPetTalking: (cb) => { ipcRenderer.on("pet:talking", (e, on) => cb(on)); },
  onPetMarket: (cb) => { ipcRenderer.on("pet:market", (e, m) => cb(m)); },
  onPetMood: (cb) => { ipcRenderer.on("pet:mood", (e, m) => cb(m)); },
  onPetSpook: (cb) => { ipcRenderer.on("pet:spook", (e, t) => cb(t)); },
  onPetPlay: (cb) => { ipcRenderer.on("pet:play", (e, type) => cb(type)); },
  onLoadCoin: (cb) => { ipcRenderer.on("pilly:load-coin", (e, coin) => cb(coin)); },
  onQuestion: (cb) => { ipcRenderer.on("pilly:question", (e, t) => cb(t)); },
});
