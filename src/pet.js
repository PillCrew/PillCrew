/**
 * PILLY ON SCREEN — the desktop pet, ported from Pilly Desktop into the sniper so there is one program instead of two
 * (owner, 2026-11-09: "czat na górze + opcje włączenia peta na ekranie i pełne ustawienia … po co nam dwa programy").
 *
 * What is ported and what is not: `renderer/pet.html` is Pilly's own file, byte for byte - the ball, the walk, the blink,
 * the bubbles, the drag, all of it - and `src/petmotion.js` is its reflex logic with its own tests. This file is the part
 * that had to be rewritten: Pilly keeps the pet inside a 152 KB main.js wired to Pilly's chat, pomodoro and market feeds;
 * here it is a small overlay that owns one window and nothing else.
 *
 * The rules it keeps from Pilly, because they are why the pet feels alive rather than broken:
 *  - the window is always-on-top, transparent, framed off, skipped in the taskbar, unfocusable, and opts out of Chromium's
 *    background throttling (an occluded overlay otherwise freezes mid-motion on macOS);
 *  - the tick is 24 ms and moves him a fraction of a pixel a step, so he walks rather than slides;
 *  - a fast hand near him spooks him (see `petmotion.shouldSpook`), a cursor resting on him stops him
 *    (`shouldStandStill`), and a normal reach to click him does NOT, which was the first version's bug;
 *  - his position is remembered (clamped into the screen that held him) so he is where he was told to stay.
 *
 * It is inert unless the operator switches it on (`petOn`), it never touches a wallet or a setting of the desk, and it is
 * skipped entirely while `app` is not ready - which is what keeps every test run window-free.
 */
const path = require('path');
const { BrowserWindow, screen } = require('electron');
const { shouldSpook, shouldStandStill, CURSOR_HOLD_RESUME_MS } = require('./petmotion');

const PET_W = 60;
const PET_H = 64;
const TICK_MS = 24;
const SPEED_PX_PER_TICK = 0.22;        // about 9 px/s: a wander, not a race
const EDGE_PAUSE_MS = 2600;            // he turns around, stands a moment, then walks back
// The air he leaves between himself and the screen's own edge on his wander: flush with it he sits in a corner nobody looks at.
const PET_EDGE_INSET = 48;
const STATE_MS = { walk: 0, idle: 8000, sleep: 26000 };

// The size he is drawn at, in pixels. The window is the art's own 60x64 box scaled — `lg` is Pilly's 1.2x of the harness —
// and the walk step scales with it, so a bigger ball does not look like it is moonwalking.
const SIZES = { sm: 0.75, md: 1, lg: 1.2 };
// How fast he wanders. Slow is for a machine somebody is working on.
const SPEEDS = { slow: 0.5, normal: 1, fast: 2 };
// How often he stops for a moment on the way: this is the "standing still" half of walking.
const STOP_EVERY_MS = { never: 0, rare: 42000, normal: 22000, often: 9000 };
// His colours (`renderer/pet.html` owns the art; these are its own names) and the bubble looks the bubble page draws.
const THEMES = ['ball', 'green', 'blue', 'purple', 'pink', 'orange', 'plush'];
const BUBBLE_STYLES = ['default', 'light', 'glass', 'neon', 'comic', 'minimal'];

/** The window box for a size name, in device pixels. */
function boxFor(size) {
  const s = SIZES[size] || SIZES.md;
  return { w: Math.round(PET_W * s), h: Math.round(PET_H * s) };
}

