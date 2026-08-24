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
});
