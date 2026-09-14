// v1.1.2 animation verification harness.
//
// pet.html's renderer lives inside an IIFE, so its animation internals are not
// reachable from executeJavaScript. Rather than adding test hooks to the
// shipped file, this harness injects a read/write bridge into a temporary
// *copy* of pet.html and drives the real draw()/blinkAmount() functions there.
// Run it with: npm run verify:anim
const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");

const ROOT = path.join(__dirname, "..");
const PRELOAD = path.join(__dirname, "stub-preload.js");
// The bridge is injected into a throwaway copy, so nothing is written into the
// repository (and two runs cannot fight over the same file).
const PATCHED = path.join(os.tmpdir(), "pilly-pet-patched-" + process.pid + ".html");
// Isolate the run: never touch the developer's real Pilly profile.
const PROFILE = path.join(os.tmpdir(), "pilly-verify-anim-" + process.pid);
app.setPath("userData", PROFILE);

// app.exit() skips will-quit, and Chromium keeps writing into the profile while
// the process tears down, so the last write always lands after any cleanup we do
// in-process. Remove the copy here and hand the profile to a detached helper that
// deletes it once this process is gone: a verification run should leave no trace.
function cleanupTmp() {
  try { fs.rmSync(PATCHED, { force: true }); } catch (e) { /* nothing to remove */ }
  try {
    const { spawn } = require("child_process");
    const code = `setTimeout(() => { try { require("fs").rmSync(${JSON.stringify(PROFILE)}, ` +
      `{ recursive: true, force: true }); } catch (e) {} }, 1500);`;
    spawn(process.execPath, ["-e", code], {
      detached: true,
      stdio: "ignore",
      env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: "1" }),
    }).unref();
  } catch (e) { /* best effort */ }
}

const BRIDGE = `
      window.__t = {
        get state() { return state; }, set state(v) { state = v; },
        get gesture() { return gesture; }, set gesture(v) { gesture = v; },
        get gestureStart() { return gestureStart; }, set gestureStart(v) { gestureStart = v; },
        get gestureUntil() { return gestureUntil; }, set gestureUntil(v) { gestureUntil = v; },
        get gestureNext() { return gestureNext; }, set gestureNext(v) { gestureNext = v; },
        get greetHoldUntil() { return greetHoldUntil; }, set greetHoldUntil(v) { greetHoldUntil = v; },
        get reduceMotion() { return reduceMotion; }, set reduceMotion(v) { reduceMotion = v; },
        get thoughtNext() { return thoughtNext; }, set thoughtNext(v) { thoughtNext = v; },
        get hopStart() { return hopStart; }, set hopStart(v) { hopStart = v; },
        get cur() { return cur; },
        get cursor() { return cursor; }, set cursor(v) { cursor = v; },
        get petDirNow() { return petDirNow; },
        get particles() { return particles; },
        get dragOverride() { return dragOverride; },
        get hover() { return hover; }, set hover(v) { hover = v; },
        // v1.1.2 drag/tap: the carry state and the movement counter the pointer
        // handlers actually keep. "Sometimes the chat does not open" is a claim
        // about exactly this state, so the harness reads it back instead of
        // guessing from pixels.
        get dragging() { return dragging; },
        get moved() { return moved; },
        get canDrag() { return canDrag; },
        get dragIdleMs() { return dragIdleMs; }, set dragIdleMs(v) { dragIdleMs = v; },
        get clickUntil() { return clickUntil; }, set clickUntil(v) { clickUntil = v; },
        get talking() { return talking; }, set talking(v) { talking = v; },
        get blinkStart() { return blinkStart; }, set blinkStart(v) { blinkStart = v; },
        get blinkUntil() { return blinkUntil; }, set blinkUntil(v) { blinkUntil = v; },
        get blinkNext() { return blinkNext; }, set blinkNext(v) { blinkNext = v; },
        get canvas() { return canvas; },
        get ctx() { return ctx; },
        get focusState() { return focusState; },
        get focusNodUntil() { return focusNodUntil; }, set focusNodUntil(v) { focusNodUntil = v; },
        applyFocus: (p) => applyFocus(p),
        ring: (n, y) => drawFocusRing(n, y),
        part: (ms) => dayPart(ms),
        pace: (ms) => DAY_PART_PACE[dayPart(ms)] || 1,
        gestureTable: (part) => (DAY_PART_GESTURES[part] || []).map((e) => e[0]),
        // v1.1.2 additions: the coin toss, the background breathing, the walk
        // gaze and the night droop are all invisible to a pixel count, so the
        // bridge reports the values the draw loop actually used.
        coinAt: (n) => coinState(n),
        coinMs: () => COIN_MS,
        droopAt: (ms) => nightDroop(ms),
        get breathY() { return breathY; },
        get gazeAhead() { return gazeAhead; }, set gazeAhead(v) { gazeAhead = v; },
        get face() { return face; },
        get lastLid() { return lastLid; },
        get wobbleStart() { return wobbleStart; }, set wobbleStart(v) { wobbleStart = v; },
        get wobbleUntil() { return wobbleUntil; }, set wobbleUntil(v) { wobbleUntil = v; },
        get dartUntil() { return dartUntil; }, set dartUntil(v) { dartUntil = v; },
        get landingUntil() { return landingUntil; }, set landingUntil(v) { landingUntil = v; },
        // v1.1.2 touch: petting, being carried, being tapped. The harness drives
        // the real entry points and reads back what the draw loop did with them -
        // a stroke is pointer movement, so it cannot be faked from the outside.
        stroke: (cx, cy, at) => stroke(cx, cy, at),
        boop: (at) => boop(at),
        wakeUp: (at) => wakeUp(at),
        dropReaction: (at) => dropReaction(at),
        blissLevel: (at) => blissLevel(at),
        resetStroke: () => resetStroke(),
        get petCharge() { return petCharge; }, set petCharge(v) { petCharge = v; },
        get petChargeAt() { return petChargeAt; }, set petChargeAt(v) { petChargeAt = v; },
        get petStrokeTurns() { return petStrokeTurns; },
        get petLevel() { return petLevel; }, set petLevel(v) { petLevel = v; },
        get petStart() { return petStart; }, set petStart(v) { petStart = v; },
        get petUntil() { return petUntil; }, set petUntil(v) { petUntil = v; },
        get petCoolUntil() { return petCoolUntil; }, set petCoolUntil(v) { petCoolUntil = v; },
        get petTrigger() { return PET_TRIGGER; },
        get petMeltTrigger() { return PET_MELT_TRIGGER; },
        get petMs() { return PET_MS; },
        get petMeltMs() { return PET_MELT_MS; },
        get petCoolMs() { return PET_COOLDOWN_MS; },
        get petLean() { return petLean; }, set petLean(v) { petLean = v; },
        get petLeanX() { return petLeanX; }, set petLeanX(v) { petLeanX = v; },
        get boopCount() { return boopCount; }, set boopCount(v) { boopCount = v; },
        get boopLast() { return boopLast; }, set boopLast(v) { boopLast = v; },
        get loveFromTapUntil() { return loveFromTapUntil; }, set loveFromTapUntil(v) { loveFromTapUntil = v; },
        get carryVX() { return carryVX; }, set carryVX(v) { carryVX = v; },
        get carryVY() { return carryVY; }, set carryVY(v) { carryVY = v; },
        get carryDist() { return carryDist; }, set carryDist(v) { carryDist = v; },
        get carryRough() { return carryRough; }, set carryRough(v) { carryRough = v; },
        get dizzyUntil() { return dizzyUntil; }, set dizzyUntil(v) { dizzyUntil = v; },
        get shakeStart() { return shakeStart; }, set shakeStart(v) { shakeStart = v; },
        get shakeUntil() { return shakeUntil; }, set shakeUntil(v) { shakeUntil = v; },
        get tickleUntil() { return tickleUntil; }, set tickleUntil(v) { tickleUntil = v; },
        get tickleMs() { return TICKLE_MS; },
        get perkUntil() { return perkUntil; }, set perkUntil(v) { perkUntil = v; },
        get perkNext() { return perkNext; }, set perkNext(v) { perkNext = v; },
        get perkMs() { return PERK_MS; },
        get market() { return market; }, set market(v) { market = v; },
        get marketUntil() { return marketUntil; }, set marketUntil(v) { marketUntil = v; },
        get blinkAgainAt() { return blinkAgainAt; }, set blinkAgainAt(v) { blinkAgainAt = v; },
        startGesture: (n, at) => startGesture(n, at),
        draw: (n, d) => draw(n, d),
        blinkAmount: (n) => blinkAmount(n),
        opaque: () => {
          const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          let n = 0;
          for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
          return n;
        },
        centroid: () => {
          const w = canvas.width, h = canvas.height;
          const d = ctx.getImageData(0, 0, w, h).data;
          let sw = 0, sx = 0;
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              const a = d[(y * w + x) * 4 + 3];
              if (a > 0) { sw += a; sx += a * x; }
            }
          }
          return sw ? sx / sw : 0;
        },
      };
`;

function writePatched() {
  const src = fs.readFileSync(path.join(ROOT, "renderer", "pet.html"), "utf8");
  const anchor = '"use strict";';
  if (src.indexOf(anchor) < 0) throw new Error("could not find the IIFE anchor in pet.html");
  fs.writeFileSync(PATCHED, src.replace(anchor, anchor + "\n" + BRIDGE), "utf8");
}

app.disableHardwareAcceleration();
setTimeout(() => { console.log("VERIFY HARD_TIMEOUT"); cleanupTmp(); app.exit(2); }, 90000);
process.on("uncaughtException", (e) => { console.log("MAIN_UNCAUGHT " + (e && e.stack ? e.stack : e)); cleanupTmp(); app.exit(3); });