/** What the main process pushes to the pet's renderer (`pet:settings`), from the operator's settings. */
function petOptions(settings = {}) {
  return {
    name: String(settings.petName || 'Pilly').slice(0, 14),
    theme: THEMES.includes(settings.petTheme) ? settings.petTheme : 'ball',
    size: SIZES[settings.petSize] ? settings.petSize : 'md',
    speed: SPEEDS[settings.petSpeed] ? settings.petSpeed : 'normal',
    walkMode: settings.petWalkMode === 'taskbar' ? 'taskbar' : 'screen',
    stopFreq: STOP_EVERY_MS[settings.petStopFreq] != null ? settings.petStopFreq : 'normal',
    mood: ['happy', 'sad'].includes(settings.petMood) ? settings.petMood : '',
    bubbles: settings.petBubbles !== false,
    bubbleSize: ['sm', 'md', 'lg'].includes(settings.petBubbleSize) ? settings.petBubbleSize : 'md',
    bubbleText: ['sm', 'md', 'lg'].includes(settings.petBubbleText) ? settings.petBubbleText : 'md',
    bubbleStyle: BUBBLE_STYLES.includes(settings.petBubbleStyle) ? settings.petBubbleStyle : 'default',
    sounds: settings.petSounds !== false,
    soundVol: Math.min(100, Math.max(0, Math.round(Number(settings.petSoundVol)) || 0)),
    questions: settings.petQuestions !== false,
    reduceMotion: settings.petReduceMotion === true,
  };
}

/**
 * How wide the bubble window has to be for a given look. Pilly shipped a fixed 190 px window with `max-width: 170px * scale`
 * inside it, which is right at the default size — but at the large text size the sentence wrapped to eleven characters a line
 * and the bubble grew taller than the screen. The width therefore follows the text: the padding scale plus the letters.
 */
function bubbleBox(opts = {}) {
  const bs = opts.bubbleSize === 'sm' ? 0.85 : opts.bubbleSize === 'lg' ? 1.15 : 1;
  const bt = opts.bubbleText === 'sm' ? 10 : opts.bubbleText === 'lg' ? 14 : 12;
  const w = Math.round(Math.min(340, Math.max(160, 170 * bs + 24 + (bt - 12) * 12)));
  return { w, h: 160 };
}

/**
 * Where a speech bubble must sit for a pet standing at `pos`, and which way its tail points.
 *
 * Purely arithmetic on purpose: the rule is "the bubble is never off the screen and its tail always points at him", and
 * that is exactly what a test can hold. Pilly's own version lives inside its 152 KB main.js; this one answers the same
 * question in one place so `Bubble` only has to move a window.
 */
function bubblePlacement(opts = {}) {
  const pos = opts.pos || { x: 0, y: 0 };
  const size = SIZES[opts.size] ? opts.size : 'md';
  const { w: petW, h: petH } = boxFor(size);
  const work = opts.work || { x: 0, y: 0, width: 1920, height: 1040 };
  const bw = Math.max(1, Math.round(opts.bubble ? opts.bubble.w : 190));
  const bh = Math.max(1, Math.round(opts.bubble ? opts.bubble.h : 160));
  const EDGE = 24;

  // The pill's own box inside the window: Pilly draws it 11 px off the floor, 23 px tall (scaled with his size).
  const pillTopAbs = pos.y + petH - 11 - 23 * (SIZES[size] < 1 ? 0.85 : SIZES[size] > 1 ? 1.2 : 1);
  const pillBottomAbs = pos.y + petH - 11;
  const pillLeftAbs = pos.x;
  const pillRightAbs = pos.x + petW;
  const spaceAbove = pillTopAbs - work.y;
  const spaceBelow = work.y + work.height - pillBottomAbs;
  const spaceLeft = pillLeftAbs - work.x;
  const spaceRight = work.x + work.width - pillRightAbs;

  // Hugging the left or right edge (and not also the top/bottom) puts the bubble BESIDE him, tail sideways; anywhere else
  // it goes above if it fits and below if it does not.
  let orient;
  if (spaceLeft < EDGE && spaceAbove >= EDGE && spaceBelow >= EDGE) orient = 'right';
  else if (spaceRight < EDGE && spaceAbove >= EDGE && spaceBelow >= EDGE) orient = 'left';
  else if (spaceAbove >= bh) orient = 'above';
  else if (spaceBelow >= bh) orient = 'below';
  else orient = spaceBelow > spaceAbove ? 'below' : 'above';

  let x;
  let y;
  if (orient === 'right' || orient === 'left') {
    const pillMid = (pillTopAbs + pillBottomAbs) / 2;
    y = Math.round(pillMid - bh / 2);
    x = orient === 'right' ? pillRightAbs - 2 : pillLeftAbs - bw + 2;
  } else {
    y = orient === 'above' ? pillTopAbs - 12 - (bh - 14) : pillBottomAbs - 2;
    x = Math.round(pos.x - (bw - petW) / 2);
  }
  x = Math.max(work.x + 2, Math.min(x, work.x + work.width - bw - 2));
  y = Math.max(work.y, Math.min(y, work.y + work.height - bh));

  // Once the window is clamped it may no longer point at him, so the page slides the bubble and then the tail: the numbers
  // below are where his head (or his side) sits relative to the window's centre.
  const side = orient === 'right' || orient === 'left';
  const tail = side
    ? { tx: 0, ty: Math.round((pillTopAbs + pillBottomAbs) / 2 - (y + bh / 2)) }
    : { tx: Math.round(pos.x + petW / 2 - (x + bw / 2)), ty: 0 };
  return { orient, x, y, tail };
}

