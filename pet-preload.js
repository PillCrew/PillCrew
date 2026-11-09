/**
 * The bridge Pilly's own `renderer/pet.html` expects: `window.pilly`.
 *
 * The pet's art and animation are Pilly's file, byte for byte, so the contract has to be Pilly's too. Every method below is
 * either a message the main process pushes (`onPet*`) or one the pet sends up (`petDrag`, `petReact`, `petMood`). The ones
 * the sniper has nothing to say about (the pomodoro session, the battery, the mood of a market feed) are answered with a
 * harmless no-op instead of being removed, because `pet.html` calls them unconditionally and an undefined method would
 * leave a renderer error behind.
 */
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  if (typeof cb !== 'function') return;
  ipcRenderer.on(channel, (_e, payload) => { try { cb(payload); } catch (_) { /* a throwing listener is not the app's problem */ } });
};
const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args).catch(() => null);

contextBridge.exposeInMainWorld('pilly', {
  // The main process pushes these while he walks.
  onPetSettings: on('pet:settings'),
  onPetDir: on('pet:dir'),
  onPetCursor: on('pet:cursor'),
  onPetState: on('pet:state'),
  onPetSpook: on('pet:spook'),
  onPetTalking: on('pet:talking'),
  onPetGreet: on('pet:greet'),
  onPetFocus: on('pet:focus'),
  onPetMood: on('pet:mood'),
  onPetMarket: on('pet:market'),
  onPetJoke: on('pet:joke'),
  onPetOrient: on('pet:orient'),
  // His own sound effects: `sfx(type)` in Pilly's page plays the ding an alert carries.
  onPetPlay: on('pet:play'),
  // The bubble's own two verbs: the page measures its text and asks for a taller window, and a tap on it closes it and opens
  // the chat. Pilly's `bubble.html` asks for both unconditionally, so both must exist even when nothing is clickable.
  resizeBubble: (h) => { try { ipcRenderer.send('bubble:resize', h); } catch (_) { /* ignore */ } },
  closeBubble: () => { try { ipcRenderer.send('bubble:close'); } catch (_) { /* ignore */ } },
  openChat: () => { try { ipcRenderer.send('bubble:open-chat'); } catch (_) { /* ignore */ } },
  // What the pet asks for.
  petSettings: () => invoke('pet:settings'),
  petApply: (pet) => invoke('pet:apply', pet),
  petDrag: (pos) => { try { ipcRenderer.send('pet:drag', pos); } catch (_) { /* ignore */ } },
  // The page asks this while a hand holds him still: main answers from the window bounds it owns, because from inside the page a
  // still hold and a lost release look identical.
  petDragCursorOver: () => invoke('pet:cursorOver'),
  petReact: (kind) => { try { ipcRenderer.send('pet:react', kind); } catch (_) { /* ignore */ } },
  petMood: () => Promise.resolve(null),
  petBattery: () => Promise.resolve(null),
  setUiPrefs: () => Promise.resolve(true),
  petToggle: () => invoke('pet:toggle'),
});
