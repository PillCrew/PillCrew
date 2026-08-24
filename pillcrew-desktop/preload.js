// Preload - exposes a tiny, safe API to the chat window.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pilly", {
  chat: (payload) => ipcRenderer.invoke("pilly:chat", payload),
  memePrompts: () => ipcRenderer.invoke("pilly:meme"),
  onSuggest: (cb) => {
    ipcRenderer.on("pilly:suggest", (e, type) => cb(type));
  },
  // settings
  settingsGet: () => ipcRenderer.invoke("pilly:settings:get"),
  settingsSave: (s) => ipcRenderer.invoke("pilly:settings:save", s),
  settingsTest: (s) => ipcRenderer.invoke("pilly:settings:test", s),
  settingsModels: (t) => ipcRenderer.invoke("pilly:settings:models", t),
  // live Solana data
  coin: (mint) => ipcRenderer.invoke("pilly:coin", mint),
  trending: () => ipcRenderer.invoke("pilly:trending"),
  // taskbar pet
  petToggle: () => ipcRenderer.invoke("pilly:pet:toggle"),
  openChat: () => ipcRenderer.invoke("pilly:open-chat"),
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
});