/** Where the pet may stand: inside the work area of the screen nearest his saved spot. */
function clampToScreen(pos, work, size = 'md') {
  const { w, h } = boxFor(size);
  const x = Math.min(Math.max(Math.round(pos.x), work.x), work.x + work.width - w);
  const y = Math.min(Math.max(Math.round(pos.y), work.y), work.y + work.height - h);
  return { x, y };
}

// The keys of the mascot's own configuration, in the panel's order. `petOn` is not here: it is the switch, not a setting of
// his behaviour, and it is written by `pet:toggle` alone.
const PET_SETTINGS = ['petName', 'petTheme', 'petSize', 'petSpeed', 'petWalkMode', 'petStopFreq', 'petMood', 'petBubbles',
  'petBubbleSize', 'petBubbleText', 'petBubbleStyle', 'petSounds', 'petSoundVol', 'petQuestions', 'petReduceMotion',
  'petHotAlerts', 'petHotPct', 'petAlertSound', 'petDailyBrief', 'petPillyPick', 'petSniper', 'petWhaleAlerts',
  'petPortfolioMood', 'petPos'];

/**
 * One mascot setting, checked and normalised — the value that is safe to store, or a thrown error naming the field.
 *
 * It lives here, next to `petOptions`, because the panel, the window and the settings file have to agree on one shape. Every
 * closed list is a list here (an unknown value would reach the renderer as nothing and leave him standing still), and a
 * field this function does not know returns `undefined` so the caller can refuse it instead of writing it blind.
 */
function cleanPetSetting(key, value) {
  switch (key) {
    case 'petName':
      return String(value == null ? '' : value).replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 14) || 'Pilly';
    case 'petSize':
    case 'petBubbleSize':
    case 'petBubbleText':
      if (!['sm', 'md', 'lg'].includes(value)) throw new Error(`Unknown pet ${key === 'petSize' ? 'size' : 'scale'}`);
      return value;
    case 'petTheme':
      if (!THEMES.includes(value)) throw new Error('Unknown pet theme');
      return value;
    case 'petBubbleStyle':
      if (!BUBBLE_STYLES.includes(value)) throw new Error('Unknown bubble style');
      return value;
    case 'petMood':
      if (!['neutral', 'happy', 'sad'].includes(value)) throw new Error('Unknown pet mood');
      return value;
    case 'petSpeed':
      if (!['slow', 'normal', 'fast'].includes(value)) throw new Error('Unknown pet speed');
      return value;
    case 'petWalkMode':
      if (!['screen', 'taskbar'].includes(value)) throw new Error('Unknown pet walk mode');
      return value;
    case 'petStopFreq':
      if (!['never', 'rare', 'normal', 'often'].includes(value)) throw new Error('Unknown pet stop frequency');
      return value;
    case 'petBubbles':
    case 'petSounds':
    case 'petQuestions':
    case 'petReduceMotion':
    case 'petHotAlerts':
    case 'petAlertSound':
    case 'petDailyBrief':
    case 'petPillyPick':
    case 'petSniper':
    case 'petWhaleAlerts':
    case 'petPortfolioMood':
      if (typeof value !== 'boolean') throw new Error(`Invalid value for ${key}`);
      return value;
    case 'petSoundVol': {
      if (!Number.isFinite(value)) throw new Error('Invalid number for petSoundVol');
      if (value < 0 || value > 100) throw new Error('petSoundVol must be between 0 and 100');
      return Math.round(value);
    }
    case 'petHotPct': {
      if (!Number.isFinite(value)) throw new Error('Invalid number for petHotPct');
      if (value < 1 || value > 100) throw new Error('petHotPct must be between 1 and 100');
      return Math.round(value);
    }
    case 'petPos': {
      if (value == null) return null;
      const x = Number(value.x);
      const y = Number(value.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('The pet position must be two numbers');
      return { x: Math.round(x), y: Math.round(y) };
    }
    default:
      return undefined;
  }
}

