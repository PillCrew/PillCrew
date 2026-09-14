<div align="center">

<img src="../assets/00-cover.png" alt="Pilly Desktop - the proactive market companion" />

# 💊 Pilly Desktop

A tiny green pill AI friend that **lives in your taskbar or menu bar** (Windows, macOS and Linux). Click it, chat with it (free AI), and it answers like a sharp, terminally-online friend - short enough to screenshot.

Pilly is an original PillCrew character - its own persona, prompts and meme brain.

[![Release](https://img.shields.io/github/v/release/PillCrew/PillCrew?style=flat-square&color=4caf50)](https://github.com/PillCrew/PillCrew/releases)
[![License](https://img.shields.io/badge/License-MIT-4caf50?style=flat-square)](LICENSE)

</div>

---

## What it does

- **Sits in the system tray** - a little green pill with eyes, gently bobbing.
- **One click = chat** - a small frameless window pops up right above the tray icon.
- **Free AI** - talks through your own API settings (**Settings** in the chat: paste any chat-completions endpoint and key, pick a free model with one click, test, done).
- **Live Solana data (pro)** - paste a token address or a pump.fun/jup.ag link and Pilly pulls live data from free APIs (pump.fun, DexScreener, GeckoTerminal, Jupiter intel): price, mcap, volume, liquidity, 24h change, age, buy/sell txns, organic score, verification, holder/audit flags - then gives a trained pro read (I BUY / TRIM / hold / SELL with the real numbers).
- **Trending** - one click pulls the hottest Solana coins right now with **real market caps** (GeckoTerminal + DexScreener + pump.fun) and a short rundown.
- **Wallet portfolio** - paste your Solana wallet address and Pilly lists your SOL + token holdings with real prices, weighted 24h change and total value (both Token and Token-2022 accounts).
- **Watchlist PnL summary** - set an entry price on any watched token and the watchlist rolls it up into a one-glance portfolio strip: Avg / Best / Worst and how many tokens are tracked. Green when you're up, red when you're down.
- **Taskbar pet (pro animations)** - a 60fps canvas renderer. Pilly walks the
  taskbar (or the whole monitor) with smooth step-squash and rocking, soft
  landings, a talking mouth, richer eyes (pupils, gloss, squints, eye-darts)
  and a soft radial shadow - crisp on any DPI.
- **Market reactions** - check a coin, wallet or trending and Pilly reacts to
  the market: green = confetti + smile + bounce, red = frown + a tear.
- **Ambient life** - day/night behavior, dance notes, idle gestures (wave /
  yawn / stretch / peek / sneeze), weather moods, a morning greeting, and naps
  when the mouse is idle.
- **Cursor play** - in whole-monitor mode a fast poke spooks Pilly: jump,
  "!", a short scared dash - then he calms down and stays clickable.
- **Chat mood** - the chat avatar senses the mood of your messages and the
  market, and reacts with emoji + expressions (plus click = boop, hold = pet).
- **Market alerts** - Pilly watches trending every few minutes and calls out
  big pumps and dumps.
- **Sound effects** - optional WebAudio blips (hop, scare, confetti, sad,
  sleep) - toggle in settings.
- **Memory & stats** - Pilly counts jokes, coins, scares and days together,
  and shares little facts from its life.
- **Personalization** - rename Pilly, set a default mood, and the whole chat
  (bubbles included) follows your theme color.
- **Meme brain** - detects what you want and switches mode (from the chips, or just by typing it - `roast me`, `caption this: …`):
  - `meme this` → rewrites your text in meme-native language
  - `caption this` → a punchy meme caption
  - `name this` → an absurd coin / token / character name
  - `react` → a short, terminally-online reaction
  - `roast` → a playful light roast
- **Short replies** - everything fits in a screenshot, never over-explains a joke.
- **Hotkey** - `Ctrl+Alt+P` (`Cmd+Alt+P` on macOS) summons Pilly from anywhere,
  and toggles the chat back away on a second press.
- **Start with Windows** - optional, from the tray menu.
- **The whole app is in the tray menu** - Open chat, the Solana RPC health line,
  **Pilly on the taskbar** (the same switch as the heart button in the chat),
  focus session controls, Reset window position, Start at login and Quit.
- **Auto-update** - Pilly checks GitHub for new releases when you open it and updates itself; the installed build restarts into the new version (the portable .exe links you to the releases page instead).
- **Settings polish** - the window position is remembered automatically, with one-click **Reset window position** if Pilly ever lands off-screen (tray menu still has it too).

## Screenshots

| | | |
| --- | --- | --- |
| ![Pilly chat](docs/screenshot-chat.png) | ![Live trending](../assets/features-trending.png) | ![Watchlist & PnL](../assets/features-watchlist.png) |
| ![Radar - fresh launches](../assets/features-radar.png) | ![Position-size calculator](../assets/features-calc.png) | ![Pilly's Scorecard](../assets/features-scorecard.png) |
| ![Whale Follow](../assets/features-whales.png) | ![Settings](../assets/features-settings.png) | |

## What's new

### v1.1.2

Pilly feels **more alive** and behaves more politely on macOS.

#### More life
- **New idle gestures** - coin flip, stretch, peek, sneeze, heart, giggle and
  spin join the existing wave / yawn / curious / wiggle rotation, so Pilly never
  just stands there. The coin flip is the showpiece: he tosses a gold coin, it
  spins edge over edge three times, and he catches it with a squash and a puff of
  gold dust. It is drawn as geometry (a disc, a rim, three slanted bars), so it
  stays sharp at every pet size.
- **He breathes** - all the time, in every state, not only while parked. A slow
  chest rise, faster when he is walking or dancing. A sprite that only moves when
  something happens reads as a slideshow; this is what makes him look alive while
  you work. It is off while you are holding him, and off under reduced motion.
- **His eyes look where he is going** - the pupils ease ahead of him as he walks
  and settle back when he stops, instead of staying pinned to the middle of his
  face.
- **Sleepy lids in the evening** - as the night gets later his eyelids droop
  further and open more slowly, so a 2 a.m. Pilly looks as tired as you feel.
- **Landing wobble** - hops now resolve: the squash on touchdown settles through a
  short three-beat wobble instead of snapping flat.
- **Eased blinking** - eyes now close and open along a smooth curve instead of
  snapping, plus occasional quick double-blinks. Same treatment for the chat
  avatar, which also glances around on its own and pops in when it opens.
- **Real hops** - the jump is keyframed now: a crouch to load up, a stretch at
  launch, then a squash on landing, instead of one stiff pose held for the whole
  flight.
- **Shy lean** - when your cursor comes close Pilly leans *away* from it, like a
  cat pretending not to care.
- **He waits for the click** - while the cursor is on him he cuts his walk short
  and stands still, so he is where he was when you aimed at him. He still dodges a
  genuine flick, but a hand simply reaching for him is no longer something to run
  from.
- **He can be petted, and he melts** - rubbing him with the cursor is an
  interaction of its own now. A slow rub gets you bliss: he widens out and leans
  into your hand, purrs, and hearts float off him. Keep rubbing and he melts all
  the way - deeper, flatter, leaning further and purring harder - and when you let
  go he sighs, settles, and then asks for a few seconds of peace before he'll have
  it again. Petting is deliberate: the pointer has to travel back and forth over
  him, so merely crossing him on the way to something else never sets it off, and
  a pet already off the ground cannot be rubbed at all. While he is asleep a
  stroke wakes him instead - once, not once per pointer sample.
- **One tap, two taps, three taps** - a single click is a friendly boop and gets
  you heart eyes. Tap again straight away and he giggles. A third tap earns a full
  tickle: he squirms side to side, shivers and laughs at you. The chain expires on
  its own, so he can never get stuck in the silly mood, and a tap never overrides
  a love mood that came from the market or the chat.
- **How you put him down matters** - a short, gentle drag ends in a soft landing;
  a long or fast one leaves him dizzy, with spinning eyes and a wobbly grin, while
  he shakes it off. Either way the swing itself stops with your hand instead of
  coasting after it.
- **The idle perk** - every 30-70 seconds while he is parked he pulls himself up
  straight for a beat, as if something had just caught his eye, and settles back.
  Short, rare, and skipped while you are holding him.
- **He remembers** - the chat's stat chatter counts pets as well as drags
  ("you've petted me 12 times and dragged me 3"), and a stale stats file can no
  longer make him announce `undefined` of anything.
- **Birth pop-in** - Pilly springs onto the taskbar with a tiny overshoot and a
  puff of dust.
- **Talking bob** - a gentle, attentive bob while Pilly speaks.
- **Gesture chains** - idle gestures now flow into each other (a wave often leads
  into a wiggle, a yawn into a stretch), and the same gesture never plays twice in
  a row, so the idle loop reads like a little performance instead of a random
  number generator.
- **He's on your clock** - what he does while idling is weighted by the time of
  day: brisk, wavy and wiggly in the morning, watchful and curious through the
  work day, stretching and yawning as the evening winds down, and leaving much
  longer pauses late at night. Every gesture is still possible at every hour - he
  is drowsy, not stuck on a loop - but the odds and the pacing move with the
  clock, so a 2 a.m. Pilly reads differently from a 9 a.m. Pilly.
- **Pin-sharp on every display** - the pet canvas follows the screen's pixel
  ratio (Retina, 125 %/150 % Windows scaling) and re-scales itself when Pilly is
  moved onto a display with a different scale factor. Before this he looked
  slightly soft on anything that wasn't a 100 % display.
- **He notices when you come back** - bringing the chat to the front (including
  from the tray, or back from being minimised) gets you a quick wave or a peek,
  and he won't start an idle gesture on top of it. Rate-limited to once a minute,
  and skipped entirely while he's asleep, eating, dancing or mid-gesture, so it
  reads as affection instead of a tic. **Coming back means coming back**: the
  greeting needs the window to have lost focus first, so launching the app no
  longer spends the wave on a return that never happened - and a greet that the
  pet window cannot hear yet (pet.html still loading) no longer burns the
  one-a-minute cooldown either.
- **A focus ring over his head** - while a Pomodoro session is running, Pilly
  wears a small ring that drains as the session burns down, with the minutes left
  in the middle. It turns amber for the last minute (and pulses gently, unless
  you asked for reduced motion), says `❚❚` while you're paused, and turns blue on
  a break. Starting a break gets you a confetti burst and a bounce; heading back
  into focus gets a determined little nod. Start a session while he's off, or
  restart him mid-session, and he still picks it up the moment his window loads.
- **Reminders are his business too** - when a reminder comes due he hops and pops
  a clock over his head, so you notice it where you're already looking instead of
  on a system toast on the other side of the screen.
- **He tells you when Solana's public RPC is the problem** - every on-chain screen
  (balance, whale diff, rug check, scorecard) goes through the same public
  endpoint, and when it is rate-limited those screens just come back empty - which
  looks exactly like a dead mint. Pilly now probes it once a minute with a single
  `getSlot` call and says so where you look first: the tray menu always carries a
  `Solana RPC: ok · 78 ms` / `slow · 1.4 s` / `unreachable` line, and the tooltip
  adds a short note **only** when the endpoint is actually misbehaving, so a
  healthy endpoint stays silent instead of filling your tooltip with "all good".
  Point it at your own node with `PILLY_RPC_URL=https://…` (in `.env`, or your
  environment) if you have a private endpoint - the public one rate-limits exactly
  the people who use these screens most.
- **Reduce motion, done properly** - if your system asks for reduced motion
  (macOS *Reduce motion*, Windows *Show animations* off), Pilly keeps blinking,
  swaying and waving but drops the gestures that fling the whole pill around, and
  the chat UI stops looping animations instead of just playing them faster. The
  preference is re-read live, so flipping the switch in your system settings calms
  him down without a restart - and the menu bar icon stops bobbing too, because
  the renderers report the setting to the main process (which cannot read it
  itself on every platform).

#### Fixes & macOS polish
- **Only one Pilly can run at a time** - the app never asked for a single-instance
  lock, so launching it twice gave you two tray icons, two pets walking the
  taskbar, duplicate alerts and two processes writing the same settings and
  position files on top of each other. A second launch now hands the request to
  the copy that is already running (which reopens and focuses the chat) and exits.
- **Idle gestures came back** - a state flag was never cleared, so Pilly only
  ever performed *one* idle gesture per launch and then stood still forever
  (thought bubbles were dead for the same reason). All eleven gestures and the
  bubbles now recur properly.
- **macOS Dock click** now re-opens the chat (the hidden window used to stay
  hidden).
- **A menu bar icon that belongs there** - the tray frames are 32x32, and macOS
  draws a tray image at its own point size, so Pilly filled the whole menu bar and
  looked soft on a Retina screen. The icon is now handed to the menu bar as a real
  16pt image with a 2x representation. Windows and Linux were already right and
  are untouched.
- **Your first macOS click lands where you aimed** - the pet window is
  deliberately non-focusable, and macOS silently swallows the first click on such
  a window, so petting him or starting a drag took two clicks (with the first one
  doing nothing at all). The pet and bubble windows now accept the first
  mouse-down. Ignored on Windows and Linux, which never had the problem.
- **A curated macOS app menu** - with no menu of its own, Electron installs its
  default template, which ships **Reload** and **Toggle DevTools** in a released
  build plus zoom items that only apply to windows you can't see. macOS now gets
  a menu built for it - About, Hide, Quit, the standard editing roles (so the
  chat's text fields keep cut/copy/paste), Open chat, Reset window position,
  Minimize, Zoom, Bring all to front - and `Cmd+W` hides the chat instead of
  closing it. The app menu takes its name from `package.json`, not from
  `app.name`, which answers "Electron" whenever Electron cannot see the package
  file - and the menu bar prints that string verbatim. The template lives in
  `src/macmenu.js` and is unit-tested, plus re-checked inside Electron by the boot
  gate, because Electron accepts a role it doesn't recognise in silence: the item
  simply ends up with an empty label and does nothing when clicked, which is
  exactly the kind of macOS-only mistake a Windows test run would never surface.
- **Double-clicking the menu bar icon** - macOS reports a double-click as two
  clicks, so the chat used to open and immediately close again. Double-click
  events are ignored on macOS now.
- **Hotkey conflict fixed** - the summon shortcut moved from `Ctrl+Shift+P`
  (VS Code's command palette) to `Ctrl+Alt+P` / `Cmd+Alt+P`. If something else
  still owns it, the tray now says so ("Summon hotkey taken by another app")
  instead of leaving you pressing a key that silently does nothing, and the
  shortcut is released on quit so it doesn't linger after Pilly exits.
- **Friendlier clicks** - a quick click no longer flashes an annoyed face
  (only a real drag does).
- **The click that opens the chat can no longer miss** - three separate accidents
  fed the "sometimes clicking Pilly does nothing" report. He used to dart 90 px
  away from a cursor approaching at 0.5 px/ms - an ordinary approach, not a threat
  - and the click then landed on the desktop behind where he had been: he now only
  flinches from a genuine flick (over ~1.6 px/ms, and never twice inside four
  seconds), and while your cursor is actually on him he stops walking and stands
  for the click instead of wandering out from under it. The tap tolerance was 6 px,
  which left every trackpad drift between 6 and 24 px in a dead zone where nothing
  happened at all - not a tap, not a carry; the tolerance is 10 px now and the
  11-24 px band is a short carry you can see him take. And a click on a chat that
  was open but buried behind another window only called `focus()`, which does not
  raise a window on Windows; it is moved to the top as well.
- **He can always be picked up** - pick-up was armed by the reply to the
  pet-settings call, and nothing else. Until that reply arrived - and for the whole
  session if it failed - the cursor stayed on the default arrow and dragging him
  did nothing at all. Nothing about being pickable is a setting, so it no longer
  waits for one, and a settings reply that fails is logged instead of vanishing
  into an unhandled rejection - as is a chat-open call that fails.
- **He can no longer be dropped while you are still holding him** - the renderer
  reported a carry only when the pointer *moved*, so a hand holding him perfectly
  still for four seconds tripped both carry watchdogs: they read the silence as a
  lost release and put him down, and he walked out of the hand that was still
  holding him. A still pointer now reports the carry as alive, which is what keeps
  main's watchdog fed, and the hold no longer counts as a spook/flee trigger. A
  window that loses focus mid-carry ends the carry too, so a system dialog stealing
  the mouse can't leave him stuck in mid-air - which is what used to make the *next*
  tap do nothing at all until Pilly was switched off and on again.
- **Pilly comes back after a restart** - the pet's on/off state is remembered now.
  It used to reset on every launch, so you had to click the pet button again each
  time you opened the app (or rebooted).
- **"Open chat" opens the chat** - the tray item and the macOS menu item both
  carried that label and both *toggled*: with the chat already up, clicking
  "Open chat" put it away, the exact opposite of what the entry says, and it
  loaded a pending hot-coin into a hidden window on the way. Both now open and
  raise. The tray icon click and the summon hotkey still toggle, because a summon
  that answers a second press by hiding is what that reflex expects. Raising also
  happens on every reveal now (`moveTop()` and not just `focus()`), so a chat that
  was open but behind another always-on-top window actually comes forward instead
  of looking like the click did nothing.
- **Pilly no longer freezes on other Spaces** - the pet, bubble and poop windows
  opt out of Chromium's background throttling. macOS marks a window sitting on a
  *non-active* Space (or behind a full-screen app) as occluded, and Pilly was
  being throttled to about one frame per second right there.
- **Pilly follows you across Spaces and full-screen apps** - the pet, bubble and
  poop windows re-assert `visibleOnFullScreen` every time they are shown.
- **Honest updater on macOS** - a self-signed or unsigned build can't use
  auto-update (it needs a Developer ID signature), so instead of failing silently
  Pilly now detects that and tells you to grab the new DMG from Releases.
- **Packaging hardened** - the mac build enables the hardened runtime with the
  matching entitlements, so notarised builds don't crash on launch.
- **Less IPC chatter** - the pet's facing direction is only sent to the main
  process when it actually changes (was ~40 messages per second).
- **A background tick can't take him down any more** - the polls for jokes,
  questions, weather, market alerts, whale flow and portfolio mood all run on
  plain timers, where a rejected promise (a dropped request, a half-written
  settings file) becomes an unhandled rejection that nothing in the app ever
  hears about - Electron only logs a warning to a console you cannot open in a
  packaged build. Every one of them now reports its own failure and keeps Pilly
  running, and the same guard covers the timer callbacks that had no `try` of
  their own.
- **A desktop that refuses a tray can no longer take startup down** - creating the
  tray ran bare inside startup, so on a Linux session without AppIndicator support
  (or any environment that says no to a tray icon) `new Tray()` threw, the rest of
  the startup chain never ran, and what was left was a process with no tray, no
  pet and no chat. Tray creation is guarded now, "Start at login" reports a refusal
  from the OS instead of throwing out of a tray-menu click (which macOS answers
  with a crash dialog on an unsigned build), and a startup failure is logged
  instead of disappearing as an unhandled rejection.
- **Multi-monitor resilience** - undocking a laptop (or changing a resolution) no
  longer strands Pilly and the chat window on a display that no longer exists.
  `display-removed`, `display-added` and `display-metrics-changed` all pull them
  back into the work area of the nearest surviving screen, and a window that was
  hidden while the monitors changed is re-clamped when you reopen it.
- **Pilly walks the display he's standing on** - every step, flee and clamp now
  uses the work area of the monitor he is actually on, not the primary one.
- **He comes back exactly where you left him** - the parked position is written
  both when you drag him and on quit, so he returns to the spot he had wandered
  to (the old code only remembered the last drag, so he could reappear hundreds of
  pixels away).
- **Dragging works in taskbar mode too** - you could only drag Pilly in "screen"
  walk mode; now the taskbar pill is draggable as well, still clamped to its bar.
- **Settings Save can't clobber your API keys** - pressing Save before the
  settings rows were rendered threw inside the renderer (`Cannot read properties
  of undefined`). Save and Test now re-post the tiers that are actually saved
  instead of inventing empty ones, so keys are never wiped.
- **Petting him can't leak your API keys into a file** - switching Pilly on or
  off, parking him somewhere new and changing one of his pet options each write
  the settings file, and all three built that write on top of the *effective*
  settings - the ones with the `.env` tiers already merged in. So the first pet
  toggle or drag copied the `PILLY_TIER*_KEY` you keep in `.env` into
  `pilly-settings.json`, after which the saved copy wins and later `.env` edits
  are ignored for good. Pet writes now merge onto the saved settings
  (`SETTINGS.savePet`), so `.env` stays the only place those keys live unless you
  type them into the app yourself.
- **Following a whale no longer reports his whole bag as a fresh buy** - there is
  nothing to diff against on the very first poll after you add an address, so
  every token the whale had been holding for months counted as "new": up to two
  `whale just bought …` bubbles and two scorecard calls for buys that never
  happened. The first poll now only records the baseline (the panel's rule is a
  *new position*, and that is what it now means), and the diff runs against every
  mint Pilly has ever seen that wallet hold instead of against the previous
  snapshot - the portfolio read is capped to the ten largest tokens, so a small
  bag that slipped to eleventh place and came back used to be announced as a
  purchase too.
- **Turning Pilly off and on again no longer doubles his chatter** - the
  "warm-up" timers he arms when he starts (first joke, first question, first
  daily brief, the weather check) were fire-and-forget, and so was every
  self-rearming scheduler behind them: a quick off→on toggle - the ordinary
  mis-click, click again - left the first session's timers armed, and each of
  them fired into the new session and started a *second*, forever-rearming chain
  of its own. Jokes, questions and poops then arrived at about twice the intended
  rate for the rest of the run. The warm-up timers are cancelled with him now and
  every scheduler cancels its own previous handle before re-arming.
- **The pet is in the tray** - the pet button lives inside the chat window and
  Windows and macOS start tray-first with that window hidden, so after a launch
  that starts with Pilly off there was no way to call him back without opening
  the chat first. The tray now carries a **Pilly on the taskbar** checkbox that
  drives the same switch (and the same saved state) as the heart button in the
  chat, and the chat's button follows along if you flip it from the tray. Note
  for anyone upgrading from 1.1.1: the flag only exists since 1.1.2, so the first
  launch after the update starts with him off until you switch him on once.
- **Switching him off is no longer logged as a crash** - tearing the pet's window
  down on purpose (switching him off, quitting) went through the crash-recovery
  handler, so the log announced "Pilly's window lost its window - rebuilding it"
  every time you turned him off.
- **External links report failure** - `shell.openExternal()` rejects where the
  platform has no handler for the URL (a Linux session without `xdg-open`, say).
  Called bare, the click looked like it worked, the promise rejection was
  unhandled and the UI had nothing to report; every caller now gets a yes/no.
- **A reminder still reaches you when Pilly is off** - a due reminder popped a
  clock over Pilly's head and pushed an OS notification, and that was all: the
  text never went to the chat, so with Pilly switched off (or on a desktop in Do
  Not Disturb, where the toast is swallowed) the reminder you asked for left no
  trace anywhere. It is now written into the chat transcript as
  `⏰ Reminder — <what you asked for>` as well, escaped like any other message.
- **Focus sessions started from the tray say so** - the chat explains a session
  you started by typing in it, but the tray's **Focus** items changed the state
  in silence, so a session you started from the menu bar left the transcript
  insisting there was nothing running. Each tray item now narrates the outcome
  into the chat ("🍅 Focus started from the tray — 25 min. I'll keep the chatter
  down."), including the clicks that had no visible effect at all before:
  starting a session while one is already running, or pausing, resuming and
  stopping a session when there is nothing to pause, resume or stop.
- **Removed a dead channel** - the renderer still listened for a `pilly:suggest`
  push that no version of this app has ever sent (its comment credited a tray
  "Meme mode" that does not exist). Gone from the bridge, the renderer and the
  test stub.
- **The stink clouds stop when the poop window fades** - the window fades out on
  a timer, and the 💨 keyframes kept running underneath it, so as the window went
  transparent the emoji popped back to full opacity over the fading frame.
- **Closing the chat window on purpose is no longer logged as a crash** - same
  false repair as the pet's: the log said the chat window had been lost and was
  being rebuilt for a window the app was deliberately tearing down, which is
  exactly how a log stops being worth reading.
- **Hiding the chat window sticks on the first click** - the header's hide button
  called `window.close()`, and on Windows a renderer's `close()` destroys the
  window *without* emitting the window's `close` event (measured on Electron
  31.7.7; only `closed` arrives). The handler that hides the chat therefore never
  ran, the window was still recorded as wanted, and the survival net rebuilt and
  re-showed it a moment later - so hiding right after a snipe could take several
  clicks, each one spending one of the four repairs a minute the net allows, until
  it gave up and left you with no chat window at all. The button now asks the main
  process to hide the window: the intent to hide is recorded first and the window
  is hidden rather than closed, so it also keeps whatever coin, transcript and
  scroll position you had loaded instead of being rebuilt from scratch.
- **A shutdown is not a crash either** - Windows and Linux do not emit
  `before-quit` when the machine is shut down or the user logs out (Electron
  documents that for Windows), so the OS tearing our windows down went through
  the same recovery path: a repair logged, and a window rebuilt inside a process
  with no time left to show it. The power monitor's `shutdown` event now marks
  the app as quitting first, so those final seconds stay quiet.
- **No more dust launches** - pump.fun coins are born at roughly $2.8-3K of
  market cap and its feed is sorted newest-first, so the top of the list is
  almost entirely coins nobody has bought yet. Pilly presented those as fresh
  launches ("🔫 JUST LAUNCHED" bubbles, radar rows, hot-coin bubbles), which is
  the wrong signal to put in front of a trader. Fresh launches now have to clear
  a **$7K market-cap floor** (`COINS.MIN_FRESH_MCAP`): the feed is asked for four
  times as many rows (the newest ones are the cheapest, so asking for twelve
  would mostly measure dust), the floor is applied to the pump.fun feed and to
  the DexScreener fallback, and the sniper's own age/market-cap gate plus the hot
  radar use the same constant. A coin whose market cap cannot be read counts as
  below the floor - the floor is a promise, and an unknown cannot keep it.
  Because launches really do start near $2.8K, an empty radar is the common
  case: the panel now says so ("Nothing above $7K yet - this batch's 9 smaller
  launches filtered out") instead of leaving a blank list that reads like a bug.
- **"Trending feed is unavailable" was mostly a lie** - the free APIs Pilly reads
  sit behind CDNs that answer 502/503 now and then. The fetch helper gave up on
  the first non-429 error, so one blip from a healthy feed turned into a flat
  "Trending feed is unavailable right now". It now retries 5xx and 408 before
  giving up, and when a read really does fail the chat falls back to the last
  good trending list - stamped with the time it was read, both in the card and in
  the text Pilly gets - for up to 30 minutes ([src/trendcache.js](src/trendcache.js)).
  Throttling (429) and "the API did not answer" now say different things, because
  they need different reactions from you. And when there is genuinely no data,
  Pilly no longer gets asked at all: a rundown written from an empty context is
  invented coins with invented numbers, which is the one thing this app must
  never do.
- **One dependency in the shipped app was out of date** - `electron-updater`
  parses `latest.yml` with `js-yaml`, and the copy that ended up inside
  `app.asar` was 4.3.1, the last release affected by GHSA-2883-xcg3-v3hh
  (`maxTotalMergeKeys` CPU exhaustion). It is now pinned to `^4.3.2` through an
  `overrides` entry, and `npm audit --omit=dev` on the production tree reports
  nothing. See [Dependencies & security](#dependencies--security) for the full
  runtime list and for the two majors that are deliberately deferred.

### v1.1.1

Pilly goes **cross-platform** and learns to keep you focused. macOS and Ubuntu
Linux are now first-class targets, and the pet gains a Pomodoro timer, an
activity diary and chat reminders.

#### Cross-platform
- **macOS** - menu bar app with a universal (Intel + Apple Silicon) build.
- **Ubuntu Linux** - tray app shipped as **AppImage** and **deb**.
- **Start at login** works on all three platforms (Linux uses an XDG autostart
  entry; Windows and macOS use native login items).
- Platform-aware window placement (above the tray on Windows, under the menu
  bar on macOS, bottom-right on Linux).

#### Focus & activity
- **Pomodoro** - start a session from the tray menu or the chat (`start focus`),
  with custom lengths (`start focus 50`, `pomodoro 25/5`). Pause and resume any
  time (`pause focus` / `resume focus`).
- **Activity diary** - Pilly records your active minutes and can report your
  day (`how was my day`) and your current day streak (`streak`).
- **Morning digest** - a once-a-day recap of yesterday's focus and activity.
- **Low battery** - Pilly looks sleepy and warns you when the battery is low.

#### Reminders
- Ask Pilly to **remind you** - "remind me in 10 minutes to check SOL" or
  "remind me at 14:30". A native notification and a Pilly bubble fire when the
  time comes.

#### Polish & fixes
- More life: a "love" mood (heart eyes) and an "eat" animation when Pilly finds
  a coin.
- **Fix: side-of-screen bubble.** When Pilly sits against the left or right edge
  of the screen, the thought bubble now appears beside it with the tail pointing
  at Pilly.
- **Fix: Linux launch.** Both the `.deb` and the `.AppImage` now start out of the
  box on Ubuntu — no manual `chown`/`chmod` of `chrome-sandbox` and no
  `--no-sandbox` flag. The deb fixes the sandbox helper's permissions at install
  time and declares `libgbm1`. The chat window also opens once at startup on
  Linux (GNOME hides tray icons unless the AppIndicator extension is installed).

### v1.1.0

Pilly is now a **living creature**, not just a pet. This release is all about
the little things that make it feel alive on your screen - more animation,
more personality, and a cleaner, more polished UI.

#### A living Pilly
- **More animation** - Pilly blinks, sways, hops and celebrates green candles,
  naps when you're away, and reacts when you poke it.
- **Better look & expression** - cleaner blinking, glossier eyes, squints and
  idle eye-darts. The little mark above its forehead now reads as a deliberate
  detail, not a glitch.
- **Fix: Pilly is never hidden behind the cloud.** When Pilly sits at the top
  of the screen, the chat bubble now flips below it, so you always see the
  whole creature.
- **Fix: smoother idle reactions** - the sway / heart animations no longer
  judder while Pilly waits.

#### Watchlist PnL summary
- The watchlist now rolls your positions into a one-glance strip: **Avg**,
  **Best**, **Worst** and how many tokens you're tracking - green when you're
  up, red when you're down.

#### Polished panels
- Every panel layout is tighter and cleaner - no broken spacing, no runaway
  windows.
- **Reset window position** - if Pilly ever lands off-screen, one click snaps
  it back (also in the tray menu).

#### Automatic updates
- Pilly now checks for new releases on startup and downloads them in the
  background - install it with one click and you're always on the latest build.
- The portable build can't self-update, so it points you straight to the
  newest installer on GitHub instead.

### v1.0.5

Pilly levels up from a chat buddy to a **proactive market companion**. Everything
in v1.0.4 is still there - live coin checks, trending and chat - and now Pilly
also watches, tracks, scores and follows the market for you.

#### Watchlist & price alerts
- Watch any coin from the chat or a coin card in one click.
- Set a **±% price alert** per coin; Pilly polls live prices and raises a native
  Windows notification the moment your level is hit.
- Persists across restarts and follows you to every panel.

#### PnL tracking
- Your **entry price** is captured automatically the moment you watch a coin.
- Live **PnL%** per position, colour-coded green / red, right in the watchlist.

#### Pilly's Scorecard
- Every proactive call - **hot radar**, **Pilly's pick**, **whale signal**,
  **sniper** - is timestamped with the price at call time.
- Picks are later **resolved win/loss** against live prices.
- Tracks **total calls, win rate, average move and best call**. A real,
  on-chain-verifiable track record, not vibes.

#### Whale Follow
- Follow whale wallets and let Pilly **diff their holdings between polls**.
- Native alert when a followed whale opens a **NEW position** - an early
  accumulation signal.

#### Radar (fresh launches)
- A live stream of brand-new Solana launches with **age, price and market cap**.
- **NEW flags** highlight coins that just came up.
- Only launches above the **$7K market-cap floor**: anything cheaper is a coin with
  no buyers yet, and the panel says how many of that batch the floor dropped
  instead of leaving a blank list.

#### Position-size calculator
- Size a trade from **price, capital, risk % and stop-loss**, with breakeven
  worked out for you.

#### Deeper settings
- **Proactive features** toggles: hot-mover alerts, alert sound, morning brief
  (SOL + your PnL), Pilly's pick, sniper, whale alerts and portfolio mood.
- **Pet & chat look**: pick a bubble style (default / light / glass / neon /
  comic / minimal), bubble text size and chat bubble style.
- **Volume control** for Pilly's sounds.

| | | |
| --- | --- | --- |
| ![Settings - API](../assets/features-settings-api.png) | ![Settings - Pet](../assets/features-settings-pet.png) | ![Settings - Chat](../assets/features-settings-chat.png) |

#### Smarter chat
- The chat now understands **"watchlist"**, **"alerts"** and **"score"** commands,
  so you can manage your list, set price alerts and check Pilly's scorecard
  without leaving the conversation.

### v1.0.4

- **Pro animations** - Pilly is a canvas renderer with smooth walking,
  step-squash and rocking, soft landings, a talking mouth, richer eyes (pupils,
  gloss, squints, idle eye-darts), a soft radial shadow and crisp rendering on
  any DPI.
- **Market reactions** - check a coin, wallet or trending and Pilly reacts:
  green = confetti + smile + bounce, red = frown + a tear. The chat avatar
  feels it too.
- **Ambient life** - day/night behavior (sleepy at night, peppy by day), dance
  notes, idle gestures (waving, yawning), weather moods, a morning greeting and
  faster naps when the mouse sits still.
- **Cursor play** - in whole-monitor mode a fast poke spooks Pilly: jump, "!",
  a short scared dash - then he calms down and stays clickable.
- **Chat mood** - Pilly senses the mood of the conversation and the chat avatar
  reacts with emoji + expressions.
- **Proactive market alerts** - every few minutes Pilly watches trending and
  calls out big pumps and dumps.
- **Sound effects** - optional WebAudio blips for hops, scares and confetti
  (toggle in settings).
- **Memory & stats** - Pilly remembers how long you've been together and shares
  little facts from its life.
- **Personalization** - rename Pilly, set a default mood, and the whole chat
  (bubbles included) follows your theme color.

## Run it

Requires **Node.js 20+**.

```bash
cd pillcrew-desktop
npm install        # also generates the tray icons
cp .env.example .env
npm start
```

### Config (`.env`)

Pilly talks to any OpenAI-compatible chat-completions API. Put one (or several
as fallbacks) in `.env`:

```
PILLY_TIER1_URL=https://...chat/completions
PILLY_TIER1_KEY=...
PILLY_TIER1_MODEL=...
PILLY_TIER2_URL=...
...
```
> **Tip:** Put any endpoint into `PILLY_TIER1_URL`, its key into `PILLY_TIER1_KEY` and
> its model into `PILLY_TIER1_MODEL` (most providers require one). Add more tiers
> as fallbacks - they are tried in order, cheapest/free first.

Tune with `PILLY_TEMPERATURE` and `PILLY_MAX_TOKENS`.

**Or set it all in the app** - click **Settings** in the chat window: 3 API slots
(URL / key / model), **Find free models**, a **Test connection** button and
temperature. Saved on disk, no file edits.

> **No secrets live in this repo.** Real keys belong in a local `.env` (which is
> git-ignored), never in the repository.

### Which API for which AI (chat-completions format)

| Provider | API URL | Key from | Notes |
|---|---|---|---|
| OpenRouter | `https://openrouter.ai/api/v1/chat/completions` | openrouter.ai → Keys | One key, many models; free models end with `:free` |
| Groq | `https://api.groq.com/openai/v1/chat/completions` | console.groq.com | Very fast, free tier, generous limits |
| Cerebras | `https://api.cerebras.ai/v1/chat/completions` | cloud.cerebras.ai | Fast inference, free tier |
| NVIDIA NIM | `https://integrate.api.nvidia.com/v1/chat/completions` | build.nvidia.com | Free credits, strong open models |
| DeepSeek | `https://api.deepseek.com/chat/completions` | platform.deepseek.com | Cheap, strong reasoning |
| Together AI | `https://api.together.xyz/v1/chat/completions` | api.together.xyz | Many open models, cheap |
| Mistral | `https://api.mistral.ai/v1/chat/completions` | console.mistral.ai | Free tier available |
| Any OpenAI-compatible | `https://…/v1/chat/completions` | - | Also local: Ollama / LM Studio on `http://localhost:11434/v1` |

Auth is `Bearer <key>`. Leave Model empty if the endpoint defaults it.

## Build from source

Requires **Node.js 20+**. Electron apps don't cross-compile - build each
platform on that platform (or on its CI runner).

```bash
cd pillcrew-desktop
npm install        # installs dependencies and generates the tray icons
npm test           # runs the test suite
```

| Platform | Command | Output in `dist/` |
|---|---|---|
| Windows | `npm run dist` | `Pilly-Setup-<version>.exe` + `Pilly-<version>-portable.exe` |
| macOS | `npm run dist:mac` | `Pilly-<version>-mac.dmg` + `Pilly-<version>-mac.zip` (universal) |
| Linux | `npm run dist:linux` | `Pilly-<version>-x86_64.AppImage` + `Pilly-<version>-amd64.deb` |

The build scripts use [electron-builder](https://www.electron.build/), which
downloads the matching Electron binaries automatically.

## Install

- **Windows** - run `Pilly-Setup-<version>.exe`, or use the portable `.exe`
  with no installation.
- **macOS** - open the `.dmg` and drag Pilly into **Applications**. The build
  is unsigned, so the first launch shows a Gatekeeper prompt: right-click the
  app and choose **Open**, then confirm. Because the bundle isn't signed with a
  Developer ID, auto-update is off on macOS - Pilly detects that and points you
  at Releases instead of failing quietly. The build is already configured for
  notarisation (hardened runtime + entitlements + `LSMinimumSystemVersion`
  10.15), so signing it later needs nothing but credentials - see
  [Signing and notarising the macOS build](#signing-and-notarising-the-macos-build).
  One macOS note: **Start at login** is a macOS login item, so it appears (and can
  be switched off) in **System Settings → General → Login Items** - add Pilly
  there by hand if the system didn't pick it up.
- **Linux** - either run the AppImage:
  ```bash
  chmod +x Pilly-<version>-x86_64.AppImage
  ./Pilly-<version>-x86_64.AppImage
  ```
  or install the package with `sudo apt install ./Pilly-<version>-amd64.deb`
  and launch it from the application menu (or run `pilly-desktop`). Neither
  format needs any manual `chown`/`chmod` or `--no-sandbox` step.

  AppImages need FUSE, which Ubuntu no longer ships by default. If the AppImage
  won't start, install it once: `sudo apt install libfuse2` (or run
  `./Pilly-<version>-x86_64.AppImage --appimage-extract-and-run`).

### Signing and notarising the macOS build

The released DMG is unsigned, so Gatekeeper quarantines it. Everything that can
be prepared without credentials is already in place: hardened runtime, the
JIT / unsigned-memory / dyld / network entitlements in
[build/entitlements.mac.plist](build/entitlements.mac.plist), and
`LSMinimumSystemVersion` 10.15. To produce a build that opens on a double-click
and can use auto-update, you need a **Developer ID Application** certificate in
your login keychain and an Apple ID with an app-specific password:

```bash
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="abcd-efgh-ijkl-mnop"
export APPLE_TEAM_ID="ABCDE12345"
npm run dist:mac
```

With those variables set, electron-builder signs with the Developer ID and
uploads the app to Apple's notary service, then staples the ticket. Add
`"notarize": true` to `build.mac` in `package.json` if you also want the
behaviour to be explicit rather than inferred from the environment. Verify a
finished build before shipping it:

```bash
codesign -dv --verbose=4 "dist/mac-universal/Pilly.app"
spctl -a -vvv -t install "dist/mac-universal/Pilly.app"
xcrun stapler validate "dist/mac-universal/Pilly.app"
```

For an unsigned build, the terminal equivalent of the right-click-Open dance is:

```bash
xattr -dr com.apple.quarantine /Applications/Pilly.app
```

## Tests

```bash
npm test             # unit tests for the pure modules in src/
npm run verify:anim  # the animation suite: boots the real renderer in Electron
npm run verify:boot  # boots the real app and drives the shipped UI
```

`npm test` covers the logic that has no UI: focus, reminders, activity, PnL,
settings, portfolio, whale, the RPC health classifier, the macOS app menu
template, the fresh-launch floor (`MIN_FRESH_MCAP`), the trending last-good
fallback (`src/trendcache.js`) and the rest. It is fast and needs nothing but
Node.

`verify:anim` loads `renderer/pet.html` unmodified except for a small bridge that
exposes the animation internals, then asserts 131 facts about them - every idle
gesture (including the coin flip), the breathing lift, the blink curve, the
day-part weights, the look-ahead gaze blend, the landing wobble, the focus ring
geometry, the reminder glyph, the petting / tap / drop interactions and the
reduce-motion rules, plus the details that only exist so nothing is left unsaid: a
fired reminder being escaped into the chat, a bare focus tick staying silent, a
tray-started session being narrated, and the stink clouds stopping when the poop
window fades. The touch checks run as pairs on one clock (one petted pet, one
not) and compare the frames, so a claim about the lean or the purr is a
measurement rather than a pixel count. It is the regression net for anything that
moves, and it writes nothing outside a temporary directory.

`verify:boot` is the end-to-end pass: it imports the real `main.js` and then
behaves like a user - clicking the pet button, dragging him, pressing Save in
Settings, taking the app's focus away and back, changing displays, starting a
focus session, clicking the tray's own **Focus → Start focus**, switching Pilly
off to watch a due reminder land in the chat, and letting a reminder come due.
Every mode needs an isolated profile so it can never touch your real Pilly
settings - the harness refuses to start without one:

```bash
npm run verify:boot -- --click-pet --user-data-dir=/tmp/pilly-check
```

Modes: `--park-pet`, `--expect-parked`, `--click-pet`, `--click-save` and
`--focus-nudge` (the focus ring and the reminder hop). On Windows,
`scripts\run-boot-seq.ps1` runs all eight boots in the right order on throwaway
profiles; the eight add up to 279 checks, and each boot has to report its own
check count, so a mode that quietly did nothing fails instead of passing. The
default flow also checks the two things the API-client fixes promised: the hot
radar reports the fresh-launch floor it applied and never lists a row below it,
and the greeting needs a return (a bare focus does not greet, coming back does,
and a second return inside the cooldown does not). Every
boot also re-checks the macOS application menu template - roles, menu titles, the
absence of Reload/DevTools - because macOS is the one platform the gate cannot
boot, and Electron makes a mistyped role fail *silently* there. The
last boot points `PILLY_RPC_URL` at a dead port on purpose: a healthy endpoint
would make the "loud when the RPC is broken" half of the tray rule impossible to
exercise, and a closed port answers instantly instead of depending on the
machine being offline.

## Troubleshooting

**Linux: the AppImage does nothing when I run it.** AppImages need FUSE, which
Ubuntu doesn't install by default. Run `sudo apt install libfuse2` once, then
try again. If you can't install packages, run
`./Pilly-<version>-x86_64.AppImage --appimage-extract-and-run`.

**Linux: the deb installed but Pilly won't open.** Run it from a terminal to see
the error: `pilly-desktop`. If you see `error while loading shared libraries`,
install the missing package (the deb declares `libgbm1`). The installer already
sets the correct permissions on `chrome-sandbox`, so launching needs no manual
`chown`/`chmod`.

**Linux: no tray icon.** GNOME hides tray icons unless the **AppIndicator**
extension is installed. Pilly opens its chat window once at launch so it's
still reachable, and `Ctrl+Alt+P` toggles it any time.

**The chat window froze or stopped responding.**

1. **Close it** – right-click the tray icon → **Quit Pilly**. If the window is
   really stuck (can't click anything), end it from the taskbar: `Ctrl+Shift+Esc`
   → find **Pilly / electron.exe** → *End task*.
2. **Open it again** – the chat history, watchlist, PnL and settings are all
   saved on disk, so nothing is lost. Click the tray icon to reopen.
3. **Still freezing?** – it's almost always the free AI endpoint being slow or
   rate-limited (the coin/watchlist data is local and fast). Give it a few
   seconds – Pilly retries and falls back to a local read for coins. You can
   also lower the load: close the **radar** panel (it refreshes every 60 s)
   and the **watchlist** panel.

**The window closed but the app still runs.** That's normal – closing the chat
only hides it (Pilly stays in the tray). Reopen with the tray icon or the
`Ctrl+Alt+P` hotkey. If it truly died, right-click the tray icon → Quit, then
start Pilly again.

**Pilly is "gone" (no tray icon).** Restart the app. If it won't start at all,
check that a previous instance isn't holding it: `Ctrl+Shift+Esc` → end all
`electron.exe` processes, then start Pilly again.

**Coin paste shows "no data".** The free market APIs are throttled sometimes –
retry in a few seconds. Pilly pulls from 4 sources (pump.fun, DexScreener,
Jupiter, GeckoTerminal) with automatic retries, so a temporary 429 usually
clears itself.

**Worst case / factory reset.** Quit Pilly, then delete these files in
`%APPDATA%\pilly-desktop\` (or the productName folder) to reset only that part:
- `pilly-settings.json` – API settings & preferences
- `pilly-watchlist.json` – watched coins
- `pilly-pnl.json` – entry prices (PnL)
- `pilly-window.json` – window position
- `pilly-stats.json` – Pilly's memory/stats

Deleting all of them gives you a fresh install-like state.

## How it's built

```
pillcrew-desktop/
├── main.js            # Electron: tray, window, hotkey, IPC
├── preload.js         # safe bridge to the renderer
├── src/
│   ├── ai.js          # free AI chain + short-reply clamp
│   ├── pilly.js       # Pilly's persona + meme task briefs
│   ├── meme.js        # client-side request-type detection
│   ├── coins.js       # live Solana coin data
│   ├── picks.js       # coin pick scoring
│   ├── pnl.js         # entry-price / PnL tracking
│   ├── settings.js    # persisted preferences
│   ├── watchlist.js   # watchlist + price alerts
│   ├── whales.js      # whale-wallet following
│   ├── focus.js       # Pomodoro state machine
│   ├── activity.js    # per-minute activity diary
│   ├── rpc.js         # Solana RPC health (tray indicator)
│   └── reminders.js   # one-shot chat reminders
├── renderer/          # chat window (animated pill, bubbles, chips)
├── scripts/           # gen-icon, shipped-deps, verify-anim, verify-boot
├── assets/            # generated pill PNGs
└── .env.example
```

## Dependencies & security

Pilly has exactly **one** runtime dependency: `electron-updater`. Everything else
in `package.json` is a devDependency - Electron itself, which the app is built
on, and electron-builder, which produces the installers. The packaged app
therefore ships sixteen npm packages: `electron-updater` plus its transitive tree.

```bash
npm ci
npm audit --omit=dev         # found 0 vulnerabilities
node scripts/shipped-deps.js # what is actually inside app.asar
```

`npm ls` describes the source tree; [scripts/shipped-deps.js](scripts/shipped-deps.js)
reads the header of `app.asar` and prints what someone who downloads Pilly
really gets, which is the list a dependency advisory applies to. The first entry
is Pilly's own `package.json`, so the count below is one higher than the number
of packages:

```
dist\win-unpacked\resources\app.asar

pilly-desktop@1.1.2
argparse@2.0.1                    argparse
debug@4.4.3                       debug
electron-updater@6.8.9            electron-updater
builder-util-runtime@9.7.0        electron-updater/node_modules/builder-util-runtime
fs-extra@10.1.0                   electron-updater/node_modules/fs-extra
jsonfile@6.2.1                    electron-updater/node_modules/jsonfile
semver@7.7.4                      electron-updater/node_modules/semver
universalify@2.0.1                electron-updater/node_modules/universalify
graceful-fs@4.2.11                graceful-fs
js-yaml@4.3.2                     js-yaml
lazy-val@1.0.5                    lazy-val
lodash.escaperegexp@4.1.2         lodash.escaperegexp
lodash.isequal@4.5.0              lodash.isequal
ms@2.1.3                          ms
sax@1.6.1                         sax
tiny-typed-emitter@2.1.0          tiny-typed-emitter

17 packages
```

`js-yaml` is pinned to `^4.3.2` through an `overrides` entry, and that pin is the
reason this section exists. It is not a direct dependency: `electron-updater` uses
it to parse the `latest.yml` that the update feed serves, so the copy inside
`app.asar` is the copy that runs in front of a user. 4.3.1 was the last release
affected by GHSA-2883-xcg3-v3hh (`maxTotalMergeKeys` CPU exhaustion) and 4.3.2
fixes it. Both consumers ask for `^4.1.0`, so the override stays inside the same
major and npm installs a single hoisted copy.

Two things are deliberately **not** done in this release, and both are the kind
of thing a plain `npm audit` will still mention:

- An audit *without* `--omit=dev` also reports electron-builder's toolchain -
  `tar`, `node-gyp`, `cacache`, `make-fetch-happen` and friends. None of it is
  packaged: it runs on the machine that builds Pilly, never on the machine that
  runs it. Clearing those means moving to electron-builder 26, a major with a
  changed configuration surface, and the Linux AppImage it produces cannot be
  built or smoke-tested on Windows.
- Electron is on 31.7.7. The current major carries fixes for the ASAR integrity
  bypass (resource modification, and it needs write access to the install first),
  an AppleScript injection in `app.moveToApplicationsFolder` (which Pilly never
  calls) and an `extract-zip` symlink traversal that is not on any code path here.
  A major jump would also strand macOS users: Electron 44 requires **macOS 13
  (Ventura) or later**, while Pilly runs on 10.15 and up today
  (`build.mac.extendInfo.LSMinimumSystemVersion`, which matches what Electron 31
  and its Chromium actually support). That trade belongs in its own change with a
  full Windows + macOS + Linux pass, not in a release about pet animations.

Saying `npm audit --omit=dev` is clean is a claim about the npm tree that ships,
not about the Electron runtime; the runtime version is above, on its own line.

## Releases & auto-update

Pushing a `v*` tag triggers the
[`build-pilly-desktop`](../.github/workflows/build-pilly-desktop.yml) workflow,
which runs the test suite and builds installers for all three platforms:

- **Windows** - `Pilly-Setup-<version>.exe` + `Pilly-<version>-portable.exe`
- **macOS** - `Pilly-<version>-mac.dmg` + `Pilly-<version>-mac.zip` (universal)
- **Linux** - `Pilly-<version>-x86_64.AppImage` + `Pilly-<version>-amd64.deb`

The release assets (including `latest.yml`) are attached to the GitHub Release,
so Pilly's installed Windows build detects the new version and updates itself.
The portable build can't self-update - it links to the releases page instead.

## Disclaimer

Pilly is a fun tool for entertainment and education. It is **not financial advice (NFA)** - always do your own research.

---

MIT © PillCrew
