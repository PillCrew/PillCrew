const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const assert = require('assert/strict');
const { pathToFileURL } = require('url');
const { Engine, DEFAULTS } = require('../src/engine');
const { trustedSender } = require('../src/ipcguard');
const Share = require('../src/share');

// RULE ADDED 2026-11-06 (1.1.1): the profile this test opens lives under one scratch root and is removed when the test
// exits. Electron writes a whole Chromium profile per run, and a harness that leaves it behind fills the temp folder.
// Every scratch directory this test makes lives under one root that is removed on exit, and roots left by an earlier
// run are swept (see `test/scratch.js`).
const scratchDir = require('./scratch').root;
app.setPath('userData', path.join(scratchDir, 'profile'));
const timer = setTimeout(() => { console.error('UI test timed out'); app.exit(1); }, 20000);
app.whenReady().then(async () => {
  const entry = path.join(__dirname, '..', 'renderer', 'index.html');
  const win = new BrowserWindow({ show: false, width: 1320, height: 860, webPreferences: {
    preload: path.join(__dirname, '..', 'preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false,
  } });
  const settings = { ...DEFAULTS, onboarded: true, bumpMint: 'So11111111111111111111111111111111111111112' };
  const store = { get: () => settings, set: (patch) => Object.assign(settings, patch) };
  const wallet = { exists: () => false, address: () => null, isUnlocked: () => false };
  const engine = new Engine(wallet, store);
  const calls = { autopilotArgs: 'never called', botStart: 0 };
  // The mascot's whole configuration, in the settings' own names — what `pet:state` really answers with.
  const PET_SETTINGS_STUB = {
    petName: 'Pilly', petTheme: 'ball', petSize: 'md', petSpeed: 'normal', petWalkMode: 'screen', petStopFreq: 'normal',
    petMood: 'neutral', petBubbles: true, petBubbleSize: 'md', petBubbleText: 'md', petBubbleStyle: 'default',
    petSounds: true, petSoundVol: 60, petQuestions: true, petReduceMotion: false, petHotAlerts: true, petHotPct: 10,
    petAlertSound: true, petDailyBrief: true, petPillyPick: true, petSniper: true, petWhaleAlerts: true,
    petPortfolioMood: true, petPos: null,
  };
  // What the bump desk would report with three wallets and one bag open: enough for the panel to have to draw numbers.
  const bumpFixture = () => ({
    running: false, paused: false, simulate: false, mint: 'So11111111111111111111111111111111111111112', short: 'So11…1112',
    addresses: ['A', 'B', 'C'], unlocked: true, inPlaySol: 0.006,
    // RULE ADDED 2026-11-11 (1.1.5): the panel is told both numbers (what the slider asks for, what the pool holds) and what
    // the Jito switch is doing, because the owner read "3 typed, 2 created" off this panel and had no way to tell why.
    pool: { asked: 3, have: 2 },
    jito: { on: true, tipSol: 0.00001, broken: false, misses: 0, bundles: 4 },
    vault: { exists: true, address: 'Vau1tAddreSS111111111111111111111111111111', balanceSol: 0.02 },
    wallets: [
      { address: 'A', short: 'A…1', balanceSol: 0.09, budgetSol: 0.1, spentSol: 0.01, holdingSol: 0.006, bumps: 2, stuck: false, sellsIn: 12 },
      { address: 'B', short: 'B…2', balanceSol: 0.1, budgetSol: 0.1, spentSol: 0, holdingSol: 0, bumps: 0, stuck: false, sellsIn: null },
      { address: 'C', short: 'C…3', balanceSol: 0.1, budgetSol: 0.1, spentSol: 0, holdingSol: 0, bumps: 0, stuck: true, sellsIn: null },
    ],
    stats: { bumps: 2, buys: 2, sells: 0, errors: 1, spentSol: 0.01, feesSol: 0.0006, volumeSol: 0.01, buySharePct: 100, rate: 18, startedAt: Date.now(), endsAt: null },
    estimate: require('../src/bump').estimate(settings),
    lastLine: 'Buy 0.0060 SOL of So11…1112 from A…1.',
  });
  for (const [name, handler] of Object.entries({
    'settings:get': () => settings,
    // The rest of the app talks to the store through this channel; the bump form uses it too, so the test registers it.
    'settings:set': (patch) => { if (patch && 'aiBubble' in patch) calls.chatLook = patch; return Object.assign(settings, patch); },
    'wallet:status': () => ({ exists: false, unlocked: false, address: null }),
    'settings:share': () => ({ code: Share.encode(settings), text: Share.describe(settings) }),
    // RULE ADDED 2026-11-05 (1.0.4): a settings button must never start trading.
    // The button must write settings and nothing else, so both channels are recorded and checked below.
    'settings:autopilot': (...args) => { calls.autopilotArgs = args; return settings; },
    'bot:start': () => { calls.botStart += 1; return { ok: true }; },
    // The connection doctor, answered from a fixture so the UI test never dials anything.
    'diag:check': () => ({
      rows: [
        { ok: true, label: 'Main node', ms: 120, detail: 'Answered in 120 ms (solana-core 2.1.0).' },
        { ok: false, label: 'Your socket', ms: 90, detail: 'Refused without a key. Copy the socket URL together with the key your provider gives for it.' },
      ],
      notes: ['No private socket or Geyser endpoint: the feed will read public nodes.'],
    }),
    // RULE ADDED 2026-11-08 (1.1.2): the bump desk's channels, answered from the real module so the tab is drawn with
    // the same numbers the app would use - and so a missing channel is a failed test, not a blank panel.
    'bump:state': () => bumpFixture(),
    'bump:estimate': () => require('../src/bump').estimate(settings),
    'bump:create': (...args) => { calls.bumpCreate = args; return { addresses: [], created: 0 }; },
    'bump:unlock': () => ({ unlocked: 0 }),
    'bump:lock': () => ({ unlocked: 0 }),
    'bump:forget': () => ({ removed: true }),
    'bump:fund': () => ({ funded: 0, sol: 0 }),
    'bump:start': () => ({ ok: true }),
    'bump:pause': () => ({ ok: true }),
    'bump:resume': () => ({ ok: true }),
    'bump:stop': () => ({ ok: true, bumps: 0, soldBack: 0 }),
    'bump:sweep': () => ({ returnedSol: 0, closed: 0 }),
    'bump:vault': () => ({ address: 'Vau1tAddreSS111111111111111111111111111111' }),
    'bump:deposit': (amount) => ({ sol: amount, address: 'Vau1tAddreSS111111111111111111111111111111' }),
    'bump:fit': () => require('../src/bump').fitPlan(settings),
    // THE COUNCIL (1.2.0): answered from a stub, because a UI test must never ask a real AI endpoint (it would cost the
    // owner money and depend on the internet). The shape is the module's own.
    'ai:ask': (messages, opts) => {
      calls.aiMessages = messages;
      if (opts && opts.task) calls.aiChipTask = opts.task;
      return { verdict: 'ok', reason: 'the read is fine - liquidity is the number that decides it', by: 'DeepSeek', tiers: 1, answers: [{ label: 'DeepSeek', ok: true, text: 'the read is fine', ms: 42 }] };
    },
    'ai:test': () => ({ ok: true, ms: 42, text: 'ready', label: 'DeepSeek' }),
    // The chip data and the chip task: answered from memory, so a chip press is proven end to end without a network call.
    'window:reset': () => ({ ok: true }),
    'ai:models': (tier) => ({ ok: true, models: [{ id: 'deepseek/deepseek-chat:free', free: true, context: 64000 }, { id: 'meta/llama:free', free: true, context: 32000 }], free: ['deepseek/deepseek-chat:free', 'meta/llama:free'], best: 'deepseek/deepseek-chat:free' }),
    'ai:context': (kind) => { calls.aiChipContext = kind; return { question: `What is moving right now? (${kind})`, context: `LIVE COIN ROWS for ${kind}: - BUMP: 5m +34%, mcap $120.0K, buyers 44` }; },
    // PILLY ON SCREEN (1.2.0): the pet is a real window, and a UI test must never open one. The state is answered from a
    // flag, so pressing the button is still proven end to end (button → IPC → state → the sentence on the panel).
    'pet:state': () => ({ on: Boolean(calls.petOn), pos: null, pet: { ...PET_SETTINGS_STUB } }),
    'pet:toggle': () => { calls.petOn = !calls.petOn; return { ok: true, on: calls.petOn }; },
    'pet:apply': (patch) => { calls.petPatch = patch; return { ok: true, pet: { ...PET_SETTINGS_STUB, ...patch } }; },
    // THE WATCHLIST AND HIS SCORECARD (1.2.0): file-backed in the real app, answered from memory here.
    'watch:list': () => [
      { mint: 'GxWqJbWPxMseev7WXYNPLEG8K59v2fAhJ5m5o7Yepump', symbol: 'PILLCREW', alertPct: 15, addedAt: 1 },
    ],
    'watch:add': (mint, symbol, name) => { calls.watchAdded = { mint, symbol, name }; return []; },
    'watch:remove': () => [],
    'watch:alert': () => [],
    'picks:stats': () => ({
      stats: { total: 3, open: 1, wins: 1, losses: 1, flat: 0, winRate: 50, avgPct: 4.2, best: { symbol: 'MOPS', mint: 'M', pct: 31 } },
      picks: [
        { mint: 'M', symbol: 'MOPS', source: 'hot', ts: 1700000000000, pct: 31, result: 'win' },
        { mint: 'N', symbol: 'RUG', source: 'launch', ts: 1700000000000, pct: -18, result: 'loss' },
        { mint: 'O', symbol: 'OPEN', source: 'pick', ts: 1700000000000, pct: null, result: null },
      ],
    }),
  })) {
    ipcMain.handle(name, (event, ...args) => {
      assert.ok(trustedSender(event, win, entry), 'real preload IPC passes the main-frame check');
      return { ok: true, data: handler(...args) };
    });
  }
  const errors = [];
  win.webContents.on('console-message', (event) => { if (event.level === 'error') errors.push(event.message); });
  win.webContents.on('render-process-gone', (_event, details) => errors.push(details.reason));
  try { await win.loadURL(pathToFileURL(entry).href); } catch (err) {
    console.error('Renderer diagnostics:', { url: win.webContents.getURL(), loading: win.webContents.isLoading(), errors });
    throw err;
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
  engine.once('state', (state) => win.webContents.send('state', state));
  engine._emitState();
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.deepEqual(errors, [], 'the page loads with no console errors of its own');
  assert.equal(await win.webContents.executeJavaScript('document.querySelector("#startBtn").disabled'), false);
  await win.webContents.executeJavaScript('document.querySelector("#nav [data-tab=settings]").click()');
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.ok(await win.webContents.executeJavaScript('document.querySelector("#tab-settings").classList.contains("active")'));
  // One press of Best Profit writes the preset and stops there: no arguments on the channel that could ask for a start,
  // no call to the start channel at all, and the button says what it does.
  assert.ok(await win.webContents.executeJavaScript('document.querySelector("#autopilotBtn span").textContent.includes("Apply")'),
    'the button promises to apply settings, not to start a scan');
  await win.webContents.executeJavaScript('document.querySelector("#autopilotBtn").click()');
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.deepEqual(calls.autopilotArgs, [], 'the preset channel is called with no start request');
  assert.equal(calls.botStart, 0, 'pressing Best Profit never starts the bot');
  assert.ok(await win.webContents.executeJavaScript('(document.querySelector("#autopilotMsg").textContent || "").includes("Press Start")'),
    'and the message says the run has to be started by hand');
  // RULE ADDED 2026-11-06 (1.0.9): the "Test my connection" button must reach the doctor and draw its answer, and it
  // must show the failing door in words rather than a silent blank.
  assert.ok(await win.webContents.executeJavaScript('Boolean(document.querySelector("#diagBtn"))'), 'the doctor has a button');
  await win.webContents.executeJavaScript('document.querySelector("#diagBtn").click()');
  await new Promise((resolve) => setTimeout(resolve, 400));
  const diagText = await win.webContents.executeJavaScript('document.querySelector("#diagOut").textContent');
  assert.ok(/Main node/.test(diagText), 'the answer names each door: ' + diagText);
  assert.ok(/✕/.test(diagText), 'and a refused door is marked');

  // RULE ADDED 2026-11-08 (1.1.2): the bump desk has to be a working panel, not a tab that opens on nothing. The tab
  // draws the wallets the desk reports, the cost model, the six live figures, and its own warning - and a number typed
  // into it has to reach the settings channel.
  await win.webContents.executeJavaScript('document.querySelector("#nav [data-tab=bump]").click()');
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.ok(await win.webContents.executeJavaScript('document.querySelector("#tab-bump").classList.contains("active")'), 'the bump tab opens');
  assert.strictEqual(await win.webContents.executeJavaScript('document.querySelectorAll("#bumpWallets .rec-row").length'), 3, 'one row per wallet');
  assert.strictEqual(await win.webContents.executeJavaScript('document.querySelectorAll("#bumpStats .stat").length'), 6, 'six live figures');
  assert.ok(await win.webContents.executeJavaScript('document.querySelectorAll("#bumpEstimate .rec-row").length') >= 4, 'the cost model is on the panel');
  assert.ok(await win.webContents.executeJavaScript('document.querySelectorAll("#bumpForm input[data-key]").length') >= 11, 'every setting has a field');
  // RULE CHANGED 2026-11-08 (1.1.2): "Wallets per bundle" implied several wallets share a block, which nothing in the desk
  // does - a bundle is one wallet's trade plus its tip. The field is gone and Jito is a plain switch.
  assert.strictEqual(await win.webContents.executeJavaScript('document.querySelectorAll("[data-key=bumpJitoBundle]").length'), 0, 'no field implies several wallets in one bundle');
  assert.strictEqual(await win.webContents.executeJavaScript('document.querySelectorAll("input[data-key=bumpUseJito]").length'), 1, 'Jito is a switch on the panel');
  // RULE CHANGED 2026-11-11 (1.1.5): Jito is ON by default again. A bundle is now a first try - offered a few times, then
  // the same signed trade goes out the normal way - so having it on can never cost a bump, and the owner's own complaint
  // ("TO POWINNO z jito zapierdalac") stops being a guess: the line under the plan says whether it is on, what the tip is,
  // and whether it was stood down.
  assert.strictEqual(await win.webContents.executeJavaScript('document.querySelector("input[data-key=bumpUseJito]").checked'), true, 'Jito is on by default');
  assert.ok(await win.webContents.executeJavaScript('document.querySelector("#bumpJito").textContent.includes("Jito: on")'), 'and the panel says so: ' + await win.webContents.executeJavaScript('document.querySelector("#bumpJito").textContent'));
  assert.ok(await win.webContents.executeJavaScript('document.querySelector("#bumpJito").textContent.includes("only ever paid by a bundle that lands")'), 'including when the tip is paid');
  assert.ok(await win.webContents.executeJavaScript('document.querySelector("#bumpWarn").textContent.includes("3.5%")'), 'the real cost is stated in the panel, not hidden behind a price list');
  assert.strictEqual(await win.webContents.executeJavaScript('document.querySelector("#bumpMint").value'), 'So11111111111111111111111111111111111111112', 'the saved token is in the field');
  // A number typed into the form goes to the settings channel (through the same IPC the rest of the app uses).
  settings.bumpMint = '';
  await win.webContents.executeJavaScript('(() => { const el = document.querySelector("#bumpMint"); el.value = "BPFLoaderUpgradeab1e11111111111111111111111"; el.dispatchEvent(new Event("change", { bubbles: true })); })()');
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.strictEqual(settings.bumpMint, 'BPFLoaderUpgradeab1e11111111111111111111111', 'the address reaches the store: ' + settings.bumpMint);

  // RULE ADDED 2026-11-08 (1.1.2): the three sliders, the plan they produce, and the honest refusal when they do not add
  // up. This is the panel: how much SOL, how long, how fast - and the ticket worked out from that.
  // RULE CHANGED 2026-11-08 (1.1.2): a fourth slider arrived - how many buys one round makes before its single sell.
  assert.strictEqual(await win.webContents.executeJavaScript('document.querySelectorAll("#bumpSliders input[type=range]").length'), 4, 'four sliders');
  assert.ok(await win.webContents.executeJavaScript('document.querySelector("#bumpSliders").textContent.includes("Buys in one round")'), 'the round size is a slider of its own');
  assert.strictEqual(await win.webContents.executeJavaScript('Boolean(document.querySelector("input[data-key=bumpBuysRandom]"))'), true, 'and every round can draw its own count');
  assert.strictEqual(await win.webContents.executeJavaScript('Boolean(document.querySelector("input[data-key=bumpBuyRatio]"))'), false, 'the old buy-share knob is gone: the round decides the share');
  // RULE ADDED 2026-11-09 (1.1.3): the rescue sentence on the panel is the same truth as the one in the diary - a bag it
  // tried to sell and could not is named as still there, never as "nothing held".
  const appSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
  assert.ok(appSrc.includes('the bag is still there, nothing was sold'), 'the rescue toast can say the bag is still there');
  assert.ok(!/r\.sold \? 'bag sold' : 'nothing held'/.test(appSrc), 'and no longer calls a failed sell "nothing held"');
  assert.ok(appSrc.includes('put back for its fee'), 'and it names the fee float when one was needed');
  // RULE ADDED 2026-11-10 (1.1.4): Delete keys recovers before it deletes, and the panel carries the two-step answer: the
  // recovery summary, and a second confirmation that names what would be abandoned when something cannot be moved.
  assert.ok(appSrc.includes('DELETE_NEEDS_FORCE'), 'the delete knows when it must ask a second time');
  assert.ok(/Every bag is sold and every lamport is brought home first/.test(appSrc) === false, 'that sentence comes from the desk, not the panel');
  assert.ok(appSrc.includes('deleteLine'), 'and it reports what it recovered');
  assert.ok(appSrc.includes('the chain could not be asked what it holds'), 'the rescue toast can say the chain did not answer');
  assert.ok(await win.webContents.executeJavaScript('document.querySelector("#bumpSliders").textContent.includes("How much SOL")'), 'the first one asks how much SOL');
  assert.ok(await win.webContents.executeJavaScript('Boolean(document.querySelector("#bumpPlan .plan-line"))'), 'the plan is spelled out');
  assert.ok(await win.webContents.executeJavaScript('document.querySelector("#bumpPlan").textContent.includes("rent parked")'), 'including the rent it parks');
  assert.strictEqual(await win.webContents.executeJavaScript('document.querySelector("#bumpVaultAddr").value'), 'Vau1tAddreSS111111111111111111111111111111', 'the one desk address is on the panel');
  assert.ok(await win.webContents.executeJavaScript('document.querySelector("#bumpVaultNote").textContent.includes("SOL in it")'), 'with its balance');
  // RULE ADDED 2026-11-11 (1.1.5): the pool size is a number IN THE BOX, and it must reach the store. The owner typed 3 and
  // the desk went on saying 2 because nothing listened to that box at all - only the range beside it.
  assert.ok(await win.webContents.executeJavaScript('document.querySelector("#bumpWalletNote").textContent.includes("you asked for 3")'), 'the wallet line names the gap between the slider and the pool: ' + await win.webContents.executeJavaScript('document.querySelector("#bumpWalletNote").textContent'));
  assert.ok(await win.webContents.executeJavaScript('document.querySelector("#bumpWalletNote").textContent.includes("press Create wallets to add 1 more")'), 'and says which button closes it');
  await win.webContents.executeJavaScript('(() => { const el = document.querySelector("#bumpSliders input[data-key=bumpWallets]"); el.value = "5"; el.dispatchEvent(new Event("change", { bubbles: true })); })()');
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.strictEqual(settings.bumpWallets, 5, 'a number typed into the pool-size box reaches the store: ' + settings.bumpWallets);
  // Now a small budget: 0.02 SOL over three hours at twenty a minute. It does not fit, so the panel must say so
  // and offer the fitter - this is the case that would otherwise look like a broken bot.
  Object.assign(settings, { bumpBudgetSol: 0.02, bumpMinutes: 180, bumpPerMinute: 20, bumpAutoAmount: true });
  await win.webContents.executeJavaScript('document.querySelector("#nav [data-tab=dashboard]").click()');
  await win.webContents.executeJavaScript('document.querySelector("#nav [data-tab=bump]").click()');
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.ok(await win.webContents.executeJavaScript('document.querySelector("#bumpPlan").classList.contains("bad")'), 'a plan the money cannot pay is marked');
  const planText = await win.webContents.executeJavaScript('document.querySelector("#bumpPlan").textContent');
  assert.ok(/minutes at 20\/min/.test(planText), 'and says what it can do instead: ' + planText.slice(0, 200));
  assert.ok(await win.webContents.executeJavaScript('[...document.querySelectorAll("#bumpPlan button")].some((b) => /Fit it/.test(b.textContent))'), 'the fitter has a button');
  await win.webContents.executeJavaScript('[...document.querySelectorAll("#bumpPlan button")].find((b) => /Fit it/.test(b.textContent)).click()');
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.ok(settings.bumpPerMinute < 20 && settings.bumpMinutes === 180, 'pressing it keeps the three hours and lowers the pace: ' + settings.bumpPerMinute);

  // ── THE COUNCIL (1.2.0): the chat tab offers its endpoints, takes a key, and shows the council's answer ──
  await win.webContents.executeJavaScript('document.querySelector("#nav [data-tab=chat]").click()');
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.ok(await win.webContents.executeJavaScript('document.querySelector("#tab-chat").classList.contains("active")'), 'the chat tab opens');
  assert.ok(await win.webContents.executeJavaScript('document.querySelectorAll("#chatTiers .chat-tier").length') >= 3, 'three endpoints are offered out of the box');
  assert.strictEqual(await win.webContents.executeJavaScript('document.querySelectorAll("#chatTiers input[type=password]").length'), 3, 'each endpoint has a key field, masked in the panel');
  assert.ok(await win.webContents.executeJavaScript('document.querySelector("#chatTierNote").textContent.includes("no endpoint set")'), 'the panel says there is no usable endpoint yet');
  // Paste a key into the first tier: the change handler saves it, exactly as a person typing would.
  await win.webContents.executeJavaScript('(() => { const el = document.querySelector("#chatTiers input[type=password]"); el.value = "sk-test-key-abcdef"; el.dispatchEvent(new Event("change", { bubbles: true })); })()');
  await new Promise((resolve) => setTimeout(resolve, 700));
  const tierNote = await win.webContents.executeJavaScript('document.querySelector("#chatTierNote").textContent');
  assert.ok(!tierNote.includes('no endpoint set'), 'once a key is in, an endpoint is ready: ' + tierNote);
  // Ask: the question goes in, the council's sentence comes back.
  await win.webContents.executeJavaScript('(() => { document.querySelector("#chatInput").value = "would you buy this coin?"; document.querySelector("#chatSend").click(); })()');
  await new Promise((resolve) => setTimeout(resolve, 900));
  const chatText = await win.webContents.executeJavaScript('document.querySelector("#chatLog").textContent');
  assert.ok(chatText.includes('would you buy this coin?'), 'the question is in the log: ' + chatText.slice(0, 100));
  assert.ok(chatText.includes('the read is fine'), 'and the council answered: ' + chatText.slice(-160));
  assert.ok(!chatText.includes('sk-test-key-abcdef'), 'the key is never printed in the panel');
  assert.ok(Array.isArray(calls.aiMessages) && calls.aiMessages[0].role === 'user', 'only the question was sent: ' + JSON.stringify(calls.aiMessages));
  assert.ok(await win.webContents.executeJavaScript('Boolean(document.querySelector("#chatSystem"))'), 'the system prompt is editable');
  // ── THE CHAT'S EXTRAS (1.2.0): 13 quick actions, five bubble styles, three text sizes, the language lock and always-on-top ──
  assert.strictEqual(await win.webContents.executeJavaScript('document.querySelectorAll("#chatChips .chip").length'), 13, 'every quick action Pilly Desktop had is on the panel');
  assert.strictEqual(await win.webContents.executeJavaScript('document.querySelector("#chatBubbleStyle").offsetParent !== null && document.querySelector("#chatSaveLook").offsetParent !== null'), true, 'the look controls are visible on the chat tab, not hidden in another one');
  // "Find free models": the button asks the main process, the list is drawn ON the panel, and the best one lands in the Model box.
  const findBtnSel = '#chatTiers button.find-models';
  assert.ok(await win.webContents.executeJavaScript(`Boolean(document.querySelector('${findBtnSel}'))`), 'each endpoint has the find-free-models button');
  await win.webContents.executeJavaScript(`document.querySelector('${findBtnSel}').click()`);
  await new Promise((resolve) => setTimeout(resolve, 900));
  const freeList = await win.webContents.executeJavaScript(`(() => { const sel = document.querySelectorAll('#chatTiers select')[0]; const inputs = document.querySelectorAll('#chatTiers input[type=text]'); return { shown: Boolean(sel) && !sel.hidden, count: sel ? sel.options.length : 0, first: sel && sel.options[0] ? sel.options[0].value : null, model: inputs.length > 1 ? inputs[1].value : null }; })()`);
  assert.strictEqual(freeList.shown, true, 'the dropdown is drawn on the panel, not thrown away by a re-render');
  assert.strictEqual(freeList.count, 2, 'and it holds what the provider actually offers: ' + JSON.stringify(freeList));
  assert.strictEqual(freeList.model, 'deepseek/deepseek-chat:free', 'the best free model was written into the Model box: ' + JSON.stringify(freeList));
  await win.webContents.executeJavaScript('document.querySelector("#chatChips [data-action=trending]").click()');
  await new Promise((resolve) => setTimeout(resolve, 900));
  const chipText = await win.webContents.executeJavaScript('document.querySelector("#chatLog").textContent');
  assert.ok(chipText.includes('What is moving right now?'), 'a chip puts the app\'s own question in the log: ' + chipText.slice(-120));
  assert.ok(calls.aiChipContext === 'trending', 'and the numbers it needs were asked for by kind: ' + calls.aiChipContext);
  assert.ok(calls.aiChipContext === 'trending', 'and the numbers were asked for by kind: ' + calls.aiChipContext);
  // A meme chip arms the next question instead of asking one.
  await win.webContents.executeJavaScript('document.querySelector("#chatChips [data-task=roast]").click()');
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.ok(await win.webContents.executeJavaScript('document.querySelector("#chatChips [data-task=roast]").classList.contains("on")'), 'the armed chip lights up');
  assert.ok(/roast/.test(calls.aiChipTask || '') === false, 'arming a task asks nothing yet');
  await win.webContents.executeJavaScript('(() => { document.querySelector("#chatInput").value = "my bags"; document.querySelector("#chatSend").click(); })()');
  await new Promise((resolve) => setTimeout(resolve, 900));
  assert.strictEqual(calls.aiChipTask, 'roast', 'the armed task travelled with the next question: ' + calls.aiChipTask);
  // The look: saving applies the classes at once and reaches the main process.
  await win.webContents.executeJavaScript('(() => { document.querySelector("#chatBubbleStyle").value = "neon"; document.querySelector("#chatFontSize").value = "lg"; document.querySelector("#chatLanguage").value = "en"; document.querySelector("#chatOnTop").checked = true; document.querySelector("#chatSaveLook").click(); })()');
  await new Promise((resolve) => setTimeout(resolve, 700));
  const look = await win.webContents.executeJavaScript('document.querySelector("#chatLog").className');
  assert.ok(/bs-neon/.test(look) && /fs-lg/.test(look), 'the log takes the style and the text size at once: ' + look);
  assert.ok(calls.chatLook && calls.chatLook.aiBubble === 'neon' && calls.chatLook.aiFont === 'lg' && calls.chatLook.aiLanguage === 'en' && calls.chatLook.aiOnTop === true, 'and the main process was told: ' + JSON.stringify(calls.chatLook));

  // ── PILLY ON SCREEN (1.2.0): a switch in Settings that really asks the main process ──
  await win.webContents.executeJavaScript('document.querySelector("#nav [data-tab=settings]").click()');
  await new Promise((resolve) => setTimeout(resolve, 600));
  // WHERE it lives matters as much as what it does: the whole mascot card once sat inside the Beginner Guide tab, so Settings
  // showed nothing of it while every id-based assertion here stayed green. Visibility is asserted, not presence.
  assert.strictEqual(await win.webContents.executeJavaScript('document.querySelector("#tab-settings").contains(document.querySelector("#petCard"))'), true, 'the mascot card is in the Settings tab');
  assert.strictEqual(await win.webContents.executeJavaScript('document.querySelector("#tab-guide").contains(document.querySelector("#petCard"))'), false, 'and not in the guide');
  assert.strictEqual(await win.webContents.executeJavaScript('document.querySelector("#petToggleBtn").offsetParent !== null'), true, 'the switch is visible on the panel it belongs to');
  assert.strictEqual(await win.webContents.executeJavaScript('document.querySelector("#petCard").offsetParent !== null'), true, 'and the card is on screen, not hidden in a tab nobody opened');
  assert.ok(await win.webContents.executeJavaScript('Boolean(document.querySelector("#petToggleBtn"))'), 'the pet has a button in Settings');
  assert.strictEqual(await win.webContents.executeJavaScript('document.querySelector("#petNote").textContent'), 'off', 'and says he is off before anything is pressed');
  await win.webContents.executeJavaScript('document.querySelector("#petToggleBtn").click()');
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.strictEqual(calls.petOn, true, 'pressing it asked the main process for the pet');
  assert.strictEqual(await win.webContents.executeJavaScript('document.querySelector("#petNote").textContent'), 'on screen', 'and the panel says he is on screen');
  assert.ok(/Put Pilly away/.test(await win.webContents.executeJavaScript('document.querySelector("#petToggleBtn span").textContent')), 'the button now offers to put him away');
  // The whole mascot configuration is on the panel, and saving it really reaches the main process.
  const fieldCount = await win.webContents.executeJavaScript('document.querySelectorAll("#petCard [data-pet]").length');
  assert.strictEqual(fieldCount, 23, 'every mascot setting Pilly Desktop had has a field here');
  assert.strictEqual(await win.webContents.executeJavaScript('document.querySelector("[data-pet=petName]").value'), 'Pilly', 'his name is filled in');
  assert.ok(await win.webContents.executeJavaScript('[...document.querySelectorAll("[data-pet=petSize] option")].map((o) => o.value).join()') === 'sm,md,lg', 'three sizes');
  assert.ok(await win.webContents.executeJavaScript('[...document.querySelectorAll("[data-pet=petWalkMode] option")].map((o) => o.value).join()') === 'screen,taskbar', 'and the choice of where he walks');
  assert.ok(await win.webContents.executeJavaScript('[...document.querySelectorAll("[data-pet=petTheme] option")].map((o) => o.value).join()').then((v) => v.startsWith('ball,plush')), 'his colours, starting with the brand ball');
  assert.ok(await win.webContents.executeJavaScript('[...document.querySelectorAll("[data-pet=petBubbleStyle] option")].map((o) => o.value).join()') === 'default,light,glass,neon,comic,minimal', 'all six bubble styles');
  assert.strictEqual(await win.webContents.executeJavaScript('document.querySelector("[data-pet=petHotPct]").value'), '10', 'the hot-coin bar starts where Pilly had it');
  for (const k of ['petHotAlerts', 'petSniper', 'petDailyBrief', 'petPillyPick', 'petWhaleAlerts', 'petPortfolioMood', 'petAlertSound']) {
    assert.strictEqual(await win.webContents.executeJavaScript(`document.querySelector("[data-pet=${k}]").checked`), true, `${k} is switched on and filled in`);
  }
  await win.webContents.executeJavaScript('(() => { document.querySelector("[data-pet=petSize]").value = "lg"; document.querySelector("[data-pet=petSpeed]").value = "fast"; document.querySelector("[data-pet=petBubbles]").checked = false; document.querySelector("[data-pet=petTheme]").value = "plush"; document.querySelector("[data-pet=petHotAlerts]").checked = false; document.querySelector("#petSaveBtn").click(); })()');
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.ok(calls.petPatch && calls.petPatch.petSize === 'lg' && calls.petPatch.petSpeed === 'fast' && calls.petPatch.petBubbles === false, 'saving sends every field: ' + JSON.stringify(calls.petPatch));
  assert.ok(calls.petPatch.petTheme === 'plush' && calls.petPatch.petHotAlerts === false, 'including the look and the radar: ' + JSON.stringify(calls.petPatch));
  // What the main process answers back is laid onto the panel again, so a field it refused cannot be left showing a value
  // the app is not using.
  assert.strictEqual(await win.webContents.executeJavaScript('document.querySelector("[data-pet=petName]").value'), 'Pilly', 'the name survives the save');
  assert.deepEqual(errors, []);
  // THE WATCHLIST AND HIS SCORECARD (1.2.0): two lists in the PillCrew tab, drawn from the main process.
  await win.webContents.executeJavaScript('document.querySelector("#nav [data-tab=crew]").click()');
  await new Promise((resolve) => setTimeout(resolve, 800));
  assert.ok(/50%/.test(await win.webContents.executeJavaScript('document.querySelector("#picksRate").textContent')), 'his hit rate is on the panel');
  assert.strictEqual(await win.webContents.executeJavaScript('document.querySelector("#picksWins").textContent'), '1', 'with the wins beside it');
  assert.strictEqual(await win.webContents.executeJavaScript('document.querySelectorAll("#picksList .rec").length'), 3, 'and every call in the list');
  assert.ok(/win/.test(await win.webContents.executeJavaScript('document.querySelector("#picksList .rec .num").textContent')), 'the first one marked as the win it was');
  assert.strictEqual(await win.webContents.executeJavaScript('document.querySelectorAll("#watchList .rec").length'), 1, 'the watchlist draws what is watched');
  assert.strictEqual(await win.webContents.executeJavaScript('document.querySelector("#picksList").offsetParent !== null'), true, 'and both cards are visible on the PillCrew tab');
  assert.ok(/±15%/.test(await win.webContents.executeJavaScript('document.querySelector("#watchList .rec .num").textContent')), 'with the bar on the alert');
  await win.webContents.executeJavaScript('(() => { document.querySelector("#watchMint").value = "GxWqJbWPxMseev7WXYNPLEG8K59v2fAhJ5m5o7Yepump"; document.querySelector("#watchPct").value = "20"; document.querySelector("#watchAddBtn").click(); })()');
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.ok(calls.watchAdded && calls.watchAdded.mint.startsWith('GxWq'), 'adding a coin reaches the main process: ' + JSON.stringify(calls.watchAdded));
  clearTimeout(timer);  console.log('Electron UI smoke test passed (hidden window, isolated mock wallet, trading stopped)');
  // The window is closed before exit, and the profile is removed on the way out. While Chromium's own children are
  // still alive this usually fails on Windows - so the sweep in `test/scratch.js` removes it at the start of the next
  // run, which is what keeps the temp folder from growing.
  win.destroy();
  try { require('fs').rmSync(scratchDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch (_) { /* swept by the next run */ }
  app.exit(0);
}).catch((err) => { console.error(err); app.exit(1); });