class PetOverlay {
  /** @param {{store: object, settings?: function}} opts `settings()` returns the live settings object. */
  constructor(opts = {}) {
    this.store = opts.store || null;
    this.settings = opts.settings || (() => (this.store ? this.store.get() : {}));
    this.win = null;
    this.timer = null;
    this.dir = 1;
    this.state = 'walk';
    this.stateUntil = 0;
    this.pauseUntil = 0;
    this.cooldownUntil = 0;
    this.holdUntil = 0;
    this.pos = null;
    this.lastPos = null;
  }

  isOn() { return Boolean(this.win && !this.win.isDestroyed()); }

  /** The saved spot, or the bottom-right corner of the primary screen. */
  defaultPos() {
    const s = this.settings() || {};
    const box = boxFor(s.petSize);
    const area = screen.getPrimaryDisplay().workArea;
    return { x: area.x + area.width - box.w - 24, y: area.y + area.height - box.h - 12 };
  }

  start() {
    if (this.isOn()) return { ok: true, already: true };
    if (!screen || !BrowserWindow) return { ok: false, error: 'the pet needs a desktop' };
    const s = this.settings() || {};
    const box = boxFor(s.petSize);
    const saved = s.petPos;
    const area = screen.getPrimaryDisplay().workArea;
    const seed = saved && Number.isFinite(saved.x) ? saved : this.defaultPos();
    this.pos = clampToScreen(seed, area, s.petSize);
    this.win = new BrowserWindow({
      width: box.w,
      height: box.h,
      x: this.pos.x,
      y: this.pos.y,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      focusable: false,
      // macOS: a non-focusable window otherwise spends the first click trying to become key, i.e. swallows it.
      acceptFirstMouse: true,
      hasShadow: false,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '..', 'pet-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    this.win.setAlwaysOnTop(true, 'screen-saver');
    if (typeof this.win.setVisibleOnAllWorkspaces === 'function') {
      try { this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch (_) { /* not on this platform */ }
    }
    this.win.loadFile(path.join(__dirname, '..', 'renderer', 'pet.html'));
    this.win.once('ready-to-show', () => {
      try {
        this.win.showInactive();
        this.send('pet:settings', petOptions(s));
      } catch (_) { /* already gone */ }
    });
    this.win.on('closed', () => { if (this.win) this.win = null; this._clear(); });
    this._tick();
    return { ok: true };
  }

  /**
   * A settings change while he is on screen: the size moves the window, the rest is pushed to the renderer. Called for
   * every field of the pet panel, so the operator sees a change as soon as they make it.
   */
  apply(s = this.settings()) {
    const opts = petOptions(s);
    if (this.win && !this.win.isDestroyed()) {
      const box = boxFor(opts.size);
      try {
        const [w, h] = this.win.getSize();
        if (w !== box.w || h !== box.h) this.win.setSize(box.w, box.h);
        if (this.pos) {
          const area = screen.getDisplayNearestPoint({ x: this.pos.x + box.w / 2, y: this.pos.y + box.h / 2 }).workArea;
          this.pos = clampToScreen(this.pos, area, opts.size);
          this.win.setPosition(Math.round(this.pos.x), Math.round(this.pos.y));
        }
      } catch (_) { /* a window that cannot resize right now is not a crash */ }
    }
    this.send('pet:settings', opts);
    return opts;
  }

  stop() {
    this._clear();
    if (this.win && !this.win.isDestroyed()) {
      const w = this.win;
      this.win = null;
      try { w.destroy(); } catch (_) { /* already gone */ }
    }
    return { ok: true };
  }

  toggle() { return this.isOn() ? { ...this.stop(), on: false } : { ...this.start(), on: true }; }

  _clear() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Push a message at the renderer without ever throwing at a window that has just died. */
  send(channel, payload) {
    try {
      if (this.win && !this.win.isDestroyed() && this.win.webContents && !this.win.webContents.isDestroyed()) {
        this.win.webContents.send(channel, payload);
      }
    } catch (_) { /* a dead renderer is not a reason to stop the pet */ }
  }

  /**
   * One step of Pilly's life. Pure enough to test: every input (the time, the cursor, the work area) comes in as an
   * argument, and the only side effects are the window's position and the messages the renderer needs.
   */
  step(now, cursor, work) {
    const dt = TICK_MS;
    const s = this.settings() || {};
    const opts = petOptions(s);
    const box = boxFor(opts.size);
    if (!this.pos) this.pos = clampToScreen(this.defaultPos(), work, opts.size);
    // On the taskbar line he walks the bottom edge: the same walk, pinned to where a taskbar pet belongs.
    if (opts.walkMode === 'taskbar') {
      const line = work.y + work.height - box.h;
      if (Math.abs(this.pos.y - line) > 1) { this.pos = { ...this.pos, y: line }; this._move(); }
    }
    const anchorY = this.pos.y + box.h;
    const dist = Math.hypot(cursor.x - (this.pos.x + box.w / 2), cursor.y - anchorY);
    const speed = this.lastPos ? Math.hypot(this.pos.x - this.lastPos.x, this.pos.y - this.lastPos.y) / dt : 0;

    // A poke: close, fast, off cooldown. This asks the renderer to play the scare, then he bolts the other way.
    if (!opts.reduceMotion && shouldSpook({ dist, speed, now, cooldownUntil: this.cooldownUntil })) {
      this.cooldownUntil = now + 4000;
      this.send('pet:spook', now);
      this.dir = -this.dir;
      this.pauseUntil = now + 250;
    }
    if (shouldStandStill({ dist, dragging: false, walkMode: opts.walkMode, state: this.state })) {
      this.holdUntil = now + CURSOR_HOLD_RESUME_MS;
    }
    // How often he stands a moment on his own. `never` means he only ever stops for a cursor or an edge.
    const stopEvery = STOP_EVERY_MS[opts.stopFreq] || 0;
    if (stopEvery && !this.nextStopAt) this.nextStopAt = now + stopEvery;
    if (stopEvery && this.nextStopAt && now >= this.nextStopAt) {
      this.nextStopAt = now + stopEvery;
      this.pauseUntil = now + Math.min(2500, stopEvery / 6);
      this.send('pet:react', 'idle');
    }
    const resting = opts.reduceMotion || this.dragging || now < this.pauseUntil || now < this.holdUntil || now < this.stateUntil;

    if (!resting) {
      this.lastPos = { ...this.pos };
      const stepPx = SPEED_PX_PER_TICK * (SPEEDS[opts.speed] || 1) * ((SIZES[opts.size] || 1) * 0.4 + 0.6);
      this.pos = { ...this.pos, x: this.pos.x + this.dir * stepPx };
      // He turns around short of the frame (owner: "idzie do rogów gdzie jej nie widac"). Walking flush to the very edge of the
      // screen parks him in a corner where nobody looks, so his own wander keeps an inset - drag him there and he stays, because
      // that is the operator's hand and not his own feet.
      const inset = Math.min(PET_EDGE_INSET, Math.max(0, Math.round((work.width - box.w) / 4)));
      const left = work.x + inset;
      const right = work.x + work.width - box.w - inset;
      if (this.pos.x <= left || this.pos.x >= right) {
        this.pos.x = Math.min(Math.max(this.pos.x, left), right);
        this.dir = -this.dir;
        this.pauseUntil = now + EDGE_PAUSE_MS;
        this.send('pet:react', 'turn');
      }
      this._move();
    }

    // The mood matters to the animation: a walk cycle plays only while he is walking.
    const next = opts.reduceMotion ? 'idle' : now < this.pauseUntil ? 'idle' : 'walk';
    if (next !== this.state) {
      this.state = next;
      this.stateUntil = STATE_MS[next] ? now + STATE_MS[next] : 0;
      this.send('pet:state', next);
    }
    if (this.dir !== this._dirSent) {
      this._dirSent = this.dir;
      this.send('pet:dir', this.dir);
    }
    this.send('pet:cursor', { x: cursor.x, y: cursor.y });
    return this.pos;
  }

  _move() {
    try {
      if (!this.win || this.win.isDestroyed()) return;
      this.win.setPosition(Math.round(this.pos.x), Math.round(this.pos.y));
    } catch (_) { /* a window that cannot move is not a crash */ }
    // Anything glued to him (the bubble) has to be told, every time he actually moves: without this the bubble stayed where it
    // was first placed while he walked away, which is what "the bubbles break at the edges" looked like.
    if (typeof this.onMove === 'function') { try { this.onMove(this.pos); } catch (_) { /* ignore */ } }
  }

  _tick() {
    this._clear();
    this.timer = setTimeout(() => {
      try {
        if (!this.isOn()) return;
        const cursor = screen.getCursorScreenPoint();
        const point = { x: this.pos ? this.pos.x + PET_W / 2 : cursor.x, y: this.pos ? this.pos.y + PET_H / 2 : cursor.y };
        const display = screen.getDisplayNearestPoint(point);
        this.step(Date.now(), cursor, display.workArea);
      } catch (_) { /* never let a tick take the app down */ }
      this._tick();
    }, TICK_MS);
    if (this.timer && typeof this.timer.unref === 'function') this.timer.unref();
  }

  /** Remember where he was left, debounced: a walk would otherwise write the file forty times a second. */
  remember() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      try { if (this.store && this.pos) this.store.set({ petPos: { x: Math.round(this.pos.x), y: Math.round(this.pos.y) } }); } catch (_) { /* ignore */ }
    }, 900);
    if (this._saveTimer && typeof this._saveTimer.unref === 'function') this._saveTimer.unref();
  }