const failures = [];
let checks = 0;
function check(name, ok, detail) {
  checks++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail === undefined ? "" : "  -> " + JSON.stringify(detail)}`);
  if (!ok) failures.push(name);
}

app.whenReady().then(async () => {
  writePatched();
  const win = new BrowserWindow({
    show: false, width: 60, height: 64,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: PRELOAD },
  });
  const rendererErrors = [];
  win.webContents.on("console-message", (e, level, msg) => { if (level >= 3) rendererErrors.push(String(msg)); });
  win.webContents.on("render-process-gone", (e, d) => rendererErrors.push("gone " + JSON.stringify(d)));
  await win.loadFile(PATCHED);
  await new Promise((r) => setTimeout(r, 800));

  const api = await win.webContents.executeJavaScript("(() => ({ bridge: typeof window.__t, blink: typeof window.__t && typeof window.__t.blinkAmount, draw: typeof window.__t && typeof window.__t.draw }))()");
  check("bridge injected into the pet IIFE", api.bridge === "object" && api.blink === "function" && api.draw === "function", api);
  if (api.bridge !== "object") {
    console.log("VERIFY_DONE checks=" + checks + " failures=" + failures.length);
    cleanupTmp();
    return app.exit(1);
  }

  // Quiesce the ambient schedulers so the tests drive everything themselves.
  await win.webContents.executeJavaScript(`(() => {
    const t = window.__t;
    t.gestureNext = performance.now() + 1e9;
    t.thoughtNext = performance.now() + 1e9;
    t.blinkNext = performance.now() + 1e9;
    t.dragOverride.active = false;
    return true;
  })()`);

  // --- eased blink curve -------------------------------------------------
  const curve = await win.webContents.executeJavaScript(`(() => {
    const t = window.__t;
    t.blinkStart = 1000; t.blinkUntil = 1100;   // 100ms blink
    const at = (x) => Number(t.blinkAmount(x).toFixed(4));
    return { before: at(0), start: at(1000), q1: at(1025), mid: at(1050), q3: at(1075), end: at(1100), after: at(1200) };
  })()`);
  check("blink starts fully open", curve.before === 0 && curve.start === 0, curve);
  check("blink holds a full close at the midpoint", curve.mid === 1, curve.mid);
  check("blink reopens symmetrically (no snap)", curve.q1 === curve.q3 && curve.q1 > 0.5 && curve.q1 < 1, [curve.q1, curve.q3]);
  check("blink ends after blinkUntil", curve.end === 0 && curve.after === 0);

  // --- every gesture renders without throwing ----------------------------
  const gestures = ["wave", "yawn", "stretch", "peek", "curious", "sneeze", "wiggle", "heart", "giggle", "spin", "coin"];
  const gestureRun = await win.webContents.executeJavaScript(`(() => {
    const t = window.__t;
    const list = ${JSON.stringify(gestures)};
    const out = {};
    for (const g of list) {
      try {
        t.state = "pause";
        t.gesture = g; t.gestureStart = performance.now() - 200; t.gestureUntil = performance.now() + 1200;
        t.particles.length = 0;
        for (let i = 0; i < 40; i++) t.draw(performance.now() + i * 25, 25);
        out[g] = t.opaque();
      } catch (e) {
        out[g] = "THREW: " + (e && e.message ? e.message : String(e));
      }
    }
    t.gesture = ""; t.gestureUntil = 0;
    return out;
  })()`);
  for (const g of gestures) {
    const v = gestureRun[g];
    check(`gesture "${g}" animates 40 frames without throwing`, typeof v === "number" && v > 100, v);
  }

  // --- the spin squashes X toward zero (turn illusion) -------------------
  const spin = await win.webContents.executeJavaScript(`(() => {
    const t = window.__t;
    t.state = "pause";
    // Isolate: the previous gesture (the coin toss) ends with a landing wobble,
    // and this check is about the spin's own turn illusion.
    t.landingUntil = 0; t.wobbleStart = 0; t.wobbleUntil = 0;
    t.gesture = "spin"; t.gestureStart = performance.now(); t.gestureUntil = t.gestureStart + 820;
    const widths = [];
    for (let i = 0; i <= 8; i++) {
      t.cur.squX = 1;
      t.draw(t.gestureStart + (820 / 8) * i, 16);
      widths.push(Number(t.cur.squX.toFixed(3)));
    }
    t.gesture = ""; t.gestureUntil = 0;
    return widths;
  })()`);
  check("spin shrinks the body width", Math.min(...spin) < 0.3, spin);
  check("spin never collapses to nothing", Math.min(...spin) >= 0.14, Math.min(...spin));

  // --- v1.1.2: the coin flip --------------------------------------------
  // His own gesture (this is an app for people who live on Solana): he tosses a
  // coin, it spins edge over edge, he catches it. The toss arc, the spin and the
  // catch are all read from the state the renderer itself used.
  const coin = await win.webContents.executeJavaScript(`(() => {
    const t = window.__t;
    const t0 = performance.now();
    t.state = "pause"; t.landingUntil = 0; t.wobbleStart = 0; t.wobbleUntil = 0;
    // Go through the real entry point: it is what resets the per-toss catch flag.
    t.startGesture("coin", t0);
    t.particles.length = 0;   // drop the sparkle the toss itself spawns
    const arc = [], spin = [];
    for (let i = 0; i <= 9; i++) {
      const s = t.coinAt(t0 + (t.coinMs() / 10) * i);
      arc.push(Number(s.h.toFixed(3)));
      spin.push(Number(s.sx.toFixed(3)));
    }
    arc.push(Number(t.coinAt(t0 + t.coinMs() - 1).h.toFixed(3)));   // the final frame, just before the catch
    const after = t.coinAt(t0 + t.coinMs() + 1);                     // the window has closed
    const noGesture = (() => { const g = t.gesture; t.gesture = ""; const v = t.coinAt(t0); t.gesture = g; return v; })();
    // The catch: past 90% of the toss he lands it - one squash, one puff.
    t.landingUntil = 0;
    t.draw(t0 + t.coinMs() * 0.99, 16);
    const landed = t.landingUntil;
    const gold = t.particles.filter((p) => p.type === "confetti").length;
    t.draw(t0 + t.coinMs() * 0.995, 16);
    const goldAgain = t.particles.filter((p) => p.type === "confetti").length;
    t.gesture = ""; t.gestureUntil = 0; t.state = "pause";
    t.landingUntil = 0; t.wobbleStart = 0; t.wobbleUntil = 0;
    return { arc, spin, after, noGesture, landed, gold, goldAgain };
  })()`);
  check("the coin flip tosses the coin up and brings it back down",
    coin.arc[0] < 0.05 && coin.arc[5] > 0.95 && coin.arc[10] < 0.05, coin.arc);
  check("the coin spins edge over edge without ever vanishing",
    Math.min(...coin.spin) < 0.2 && Math.min(...coin.spin) >= 0.12, coin.spin);
  check("the coin only exists while the gesture runs",
    coin.after === null && coin.noGesture === null, [coin.after, coin.noGesture]);
  check("catching the coin squashes him and puffs gold",
    coin.landed > 0 && coin.gold >= 4, { squashUntil: coin.landed > 0, gold: coin.gold });
  check("the catch fires once per toss, not on every frame",
    coin.goldAgain === coin.gold, { first: coin.gold, later: coin.goldAgain });

  // --- v1.1.2: he breathes in every state -------------------------------
  // A sprite that only moves when something happens reads as a slideshow. The
  // measurement is the offset the draw loop actually applied.
  const breath = await win.webContents.executeJavaScript(`(() => {
    const t = window.__t;
    const motion = t.reduceMotion;   // the real OS setting: this check is about the breathing, not about it
    t.reduceMotion = false;
    t.dragOverride.active = false;
    t.cursor = { x: 400, y: 400 };
    const sample = (state) => {
      t.state = state;
      const vals = [];
      for (let i = 0; i < 200; i++) { t.draw(performance.now() + i * 16.67, 16.67); vals.push(t.breathY); }
      return { min: Math.min(...vals), max: Math.max(...vals) };
    };
    const walking = sample("walk");
    const parked = sample("pause");
    t.state = "pause";
    t.dartUntil = 0;   // the parked sampling let the idle dart fire at a synthetic future time
    t.reduceMotion = motion;
    return { walking, parked, osCalm: motion };
  })()`);
  check("he keeps breathing while he walks (not only while parked)",
    breath.walking.min < -0.3 && breath.walking.max > 0.3, breath);
  check("the background breathing stays subtle (under a pixel)",
    breath.walking.max < 1 && breath.walking.min > -1, breath.walking);
  check("the parked breathing is left to the idle animation (no double bounce)",
    breath.parked.min === 0 && breath.parked.max === 0, breath.parked);

  // --- v1.1.2: he looks where he is going ---------------------------------
  // While he walks and your cursor is far away, tracking it means staring off
  // the edge of his window. He looks ahead instead - and still tracks you the
  // moment you come close.
  const gaze = await win.webContents.executeJavaScript(`(() => {
    const t = window.__t;
    t.dartUntil = 0;   // a stale idle dart would hold the look-ahead blend off
    const settle = (cx) => {
      t.state = "walk"; t.cursor = { x: cx, y: 0 };
      const now = performance.now();
      for (let i = 0; i < 60; i++) t.draw(now + i * 16.67, 16.67);
      const r = { px: Number(t.face.px.toFixed(3)), dir: t.petDirNow, blend: Number(t.gazeAhead.toFixed(3)) };
      return r;
    };
    const behind = settle(-400);   // far behind him: following it is pointless
    const ahead = settle(400);     // far in front: same thing
    const close = settle(10);      // right next to him: he watches you
    t.state = "pause"; t.cursor = { x: 0, y: 0 }; t.gazeAhead = 0;
    return { behind, ahead, close };
  })()`);
  const looksAhead = (s) => Math.abs(s.px - 0.85 * s.dir) < 0.2 && Math.abs(s.px) > 0.6;
  check("far away, his pupils point where he is walking (not at the cursor)",
    looksAhead(gaze.behind) && looksAhead(gaze.ahead) &&
      gaze.behind.blend > 0.9 && Math.abs(gaze.behind.px * gaze.behind.dir) > 0,
    gaze);
  check("a cursor near him still pulls his gaze back",
    Math.abs(gaze.close.px) < 0.3 && gaze.close.px * gaze.close.dir > 0 && gaze.close.blend < 0.1, gaze);

  // --- v1.1.2: the landing releases into a wobble -------------------------
  // The squash must not just stop when it is done: weight is what you see after
  // the contact, and it is the cheapest way to stop reading as a sprite swap.
  const wobble = await win.webContents.executeJavaScript(`(() => {
    const t = window.__t;
    t.reduceMotion = false;
    const t0 = performance.now();
    t.state = "hop"; t.hopStart = t0; t.cursor = { x: 400, y: 400 };
    t.landingUntil = 0; t.wobbleStart = 0; t.wobbleUntil = 0;
    for (let i = 0; i <= 80; i++) t.draw(t0 + i * 10, 10);   // fly the whole hop
    const start = t.wobbleStart, until = t.wobbleUntil;
    if (!start || !until) { t.state = "pause"; return { start: 0, until: 0, devs: [] }; }
    // Isolate the settle: start the measurement from a neutral body so the
    // numbers are the wobble's, not the tail of the landing squash's.
    const devs = [];
    for (let n = start; n < until; n += 16.67) {
      t.cur.squX = 1; t.cur.squY = 1;
      t.draw(n, 16.67);
      devs.push(Math.abs(t.cur.squX - 1));
    }
    t.state = "pause"; t.wobbleStart = 0; t.wobbleUntil = 0; t.landingUntil = 0;
    const third = Math.max(1, Math.floor(devs.length / 3));
    const mean = (a) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
    return {
      start: start - t0, until: until - t0, frames: devs.length,
      peak: Number(Math.max(...devs).toFixed(4)),
      early: mean(devs.slice(0, third)), late: mean(devs.slice(-third)),
    };
  })()`);
  check("a landing opens a wobble window after the squash",
    wobble.start > 0 && wobble.until > wobble.start + 300, { start: wobble.start, until: wobble.until });
  // 0.01 of a 40px body is 0.4px: anything less than that is invisible and the
  // wobble would be decoration in the source only.
  check("the wobble actually moves him (and stays subtle)",
    wobble.peak > 0.01 && wobble.peak < 0.08, wobble.peak);
  check("the wobble damps out instead of ringing forever", wobble.late < wobble.early, { early: wobble.early, late: wobble.late });

  // --- v1.1.2: he gets drowsy at night ------------------------------------
  // The diurnal gesture weights say this with behaviour; the lid says it on
  // screen, all the time. Both are read from the pure helper and from the value
  // the eyes were really drawn with.
  const droop = await win.webContents.executeJavaScript(`(() => {
    const t = window.__t;
    const at = (h) => new Date(2024, 0, 15, h, 30, 0).getTime();
    t.state = "pause"; t.gesture = ""; t.gestureUntil = 0; t.talking = false;
    t.cursor = { x: 0, y: -400 };           // nobody near, nothing to be excited about
    t.draw(performance.now(), 16);
    const lid = t.lastLid;
    const excited = t.face.excited;
    t.draw(performance.now() + 40, 16);
    const nowMs = Date.now();
    return { night: t.droopAt(at(2)), day: t.droopAt(at(12)), evening: t.droopAt(at(20)), live: t.droopAt(nowMs), lid, excited, atNight: t.part(nowMs) === "night" };
  })()`);
  check("his lids droop at night and lift during the day",
    droop.night > 0.2 && droop.night < 0.45 && droop.day === 0 && droop.evening === 0,
    { night: droop.night, day: droop.day, evening: droop.evening });
  check("the droop follows the real clock at runtime", droop.live === (droop.atNight ? droop.night : 0), { live: droop.live, atNight: droop.atNight });
  check("the droop reaches the eyelid he is drawn with (unless something excites him)",
    droop.excited || droop.lid >= (droop.atNight ? droop.night : 0) - 1e-9, { lid: droop.lid, excited: droop.excited, atNight: droop.atNight });

  // --- hop: anticipation crouch, then a tall stretch ---------------------
  const hop = await win.webContents.executeJavaScript(`(() => {
    const t = window.__t;
    const t0 = performance.now();
    const frames = [];
    for (let i = 0; i <= 10; i++) {
      t.state = "walk";
      t.state = "hop"; t.hopStart = t0;
      t.cur.squX = 1; t.cur.squY = 1;
      t.draw(t0 + (720 / 10) * i, 72);
      frames.push({ x: Number(t.cur.squX.toFixed(3)), y: Number(t.cur.squY.toFixed(3)) });
    }
    t.state = "pause";
    return frames;
  })()`);
  check("hop crouches before launching (anticipation)", hop[1].x > 1.05 && hop[1].y < 0.95, hop[1]);
  check("hop stretches tall in the air", hop[4].y > 1.05 || hop[5].y > 1.05, [hop[4], hop[5]]);

  const hopCont = await win.webContents.executeJavaScript(`(() => {
    const t = window.__t;
    const t0 = performance.now();
    let prev = null, maxd = 0, first = null;
    for (let i = 0; i < 720; i += 2) {
      t.state = "hop"; t.hopStart = t0;
      t.draw(t0 + i, 2);
      const c = { x: t.cur.squX, y: t.cur.squY };
      if (prev) maxd = Math.max(maxd, Math.abs(c.x - prev.x), Math.abs(c.y - prev.y));
      prev = c;
      if (!first) first = c;
    }
    t.state = "pause";
    return { maxd: Number(maxd.toFixed(4)), firstX: Number(first.x.toFixed(3)), firstY: Number(first.y.toFixed(3)) };
  })()`);
  check("hop shape is continuous (no snap between phases)", hopCont.maxd < 0.05, hopCont);
  check("hop starts from neutral", Math.abs(hopCont.firstX - 1) < 0.03 && Math.abs(hopCont.firstY - 1) < 0.03, hopCont);

  // --- shy lean: how the body actually shifts on screen ------------------
  const lean = await win.webContents.executeJavaScript(`(() => {
    const t = window.__t;
    t.state = "pause"; t.gesture = ""; t.gestureUntil = 0; t.dragOverride.active = false;
    const now = performance.now();
    // Settle first: the lean is smoothed, so a single frame would only report a
    // fraction of it (and make the check flaky).
    const at = (cx) => {
      t.cursor = { x: cx, y: 6 }; t.cur.tilt = 0;
      for (let i = 0; i < 40; i++) t.draw(now + i * 16, 16);
      return t.centroid();
    };
    const far = at(200);
    return {
      far: Number(far.toFixed(4)),
      right: Number((at(6) - far).toFixed(4)),
      left: Number((at(-6) - far).toFixed(4)),
      dir: t.petDirNow,
    };
  })()`);
  check("lean with the cursor right moves the body left (away from you)", lean.right < -0.4, lean);
  check("lean with the cursor left moves the body right (away from you)", lean.left > 0.4, lean);
  check("lean is subtle (< 3px)", Math.abs(lean.right) < 3 && Math.abs(lean.left) < 3, lean);

  // --- the ambient scheduler still reaches every gesture -----------------
  const picks = await win.webContents.executeJavaScript(`(() => {
    const t = window.__t;
    t.state = "pause"; t.gestureNext = 0; t.thoughtNext = performance.now() + 1e9;
    const seen = {};
    let now = performance.now();
    for (let i = 0; i < 12000; i++) {
      t.draw(now, 16);
      seen[t.gesture] = (seen[t.gesture] || 0) + 1;
      now += 500;   // fast-forward through the 14-28s gap between gestures
    }
    t.gestureNext = now + 1e9; t.gesture = ""; t.gestureUntil = 0;
    return seen;
  })()`);
  const missing = gestures.filter((g) => !picks[g]);
  check("all 11 gestures come out of the scheduler", missing.length === 0, missing.length ? missing : picks);

  // --- v1.1.2: greeting when the user comes back to the app --------------
  const greet = await win.webContents.executeJavaScript(`(() => {
    const t = window.__t;
    const fire = window.pilly.__fire;
    const out = {};
    // The greet listener must be wired at all - the main process sends this on
    // chat-window focus, so a missing bridge here means the whole feature is dead.
    out.wired = typeof fire === "function" && typeof (window.pilly.onPetGreet) === "function";

    // 1) idle -> he waves (or peeks) and the ambient scheduler backs off
    t.state = "pause"; t.gesture = ""; t.gestureUntil = 0; t.greetHoldUntil = 0;
    t.gestureNext = 0;
    fire("greet");
    out.greetGesture = t.gesture;
    out.started = t.gestureUntil > performance.now();
    out.schedulerHeld = t.gestureNext >= t.gestureUntil + 5000;
    out.hold = t.greetHoldUntil > performance.now();

    // 2) a second greet inside the hold window must not restart the animation
    const start1 = t.gestureStart;
    t.gesture = ""; t.gestureUntil = 0;           // pretend the first one ended
    fire("greet");
    out.repeatIgnored = t.gesture === "" && t.gestureStart === start1;

    // 3) he stays quiet while asleep / eating / dancing / hopping
    const busy = {};
    for (const s of ["sleep", "eat", "dance", "hop"]) {
      t.state = s; t.gesture = ""; t.gestureUntil = 0; t.greetHoldUntil = 0;
      fire("greet");
      busy[s] = t.gesture;
    }
    out.busy = busy;

    // 4) mid-gesture greetings don't stomp on what he is already doing
    t.state = "pause"; t.gesture = "sneeze"; t.gestureStart = 100; t.gestureUntil = performance.now() + 900;
    t.greetHoldUntil = 0;
    fire("greet");
    out.midGesture = t.gesture;

    // 5) once the hold expires he is happy to say hi again
    t.gesture = ""; t.gestureUntil = 0; t.greetHoldUntil = 0;
    fire("greet");
    out.again = t.gesture;

    t.state = "pause"; t.gesture = ""; t.gestureUntil = 0; t.greetHoldUntil = 0;
    t.gestureNext = performance.now() + 1e9;
    return out;
  })()`);
  check("pet:greet listener is wired to the preload bridge", greet.wired === true, greet.wired);
  check("greeting starts a wave/peek while idle", ["wave", "peek"].includes(greet.greetGesture) && greet.started, greet.greetGesture);
  check("greeting holds the idle scheduler back", greet.schedulerHeld === true, greet.schedulerHeld);
  check("greeting sets a hold window", greet.hold === true, greet.hold);
  check("a repeat greeting inside the hold is ignored", greet.repeatIgnored === true, greet.repeatIgnored);
  check("no greeting while asleep / eating / dancing / hopping",
    Object.values(greet.busy).every((g) => g === ""), greet.busy);
  check("a greeting never interrupts a gesture in progress", greet.midGesture === "sneeze", greet.midGesture);
  check("he greets again after the hold expires", ["wave", "peek"].includes(greet.again), greet.again);

  // --- v1.1.2: the focus ring ------------------------------------------- 
  // A running pomodoro is app state, not decoration: the ring above his head has
  // to say the same thing the tray tooltip does. drawFocusRing() returns what it
  // drew, so this checks the arithmetic rather than sniffing pixels.
  const ring = await win.webContents.executeJavaScript(`(() => {
    const t = window.__t;
    const fire = window.pilly.__fire;
    const out = {};
    out.wired = typeof fire === "function" && typeof (window.pilly.onPetFocus) === "function";
    const now = performance.now();

    // Main process pushes pet:focus, not the renderer.
    fire("focus", { phase: "idle" });
    out.idleClears = t.focusState === null;
    out.idleRing = t.ring(now, 0);            // must be null - nothing to show

    // 10 minutes into a 25 minute block: 15 minutes left, 40% drawn.
    fire("focus", { phase: "focus", remainingMs: 15 * 60000, totalMs: 25 * 60000, paused: false });
    out.mid = t.ring(now, 0);
    out.midState = t.focusState && t.focusState.phase;

    // Same phase re-sent (the once-a-minute tick) must not re-trigger a reaction.
    out.particlesBefore = t.particles.length;
    fire("focus", { phase: "focus", remainingMs: 14 * 60000, totalMs: 25 * 60000, paused: false });
    out.noRepeat = t.particles.length === out.particlesBefore;
    out.tickedDown = t.focusState.remainingMs === 14 * 60000;

    // The final minute: amber, and it pulses.
    fire("focus", { phase: "focus", remainingMs: 45000, totalMs: 25 * 60000, paused: false });
    out.lastMin = t.ring(now, 0);

    // Paused: the ring holds, the label says so.
    fire("focus", { phase: "focus", remainingMs: 45000, totalMs: 25 * 60000, paused: true });
    out.paused = t.ring(now, 0);

    // Break: blue, and the run-up to it throws confetti once.
    t.particles.length = 0;
    fire("focus", { phase: "break", remainingMs: 300000, totalMs: 300000, paused: false });
    out.break = t.ring(now, 0);
    out.confetti = t.particles.filter((p) => p.type === "confetti").length;

    // Back to work: a nod, and the idle scheduler backs off while he is quiet.
    t.gesture = ""; t.gestureUntil = 0;
    fire("focus", { phase: "focus", remainingMs: 25 * 60000, totalMs: 25 * 60000, paused: false });
    out.nodSet = t.focusNodUntil > performance.now() && t.focusNodUntil <= performance.now() + 600;
    // Sample mid-swing (the curve is zero at both ends of the 520ms window, so a
    // frame on the boundary would prove nothing) and measure him vertically.
    const drawnAt = t.focusNodUntil - 260;
    const centY = () => {
      const c = t.canvas, w = c.width, h = c.height;
      const d = t.ctx.getImageData(0, 0, w, h).data;
      let sw = 0, sy = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const a = d[(y * w + x) * 4 + 3];
        if (a > 0) { sw += a; sy += a * y; }
      }
      return sw ? sy / sw : 0;
    };
    const dip = () => { t.state = "pause"; t.cur.squX = 1; t.cur.squY = 1; t.cur.tilt = 0; t.draw(drawnAt, 16); return centY(); };
    const nodded = dip();
    t.focusNodUntil = 0;
    out.nodDip = Number((nodded - dip()).toFixed(3));
    t.state = "pause";

    // The ring rides with him instead of being pinned to the window.
    t.focusNodUntil = 0;
    out.cyFlat = t.ring(now, 0).cy;
    out.cyUp = t.ring(now, -10).cy;      // mid-hop, bodyY is negative
    fire("focus", { phase: "idle" });
    out.cleared = t.focusState === null;
    return out;
  })()`);
  check("pet:focus listener is wired to the preload bridge", ring.wired === true, ring.wired);
  check("idle: no ring is drawn at all", ring.idleClears === true && ring.idleRing === null, ring.idleRing);
  check("a running block draws the ring for that phase", ring.midState === "focus" && !!ring.mid && ring.mid.phase === "focus", ring.midState);
  check("ring drains with the clock (10 of 25 min gone => 40%)", Math.abs(ring.mid.pct - 0.4) < 0.001, ring.mid.pct);
  check("ring shows the minutes left", ring.mid.label === "15", ring.mid.label);
  check("ring wears the pet's own colour until the final minute", ring.mid.color === "#22c55e", ring.mid.color);
  check("the once-a-minute tick does not re-trigger a reaction", ring.noRepeat === true && ring.tickedDown === true, ring);
  check("final minute turns amber", ring.lastMin.color === "#fbbf24" && ring.lastMin.label === "1", ring.lastMin);
  check("paused block says so", ring.paused.label === "❚❚" && ring.paused.paused === true, ring.paused);
  check("a break draws blue", ring.break.color === "#38bdf8" && ring.break.label === "5", ring.break);
  check("a block ending into a break throws confetti", ring.confetti > 0, ring.confetti);
  check("a break ending puts him back to work with a nod", ring.nodSet === true, ring.nodSet);
  check("the nod actually dips him on screen", ring.nodDip > 0.4 && ring.nodDip < 3.5, ring.nodDip);
  check("the ring floats with him (follows bodyY)", ring.cyUp < ring.cyFlat - 2, [ring.cyFlat, ring.cyUp]);
  check("stopping the session clears the ring", ring.cleared === true);

  // --- v1.1.2: a due reminder nudges him -------------------------------
  const nudge = await win.webContents.executeJavaScript(`(() => {
    const t = window.__t;
    const fire = window.pilly.__fire;
    const out = { wired: typeof (window.pilly && window.pilly.onPetNudge) === "function" };
    t.particles.length = 0;
    t.state = "pause";
    fire("nudge", { glyph: "⏰" });
    out.glyphs = t.particles.map((p) => p.glyph);
    out.kind = t.particles.map((p) => p.type);
    out.rises = t.particles.every((p) => p.vy < 0);
    fire("nudge");                       // no payload: must not throw
    out.defaulted = t.particles[t.particles.length - 1].glyph === "🔔";
    out.count = t.particles.length;
    t.particles.length = 0;
    return out;
  })()`);
  check("pet:nudge listener is wired to the preload bridge", nudge.wired === true, nudge.wired);
  check("a reminder pops the glyph the bubble showed", nudge.glyphs[0] === "⏰" && nudge.kind[0] === "emoji", nudge);
  check("the nudged glyph drifts upward", nudge.rises === true, nudge);
  check("a nudge with no payload falls back to the bell", nudge.defaulted === true, nudge);

  // --- v1.1.2: he lives on your clock, and works around your focus block ---
  // The day-part tables are the whole point of the feature (a pet who yawns as
  // often at 2am as at 9am is a random-number generator), and a running pomodoro
  // has to visibly change his pacing. Timestamps are built as local Dates, so
  // these expectations hold in every timezone.
  const rhythm = await win.webContents.executeJavaScript(`(() => {
    const t = window.__t;
    const fire = window.pilly.__fire;
    const at = (h) => new Date(2024, 0, 15, h, 30, 0).getTime();
    const parts = { h3: t.part(at(3)), h8: t.part(at(8)), h12: t.part(at(12)), h20: t.part(at(20)) };
    const paces = { h3: t.pace(at(3)), h8: t.pace(at(8)), h20: t.pace(at(20)) };
    const tables = {};
    for (const p of ["morning", "day", "evening", "night"]) tables[p] = t.gestureTable(p);

    // Pace: measure the gap the scheduler commits to. Combos deliberately
    // override it with a quick follow-up (a wave into a wiggle reads as one
    // performance), so Math.random is pinned for the measurement: 0.99 rules out
    // a combo and makes 14000 + 0.99 * 14000 the only possible base gap. The day
    // part is identical across the three samples because they share one timestamp.
    const realRandom = Math.random;
    const now = performance.now();
    const gap = () => {
      Math.random = () => 0.99;
      t.state = "pause"; t.gesture = ""; t.gestureUntil = 0; t.gestureNext = 0;
      t.thoughtNext = now + 1e9; t.particles.length = 0;
      // Everything else the scheduler tests has to start from a known value too:
      // the 40s soak above runs on a virtual clock, so a mood or a nudge it left
      // behind carries timestamps from the future and would block the scheduler
      // for the whole measurement (an intermittent failure that reads as a real
      // pacing bug).
      t.talking = false; t.market = ""; t.marketUntil = 0; t.tickleUntil = 0;
      t.perkUntil = 0; t.perkNext = now + 1e9; t.petLevel = 0; t.petUntil = 0;
      t.dragOverride.active = false;
      t.draw(now, 16);
      const g = t.gestureNext - now;
      t.gesture = ""; t.gestureUntil = 0; t.gestureNext = now + 1e9;
      Math.random = realRandom;
      return g;
    };
    fire("focus", { phase: "idle" });
    const idle = gap();
    fire("focus", { phase: "focus", remainingMs: 10 * 60000, totalMs: 25 * 60000, paused: false });
    const working = gap();
    fire("focus", { phase: "focus", remainingMs: 10 * 60000, totalMs: 25 * 60000, paused: true });
    const held = gap();
    fire("focus", { phase: "idle" });
    // The pace the draw loop must have used is the one for the real clock, not
    // for the render loop's performance.now() (see the source check below).
    return {
      parts, paces, tables, base: 14000 + 0.99 * 14000, now,
      pace: t.pace(Date.now()), uptimePace: t.pace(now),
      defaultPart: t.part(), nowPart: t.part(Date.now()),
      idle, working, held,
    };
  })()`);
  check("day parts follow the clock (3am / 8am / noon / 8pm)",
    rhythm.parts.h3 === "night" && rhythm.parts.h8 === "morning" && rhythm.parts.h12 === "day" && rhythm.parts.h20 === "evening", rhythm.parts);
  check("he is slowest late at night and quickest in the morning",
    rhythm.paces.h3 > rhythm.paces.h8 && rhythm.paces.h20 > rhythm.paces.h8, rhythm.paces);
  check("every gesture stays reachable in every part of the day",
    ["morning", "day", "evening", "night"].every((p) => rhythm.tables[p].length === 11), rhythm.tables);
  // A count alone would not notice a rename: swap one gesture for another and
  // every table still holds eleven entries while the gesture that lost its name
  // silently stops being rendered below. Compare the actual sets instead.
  const inTables = [...new Set(Object.values(rhythm.tables).flat())].sort();
  check("the day-part tables and the render harness name the same gestures",
    JSON.stringify(inTables) === JSON.stringify([...gestures].sort()),
    { tables: inTables, harness: [...gestures].sort() });
  const near = (a, b) => Math.abs(a - b) < 0.001;
  check("dayPart() defaults to the wall clock, not to uptime",
    rhythm.defaultPart === rhythm.nowPart, { defaultPart: rhythm.defaultPart, nowPart: rhythm.nowPart });
  check("the idle gap is scaled by the time of day",
    near(rhythm.idle, rhythm.base * rhythm.pace), { idle: rhythm.idle, expected: rhythm.base * rhythm.pace, pace: rhythm.pace, uptimePace: rhythm.uptimePace });
  check("a running focus block stretches the idle gap by half again",
    near(rhythm.working, rhythm.base * rhythm.pace * 1.5), { working: rhythm.working, expected: rhythm.base * rhythm.pace * 1.5 });
  check("a paused block lets him be himself again",
    near(rhythm.held, rhythm.base * rhythm.pace), { held: rhythm.held, expected: rhythm.base * rhythm.pace });
  // The rhythm only means anything if it reads the real clock. The render loop's
  // performance.now() counts from page load, so wiring it into dayPart() would
  // make him run through "morning, day, evening" in eleven hours of uptime.
  const petSrc = fs.readFileSync(path.join(ROOT, "renderer", "pet.html"), "utf8");
  check("the draw loop asks for the time of day without passing its own clock",
    /dayPart\(\s*\)/.test(petSrc) && !/dayPart\(\s*now\s*\)/.test(petSrc),
    (petSrc.match(/dayPart\([^)]*\)/g) || []).slice(0, 4));

  // Same in the ordinary window: the report carries whatever the real OS says,
  // not a hard-coded false.
  const normalPrefs = await win.webContents.executeJavaScript(
    "(() => { const f = window.pilly && window.pilly.__uiPrefs; return f ? f() : null; })()");
  const normalMotion = await win.webContents.executeJavaScript("window.__t.reduceMotion");
  check("the pet reports the motion preference the OS actually reports",
    Array.isArray(normalPrefs) && normalPrefs.length >= 1 &&
      normalPrefs[normalPrefs.length - 1].reduceMotion === normalMotion,
    { reported: normalPrefs && normalPrefs[normalPrefs.length - 1], actual: normalMotion });

  // v1.1.2: the OS "reduce motion" setting calms the ambient gestures. The
  // renderer reads the preference at load (and again if the user flips the
  // switch), exactly like a real boot, so
  // load the page first and then reload it under the emulated media feature
  // (sending the CDP command before the first navigation never comes back).
  const calmWin = new BrowserWindow({
    show: false, width: 60, height: 64,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: PRELOAD },
  });
  calmWin.webContents.on("console-message", (e, level, msg) => { if (level >= 3) rendererErrors.push("calm: " + msg); });
  await calmWin.loadFile(PATCHED);
  await new Promise((r) => setTimeout(r, 400));
  calmWin.webContents.debugger.attach("1.3");
  await calmWin.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  await calmWin.webContents.reload();
  await new Promise((r) => setTimeout(r, 700));
  const calm = await calmWin.webContents.executeJavaScript(`(() => {
    const t = window.__t;
    t.state = "pause"; t.gesture = ""; t.gestureUntil = 0; t.gestureNext = 0;
    t.thoughtNext = performance.now() + 1e9;
    const seen = {};
    let now = performance.now();
    for (let i = 0; i < 4000; i++) {
      t.draw(now, 16);
      if (t.gesture) seen[t.gesture] = (seen[t.gesture] || 0) + 1;
      now += 500;
    }
    // The greet must stay calm too - it only ever waves or peeks.
    // v1.1.2: a calm user must not get the coin toss either - it is a
    // body-flinging gesture with a sound effect attached.
    t.state = "pause";
    const breath = [];
    for (let i = 0; i < 200; i++) { t.draw(performance.now() + i * 16.67, 16.67); breath.push(t.breathY); }
    return { reduceMotion: t.reduceMotion, picked: Object.keys(seen), breathMax: Math.max(...breath.map(Math.abs)) };
  })()`);
  const loud = ["spin", "wiggle", "giggle", "coin"].filter((g) => calm.picked.indexOf(g) >= 0);
  check("the OS reduce-motion preference is read at load", calm.reduceMotion === true, calm.reduceMotion);
  // The main process cannot read this setting itself (no cross-platform API), so
  // the renderer has to tell it - otherwise the tray icon keeps bobbing at a
  // user who asked the OS for calm.
  const calmPrefs = await calmWin.webContents.executeJavaScript(
    "(() => { const f = window.pilly && window.pilly.__uiPrefs; return f ? f() : null; })()");
  check("the pet reports the OS motion preference to the app",
    Array.isArray(calmPrefs) && calmPrefs.length >= 1 && calmPrefs[calmPrefs.length - 1] &&
      calmPrefs[calmPrefs.length - 1].reduceMotion === true, calmPrefs);
  check("reduce-motion keeps the big body-flinging gestures out", loud.length === 0, loud);
  check("reduce-motion stops the background breathing too",
    calm.breathMax === 0, calm.breathMax);
  check("reduce-motion still leaves him alive (calm gestures keep coming)",
    calm.picked.length >= 3 && calm.picked.every((g) => ["wave", "yawn", "stretch", "peek", "curious", "heart"].includes(g)),
    calm.picked);
  calmWin.webContents.debugger.detach();
  calmWin.destroy();

  // --- long soak: ~40s of frames, no errors, something always drawn ------
  const soak = await win.webContents.executeJavaScript(`(() => {
    const t = window.__t;
    const start = performance.now();
    for (let i = 0; i < 2400; i++) t.draw(start + i * 16.67, 16.67);
    return { frames: 2400, opaque: t.opaque() };
  })()`);
  check("40s soak of draw() completes without throwing", soak.frames === 2400);
  check("soak still renders the pet", soak.opaque > 100, soak.opaque);

  // --- chat avatar renders + keeps animating -----------------------------
  // The window is mapped with opacity 0: an unmapped window never produces
  // frames, so sampling one would only prove that Chromium stops painting.
  const chat = new BrowserWindow({
    show: false, width: 480, height: 720,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: PRELOAD },
  });
  chat.webContents.on("console-message", (e, level, msg) => { if (level >= 3) rendererErrors.push("chat: " + msg); });
  await chat.loadFile(path.join(ROOT, "renderer", "index.html"));
  chat.setOpacity(0);
  chat.showInactive();
  await chat.webContents.executeJavaScript(`(() => {
    window.__faceHashes = new Set();
    setInterval(() => {
      const c = document.querySelector("#pillFace");
      if (!c) return;
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let h = 0;
      for (let i = 0; i < d.length; i += 53) h = (h * 31 + d[i]) | 0;
      window.__faceHashes.add(h);
    }, 100);
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 1600));
  const chatFace = await chat.webContents.executeJavaScript(`(() => {
    const c = document.querySelector("#pillFace");
    if (!c) return { found: false };
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let opaque = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) opaque++;
    return { found: true, opaque, w: c.width, h: c.height, distinct: window.__faceHashes.size };
  })()`);
  check("chat avatar renders", chatFace.found === true && chatFace.opaque > 100, chatFace);
  check("chat avatar keeps repainting", chatFace.distinct >= 3, chatFace.distinct);

  // v1.1.2: the tray checkbox and the chat's heart button drive the same switch,
  // so the button has to follow the state the app pushes at it.
  const petBtnFollows = await chat.webContents.executeJavaScript(`(() => {
    const btn = document.getElementById("petBtn");
    const seen = [];
    for (const on of [true, false, true]) {
      window.pilly.__fire("petActive", on);
      seen.push(btn.classList.contains("active"));
    }
    return seen;
  })()`);
  check("the chat's pet button follows the state the app pushes",
    petBtnFollows.join(",") === "true,false,true", petBtnFollows);

  // v1.1.2: a reminder that fires while Pilly is off (or his bubbles are off)
  // reaches the chat instead of nothing but an OS notification - the text used to
  // be lost outright on a desktop in Do Not Disturb.
  const reminderLands = await chat.webContents.executeJavaScript(`(() => {
    const list = document.getElementById("messages");
    const before = list.children.length;
    window.pilly.__fire("reminder", { message: "<b>claim the airdrop</b>" });
    const last = list.lastElementChild;
    const bubble = last && last.querySelector(".bubble");
    return {
      added: list.children.length - before,
      says: last ? /claim the airdrop/.test(last.textContent) : false,
      escaped: bubble ? !/claim the airdrop<\\/b>/.test(bubble.innerHTML) : false,
    };
  })()`);
  check("a reminder fired while the pet is off still lands in the chat",
    reminderLands.added === 1 && reminderLands.says === true, reminderLands);
  check("a reminder's own text is escaped, never markup", reminderLands.escaped === true, reminderLands);

  // The tray narrates its focus clicks through the same channel the 60 s status
  // tick uses, so a payload without `announce` must stay out of the transcript.
  const focusLines = await chat.webContents.executeJavaScript(`(() => {
    const list = document.getElementById("messages");
    const before = list.children.length;
    window.pilly.__fire("focusStatus", { phase: "focus", remainingMs: 1200000 });
    const quiet = list.children.length - before;
    window.pilly.__fire("focusStatus", {
      phase: "focus", remainingMs: 1200000, announce: "🍅 Focus started from the tray — 20 min.",
    });
    const loud = list.children.length - before;
    return { quiet, loud, text: list.lastElementChild ? list.lastElementChild.textContent : "" };
  })()`);
  check("a bare focus status tick writes nothing into the chat", focusLines.quiet === 0, focusLines);
  check("a focus session started from the tray is narrated in the chat",
    focusLines.loud === 1 && /Focus started from the tray/.test(focusLines.text), focusLines);

  // v1.1.2: the chat UI honours reduce-motion too. Emulate the OS setting and
  // read back the computed animation values the browser would really use.
  chat.webContents.debugger.attach("1.3");
  await chat.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  const calmCss = await chat.webContents.executeJavaScript(`(() => {
    const probe = document.createElement("div");
    probe.className = "chip";
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    const out = { duration: cs.animationDuration, count: cs.animationIterationCount };
    probe.remove();
    const av = document.querySelector(".pill-avatar");
    if (av) {
      const had = av.classList.contains("thinking");
      av.classList.add("thinking");
      out.thinking = getComputedStyle(av).animationName;
      if (!had) av.classList.remove("thinking");
    }
    return out;
  })()`);
  check("reduce-motion stops the chat's looping avatar animation",
    calmCss.thinking === "none", calmCss.thinking);
  check("reduce-motion collapses chat entrance animations to a no-op",
    calmCss.count === "1" && ["0.01ms", "0.00001s", "1e-05s"].includes(calmCss.duration), calmCss);
  chat.webContents.debugger.detach();
  chat.destroy();

  // --- v1.1.2: being petted, tapped and put down --------------------------
  // Petting is the one interaction with no button and no down side: you rub him
  // with the cursor. For that to read as affection rather than as a lever it has
  // to be deliberate (a pointer that merely crosses him must never set it off),
  // it has to escalate, and it has to end by itself. Every number below is a
  // claim about one of those three.
  const touch = await win.webContents.executeJavaScript(`(() => {
    const t = window.__t;
    const t0 = performance.now();
    const out = {};
    const prep = (at) => {
      t.state = "pause"; t.gesture = ""; t.gestureStart = 0; t.gestureUntil = 0; t.gestureNext = at + 1e9;
      t.talking = false; t.dragOverride.active = false;
      t.resetStroke();
      t.petCharge = 0; t.petChargeAt = 0; t.petLevel = 0; t.petStart = 0; t.petUntil = 0; t.petCoolUntil = 0;
      t.petLean = 0; t.petLeanX = 0;
      t.carryVX = 0; t.carryVY = 0; t.carryDist = 0; t.carryRough = 0;
      t.dizzyUntil = 0; t.shakeStart = 0; t.shakeUntil = 0; t.tickleUntil = 0;
      t.perkUntil = 0; t.perkNext = at + 1e9;
      t.landingUntil = 0; t.wobbleStart = 0; t.wobbleUntil = 0;
      t.hover = false; t.clickUntil = 0;
      t.market = ""; t.marketUntil = 0; t.loveFromTapUntil = 0;
      t.blinkNext = at + 1e9; t.blinkAgainAt = 0;
      t.cursor = { x: 300, y: 300 };
      t.particles.length = 0;
      window.pilly.__clearReactions();
    };
    // A believable rub: the pointer travels back and forth over him. amp is how
    // far it goes in one swing, period how many samples that takes - a small slow
    // rub is affection, a wide fast one melts.
    const rub = (from, n, amp, period, step) => {
      for (let i = 0; i <= n; i++) t.stroke(30 + Math.sin(i / period) * amp, 32, from + i * step);
      return {
        level: t.petLevel,
        alive: t.petUntil > from + n * step,
        charge: Math.round(t.petCharge),
        turns: t.petStrokeTurns,
      };
    };

    // 1. a single sweep: the pointer merely crosses him on its way somewhere else
    prep(t0);
    for (let i = 0; i < 30; i++) t.stroke(i * 4, 32, t0 + i * 16);
    out.sweep = { level: t.petLevel, turns: t.petStrokeTurns, charge: Math.round(t.petCharge) };

    // 2. a slow, gentle rub: affection, but not enough to melt him
    prep(t0);
    out.gentle = rub(t0, 80, 8, 3, 16);

    // 3. the same hand, more enthusiasm
    prep(t0);
    out.brisk = rub(t0, 60, 16, 1.5, 16);

    // 4. the charge fades with time, so a hand that leaves takes the mood with it
    prep(t0);
    t.petCharge = 200; t.petChargeAt = t0;
    t.stroke(20, 32, t0);
    const charged = t.petCharge;
    t.stroke(20, 40, t0 + 2600);
    out.decay = { before: Math.round(charged), after: Math.round(t.petCharge) };

    // 5. a cuddle ends on its own and then leaves him alone for a while
    prep(t0);
    out.first = rub(t0, 60, 16, 1.5, 16);
    const endAt = t.petUntil;
    t.draw(endAt + 10, 16);                     // the last heart floats off
    out.settled = { level: t.petLevel, until: t.petUntil, coolMs: Math.round(t.petCoolUntil - (endAt + 10)) };
    out.immediate = rub(t.petCoolUntil - 900, 40, 16, 1.5, 16);
    out.later = rub(t.petCoolUntil + 400, 60, 16, 1.5, 16);

    // 6. one cuddle, one announcement - main says the line, and it must not say it
    //    once per stroke sample
    prep(t0);
    out.cuddleStart = rub(t0, 50, 16, 1.5, 16);
    for (let i = 0; i < 200; i++) t.stroke(30 + Math.sin(i / 1.5) * 16, 32, t0 + 900 + i * 16);
    out.cuddleKeep = { level: t.petLevel, reactions: window.pilly.__reactions().slice() };
    t.draw(t.petUntil + 10, 16);
    out.cuddleAgain = rub(t.petCoolUntil + 400, 60, 16, 1.5, 16);
    out.reactionsAfterTwo = window.pilly.__reactions().slice();

    // 7. touching a sleeping pet is a wake-up, and it asks main exactly once - the
    //    sleep state belongs to main, so without the rate limit every single
    //    pointer sample would send another request until the answer arrived
    prep(t0);
    t.state = "sleep";
    for (let i = 0; i < 90; i++) t.stroke(i % 2 ? 10 : 30, 30, t0 + i * 16);
    out.wake = { reactions: window.pilly.__reactions().slice(), level: t.petLevel, heldFor: Math.round(t.petCoolUntil - (t0 + 89 * 16)) };

    // 8. tapping him: one tap is affection, two is a game, three is too much. The
    //    escalation is what makes the taps feel different, and the chain expires
    //    on its own so he can never get stuck in the silly mode
    prep(t0);
    const tap = (at) => {
      t.boop(at);
      return { count: t.boopCount, tickled: t.tickleUntil > at, love: t.market === "love", gesture: t.gesture };
    };
    out.taps = [tap(t0), tap(t0 + 400), tap(t0 + 800), tap(t0 + 3000)];

    // ...but a love mood that came from the market or the chat is never stolen
    prep(t0);
    t.market = "love"; t.marketUntil = t0 + 60000;
    t.loveFromTapUntil = t0;                    // the tap's own heart eyes expired long ago
    t.boopCount = 1; t.boopLast = t0;
    t.boop(t0 + 500);
    out.marketLove = { market: t.market, count: t.boopCount };

    // 9. putting him down: a short ride is a landing, a long or fast one is a ride
    //    he survives with his eyes spinning - and the swing has to stop with your
    //    hand, or he keeps leaning after you have let go
    prep(t0);
    t.carryDist = 60; t.carryRough = 4; t.carryVX = 20; t.carryVY = 10;
    t.dropReaction(t0);
    out.softDrop = { dizzy: t.dizzyUntil > t0, shakeMs: Math.round(t.shakeUntil - t.shakeStart), vx: t.carryVX, dist: t.carryDist, thrown: t.particles.length };
    prep(t0 + 20000);
    t.carryDist = 300; t.carryRough = 60; t.carryVX = 30;
    t.dropReaction(t0 + 20000);
    out.roughDrop = {
      dizzyMs: Math.round(t.dizzyUntil - (t0 + 20000)), shakeMs: Math.round(t.shakeUntil - t.shakeStart),
      vx: t.carryVX, dist: t.carryDist,
      glyphs: t.particles.filter((p) => p.type === "emoji").map((p) => p.glyph),
    };

    out.meltTrigger = t.petMeltTrigger;
    out.petMs = t.petMs;
    out.coolMs = t.petCoolMs;
    t.state = "pause";
    return out;
  })()`);

  check("a pointer that only crosses him never starts a cuddle",
    touch.sweep.level === 0 && touch.sweep.turns === 1 && touch.sweep.charge < touch.meltTrigger, touch.sweep);
  check("a slow, gentle rub is enough to reach him", touch.gentle.level === 1 && touch.gentle.alive === true, touch.gentle);
  check("a gentle rub stops short of melting him", touch.gentle.charge < touch.meltTrigger, [touch.gentle.charge, touch.meltTrigger]);
  check("the same hand, more enthusiastic, melts him", touch.brisk.level === 2, touch.brisk);
  check("a cuddle lasts as long as the hand keeps coming",
    touch.gentle.alive === true && touch.gentle.level === 1 && touch.petMs > 0, [touch.gentle.until, touch.petMs]);
  check("the charge a stroke builds fades away on its own",
    touch.decay.after < touch.decay.before * 0.62 && touch.decay.after > 0, touch.decay);
  check("a cuddle ends by itself and leaves him alone for a while",
    touch.first.level === 2 && touch.settled.level === 0 && touch.settled.until === 0 &&
    Math.abs(touch.settled.coolMs - touch.coolMs) < 120, touch.settled);
  check("rubbing again during the cool-down is ignored", touch.immediate.level === 0, touch.immediate);
  check("once the cool-down passes he is happy to do it all again", touch.later.level >= 1, touch.later);
  check("one cuddle is announced once, not once per stroke sample",
    touch.cuddleStart.level >= 1 && touch.cuddleKeep.level === 2 && JSON.stringify(touch.cuddleKeep.reactions) === '["pet"]', touch.cuddleKeep);
  check("a second cuddle is a second announcement",
    touch.cuddleAgain.level >= 1 && JSON.stringify(touch.reactionsAfterTwo) === '["pet","pet"]', touch.reactionsAfterTwo);
  check("touching a sleeping pet wakes him, exactly once",
    JSON.stringify(touch.wake.reactions) === '["wake"]' && touch.wake.level === 0 && touch.wake.heldFor > 0, touch.wake);
  check("tapping again escalates: affection, a giggle, then tickled",
    touch.taps[0].count === 1 && touch.taps[0].love === true &&
    touch.taps[1].count === 2 && touch.taps[1].gesture === "giggle" && touch.taps[1].love === false &&
    touch.taps[2].count === 3 && touch.taps[2].tickled === true, touch.taps);
  check("the tap chain expires, so he never gets stuck in the silly mode",
    touch.taps[3].count === 1 && touch.taps[3].tickled === false, touch.taps[3]);
  check("a tap never steals a love mood that came from the market or the chat",
    touch.marketLove.market === "love", touch.marketLove);
  check("a short ride is a landing, not a trauma",
    touch.softDrop.dizzy === false && touch.softDrop.shakeMs === 420 && touch.softDrop.thrown > 0, touch.softDrop);
  check("a long rough ride leaves him dizzy and shaking it off",
    touch.roughDrop.dizzyMs === 1500 && touch.roughDrop.shakeMs === 900 &&
    touch.roughDrop.glyphs.length === 1 && touch.roughDrop.glyphs[0].codePointAt(0) === 128565, touch.roughDrop);
  check("both drops stop the swing dead (nothing drifts on after your hand)",
    touch.softDrop.vx === 0 && touch.softDrop.dist === 0 && touch.roughDrop.vx === 0 && touch.roughDrop.dist === 0,
    [touch.softDrop.vx, touch.roughDrop.vx]);

  // --- v1.1.2: what being petted looks like on screen ---------------------
  // Every measurement is a pair of runs on the SAME clock: one petted, one not.
  // The idle sway is a function of the wall clock, not random, so the control run
  // cancels it frame by frame and the difference is only what the petting did.
  const pose = await win.webContents.executeJavaScript(`(() => {
    const t = window.__t;
    const t0 = performance.now();
    const out = {};
    const prep = (at) => {
      t.state = "pause"; t.gesture = ""; t.gestureStart = 0; t.gestureUntil = 0; t.gestureNext = at + 1e9;
      t.talking = false; t.dragOverride.active = false;
      t.resetStroke();
      t.petCharge = 0; t.petChargeAt = 0; t.petLevel = 0; t.petStart = 0; t.petUntil = 0; t.petCoolUntil = 0;
      t.petLean = 0; t.petLeanX = 0;
      t.carryVX = 0; t.carryVY = 0; t.carryDist = 0; t.carryRough = 0;
      t.dizzyUntil = 0; t.shakeStart = 0; t.shakeUntil = 0; t.tickleUntil = 0;
      t.perkUntil = 0; t.perkNext = at + 1e9;
      t.landingUntil = 0; t.wobbleStart = 0; t.wobbleUntil = 0;
      t.hover = false; t.clickUntil = 0;
      t.market = ""; t.marketUntil = 0; t.loveFromTapUntil = 0;
      t.blinkNext = at + 1e9; t.blinkAgainAt = 0;
      t.particles.length = 0;
    };
    // 60 frames = one second, which is long enough for every eased value to have
    // settled; the last 20 frames are what gets recorded.
    const trace = (from, before, frames) => {
      const at = t0 + from;
      prep(at);
      before(at);
      const xs = [], ys = [], rot = [], body = [];
      for (let i = 0; i < frames; i++) {
        t.draw(at + i * 16.67, 16.67);
        if (i >= frames - 20) { xs.push(t.cur.squX); ys.push(t.cur.squY); rot.push(t.face.rot); body.push(t.face.bodyY); }
      }
      return { xs, ys, rot, body, x: t.cur.squX, y: t.cur.squY };
    };
    const bliss = (level, dir, state) => (at) => {
      t.state = state || "pause";
      t.petLevel = level; t.petStart = at - 900; t.petUntil = at + 60000;
      t.petLeanX = dir;
    };

    out.base = trace(0, () => { t.state = "pause"; }, 60);
    out.bliss = trace(0, bliss(1, 1), 60);
    out.melt = trace(0, bliss(2, 1), 60);
    out.meltMirror = trace(0, bliss(2, -1), 60);

    // carried: you cannot rub a pet that is already in the air
    const carried = (level) => (at) => {
      t.dragOverride.active = true;
      t.petLevel = level; t.petStart = at - 900; t.petUntil = at + 60000;
      t.petLeanX = 1;
    };
    out.carryBase = trace(0, carried(0), 60);
    out.carryPet = trace(0, carried(2), 60);

    // a state that assigns his shape outright every frame (the walk cycle)
    out.walkBase = trace(0, bliss(0, 1, "walk"), 60);
    out.walkMelt = trace(0, bliss(2, 1, "walk"), 60);

    // tickled
    out.tickle = trace(0, (at) => { t.state = "pause"; t.tickleUntil = at + 60000; }, 60);

    // asleep: a cuddle started before he dozed off must not show on his sleeping shape
    out.asleep = trace(0, (at) => {
      t.state = "sleep";
      t.petLevel = 2; t.petStart = at - 900; t.petUntil = at + 60000;
      t.petLeanX = 1;
    }, 60);

    // the perk, measured against the same clock with no perk. Both runs are
    // sampled frame by frame so the idle sway cancels out of the difference:
    // comparing two independent minima would instead compare his sway to his perk.
    const perkRun = (armed) => {
      const at = t0 + 120000;
      prep(at);
      t.state = "pause";
      t.perkNext = armed ? at - 1 : at + 1e9;
      const body = [], rot = [];
      let yMax = -1e9;
      for (let i = 0; i < 84; i++) {
        t.draw(at + i * 16.67, 16.67);
        body.push(t.face.bodyY); rot.push(t.face.rot);
        yMax = Math.max(yMax, t.face.squY);
      }
      return { body, rot, yMax, armed: t.perkUntil > at };
    };
    const perkOff = perkRun(false);
    const perkOn = perkRun(true);
    out.perk = {
      armed: perkOn.armed, body: perkOn.body, bodyOff: perkOff.body,
      rot: perkOn.rot, rotOff: perkOff.rot, yMax: perkOn.yMax, yMaxOff: perkOff.yMax,
    };

    // ...and it is skipped, not queued, while you are holding him
    const at = t0 + 200000;
    prep(at);
    t.state = "pause";
    t.dragOverride.active = true;
    t.perkNext = at - 1;
    t.draw(at, 16.67);
    out.perkDeferred = { armed: t.perkUntil > 0, retryMs: Math.round(t.perkNext - at) };
    t.dragOverride.active = false;

    t.state = "pause";
    t.petLevel = 0; t.petUntil = 0;
    return out;
  })()`);

  // Differences between two runs on the same clock: the sway cancels exactly, so
  // what is left is only the reaction being measured.
  const traceDiff = (a, b, field) => a[field].map((v, i) => Number((v - b[field][i]).toFixed(4)));
  const spanOf = (a) => Math.max.apply(null, a) - Math.min.apply(null, a);
  const avgOf = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const leanOf = (a) => Number(avgOf(traceDiff(a, pose.base, "rot")).toFixed(4));
  const liftOf = (a) => Number((0 - avgOf(traceDiff(a, pose.base, "body"))).toFixed(4));
  const purrOf = (a) => Number(spanOf(traceDiff(a, pose.base, "rot")).toFixed(4));
  const perkDiff = pose.perk.body.map((v, i) => v - pose.perk.bodyOff[i]);
  const perkLift = Number((0 - Math.min.apply(null, perkDiff)).toFixed(4));
  const perkRoll = Number(spanOf(pose.perk.rot.map((v, i) => v - pose.perk.rotOff[i])).toFixed(4));

  check("being melted widens and flattens him, well beyond a pixel",
    pose.melt.x > 1.10 && pose.melt.y < 0.90, [pose.melt.x, pose.melt.y]);
  check("a gentle cuddle shapes him less than a full melt",
    pose.bliss.x > 1.04 && pose.bliss.x < pose.melt.x - 0.04 && pose.bliss.y > pose.melt.y + 0.04,
    [pose.bliss.x, pose.bliss.y, pose.melt.x, pose.melt.y]);
  check("he leans into the hand that is stroking him, the further the more he melts",
    leanOf(pose.bliss) > 0.05 && leanOf(pose.melt) > 0.08 && leanOf(pose.melt) > leanOf(pose.bliss),
    [leanOf(pose.bliss), leanOf(pose.melt)]);
  check("and leans the other way when the hand goes the other way",
    leanOf(pose.meltMirror) < -0.08, leanOf(pose.meltMirror));
  check("being petted lifts him off the floor",
    liftOf(pose.melt) > 1.2 && liftOf(pose.bliss) > 0.6, [liftOf(pose.bliss), liftOf(pose.melt)]);
  check("the purr is a vibration you can see, and it deepens as he melts",
    purrOf(pose.bliss) > 0.012 && purrOf(pose.melt) > 0.025 && purrOf(pose.bliss) < purrOf(pose.melt) * 0.75,
    [purrOf(pose.bliss), purrOf(pose.melt)]);
  check("a sleeping pet is never drawn as blissful (a stroke wakes him instead)",
    pose.asleep.x < 1.0 && pose.asleep.y > 0.9 && pose.asleep.x < pose.melt.x - 0.1, [pose.asleep.x, pose.asleep.y]);
  check("you cannot rub a pet that is already in the air",
    pose.carryPet.x < 1.06 && Math.abs(avgOf(traceDiff(pose.carryPet, pose.carryBase, "rot"))) < 0.02 &&
    Math.abs(avgOf(traceDiff(pose.carryPet, pose.carryBase, "body"))) < 0.1,
    [pose.carryPet.x, avgOf(traceDiff(pose.carryPet, pose.carryBase, "rot"))]);
  check("the melt survives a state that overwrites his shape every frame",
    avgOf(pose.walkMelt.xs) - avgOf(pose.walkBase.xs) > 0.03 && avgOf(pose.walkBase.ys) - avgOf(pose.walkMelt.ys) > 0.03,
    [avgOf(pose.walkBase.xs), avgOf(pose.walkMelt.xs), avgOf(pose.walkBase.ys), avgOf(pose.walkMelt.ys)]);
  check("being tickled is a squirm, not a giggle",
    spanOf(traceDiff(pose.tickle, pose.base, "rot")) > 0.12 &&
    spanOf(traceDiff(pose.tickle, pose.base, "xs")) > 0.03 &&
    -avgOf(traceDiff(pose.tickle, pose.base, "body")) > 0.25,
    [spanOf(traceDiff(pose.tickle, pose.base, "rot")), spanOf(traceDiff(pose.tickle, pose.base, "xs"))]);
  check("the idle perk pulls him up straight, briefly",
    pose.perk.armed === true && perkLift > 1.5 && perkLift < 2.6 && perkRoll > 0.03,
    [perkLift, perkRoll]);
  check("the perk stretches him taller, it does not just move him up",
    pose.perk.yMax > pose.perk.yMaxOff + 0.03 && pose.perk.yMax < pose.perk.yMaxOff + 0.09,
    [pose.perk.yMaxOff, pose.perk.yMax]);
  check("the perk is skipped, not queued, while you are holding him",
    pose.perkDeferred.armed === false && pose.perkDeferred.retryMs === 5000, pose.perkDeferred);

  // --- v1.1.2: the tap that opens the chat --------------------------------
  // The report was "sometimes the window does not open and I have to switch the
  // pet off and on again". Every way that can happen is a state machine accident,
  // and all of them are reachable from outside with plain DOM events, so these
  // checks drive the real handlers rather than calling the entry point directly.
  // Synthetic input cannot be used here: sendInputEvent reports buttons: 0 and
  // screenX/Y: 0 even in the middle of a drag, so the events are built with the
  // values Chromium would report.
  const tap = await win.webContents.executeJavaScript(`(async () => {
    const t = window.__t;
    const out = {};
    const idle = (ms) => new Promise((r) => setTimeout(r, ms));
    const send = (type, x, y, buttons) => document.dispatchEvent(new MouseEvent(type, {
      bubbles: true, cancelable: true, view: window,
      clientX: x, clientY: y, screenX: x, screenY: y, buttons,
    }));
    // press, travel, release - and a click afterwards when the release lands on
    // him, which is what Chromium does and what makes a drag look like a click.
    const gesture = (x0, y0, x1, y1, withClick) => {
      send("mouseover", x0, y0, 0);
      send("mousedown", x0, y0, 1);
      for (let i = 1; i <= 4; i++) {
        send("mousemove", x0 + ((x1 - x0) * i) / 4, y0 + ((y1 - y0) * i) / 4, 1);
      }
      send("mouseup", x1, y1, 0);
      if (withClick) send("click", x1, y1, 0);
    };
    const fresh = async () => {
      send("mouseup", 30, 32, 0);  // put down whatever the previous case left up
      send("mouseout", 30, 32, 0);
      t.hover = false;
      window.pilly.__clearTouch();
      await idle(20);
    };

    // 1. the plain tap, the one made a hundred times a day
    await fresh();
    gesture(28, 30, 28, 30, true);
    out.plain = { chats: window.pilly.__chats().length, drags: window.pilly.__drags().join(",") };

    // 2. a tap whose release lands just outside him: it is still a tap, but no
    //    click event is fired for it, so the chat used to stay shut for good
    await fresh();
    gesture(28, 30, 28, 30, false);
    out.outside = { chats: window.pilly.__chats().length, drags: window.pilly.__drags().join(",") };

    // 3. a real drag released on him: Chromium fires a click for it, and putting
    //    him down must never be read as "open the chat"
    await fresh();
    gesture(28, 30, 128, 60, true);
    out.drag = { chats: window.pilly.__chats().length, drags: window.pilly.__drags().join(","), dragging: t.dragging };

    // 4. a real drag released over the desktop, then a plain tap. The gate that
    //    swallows the unmatched click must not still be armed for the next tap.
    await fresh();
    gesture(28, 30, 190, 90, false);
    out.dragAway = { chats: window.pilly.__chats().length, moved: Math.round(t.moved), dragging: t.dragging };
    gesture(28, 30, 28, 30, true);
    out.afterDragAway = { chats: window.pilly.__chats().length };

    // 5. the mouseup that never arrives: the pointer leaves him and comes back
    //    with an empty hand. That is not a carry any more, whatever the browser
    //    believes about the button.
    await fresh();
    send("mouseover", 28, 30, 0);
    send("mousedown", 28, 30, 1);
    send("mousemove", 44, 34, 1);
    send("mouseout", 28, 30, 0);
    send("mousemove", 60, 36, 0);
    out.lostUp = { dragging: t.dragging, drags: window.pilly.__drags().join(",") };
    gesture(28, 30, 28, 30, true);
    out.lostUpTap = { chats: window.pilly.__chats().length };

    // 6. the same lost mouseup, rescued by the watchdog instead of by the hand
    await fresh();
    t.dragIdleMs = 120;
    send("mouseover", 28, 30, 0);
    send("mousedown", 28, 30, 1);
    send("mousemove", 50, 34, 1);
    send("mouseout", 28, 30, 0);
    await idle(700);
    out.watchdog = { dragging: t.dragging, drags: window.pilly.__drags().join(","), chats: window.pilly.__chats().length };
    t.dragIdleMs = 4000;

    // 7. a carry interrupted while he is genuinely still held must survive the
    //    watchdog: the pointer keeps reporting the button, so nothing ends it
    await fresh();
    send("mouseover", 28, 30, 0);
    send("mousedown", 28, 30, 1);
    t.dragIdleMs = 120;
    for (let i = 0; i < 4; i++) { send("mousemove", 34 + i * 4, 34, 1); await idle(140); }
    out.held = { dragging: t.dragging };
    t.dragIdleMs = 4000;

    // 8. a sloppy tap: a trackpad or a hand that is not perfectly still drifts a
    //    few pixels. That used to land in a dead zone - too far to count as a tap,
    //    too short to be a carry - so nothing at all happened, with no feedback
    //    and no reason the user could see.
    await fresh();
    window.pilly.__clearReactions();
    gesture(24, 28, 30, 32, true);
    out.sloppy = { chats: window.pilly.__chats().length, reactions: window.pilly.__reactions().join(",") };

    // 9. the other side of the same boundary: a short carry moves him and must
    //    NOT open the chat, and must not complain either - he is not being dragged
    //    around, he was nudged.
    await fresh();
    window.pilly.__clearReactions();
    gesture(24, 28, 40, 30, false);
    out.nudge = {
      chats: window.pilly.__chats().length,
      drags: window.pilly.__drags().join(","),
      reactions: window.pilly.__reactions().join(","),
    };

    // 10. a hand that holds him perfectly still: the renderer has to keep feeding
    //     main's carry watchdog ("hold"), or a grab that never ended reads as a
    //     lost release and he walks out of the hand still holding him.
    await fresh();
    t.dragIdleMs = 120;
    send("mouseover", 28, 30, 0);
    send("mousedown", 28, 30, 1);
    await idle(700);
    out.hold = { dragging: t.dragging, drags: window.pilly.__drags().join(",") };
    t.dragIdleMs = 4000;
    await fresh();
    return out;
  })()`);

  const lastDrag = (s) => (s ? s.split(",").pop() : "");
  const countDrag = (s, w) => (s ? s.split(",").filter((x) => x === w).length : 0);
  check("a plain tap opens the chat", tap.plain.chats === 1, tap.plain);
  check("...and it is one carry, started and ended exactly once",
    countDrag(tap.plain.drags, "start") === 1 && countDrag(tap.plain.drags, "end") === 1, tap.plain.drags);
  check("a tap released just outside him opens the chat too",
    tap.outside.chats === 1 && lastDrag(tap.outside.drags) === "end", tap.outside);
  check("dragging him around never opens the chat",
    tap.drag.chats === 0 && tap.drag.dragging === false, tap.drag);
  check("...while the app is still told about the whole carry",
    tap.drag.drags === "start,move,move,move,move,end", tap.drag.drags);
  check("a drag released over the desktop leaves the gate armed, not broken",
    tap.dragAway.moved > 10 && tap.dragAway.dragging === false && tap.dragAway.chats === 0, tap.dragAway);
  check("...and the very next tap still opens the chat", tap.afterDragAway.chats === 1, tap.afterDragAway);
  check("a lost mouseup does not leave him carried once the hand is empty",
    tap.lostUp.dragging === false && lastDrag(tap.lostUp.drags) === "end", tap.lostUp);
  check("...and the tap after it opens the chat", tap.lostUpTap.chats === 1, tap.lostUpTap);
  check("the watchdog puts him down when the pointer left mid-carry",
    tap.watchdog.dragging === false && lastDrag(tap.watchdog.drags) === "end" && tap.watchdog.chats === 0, tap.watchdog);
  check("a carry he is genuinely still being held in is never dropped by the watchdog",
    tap.held.dragging === true, tap.held);
  check("a tap that drifted a few pixels still opens the chat", tap.sloppy.chats === 1, tap.sloppy);
  check("...and a sloppy tap never counts as being dragged around",
    !/dragstart/.test(tap.sloppy.reactions), tap.sloppy.reactions);
  check("a short nudge carries him without opening the chat", tap.nudge.chats === 0, tap.nudge);
  check("...and a nudge he is put back down from is still a complete carry",
    /^start,(move,)+end$/.test(tap.nudge.drags), tap.nudge.drags);
  check("...without the angry 'put me down' reaction", !/dragstart/.test(tap.nudge.reactions), tap.nudge.reactions);
  check("a hand holding him perfectly still keeps telling main the carry is alive",
    tap.hold.dragging === true && countDrag(tap.hold.drags, "hold") >= 1, tap.hold);

  // --- the shipped pet.html keeps animating on its own (no test hooks) ---
  // A window that is never shown produces no frames at all, no matter what
  // backgroundThrottling says, so the harness maps the window out of the way
  // with opacity 0 and then samples. The hidden control documents that fact.
  const sampler = `(() => {
    window.__hashes = new Set();
    window.__timer = setInterval(() => {
      const c = document.getElementById("pet");
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let h = 0, opaque = 0;
      for (let i = 0; i < d.length; i += 97) h = (h * 31 + d[i]) | 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) opaque++;
      window.__hashes.add(h + ":" + (opaque > 100 ? "drawn" : "blank"));
    }, 100);
    return true;
  })()`;

  const openProd = async (label, reveal) => {
    const w = new BrowserWindow({
      show: false, width: 60, height: 64, frame: false, transparent: true, skipTaskbar: true, focusable: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: PRELOAD, backgroundThrottling: false },
    });
    w.webContents.on("console-message", (e, level, msg) => { if (level >= 3) rendererErrors.push(label + ": " + msg); });
    await w.loadFile(path.join(ROOT, "renderer", "pet.html"));
    await new Promise((r) => setTimeout(r, 500));
    if (reveal) { w.setOpacity(0); w.showInactive(); }
    await new Promise((r) => setTimeout(r, 300));
    await w.webContents.executeJavaScript(sampler);
    await new Promise((r) => setTimeout(r, 2500));
    const r = await w.webContents.executeJavaScript(`(() => { clearInterval(window.__timer); return [window.__hashes.size, document.visibilityState]; })()`);
    w.destroy();
    return r;
  };

  const [prodFrames, prodVis] = await openProd("prod", true);
  check("shipped pet.html: the rAF loop keeps repainting on its own", prodFrames >= 20, { distinct: prodFrames, visibility: prodVis });
  const [ctlFrames] = await openProd("control", false);
  console.log(`INFO  same page in a window that was never mapped: ${ctlFrames} distinct frames (Chromium paints nothing off-screen, so the harness maps the test window)`);

  // --- pick-up does not wait for the settings round-trip -------------------
  // The report was "sometimes clicking Pilly does nothing at all", and the only
  // thing that ever armed pick-up was the reply to the settings call. A reply
  // that is slow, or that fails, used to leave the pet unpickable for the whole
  // session - no cursor change, no drag, nothing. Both failure modes are loaded
  // here on the shipped page and the pet has to behave exactly as usual.
  const openPetWithSettings = async (mode, errors) => {
    const args = { hang: "--pet-settings-hang", fail: "--pet-settings-fail", openfail: "--pet-open-fail" };
    const w = new BrowserWindow({
      show: false, width: 60, height: 64, frame: false, transparent: true, skipTaskbar: true, focusable: false,
      webPreferences: {
        contextIsolation: true, nodeIntegration: false, sandbox: true, preload: PRELOAD,
        backgroundThrottling: false, additionalArguments: [args[mode]],
      },
    });
    w.webContents.on("console-message", (e, level, msg) => { if (level >= 2) errors.push(mode + ": " + msg); });
    await w.loadFile(path.join(ROOT, "renderer", "pet.html"), { query: { [mode]: "1" } });
    await new Promise((r) => setTimeout(r, 600));
    const r = await w.webContents.executeJavaScript(`(async () => {
      const send = (type, x, y, buttons) => document.dispatchEvent(new MouseEvent(type, {
        bubbles: true, cancelable: true, view: window,
        clientX: x, clientY: y, screenX: x, screenY: y, buttons,
      }));
      const cursor = () => getComputedStyle(document.querySelector("canvas")).cursor;
      const out = { mode: window.pilly.__petSettingsMode(), open: window.pilly.__openChatMode(), armed: cursor(), bodies: document.body.className };
      // the plain tap, then a real pick-up: both are what "clicking him" means
      send("mouseover", 28, 30, 0);
      send("mousedown", 28, 30, 1);
      send("mousemove", 30, 31, 1);
      send("mouseup", 30, 31, 0);
      send("click", 30, 31, 0);
      await new Promise((r) => setTimeout(r, 40));
      out.tapChats = window.pilly.__chats().length;
      send("mouseover", 28, 30, 0);
      send("mousedown", 28, 30, 1);
      send("mousemove", 80, 40, 1);
      out.carry = { cursor: cursor(), drags: window.pilly.__drags().join(",") };
      send("mouseout", 28, 30, 0);
      send("mouseup", 80, 40, 0);
      await new Promise((r) => setTimeout(r, 40));
      return out;
    })()`);
    w.destroy();
    return r;
  };

  for (const mode of ["hang", "fail"]) {
    const errors = [];
    const r = await openPetWithSettings(mode, errors);
    // The cursor is the whole tell: with pick-up never armed the pet stays on the
    // default arrow and dragging him does nothing at all.
    check(`the settings reply that ${mode === "hang" ? "never comes" : "fails"} cannot leave the pet unpickable`,
      r.mode === mode && r.armed === "grab" && /^start,(move,)+/.test(r.carry.drags), r);
    check(`the tap still opens the chat while the settings call is ${mode === "hang" ? "pending" : "failing"}`,
      r.tapChats >= 1, r);
    check(`the settings call cannot fail silently (${mode})`,
      !errors.some((m) => /unhandled|uncaught/i.test(m)) &&
      (mode !== "fail" || errors.some((m) => /could not read his pet settings/.test(m))), errors.slice(0, 4));
  }

  // The click itself can fail too: main answers { ok:false } instead of throwing,
  // but a channel that rejects outright must not become a promise nobody reads.
  {
    const errors = [];
    const r = await openPetWithSettings("openfail", errors);
    check("an open-chat call that fails is logged, not swallowed",
      r.open === "fail" && r.mode === "ok" && r.tapChats >= 1 &&
      errors.some((m) => /could not open the chat/.test(m)) &&
      !errors.some((m) => /unhandled|uncaught/i.test(m)), { ...r, errors: errors.slice(0, 3) });
  }

  // --- main.js keeps the overlays animating when the OS occludes them ----
  // macOS marks a window on a non-active Space, or behind a full-screen app, as
  // occluded; with Chromium's default throttling Pilly would freeze there even
  // though he is "visible" on every Space.
  const mainSrc = fs.readFileSync(path.join(ROOT, "main.js"), "utf8");
  const overlayFlags = (mainSrc.match(/backgroundThrottling:\s*false/g) || []).length;
  check("main.js: pet, bubble and poop windows opt out of background throttling", overlayFlags >= 3, overlayFlags);

  // --- the poop window's fade actually fades ------------------------------
  // The stink puff loops forever; while the fade only lowered its opacity the
  // puff's own keyframes kept popping it back up over a window that was supposed
  // to be emptying out. Checked on the shipped page, on computed style.
  const poopWin = new BrowserWindow({
    show: false, width: 360, height: 220, frame: false, transparent: true, skipTaskbar: true, focusable: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  poopWin.webContents.on("console-message", (e, level, msg) => { if (level >= 3) rendererErrors.push("poop: " + msg); });
  await poopWin.loadFile(path.join(ROOT, "renderer", "poop.html"));
  poopWin.setOpacity(0);
  poopWin.showInactive();
  const poopFade = await poopWin.webContents.executeJavaScript(`(async () => {
    document.body.classList.add("fade");
    const animation = getComputedStyle(document.querySelector(".stink")).animationName;
    await new Promise((r) => setTimeout(r, 800)); // let the 0.6 s fade finish
    const samples = [];
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 100));
      samples.push(Number(getComputedStyle(document.querySelector(".stink")).opacity));
    }
    return { animation, peak: Math.max(...samples) };
  })()`);
  poopWin.destroy();
  check("the poop window's fade stops the looping stink puff",
    poopFade.animation === "none", poopFade);
  check("nothing stays painted over the poop window's fade",
    poopFade.peak < 0.05, poopFade);

  check("no renderer errors on any page", rendererErrors.length === 0, rendererErrors.slice(0, 5));

  console.log("VERIFY_DONE checks=" + checks + " failures=" + failures.length);
  cleanupTmp();
  app.exit(failures.length ? 1 : 0);
});
