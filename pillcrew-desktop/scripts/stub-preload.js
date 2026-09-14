// Stub of the real preload surface so renderers boot without any ipcMain
// handlers registered.
const { contextBridge } = require("electron");

const P = () => Promise.resolve(undefined);
const on = () => {};
// v1.1.2 drag/tap: the pet-settings round-trip was the only thing that ever armed
// pick-up, and it is the one call the renderer makes whose failure used to leave
// the pet unpickable for the whole session. A window loaded with "?hang=1" makes
// that call answer never, "?fail=1" makes it reject; the harness then proves
// pick-up and the tap do not depend on it. Both channels are read because a
// sandboxed preload sees the query string and its own argv, and either can be
// missing depending on how the window was created.
const _argv = (() => { try { return process.argv || []; } catch (e) { return []; } })();
const _hung = (() => { try { return /[?&]hang=1/.test(location.search); } catch (e) { return false; } })();
const _failed = (() => { try { return /[?&]fail=1/.test(location.search); } catch (e) { return false; } })();
const _openFailed = (() => { try { return /[?&]openfail=1/.test(location.search); } catch (e) { return false; } })();
const HANG = _hung || _argv.includes("--pet-settings-hang");
const FAIL = _failed || _argv.includes("--pet-settings-fail");
// "?openfail=1": the other channel the click depends on, so a harness can prove a
// failed open-chat call is logged rather than left as an unread rejection.
const OPEN_FAIL = _openFailed || _argv.includes("--pet-open-fail");
const petSettings = HANG
  ? () => new Promise(() => {})
  : FAIL
    ? () => Promise.reject(new Error("stub: pet settings unavailable"))
    : P;
// v1.1.2: capture registered listeners so a harness can fire them on demand,
// and remember what the renderer reported through setUiPrefs.
const handlers = {};
const onCapture = (name) => (cb) => { handlers[name] = cb; };
const fire = (name, ...a) => { const h = handlers[name]; if (h) h(...a); };
const uiPrefs = [];
const setUiPrefs = (p) => { uiPrefs.push(p); };
// v1.1.2 touch: what the renderer asked main to say. The harness asserts the
// renderer does not spam these - every stroke sample re-enters the code path that
// decides to react, and one "pet" per cuddle is the contract.
const reactions = [];
const petReact = (k) => { reactions.push(k); };
// v1.1.2 drag/tap: what the renderer asked main to do with the window. A tap that
// never reaches openChat is the bug the user reports as "I have to switch the pet
// off and on", so the harness counts these instead of trusting a screenshot.
const chats = [];
const drags = [];
const openChat = () => {
  chats.push(Date.now());
  return OPEN_FAIL ? Promise.reject(new Error("stub: open chat unavailable")) : Promise.resolve(undefined);
};
const petDrag = (ev) => { drags.push((ev && ev.mode) || "?"); };

contextBridge.exposeInMainWorld("pilly", {
  chat: P, memePrompts: P, detectTask: P,
  settingsGet: P, settingsSave: P, settingsTest: P, settingsModels: P,
  coin: P, wallet: P, trending: P,
  watchList: P, watchAdd: P, watchRemove: P, watchAlert: P, watchPrices: P,
  onWatchAlert: on, onWatchRefresh: on,
  pnlGet: P, pnlSet: P, pnlRemove: P, pnlAll: P,
  picks: P, copyText: P,
  whalesList: P, whaleAdd: P, whaleRemove: P, whaleCheck: P,
  radar: P, spark: P, openExternal: P, solPrice: P,
  reminder: P, remindersList: P, reminderRemove: P, onReminderFired: onCapture("reminder"),
  focusStatus: P, focusConfig: P, focusStart: P, focusStop: P,
  focusPause: P, focusResume: P,
  activityToday: P, activityYesterday: P, activityStreak: P, onFocusStatus: onCapture("focusStatus"),
  petToggle: P, openChat, setAlwaysOnTop: P, quit: P, github: P,
  version: P, resetWindow: P,
  updateCheck: P, updateInstall: P, updateState: P, updateOpen: P, onUpdateStatus: on,
  onPetDir: on, onPetJoke: on, onPetCursor: on, onPetState: on,
  petSettings: petSettings, petApply: P, onPetSettings: on, onPetOrient: on,
  petDrag, petReact: petReact, resizeBubble: on, petMood: P, petBattery: P,
  onPetTalking: on, onPetMarket: on, onPetMood: on, onPetSpook: on, onPetPlay: on,
  onPetGreet: onCapture("greet"),
  onPetFocus: onCapture("focus"),
  onPetNudge: onCapture("nudge"),
  setUiPrefs,
  __fire: fire,
  // A function, not the bare array: a getter would let the harness mutate state.
  __uiPrefs: () => uiPrefs.slice(),
  __reactions: () => reactions.slice(),
  __clearReactions: () => { reactions.length = 0; },
  __chats: () => chats.slice(),
  __drags: () => drags.slice(),
  // How the stub is currently misbehaving, so a harness never mistakes "the
  // failure mode did not engage" for "the renderer coped with it".
  __petSettingsMode: () => (HANG ? "hang" : FAIL ? "fail" : "ok"),
  __openChatMode: () => (OPEN_FAIL ? "fail" : "ok"),
  __clearTouch: () => { chats.length = 0; drags.length = 0; },
  onPetActive: onCapture("petActive"), // v1.1.2: the tray can switch the pet too
  onLoadCoin: on, onQuestion: on,
});