  /**
   * A drag from the renderer: he follows the cursor and stays where he was put. `work` is injected by the tests.
   */
  dragTo(pos, work) {
    if (!this.pos) return null;
    const size = petOptions(this.settings() || {}).size;
    let area = work;
    if (!area) {
      if (!screen) return this.pos;
      area = screen.getDisplayNearestPoint({ x: pos.x, y: pos.y }).workArea;
    }
    this.pos = clampToScreen(pos, area, size);
    this._move();
    this.remember();
    return this.pos;
  }

  /**
   * A hand on him. The three verbs `pet.html` sends — start, move (a delta), end — are the whole story, and the walk has to stop
   * for all of them: a step taken between two move reports is a step the hand did not ask for, and it used to make the drag feel
   * like he was fighting back.
   */
  dragStart() {
    this.dragging = true;
    this.lastPos = null;
    return this.pos;
  }

  dragHold() {
    // "Still holding, not moving": the page says so every half second, and it must not end the carry.
    this.dragging = true;
    return this.pos;
  }

  /** Move him by a delta, in screen pixels, and keep him reachable on the screen he is being dragged to. */
  dragMove(dx, dy, work) {
    if (!this.pos) return null;
    const opts = petOptions(this.settings() || {});
    const box = boxFor(opts.size);
    this.dragging = true;
    let x = this.pos.x + Number(dx || 0);
    let y = this.pos.y + Number(dy || 0);
    let area = work || null;
    if (!area && screen) area = screen.getDisplayNearestPoint({ x: x + box.w / 2, y: y + box.h / 2 }).workArea;
    if (area) {
      // He is never cut and never lost: the window stays fully inside the work area he is being dragged over, because "parked
      // flush against the edge" turned out to mean "half of him is off the screen", which the owner read - correctly - as a bug.
      x = Math.max(area.x, Math.min(x, area.x + area.width - box.w));
      y = Math.max(area.y, Math.min(y, area.y + area.height - box.h));
    }
    this.pos = { x, y };
    this._move();
    return this.pos;
  }

  /** Put him down: remembered once, and the walk may start again. */
  dragEnd() {
    this.dragging = false;
    this.pauseUntil = Math.max(this.pauseUntil, Date.now() + 400);
    this.remember();
    return this.pos;
  }
}

/**
 * The speech bubble: a second always-on-top window glued to the pet, and the only way Pilly can say anything.
 *
 * It is separate from the pet window for Pilly's own reason — the bubble has to be able to hang outside the pet's 60x64 box
 * and be clicked (which the click-through pet window cannot be) — and it carries the whole look the panel offers: the bubble
 * size, the text size, and the six bubble styles `renderer/bubble.html` draws.
 *
 * Everything about *where* it goes is `bubblePlacement`, which is arithmetic and tested; this class owns a window, a hide
 * timer and the "he is talking" flag. A bubble with nothing in it is never shown, and a bubble is never left on screen after
 * the pet was put away.
 */
class Bubble {
  /** @param {{pet?: PetOverlay, settings?: function}} opts */
  constructor(opts = {}) {
    this.pet = opts.pet || null;
    this.settings = opts.settings || (() => (this.pet ? this.pet.settings() : {}));
    this.win = null;
    this.ready = false;
    this.pending = null;
    this.timer = null;
    this.hideAt = 0;
    this.clickable = false;
    this.orient = null;
    this.tail = { tx: 0, ty: 0 };
    this.size = { ...bubbleBox(petOptions(this.settings() || {})) };
  }

  isOn() { return Boolean(this.win && !this.win.isDestroyed()); }

  /**
   * Say something. `ms` is how long it stays (a joke is 9 s, an alert 12 s because it is time-sensitive), and `clickable`
   * is the alert case: a tap opens the chat instead of dismissing the bubble.
   */
  say(text, opts = {}) {
    const line = String(text == null ? '' : text).trim();
    if (!line) return { ok: false, error: 'nothing to say' };
    const s = this.settings() || {};
    if (s.petBubbles === false) return { ok: false, error: 'bubbles are switched off' };
    if (!this.pet || !this.pet.isOn()) return { ok: false, error: 'he is not on screen' };
    const win = this._ensure();
    if (!win) return { ok: false, error: 'the bubble could not be opened' };
    this._push(line);
    this.position();
    try { win.showInactive(); } catch (_) { /* already gone */ }
    this._clickable(Boolean(opts.clickable));
    this.pet.send('pet:talking', true);
    const ms = Math.min(60000, Math.max(1500, Number(opts.ms) || 9000));
    this.hideAt = Date.now() + ms;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.hide(), ms);
    if (this.timer && typeof this.timer.unref === 'function') this.timer.unref();
    return { ok: true, text: line, ms };
  }

  hide() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.hideAt = 0;
    this._clickable(false);
    try { if (this.isOn()) this.win.hide(); } catch (_) { /* already gone */ }
    if (this.pet) this.pet.send('pet:talking', false);
  }

  /** A timer decides when a bubble goes away; the page's own tap can end it early. */
  isShowing() { return Boolean(this.isOn() && this.win.isVisible() && Date.now() < this.hideAt); }

  /** The tail's target, and whether the window had to move — Pilly only re-sends an orientation that changed. */
  position() {
    if (!this.isOn() || !this.pet || !this.pet.pos) return null;
    const s = this.settings() || {};
    const opts = petOptions(s);
    const box = boxFor(opts.size);
    const centre = { x: this.pet.pos.x + box.w / 2, y: this.pet.pos.y + box.h / 2 };
    const work = screen ? screen.getDisplayNearestPoint(centre).workArea : { x: 0, y: 0, width: 1920, height: 1080 };
    const place = bubblePlacement({ pos: this.pet.pos, size: opts.size, work, bubble: this.size });
    if (process.env.PILLY_TRACE) {
      console.log('[trace] pos', JSON.stringify(this.pet.pos), 'box', JSON.stringify(box), 'size', opts.size, 'work', JSON.stringify(work), 'bubble', JSON.stringify(this.size), '->', JSON.stringify(place));
    }
    try { this.win.setPosition(place.x, place.y); } catch (_) { /* a window that cannot move is not a crash */ }
    const moved = place.orient !== this.orient || Math.abs(place.tail.tx - this.tail.tx) >= 2 || Math.abs(place.tail.ty - this.tail.ty) >= 2;
    if (moved) {
      this.orient = place.orient;
      this.tail = place.tail;
      this._send('pet:orient', { o: place.orient, tx: place.tail.tx, ty: place.tail.ty });
    }
    return place;
  }

  /** The page measured its text and asks for a taller window (Pilly clamps it at 160..340 px, and so does this). */
  resize(height) {
    if (!this.isOn()) return null;
    const h = Math.max(160, Math.min(340, Math.round(Number(height) || 160)));
    this.size = { w: this.size.w, h };
    try {
      const [oldW, old] = this.win.getSize();
      if (old !== h || oldW !== this.size.w) this.win.setSize(this.size.w, h);
    } catch (_) { /* ignore */ }
    return this.position();
  }

  /** A settings change: the bubble's look is the page's, so the options go straight at it — and the window is re-measured. */
  apply(s = this.settings()) {
    const opts = petOptions(s);
    const box = bubbleBox(opts);
    if (box.w !== this.size.w) {
      this.size = { w: box.w, h: this.size.h };
      try { if (this.isOn()) this.win.setSize(box.w, this.size.h); } catch (_) { /* ignore */ }
    }
    this._send('pet:settings', opts);
    if (this.isOn()) this.position();
    return opts;
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.hideAt = 0;
    this.ready = false;
    this.pending = null;
    this.orient = null;
    if (this.win && !this.win.isDestroyed()) {
      const w = this.win;
      this.win = null;
      try { w.destroy(); } catch (_) { /* already gone */ }
    }
    return { ok: true };
  }

  _ensure() {
    if (this.isOn()) return this.win;
    if (!BrowserWindow) return null;
    this.win = new BrowserWindow({
      width: this.size.w,
      height: this.size.h,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      // Windows freezes a non-resizable window at its current size, and the bubble has to grow with its text.
      resizable: true,
      focusable: false,
      acceptFirstMouse: true,
      hasShadow: false,
      skipTaskbar: true,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '..', 'pet-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    this.win.setAlwaysOnTop(true, 'screen-saver');
    if (typeof this.win.setVisibleOnAllWorkspaces === 'function') {
      try { this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch (_) { /* not on this platform */ }
    }
    this.win.setIgnoreMouseEvents(true, { forward: true });
    this.ready = false;
    this.orient = null;
    this.win.loadFile(path.join(__dirname, '..', 'renderer', 'bubble.html'));
    this.win.webContents.on('did-finish-load', () => {
      this.ready = true;
      this._send('pet:settings', petOptions(this.settings() || {}));
      this._send('pet:orient', { o: this.orient || 'above', tx: this.tail.tx, ty: this.tail.ty });
      // A line said before the page finished loading must not be lost.
      if (this.pending) { const t = this.pending; this.pending = null; this._push(t); }
    });
    this.win.on('closed', () => { this.win = null; this.ready = false; });
    return this.win;
  }

  _push(text) {
    if (!this.isOn()) return;
    if (this.ready) this._send('pet:joke', text);
    else this.pending = text;
  }

  _clickable(on) {
    if (this.clickable === on || !this.isOn()) return;
    this.clickable = on;
    try { this.win.setIgnoreMouseEvents(!on, { forward: true }); } catch (_) { /* ignore */ }
  }

  _send(channel, payload) {
    try {
      if (this.isOn() && this.win.webContents && !this.win.webContents.isDestroyed()) this.win.webContents.send(channel, payload);
    } catch (_) { /* a dead renderer is not a reason to stop the bubble */ }
  }
}

module.exports = { PetOverlay, Bubble, bubblePlacement, bubbleBox, clampToScreen, boxFor, petOptions, cleanPetSetting, PET_SETTINGS, PET_W, PET_H, TICK_MS, SPEED_PX_PER_TICK, PET_EDGE_INSET, SIZES, SPEEDS, STOP_EVERY_MS, THEMES, BUBBLE_STYLES };
