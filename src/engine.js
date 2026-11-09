const EventEmitter = require('events');
const WebSocket = require('ws');
const { PublicKey, VersionedTransaction } = require('@solana/web3.js');
const { RPCManager } = require('./rpc');
const { ChainFeed } = require('./chain');
const { Jupiter, WSOL } = require('./jupiter');
const { Jito, MIN_TIP_LAMPORTS } = require('./jito');
const { readCurves } = require('./curve');
const { Market } = require('./market');
const { Incinerator } = require('./incinerator');
const { assertCleanupTx, assertSwapTx, assertFeeBudget, assertSystemInstructions, readTx, lamportsOut } = require('./txguard');
const reclaim = require('./reclaim');
const { networkExtras, roundTripFeePct } = require('../renderer/fees');
const { PROTOCOL_FEE: FEE, slippageFraction, seededRandom } = require('./simulation');
const { RiskAnalyzer, adaptiveExit } = require('./risk');
const { SessionRecorder } = require('./recorder');
const { BUMP_DEFAULTS } = require('./bump');

const PUMPPORTAL_WS = 'wss://pumpportal.fun/api/data';
const PUMPDEV_WS = 'wss://pumpdev.io/ws';
const TRADE_URL = 'https://pumpportal.fun/api/trade-local';
const HARD_MAX_SOL_PER_TRADE = 5;
const MARKET_EVERY_MS = 3000;
const HOT_EVERY_MS = 1000;
// Open positions are repriced on their own short cadence: one small request that covers every coin held, and the
// difference between a stop that reacts at the price it saw and one that fills a second later.
const POS_EVERY_MS = 150;
const POS_BOARD_EVERY_MS = 500;
const HOT_BATCH = 30;
// RULE CHANGED 2026-11-05 (1.0.4: the scan and the tick were too slow for a sniper): 50 ms down to 25. The
// tick is where a position is measured against its exit ladder AND where the scan runs, so halving it halves how long a
// stop or a take profit can sit unseen, and doubles how often a qualifying coin is looked at. Measured cost of one
// judgement: ~4 us (`_bench-eval3.js`), so the extra ticks are noise next to the RPC calls the desk already makes.
const TICK_MS = 25;
const MAX_TICK_JUMP_PCT = 40;
const PX_STALE_MS = 6000;
const PX_DEAD_MS = 10000;
const PX_LOST_MS = 45000;
const CURVE_EVERY_MS = 120;
// How far the pool may sit below the board price before an entry is refused: past this the row we judged is behind a
// fall that is happening right now, and buying it is buying a coin on its way down (see `_entryPrice`).
const BOARD_STALE_FRAC = 0.08;
// A curve reading that is more than this multiple above the price the position is measured at is not taken on its own:
// two readings that agree are needed first (see `_pollPositions`). A fall is never held back - a stop has to fire.
const CURVE_JUMP_UP = 3;
const WILD_MOVE_FRAC = 0.5;
// The simple plan has no trail of its own, so it keeps one protective rule: a position that has been up this much
// closes when half of that run is given back. Not a setting - it is the difference between a winner and a wipeout.
const SIMPLE_RUN_ARM = 20;
// How old the last thing heard about a coin may be before its board price stops being a price to buy on, when no
// bonding curve could be read for it.
const ENTRY_PX_MAX_AGE_MS = 30000;
const PUMP_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
// The token programs and the three instruction tags a trade never needs (see `_guardTx`).
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const TOKEN_IX_APPROVE = 4;
const TOKEN_IX_SET_AUTHORITY = 6;
const TOKEN_IX_CLOSE_ACCOUNT = 9;
const TOKEN_IX_APPROVE_CHECKED = 13;
const FEE_FLOOR_SOL = 0.00005;
const FEE_CU_ESTIMATE = 150000;
const MIN_SLIP = 3;
// A stop or a target must land on the first order: the tolerance on an exit is not a promise about the price, it is
// the promise that the coins leave. Measured live: a refused stop cost 1.2 s of re-quoting while the coin fell.
const EXIT_SLIP_MIN = 20;
const EXIT_SLIP_MAX = 40;
const SPIKE_SLIP = 15;
const STOP_HOLD_MS = 150;
// How much of a peak the trailing stop gives back, as a share of the peak itself (see `_trailGive`). The floor is the
// profile's `trailGivePct`.
const TRAIL_GIVE_FRAC = 0.45;
// The rules that are watching money leave rather than waiting for a move to prove itself. Their hold is
// `STOP_HOLD_MS` at most (see `_riskHoldMs`), never the profit rule's `triggerHoldMs`.
const RISK_RULES = new Set(['Stop loss', 'Trailing stop', 'Break even', 'Peak give-back']);
// RULE ADDED 2026-11-05 (1.0.2): a PROFIT rule may not act on a price nobody has refreshed. Measured on a live
// trade (a position that peaked at +30.7% and was booked at -13.1%): it sat on a stale number while the coin
// fell, and the rule then booked the first reading that arrived, 28 points under its own level. A stop, the creator
// selling and the time limit still act on whatever they have - they protect money. A target protects a gain, and a
// gain measured on a stale price is not a measurement.
const PROFIT_FRESH_MS = 1500;
const TX_GUARD_MAX_SOL = 0.01;
const MAX_TRACKED = 400;
// A pump.fun launch is one billion tokens, so "SOL paid per whole token × one billion" is the market cap every
// reading in this app is quoted in. That is what turns a fill into an entry price without asking anybody.
const PUMP_SUPPLY = 1e9;
const ENTRY_FILL_MAX_RATIO = 1000;
const ENRICH_PER_CYCLE = 90;
const SCAN_PER_TICK = 60;
// RULE CHANGED 2026-11-05 (1.0.4: the scan and the tick were too slow for a sniper): a coin was re-judged
// once every 700 ms; the gate is now 400 ms, so a coin that crosses its bar waits half as long for the desk to look at it
// again. Measured, not guessed (`_bench-eval.js`): one judgement costs ~0.43 ms of CPU, so a 250 ms gate would have cost a
// whole core with 600 coins on the list. The big win is not here - it is in `_entryPrice`, which no longer waits 450-700 ms
// for a price the coin's own tape already carries.
const SCAN_GATE_MS = 250;
// How old the coin's own last trade may be before the desk trusts the price it already holds instead of asking the pool
// again (see `_entryPrice`). 1.2 s is the same order as one scan round, so a coin being judged is still being traded.
const ENTRY_TAPE_MS = 1200;
const TRADES_KEPT = 240;
const SUB_BUDGET = 20;
const SUB_BUDGET_LIMITED = 12;
// A stream that has been quiet this long is not the price any more: the coin graduated, the feed dropped it or
// the chain feed fell back to launches only. Open positions switch to the market board after this.
const STREAM_FRESH_MS = 15000;
// A broadcast that has not answered in about a second is useless to a sniper; the same signed bytes can
// safely be sent again, so the budget is deliberately short.
const BROADCAST = { timeoutMs: 1500, attempts: 3, budgetMs: 4500 };
const CONFIRM_POLLS = 40;
// Rent locked by a fresh token account, returned when the account is closed after the sell.
const TOKEN_RENT_SOL = 0.00204;
// The rent-exempt floor plus a fee and a tip per open position: never spent on an entry, so anything bought can
// always pay for its own way out (measured: the wallet hit 0.00066 SOL and no exit could be submitted).
const MIN_WALLET_RESERVE_SOL = 0.002;
const RENT_EXEMPT_SOL = 0.00089;
// A wallet under this cannot pay for an exit at all: the rent-exempt floor is 0.00089 SOL and the runtime refuses
// any transaction that would leave the fee payer below it.
const EXIT_FEE_FLOOR_SOL = 0.0012;

const PROFILES = {
  safe: {
    minScore: 70, minBuyers: 6, minNetFlowSol: 2, minMcSol: 20, maxMcSol: 80,
    takeProfitPct: 60, stopLossPct: 6, maxHoldSec: 150, slippagePct: 8, priorityFeeSol: 0.0002,
    tp1Pct: 18, tp1SellPct: 50, trailArmPct: 14, trailGivePct: 8, breakEvenPct: 0,
  },
  // RULE CHANGED 2026-11-05 (1.0.2, the shipped settings code `PCS1~…`): `balanced`
  // IS the shipped plan now - the numbers below are the default a fresh install runs.
  //
  // Read it as one plan, because that is what it is:
  //  - the ENTRY waits for a crowd: seventy distinct wallets in the window, a net 2 SOL of buying, a market cap between
  //    80 and 1500 SOL, and a pool of at least 4000 USD. The five minute band is OFF, and so is the score gate while the
  //    simple mode is on - the coin is judged on the crowd and on the safety checks, not on a momentum window;
  //  - the SAFETY checks are on and they are not tuning: a creator holding 30% or more, a creator who bought more than
  //    12 SOL, one wallet doing 40% of the buying, or a pool too thin to sell into all refuse the coin;
  //  - the EXIT gives the coin room: an 80% target against a 45% stop, held up to 500 seconds. The stop is wide on
  //    purpose - with the crowd bar this high, the coin is meant to be given time, and the fee gate below is what keeps
  //    a small ticket out of that game;
  //  - the fee gate is 8% of the ticket, so the cheapest ticket that can pay its own tips is the one this plan ships with.
  balanced: {
    minScore: 50, minBuyers: 50, minNetFlowSol: 2, minMcSol: 60, maxMcSol: 15000,
    takeProfitPct: 80, stopLossPct: 45, maxHoldSec: 500, slippagePct: 8, priorityFeeSol: 0.0002,
    tp1Pct: 0, tp1SellPct: 0, trailArmPct: 14, trailGivePct: 8, breakEvenPct: 0,
    // The ticket is NOT part of a style: a press of a card must never raise the money at risk (see `settings:profile`).
    buyAmountSol: undefined,
    // The FULL desk, not the simple one: the trail (14/8) is live, the score gate is live at 50, and the five minute
    // band is off. Ten slots and thirty buys a minute are the shipped numbers, and the session cap is one SOL.
    simpleMode: false, maxPositions: 10, maxBuysPerMin: 30,
    watchSec: 3, entryWindowSec: 45, minLiqUsd: 4000, triggerHoldMs: 400,
    sessionLossLimitSol: 1, maxLossStreak: 10, pauseMinutes: 5,
    maxDevBuySol: 12, maxDevHoldPct: 30, maxTraderSharePct: 40,
    maxChange5mPct: 0, minChange5mPct: 0, deepEntry: true, minHolders: 0, maxBuyers: 0,
    minTokenAgeSec: 0, maxTokenAgeSec: 0, maxRoundTripPct: 8,
    // RULE ADDED 2026-11-06 (1.0.8): a Geyser-class endpoint (Yellowstone gRPC is served over the same WebSocket
    // `transactionSubscribe` by the providers that offer it). Optional: with no URL the desk runs exactly as before, and
    // the decoder is unchanged - only the transport, and therefore the latency, is better.
    geyserUrl: '', geyserToken: '',
    // RULE ADDED 2026-11-06 (1.0.7): "sniping po dev wallet" / copy trading, the feature Dorado and Soldrift advertise.
    // A comma or newline separated list of base58 addresses. When one of them BUYS a coin we are watching, that coin is
    // entered at once - but only through the money guards every other entry goes through (slots, pace, cooldown, the cost
    // gate, the balance, the pool's own price). It overrides the JUDGEMENT bars, never the safety ones, and it never
    // mirrors a sell: the exit ladder is ours.
    copyWallets: '',
  },
  aggressive: {
    minScore: 78, minBuyers: 30, minNetFlowSol: 2, minMcSol: 60, maxMcSol: 500,
    takeProfitPct: 60, stopLossPct: 12, maxHoldSec: 240, slippagePct: 15, priorityFeeSol: 0.0005,
    tp1Pct: 0, tp1SellPct: 0, trailArmPct: 0, trailGivePct: 0, breakEvenPct: 0,
    simpleMode: false, maxPositions: 2, maxBuysPerMin: 4, minTokenAgeSec: 5, maxRoundTripPct: 8,
  },
};
const AUTOPILOT = {
  ...PROFILES.balanced,
  profile: 'balanced',
  // The one press preset applies the shipped plan, and the ticket stays the operator's own decision - `settings:autopilot`
  // never raises it (see main.js).
  buyAmountSol: 0.1,
  smartFees: true,
  paperLatencyMs: 300,
};
delete AUTOPILOT.buyAmountSol;   // kept out of the preset: the card names the size, the operator types it

const DEFAULTS = {
  mode: 'paper',
  recordMarket: false,
  adaptiveExits: false,
  // THE COUNCIL (1.2.0): the chat panel and its analysts, on the operator's own keys. `aiTiers` is an empty list by
  // default, which means "use the three rows the panel ships with" (see `DEFAULT_TIERS` in src/ai.js): DeepSeek, the free
  // OpenRouter lane, and one empty endpoint of the operator's own. No key is ever shipped with this app.
  aiTiers: [],
  aiSystem: '',
  aiTemperature: 0.2,
  aiMaxTokens: 300,
  aiTimeoutMs: 15000,
  aiCouncil: true,
  // THE CHAT'S OWN LOOK AND LANGUAGE (1.2.0), ported from Pilly Desktop: how his answers are drawn (five bubble styles), how big
  // the letters are, whether the window stays above everything, and whether the reply language is locked instead of following the
  // operator. `auto` follows the operator, which is what a model does on its own.
  aiBubble: 'sharp',        // sharp | rounded | glass | neon | minimal
  aiFont: 'normal',         // sm | normal | lg
  aiOnTop: false,
  aiLanguage: 'auto',       // auto | en | zh
  // PILLY ON SCREEN (1.2.0): the desktop pet and its FULL configuration, ported from Pilly Desktop — on/off, name, size,
  // walking speed, where he walks (the whole screen or along the taskbar line), how often he stops, bubbles and their size,
  // sound, whether he may ask things, and a reduce-motion switch. Off by default: a companion that appears on somebody's
  // desktop uninvited is not a feature. `petPos` remembers where he was left, clamped into that screen when he starts again.
  petOn: false,
  petName: 'Pilly',
  petTheme: 'ball',         // ball | green | blue | purple | pink | orange | plush
  petSize: 'md',            // sm | md | lg
  petSpeed: 'normal',       // slow | normal | fast
  petWalkMode: 'screen',    // screen | taskbar
  petStopFreq: 'normal',    // never | rare | normal | often
  petMood: 'neutral',       // neutral | happy | sad — what he looks like when nothing is happening
  petBubbles: true,
  petBubbleSize: 'md',      // sm | md | lg — the bubble's padding
  petBubbleText: 'md',      // sm | md | lg — the bubble's text
  petBubbleStyle: 'default', // default | light | glass | neon | comic | minimal
  petSounds: true,
  petSoundVol: 60,          // 0-100
  petQuestions: true,
  petReduceMotion: false,
  // What he says on his own, ported from Pilly Desktop's proactive features: the hot-coin radar, the daily brief, his own
  // pick of the day, a whale alert when a followed wallet opens, and his mood following the operator's PnL.
  petHotAlerts: true,
  petHotPct: 10,            // the 5-minute move that counts as hot
  petAlertSound: true,
  petDailyBrief: true,
  petPillyPick: true,
  petSniper: true,
  petWhaleAlerts: true,
  petPortfolioMood: true,
  petPos: null,
  paperLatencyMs: 0,
  paperBaseSlippagePct: 1,
  paperUnknownImpactPct: 2,
  paperFailurePct: 0,
  paperSeed: 1,
  profile: 'balanced',
  // The ticket this plan is built for: at 0.1 SOL the round trip is about 3.9% of it, which is what the 8% fee gate
  // leaves room for. A smaller ticket is refused by that gate instead of being quietly traded at a loss.
  buyAmountSol: 0.1,
  maxPositions: 3,
  maxBuysPerMin: 20,
  watchSec: 2,
  entryWindowSec: 40,
  trendMode: true,
  sessionLossLimitSol: 0.35,
  marketScan: true,
  // The wide doors: the DexScreener search board and GeckoTerminal's newest pools, on top of the launch feeds. They
  // carry coins no trending list shows, which is most of what a sniper has to choose from.
  wideDiscovery: true,
  pumpdevKey: '',
  incineratorKey: '',
  jupiterKey: '',
  autoReclaim: true,
  // Leftovers that neither door can sell are worth less than the rent their account holds: burning them and closing
  // the account returns about 0.00204 SOL each. Off means they are left alone.
  recoverDust: true,
  feedSource: 'auto',
  smartFees: true,
  // Jito: offer every signed trade to the block engine's auction as well, with a tip that is only paid if the bundle
  // lands. Off by default - it costs SOL on the trades that land, and the public RPC already works without it.
  useJito: false,
  jitoTipSol: 0.0001,
  maxDevBuySol: 3,
  maxDevHoldPct: 35,
  // A coin that finished its curve trades on PumpSwap, a different program with different liquidity. The route to
  // it is unreliable from a keyless build, so it is off until the user asks for it.
  allowGraduated: false,
  maxTraderSharePct: 45,
  // RULE CHANGED 2026-11-05: the measured band, so a coin that has already run is not bought (it was 0 = no ceiling,
  // and "Already up N% in 5m" was the gate that never fired on the coins that then dumped).
  maxChange5mPct: 30,
  minChange5mPct: 2,
  deepEntry: false,
  minHolders: 0,
  simpleMode: true,
  maxBuyers: 0,
  minLiqUsd: 4000,
  maxRoundTripPct: 20,
  // How old a coin may be to be bought at all. A launch younger than `minTokenAgeSec` has no tape to judge, and one
  // older than `maxTokenAgeSec` has already had its move. Zero means off in both directions.
  minTokenAgeSec: 0,
  maxTokenAgeSec: 0,
  triggerHoldMs: 300,
  openPositions: [],
  maxLossStreak: 5,
  pauseMinutes: 8,
  rpcUrl: '',
  rpcBackupUrl: '',
  rpcWsUrl: '',
  onboarded: false,
  ...AUTOPILOT,
  // RULE ADDED 2026-11-08 (1.1.2): the bump desk's own settings. They live here so they survive a restart and go
  // through the same validation as everything else - but the wallets that run them are NOT settings: their keys live in
  // their own sealed file (`src/bump.js`), and `SHARE_KEYS` in `src/share.js` is an allowlist, so a settings code can
  // never carry them.
  ...BUMP_DEFAULTS,
};

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const emptyBook = () => ({ trades: 0, wins: 0, losses: 0, pnl: 0, sessionPnl: 0 });

class Engine extends EventEmitter {
  constructor(wallet, store) {
    super();
    this.wallet = wallet;
    this.store = store;
    this.tokens = new Map();
    this.earlyCreatorSales = new Map();
    this.positions = new Map();
    this.history = [];
    this.logs = [];
    this.running = false;
    this.connected = false;
    this.ws = null;
    this.wantWs = false;
    this._subbed = new Set();
    this._subBudget = SUB_BUDGET;
    this.walletBalance = null;
    this.paper = { balance: 5 };
    this._paperRandom = seededRandom(this.s.paperSeed);
    // Practice money and real money are kept apart, so a bad practice session can never flatter or ruin the
    // real win rate, and each book can be reset on its own.
    this.books = { paper: emptyBook(), live: emptyBook() };
    // The record of what was booked survives a restart, because a panel that forgets the day's profit and loss makes
    // an operator trade blind - and every restart used to do exactly that.
    this._loadBook();
    // RULE ADDED 2026-11-06 (1.1.1): the bankroll is part of the book. It used to be rebuilt as 5.000 on every start, under
    // a Profit / Loss figure that had been restored - two numbers on one card that could not both be true.
    const savedPaper = Number(this.s.paperBalance);
    if (Number.isFinite(savedPaper) && savedPaper > 0) this.paper.balance = savedPaper;
    this.stats = { seen: 0, lastLatencyMs: null, lastSellMs: null, reclaimedSol: 0, launches: 0, feeSpentSol: 0, orderFails: 0, entryPx: { curve: 0, board: 0, refused: 0 } };
    // Said in the log panel, once, when the settings file was damaged or unreadable: the app is then running on
    // defaults, and that is something the person has to know before pressing Start.
    if (store && store.damaged) this._log('error', 'Settings: ' + store.damaged);
    this.launchTimes = [];
    this.buyTimes = [];
    this.cooldowns = new Map();
    this._settleQueue = new Set();
    // Mints whose curve is not quoted in SOL: no tolerance or route can fill them, so they are remembered for the
    // session instead of being re-ordered (and re-paid for) every time the market board scores them again.
    this._unsupported = new Set();
    this.jup = new Jupiter({ getKey: () => this.s.jupiterKey || '' });
    this.jito = new Jito();
    this.market = new Market({
      // Your own Jupiter key, read at call time so a key typed into Settings is live on the next request.
      getKey: () => this.s.jupiterKey || '',
      onError: (e) => this._marketError(e),
    });
    this.inc = new Incinerator(() => this.s.incineratorKey);
    this.rpc = new RPCManager({
      custom: [store.get().rpcUrl, store.get().rpcBackupUrl],
      onSwitch: (from, to, why) => this._log('warn', `RPC switched (${why}): ${new URL(to).hostname}`),
    });
    this._loop = null;
    this.risk = new RiskAnalyzer((fn, opts) => this.rpcCall(fn, opts));
    this._ui = setInterval(() => this._emitState(), 400);
    // The open positions are pushed on their own, twenty times a second, and only when a price really moved. Waiting
    // for the whole window (five times slower) is what made the panel look frozen while the market was moving.
    this._pxTimer = setInterval(() => this._pushPositions(), 50);
    this._bal = setInterval(() => this.refreshBalance(), 6000);
    setTimeout(() => this.refreshBalance(), 500);
  }

  get s() { return this.store.get(); }

  /** Run an RPC call with automatic node failover. */
  rpcCall(fn, opts) { this.rpc.setCustoms([this.s.rpcUrl, this.s.rpcBackupUrl]); return this.rpc.call(fn, opts); }

  async refreshBalance() {
    const addr = this.wallet.address();
    if (!addr) { this.walletBalance = null; return; }
    try {
      const lamports = await this.rpcCall((c) => c.getBalance(new PublicKey(addr)));
      const next = lamports / 1e9;
      const prev = this.walletBalance;
      this.walletBalance = next;
      if (prev != null && Number.isFinite(prev)) {
        const delta = next - prev;
        const quiet = Date.now() - Math.max(this._lastSettleAt || 0, this._lastReclaimAt || 0) > 10000;
        const inflight = (this._spends || []).some((x) => Date.now() - x.ms < 4000);
        if (quiet && !inflight && Math.abs(delta) >= 0.005 && this.sessionStart) {
          this.sessionStart.balance = (this.sessionStart.balance || 0) + delta;
          this._log('info', delta > 0
            ? `SOL was added to the wallet (+${delta.toFixed(4)}). Profit / Loss counts trading only, so it starts from the new balance.`
            : `SOL left the wallet (${delta.toFixed(4)}). Profit / Loss counts trading only, so it starts from the new balance.`);
        }
      }
      // Orders placed more than a moment ago are inside this reading; anything newer may still be in flight and
      // stays counted against the wallet so a burst cannot spend the same lamports twice.
      const cut = Date.now() - 1200;
      this._spends = (this._spends || []).filter((x) => x.ms > cut);
    } catch (_) { /* RPC hiccup - keep last value */ }
  }

  _balance() { return this.s.mode === 'live' ? (this.walletBalance || 0) : this.paper.balance; }

  _paperSlippage(t, amount) {
    const solUsd = typeof this.market.solPrice === 'function' ? this.market.solPrice() : 0;
    const depth = solUsd > 0 && t && t.ext && t.ext.liqUsd > 0 ? t.ext.liqUsd / solUsd / 2 : 0;
    return slippageFraction(amount, depth, this.s.paperBaseSlippagePct, this.s.paperUnknownImpactPct);
  }

  _recordTick(t, signal = false) {
    if (!this.s.recordMarket || !this.store.file) {
      if (this.recorder && !this.recorder.closed) this.recorder.close();
      return;
    }
    if (Date.now() < (this._recordingRetryAt || 0)) return;
    if (this.recorder && this.recorder.error) {
      this._recordingRetryAt = Date.now() + 60000;
      this._log('warn', 'Recording unavailable: ' + this.recorder.error);
      this.recorder = null;
      return;
    }
    try {
      if (!this.recorder || this.recorder.closed) this.recorder = new SessionRecorder(require('path').join(require('path').dirname(this.store.file), 'recordings'));
      const usd = typeof this.market.solPrice === 'function' ? this.market.solPrice() : 0;
      const depth = usd > 0 && t.ext && Number.isFinite(t.ext.liqUsd) && t.ext.liqUsd > 0 ? t.ext.liqUsd / usd / 2 : undefined;
      this.recorder.record({ ts: Date.now(), mint: t.mint, mcSol: t.mc, liquiditySol: depth, signal });
    } catch (err) { this._recordingRetryAt = Date.now() + 60000; this._log('warn', 'Recording unavailable: ' + err.message); }
  }

  async _paperWait() {
    const delay = Math.min(10000, Math.max(0, Number(this.s.paperLatencyMs) || 0));
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    if (this._paperRandom() * 100 < this.s.paperFailurePct) throw Object.assign(new Error('Simulated order failure'), { phase: 'build', definite: true });
  }

  /** What the coins on the book are worth right now, plus the rent the wallet paid for their accounts (recoverable,
   *  so it is cash in waiting, not a cost). One place, because the baseline and the live reading must be the same kind
   *  of number or the difference between them is not a profit. */
  _holdingsSol() {
    let sum = 0;
    for (const p of this.positions.values()) {
      if (p.paper) continue;
      // A coin nobody has priced yet is marked at what was paid for it, never at zero: zero would read as a total loss
      // for the few seconds between a buy and its first reading.
      const ratio = p.entryMc > 0 && p.mc > 0 ? p.mc / p.entryMc : 1;
      sum += p.solIn * ratio + TOKEN_RENT_SOL;
    }
    return sum;
  }

  /** The session's own starting point: what the wallet held in SOL, and what the coins it already held were worth. */
  _markSession() {
    this.sessionStart = {
      at: Date.now(),
      balance: this.walletBalance == null ? null : this.walletBalance,
      holdings: this._holdingsSol(),
    };
    return this.sessionStart;
  }

  _walletDelta() {
    if (!this.sessionStart || this.walletBalance == null || this.sessionStart.balance == null) return null;
    return (this.walletBalance + this._holdingsSol()) - (this.sessionStart.balance + (this.sessionStart.holdings || 0));
  }

  /** SOL that an order has committed but the next balance reading may not show yet. */
  _pendingSpend() {
    const now = Date.now();
    this._spends = (this._spends || []).filter((x) => now - x.ms < 60000);
    return this._spends.reduce((n, x) => n + x.sol, 0);
  }

  _noteSpend(sol) {
    const entry = { ms: Date.now(), sol };
    (this._spends || (this._spends = [])).push(entry);
    return entry;
  }

  /** Forget an order that provably never left the wallet. */
  _releaseSpend(entry) {
    if (entry) entry.sol = 0;
  }

  /** SOL the desk always keeps: the rent floor plus a fee and a tip for every open position. No entry may spend it. */
  _reserveSol() {
    const open = [...this.positions.values()].filter((p) => !p.paper).length;
    const perExit = (Number(this.s.priorityFeeSol) || 0.0002) + 0.0001;   // the tip, the fee, and one retry
    const needs = RENT_EXEMPT_SOL + perExit * Math.max(1, open) + 0.0004;
    return Math.max(MIN_WALLET_RESERVE_SOL, Math.round(needs * 1e9) / 1e9);
  }

  /** SOL an entry may really spend: balance minus orders still in flight minus the reserve. Without it a burst of
   *  buys drained the wallet past the point where it could pay a network fee (measured at 0.00066 SOL). */
  _freeSol() {
    if (this.s.mode !== 'live') return this._balance();
    return Math.max(0, this._balance() - this._pendingSpend() - this._reserveSol());
  }

  _log(level, msg) {
    const entry = { ts: Date.now(), level, msg };
    this.logs.push(entry);
    if (this.logs.length > 200) this.logs.shift();
    this.emit('log', entry);
  }

  resetPractice() {
    this.paper.balance = 5;
    this.resetStats('paper');
    // RULE ADDED 2026-11-06 (1.1.1): a Reset must survive a restart. The bankroll is part of the saved book now, so a
    // reset that only changed the number in memory would be undone by the next Start.
    this._persistPositions();
  }

  /** Entries were paused by the desk itself (a cold streak, or selling everything by hand). The operator may undo that:
   *  the streak counter starts again too, so the same five losses cannot put it straight back. */
  resumeEntries() {
    const was = this.pausedUntil;
    this.pausedUntil = 0;
    this.pauseReason = null;
    this.lossStreak = 0;
    if (was) this._log('info', 'Entries resumed by hand. The loss streak starts again from zero.');
    return { ok: true, running: this.running, paused: false };
  }

  /** Clears one book. Positions that are open stay open; only the numbers behind them are forgotten. */
  resetStats(mode) {
    const key = mode === 'live' ? 'live' : 'paper';
    this.books[key] = emptyBook();
    this.history = this.history.filter((h) => (key === 'live' ? h.paper : !h.paper));
    // The pause belongs to the book that earned it: clearing the practice numbers must not hand the real desk a
    // fresh licence to trade after three real losses.
    if (key === (this.s.mode === 'live' ? 'live' : 'paper')) {
      this.lossStreak = 0;
      this.pausedUntil = 0;
    }
    this._log('info', key === 'live' ? 'Real money statistics cleared.' : 'Practice statistics cleared.');
    this._persistBook();
    return this.books[key];
  }

  async start(opts = {}) {
    if (this.running) return { ok: true };
    const s = this.s;
    if (s.mode === 'live' && this.store.damaged) return { ok: false, error: 'Restore the damaged settings file before starting real-money trading.' };
    // An engine started without a network must not wait for one: the entry price falls back to the coin's own trade
    // stream instead of asking a bonding curve nobody can reach (see `_entryPrice`).
    this.offline = Boolean(opts.offline);
    if (!opts.offline && s.mode === 'live') {
      if (!this.wallet.isUnlocked()) return { ok: false, error: 'Unlock your wallet first (Wallet tab).' };
      await this.refreshBalance();
      if (this.walletBalance == null) {
        return { ok: false, error: 'Your wallet balance could not be read. Check the network or set an RPC URL in Settings, then press Start again.' };
      }
      // The only number that cannot lie about a session: what the wallet holds now against what it held at the start.
      // Every wasted tip, every rejected order and every fee is inside it, which a sum of trades can never show.
    this.sessionStart = { at: Date.now(), balance: this.walletBalance };
      // The saved positions come back first, because they are money that is already on chain: a wallet whose free
      // SOL sits in open positions and their rent must still be able to manage them, and must still show them.
      await this._restorePositions();
      await this._adoptOnChain();
    this._markSession();
      // The reserve is what pays the exits, so a wallet that cannot hold it is holding coins it cannot sell. With
      // nothing open the ticket is asked for as well, otherwise the bot would start only to refuse every entry.
      const needed = this.positions.size ? 0 : this._reserveSol() + this._cashNeeded();
      if (this.walletBalance < needed) {
        return {
          ok: false,
          error: `Not enough SOL in your wallet: ${needed.toFixed(4)} SOL covers the buy, its rent and the reserve that pays the exit fee. Deposit SOL or switch to Practice Mode.`,
        };
      }
      // Coins that are already bought are always shown and always managed, whatever the balance: the reserve is a
      // rule about spending, never about being able to sell. If there is nothing for the fee, it is said in words.
      if (this.positions.size && this.walletBalance < EXIT_FEE_FLOOR_SOL) this._warnNoFeeSol();
    }
    // RULE ADDED 2026-11-06 (1.1.1): a practice position saved by the last session comes back when the desk starts
    // again. Practice positions used to be written to disk and never read back, because the only restore path ran for
    // real money - where the tokens are in the wallet to be checked. A practice row has no token, and this path asks the
    // chain about nothing.
    if (s.mode !== 'live') await this._restorePositions();
    this.running = true;
    this.books[this.s.mode === 'live' ? 'live' : 'paper'].sessionPnl = 0;
    this._log('info', s.mode === 'live' ? 'Bot started in REAL MONEY mode.' : 'Bot started in Practice Mode (no real money).');
    if (!opts.offline) { this._connect(); this._startMarket(); }
    if (!this._loop) this._loop = setInterval(() => this._tick(), TICK_MS);
    return { ok: true };
  }

  /** SOL one entry really needs: the ticket, the tip, and the rent for the token account the buy creates. The exit
   *  fees are not in here - they live in `_reserveSol()`, which no entry may touch. */
  _cashNeeded() {
    return Math.min(this.s.buyAmountSol, HARD_MAX_SOL_PER_TRADE) + (this.s.priorityFeeSol || 0) + TOKEN_RENT_SOL + 0.0005;
  }

  /** Positions are written to disk on every change: a crash must not leave coins nobody is managing. On the next
   *  Start the book is rebuilt against the wallet - adopted if the tokens are there, dropped if they are not. */
  _persistPositions() {
    // Every structural change to the book goes through here, so this is also where the fast position feed is told
    // that the panel has something new to draw (a position opened, closed or was restored).
    this._pxDirty = true;
    const mine = [...this.positions.values()]
      // RULE CHANGED 2026-11-06 (1.1.1): practice positions are persisted too. They used to be dropped, so a restart
      // silently closed every open paper trade - the balance reset to 5.000 while Profit / Loss kept the realised
      // figure, and the two numbers disagreed on screen. A paper position has no wallet token to verify against, so the
      // restore path skips that check for it instead of throwing the row away.
      .map((p) => ({
        mint: p.mint, symbol: p.symbol, entryMc: p.entryMc, mc: p.mc, peakMc: p.peakMc, solIn: p.solIn,
        paper: Boolean(p.paper),
        pxEntry: p.pxEntry || null,
        feeBuy: p.feeBuy, feeExitEst: p.feeExitEst, openedAt: p.openedAt, tp1Done: Boolean(p.tp1Done), sig: p.sig || null,
        adopted: Boolean(p.adopted), graduated: Boolean(p.graduated),
        pendingSellSig: p.pendingSell ? p.pendingSell.sig : null, sellSig: p.sellSig || null,
        pendingBuy: Boolean(p.pendingBuy || p.confirmingBuy), tokIn: p.tokIn == null ? null : String(p.tokIn),
        pendingSellPct: p.pendingSellPct || 100,
        entryLiquidityUsd: p.entryLiquidityUsd ?? null, entryDexId: p.entryDexId || null,
      }));
    try {
      // Rows belonging to the other desk are carried over untouched: starting in Practice must not delete the record of
      // a real position it is not managing, and the other way round.
      const liveMode = this.s.mode === 'live';
      const held = new Set(mine.map((r) => r.mint));
      const other = (Array.isArray(this.s.openPositions) ? this.s.openPositions : [])
        .filter((r) => r && r.mint && !held.has(r.mint) && Boolean(r.paper) === liveMode);
      this.store.set({ openPositions: [...other, ...mine], paperBalance: Number(this.paper.balance) || 0 });
    } catch (_) { /* a full disk is not a reason to stop trading */ }
  }

  async _restorePositions() {
    const saved = Array.isArray(this.s.openPositions) ? this.s.openPositions : [];
    if (!saved.length) return;
    let missing = 0;
    for (const rec of saved) {
      if (!rec || !rec.mint || this.positions.has(rec.mint)) continue;
      // Only the rows this desk owns. A real position restored into the practice desk would be a trade with no wallet
      // behind it, and a practice row has no token to check against the chain.
      if (Boolean(rec.paper) === (this.s.mode === 'live')) continue;
      // A practice position has no token in the wallet: it is restored on the record alone, because the alternative is
      // silently closing a trade the user is still watching (and resetting the bankroll under a Profit / Loss figure).
      const held = rec.paper ? null : await this._tokenBalanceRaw(rec.mint).catch(() => null);
      if (!rec.paper && held === 0n && !rec.pendingBuy && !rec.pendingSellSig) { missing++; continue; }
      const now = Date.now();
      this.positions.set(rec.mint, {
        mint: rec.mint, symbol: rec.symbol || rec.mint.slice(0, 4), name: rec.symbol || '',
        // No made-up numbers: a record without an entry price is measured from the first price it is seen at, and
        // `_pnlPct` reads 0 until then, so nothing sells on a reference that was never paid.
        entryMc: Number(rec.entryMc) || 0, mc: Number(rec.mc) || Number(rec.entryMc) || 0,
        // A restored position remembers whether it opened on the pool's own price (see `_pricePosition`).
        pxEntry: rec.pxEntry === 'curve' ? 'curve' : (rec.pxEntry === 'board' ? 'board' : null),
        peakMc: Number(rec.peakMc) || Number(rec.mc) || Number(rec.entryMc) || 0,
        solIn: Number(rec.solIn) || this.s.buyAmountSol, feeBuy: Number(rec.feeBuy) || 0,
        // A restored position keeps the exit tip it was priced with, or gets today's if the record predates the field.
        feeExitEst: Number(rec.feeExitEst) || this._feeFor(true),
        openedAt: Number(rec.openedAt) || now, status: 'open', closing: false, paper: Boolean(rec.paper),
        bookedAt: now,
        fails: 0, nextTry: 0, pending: held === null && !rec.paper, tp1Done: Boolean(rec.tp1Done), sig: rec.sig,
        tokIn: rec.pendingSellSig && /^\d+$/.test(rec.tokIn) ? BigInt(rec.tokIn) : held, adopted: Boolean(rec.adopted), graduated: Boolean(rec.graduated),
        pendingSell: rec.pendingSellSig ? { sig: rec.pendingSellSig, raw: null } : null, sellSig: rec.sellSig || null,
        pendingBuy: Boolean(rec.pendingBuy),
        pendingSellPct: Number(rec.pendingSellPct) || 100,
        entryLiquidityUsd: Number(rec.entryLiquidityUsd) || null, entryDexId: rec.entryDexId || null,
      });
      if (!this.tokens.has(rec.mint)) {
        this._adopt({ mint: rec.mint, source: 'restore', launched: true });
        const t = this.tokens.get(rec.mint);
        if (t) { t.mc = Number(rec.mc) || Number(rec.entryMc) || 1; t.status = 'bought'; }
      }
      this._log('warn', held === null
        ? `Restored an open position in ${rec.symbol || rec.mint} from the last session. Its balance could not be read yet.`
        : `Restored an open position in ${rec.symbol || rec.mint} from the last session. It is managed and sold by the normal rules.`);
    }
    if (missing) this._log('info', `${missing} saved position${missing > 1 ? 's were' : ' was'} already closed in the wallet and removed from the book.`);
    this._persistPositions();
  }

  /** Bring the book up to date with the chain without starting the bot, so the panel shows the real coins at once. */
  async recoverBook() {
    if (!this.wallet.isUnlocked()) return 0;
    const before = this.positions.size;
    await this._restorePositions().catch(() => {});
    await this._adoptOnChain().catch(() => 0);
    return this.positions.size - before;
  }

  /** Every token account of this wallet, with the rent it holds. */
  async _tokenAccounts() {
    const addr = this.wallet.address();
    if (!addr) throw new Error('Create your wallet first.');
    return reclaim.scanTokenAccounts((fn, opts) => this.rpcCall(fn, opts), addr);
  }

  /** Coins in the wallet the book never recorded are adopted and priced where they trade now, so nothing sits in the
   *  wallet with no rule looking after it. A leftover worth less than a fifth of a ticket is not a position - it is
   *  dust, and the settle path sells or burns it for the rent. */
  async _adoptOnChain() {
    if (!this.wallet.isUnlocked()) return 0;
    let scan;
    try { scan = await this._tokenAccounts(); } catch (_) { return 0; }
    const holdings = scan.dust.filter((a) => !this.positions.has(a.mint) && a.uiAmount > 0);
    if (holdings.length && !(this.market.solPrice() > 0)) await this.market.enrich([WSOL]).catch(() => {});
    // The holding's value decides whether it is a position or a leftover: booking dust at the ticket size invented
    // money in the books and re-sold the same coin over and over.
    const prices = holdings.length ? await this.market.prices(holdings.map((a) => a.mint)).catch(() => new Map()) : new Map();
    const solUsd = this.market.solPrice();
    let added = 0;
    let skipped = 0;
    let unknown = 0;
    for (const a of holdings) {
      const px = prices.get(a.mint);
      const usd = px ? Number(a.uiAmount) * px.priceUsd : null;
      const solValue = usd != null && solUsd > 0 ? usd / solUsd : null;
      const floor = Math.max(0.0005, this.s.buyAmountSol * 0.2);
      if (solValue != null && solValue < floor) { skipped++; continue; }
      if (solValue == null) {
        unknown++;
        if (this.s.autoReclaim) this._settleMint(a.mint);
        continue;
      }
      const t = this.tokens.get(a.mint);
      const mc = t && t.mc > 0 ? t.mc : 0;
      this.positions.set(a.mint, {
        mint: a.mint, symbol: (t && t.symbol) || a.mint.slice(0, 4), name: (t && t.name) || '',
        entryMc: mc, mc, peakMc: mc, solIn: solValue > 0 ? solValue : this.s.buyAmountSol,
        feeBuy: 0, openedAt: Date.now(), bookedAt: Date.now(),
        status: 'open', closing: false, paper: false, fails: 0, nextTry: 0, pending: false,
        tp1Done: false, sig: null, tokIn: BigInt(a.amount), adopted: true,
      });
      if (!t) {
        this._adopt({ mint: a.mint, source: 'wallet', launched: true });
        const nt = this.tokens.get(a.mint);
        if (nt) { nt.mc = mc || nt.mc; nt.status = 'bought'; }
      }
      added++;
    }
    if (added) {
      this._log('warn', `Found ${added} coin${added > 1 ? 's' : ''} in the wallet that the book did not know about. Adopted, and the normal exit rules now manage ${added > 1 ? 'them' : 'it'}.`);
      this._persistPositions();
    }
    if (unknown) this._log('info', `${unknown} holding${unknown > 1 ? 's have' : ' has'} no price anywhere, so ${unknown > 1 ? 'they are' : 'it is'} sold as a leftover instead of being booked as a position.`);
    if (skipped) this._log('info', `${skipped} leftover holding${skipped > 1 ? 's are' : ' is'} too small to manage as a position; the sell-all or the next exit sweeps ${skipped > 1 ? 'them' : 'it'} and returns the rent.`);
    return added;
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    this._log('info', this.positions.size
      ? 'Bot stopped. Still managing open positions until they close.'
      : 'Bot stopped.');
    this._scheduleReclaim();
    this._shutdownIfIdle();
  }

  _shutdownIfIdle() {
    if (this.running || this.positions.size) return;
    if (this.recorder && !this.recorder.closed) this.recorder.close();
    this.wantWs = false;
    clearTimeout(this._portalRetry);
    this._portalOnly = false;
    this._subbed = new Set();
    if (this.chain) { this.chain.stop(); this.chain.removeAllListeners(); this.chain = null; }
    if (this.ws) { try { this.ws.close(); } catch (_) {} this.ws = null; }
    this.connected = false;
    if (this._loop) { clearInterval(this._loop); this._loop = null; }
    if (this._marketTimer) { clearInterval(this._marketTimer); this._marketTimer = null; }
    clearTimeout(this._hotStart);
    clearTimeout(this._marketStart);
    if (this._hotTimer) { clearInterval(this._hotTimer); this._hotTimer = null; }
    if (this._posTimer) { clearInterval(this._posTimer); this._posTimer = null; }
    this.tokens.clear();
  }

  _connect() {
    this.wantWs = true;
    const src = this.s.feedSource;
    if (src === 'pumpportal' || this._portalOnly) return this._connectPortal(PUMPPORTAL_WS, 'pumpportal');
    if (src === 'geyser') {
      // Asked for explicitly and not configured: say so instead of quietly pretending the desk is on the fast stream.
      if (!this._geyserWs()) {
        this._log('warn', 'The Geyser stream is selected but no endpoint is set, so the desk is using the public blockchain feed instead (Settings → Geyser endpoint).');
        return this._startChain(false);
      }
      return this._startChain(true);
    }
    const pumpdev = this._pumpdevUrl();
    if (src === 'pumpdev') return this._connectPortal(pumpdev, 'pumpdev');
    // RULE CHANGED 2026-11-06 (1.0.9, measured): the automatic order used to prefer PumpDev whenever a key existed, and
    // PumpDev caps how many coins a stream may watch (its free plan: 25 per IP, then it drops to 12 and says so). A
    // sniper that can only watch twelve coins is slower than one watching the whole program. So: a Geyser endpoint
    // first, then the chain feed when this machine has a private socket or node to read it from, then PumpDev, and the
    // public nodes last. PumpDev also stays the safety net inside `_fallback`.
    if (src !== 'chain' && this._geyserWs()) return this._startChain(true);
    if (src !== 'chain' && (this._wsUrl(this.s.rpcWsUrl) || this.s.rpcUrl || this.s.rpcBackupUrl)) return this._startChain(false);
    if (pumpdev) return this._connectPortal(pumpdev, 'pumpdev');
    this._startChain(false);
  }

  _pumpdevUrl() {
    const key = String(this.s.pumpdevKey || '').trim();
    if (!key) return '';
    const bare = (key.match(/[?&](?:api-key|key)=([^&]+)/) || [])[1] || key;
    return `${PUMPDEV_WS}?key=${encodeURIComponent(bare)}`;
  }

  /** Primary feed: decode Pump.fun program logs straight from a Solana RPC websocket (no data API). */
  _startChain(geo = null) {
    if (this.chain) return;
    const geyser = geo === null ? Boolean(this._geyserWs()) : geo;
    const feed = new ChainFeed({
      customRpcs: [this.s.rpcUrl, this.s.rpcBackupUrl].filter(Boolean),
      customWs: geyser ? this._geyserWs() : this._wsUrl(this.s.rpcWsUrl),
      geyser,
    });
    this.chain = feed;
    this.feedSource = geyser ? 'geyser' : 'chain';
    this._chainAt = Date.now();
    this._lastEv = 0;
    feed.on('event', (ev) => { this._lastEv = Date.now(); this.ingest(ev); });
    feed.on('status', (st) => {
      this.connected = st.connected;
      if (!st.connected) return;
      this._chainAt = Date.now();
      const where = new URL(st.url.replace(/^wss?/, 'http')).hostname;
      const mine = Boolean(this.s.rpcWsUrl) || Boolean(this.s.rpcUrl);
      const onPublic = /api\.mainnet-beta\.solana\.com|solana-rpc\.publicnode\.com/.test(st.url);
      // A private socket that refused and let the desk fall onto a public node is the single most common reason a paid
      // setup still feels slow, and it used to be invisible. Said once a minute, with the address, so it can be fixed.
      if (onPublic && mine && (!this._pubWarnAt || Date.now() - this._pubWarnAt > 60000)) {
        this._pubWarnAt = Date.now();
        this._log('warn', `The feed is on a PUBLIC node (${where}), not on your own socket. A private socket that refuses (a missing key answers 401) leaves the desk slower than the one you paid for - check the WebSocket URL in Settings.`);
      } else if (!onPublic) {
        this._log('ok', geyser
          ? `Reading Pump.fun through a Geyser stream (${where}): every transaction arrives with its logs, which is the same data as the public feed but closer to the validator.`
          : 'Reading Pump.fun straight from your own node (' + where + ').');
      }
    });
    feed.on('giveup', () => this._fallback(geyser ? 'the Geyser endpoint did not answer' : 'could not reach a node that allows log streaming'));
    feed.on('error', (e) => this._fallback(e.message));
    feed.start();
  }

  /**
   * RULE ADDED 2026-11-06 (1.0.9, measured on a live configuration): a provider's socket often needs the same key its
   * HTTP endpoint carries, and a socket URL pasted without it answers **401**. The desk then fell back to public nodes
   * silently - a paid node, and the feed was the slowest one in the room. The key is copied across as the same
   * name=value pair the RPC URL uses, so `?key=` for one provider and `?api-key=` for another both work, and a socket
   * URL that already carries a key is never touched.
   */
  _wsUrl(raw) {
    let url = String(raw || '').trim();
    if (!url) return '';
    if (!/^wss?:\/\//.test(url)) url = url.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
    if (/[?&](api-key|key|token)=/.test(url)) return url;
    const query = (String(this.s.rpcUrl || '').match(/[?&](api-key|key|token)=([^&\s]+)/));
    if (!query) return url;
    return url + (url.includes('?') ? '&' : '?') + query[1] + '=' + query[2];
  }

  /**
   * The Geyser-class socket, if one is configured. Accepts what providers actually hand out: `https://` (converted to
   * `wss://`), `wss://` as-is, and a separate token that is appended as `?api-key=` when the URL carries no key.
   */
  _geyserWs() {
    let url = String(this.s.geyserUrl || '').trim();
    if (!url) return '';
    const token = String(this.s.geyserToken || '').trim();
    if (token && !/[?&](api-key|key|token)=/.test(url)) url += (url.includes('?') ? '&' : '?') + 'api-key=' + encodeURIComponent(token);
    return url.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
  }

  _fallback(reason) {
    if (!this.chain) return;
    if (this.s.feedSource === 'chain') {
      // A feed that is set to the chain keeps retrying, and each retry reports again: said once a minute instead of
      // once every five seconds, because a wall of identical warnings hides the line that matters.
      if (this._chainWarnAt && Date.now() - this._chainWarnAt < 60000) return;
      this._chainWarnAt = Date.now();
      this._log('warn', 'On-chain feed problem: ' + reason + ' (retrying)');
      return;
    }
    this.chain.stop(); this.chain.removeAllListeners(); this.chain = null;
    this._portalOnly = true;
    const pumpdev = this._pumpdevUrl();
    if (pumpdev) {
      this._log('warn', `On-chain feed unavailable (${reason}). Using the PumpDev trade stream instead.`);
      return this._connectPortal(pumpdev, 'pumpdev');
    }
    this._log('warn', `On-chain feed unavailable (${reason}). Using PumpPortal - launches only, so prices come from the market scan. A PumpDev key in Settings brings the full trade stream back.`);
    this._connectPortal(PUMPPORTAL_WS, 'pumpportal');
  }

  _connectPortal(url, label = 'pumpportal') {
    this.wantWs = true;
    this.feedSource = label;
    this._feedLabel = label;
    if (this.ws) return;
    if (!url) {
      this._log('warn', 'No trade stream configured - prices come from the market scan.');
      return;
    }
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.on('open', () => {
      this.connected = true;
      ws.send(JSON.stringify({ method: 'subscribeNewToken' }));
      this._subbed = new Set();
      if (label === 'pumpdev') this._syncSubscriptions();
      this._log('ok', label === 'pumpdev'
        ? 'Connected to the PumpDev stream (launches and trades).'
        : 'Connected to PumpPortal (launches only).');
    });
    ws.on('message', (d) => { if (this.ws === ws) this._onMessage(d.toString()); });
    ws.on('close', () => {
      if (ws !== this.ws) return;
      this.connected = false;
      this.ws = null;
      if (this.wantWs) this._portalRetry = setTimeout(() => {
        if (!this.wantWs || this.ws || this.chain) return;
        if (this.s.feedSource === 'auto') this._startChain();
        else this._connectPortal(url, label);
      }, 2500);
    });
    ws.on('error', (e) => {
      this._log('warn', 'Feed error: ' + e.message);
      if (/CONNECTION_LIMIT/.test(e.message)) this._log('warn', 'This PumpDev key is already in use by another window.');
    });
  }

  _send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  _syncSubscriptions() {
    if (this._feedLabel !== 'pumpdev') return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const now = Date.now();
    // The smaller budget is a loan, not a sentence: once the allowance has been quiet for ten minutes the desk asks
    // for its usual set again, and if the plan refuses that too it simply shrinks once more.
    if (this._subBudget < SUB_BUDGET && this._subLimitAt && now - this._subLimitAt > 600000) {
      this._subBudget = SUB_BUDGET;
      this._subLimitAt = 0;
    }
    const budget = this._subBudget || SUB_BUDGET;
    const all = [...this.tokens.values()].filter((t) => t.status !== 'skipped' && t.mc > 0);
    const byMint = new Map(all.map((t) => [t.mint, t]));
    const keep = new Map();
    for (const mint of this.positions.keys()) keep.set(mint, Infinity);            // never replaced
    const watched = [...this._subbed]
      .filter((mint) => !keep.has(mint) && byMint.has(mint))
      .sort((a, b) => byMint.get(b).score - byMint.get(a).score);
    for (const mint of watched) { if (keep.size >= budget) break; keep.set(mint, byMint.get(mint).score); }
    const fresh = all.filter((t) => !keep.has(t.mint)).sort((a, b) => b.score - a.score);
    const MARGIN = 8;                                                              // a coin must be clearly better
    const QUIET_MS = 5000;                                                         // and the one it replaces quiet
    for (const t of fresh) {
      if (keep.size < budget) { keep.set(t.mint, t.score); continue; }
      let weakest = null;
      for (const [mint, score] of keep) if (score !== Infinity && (!weakest || score < weakest.score)) weakest = { mint, score };
      if (!weakest || t.score < weakest.score + MARGIN) break;                      // the rest are no better either
      const rec = byMint.get(weakest.mint);
      if (rec && now - (rec.lastActivity || 0) < QUIET_MS) continue;
      keep.delete(weakest.mint);
      keep.set(t.mint, t.score);
    }
    const want = new Set(keep.keys());
    const add = [...want].filter((m) => !this._subbed.has(m));
    // Only coins that lost their slot are released: a tick that changes nothing sends nothing.
    const drop = [...this._subbed].filter((m) => !want.has(m));
    if (add.length) {
      this._send({ method: 'subscribeTokenTrade', keys: add });
      for (const m of add) this._subbed.add(m);
    }
    if (drop.length) {
      this._send({ method: 'unsubscribeTokenTrade', keys: drop });
      for (const m of drop) this._subbed.delete(m);
    }
    if (!this._subNote && this._subBudget >= SUB_BUDGET && want.size >= budget) {
      this._subNote = true;
      this._log('info', `Trade stream is watching ${want.size} coins at once (plan limit). Every other coin is scored from market data.`);
    }
  }

  /** Public so tests can inject events. */
  ingest(m) {
    if (!m || !m.mint || !m.txType) return;
    if (m.txType === 'create') this._onCreate(m);
    else if (m.txType === 'buy' || m.txType === 'sell') {
      if (m.fromChain && !this.tokens.has(m.mint)) this._adoptHot(m);
      this._onTrade(m);
    }
  }

  /** A coin we did not see launch (already trending) shows real buying on-chain - start tracking it. */
  _adoptHot(m) {
    const s = this.s;
    if (!this.running || !s.trendMode || m.txType !== 'buy') return;
    const mc = Number(m.marketCapSol) || 0;
    if ((Number(m.solAmount) || 0) < 0.3 || mc < s.minMcSol || mc > s.maxMcSol * 1.2) return;
    if (this.tokens.size >= MAX_TRACKED) this._prune(true);
    if (this.tokens.size >= MAX_TRACKED) return;
    const now = Date.now();
    this.tokens.set(m.mint, {
      mint: m.mint, name: 'Trending coin', symbol: m.mint.slice(0, 4) + '…', creator: null, creatorUnknown: true,
      createdAt: now - (s.entryWindowSec + 1) * 1000, mc, mcHist: [[now, mc]], trades: [], devSold: false, devBuySol: 0,
      status: 'watching', score: 0, reason: 'Spotted on-chain', lastActivity: now, trending: true,
      launched: true, sources: new Set(['chain']), lastStreamAt: now,
    });
    this.stats.seen++;
  }

  _onMessage(raw) {
    let m;
    try { m = JSON.parse(raw); } catch (_) { return; }
    if (m.type === 'error' || m.code) {
      if (m.code === 'CONNECTION_LIMIT') this._log('warn', 'The PumpDev key is already connected somewhere else - close the other window.');
      else if (m.message) {
        this._log('warn', 'Feed: ' + m.message);
        if (/live subscriptions|reached it|upgrade your plan/i.test(String(m.message)) && this._subBudget > SUB_BUDGET_LIMITED) {
          this._subBudget = SUB_BUDGET_LIMITED;
          this._subLimitAt = Date.now();
          this._log('info', `The trade stream now watches ${SUB_BUDGET_LIMITED} coins at once: your open positions first, then the best candidates.`);
          this._syncSubscriptions();
        }
      }
      return;
    }
    this.ingest(m);
  }

  _onCreate(m) {
    if (this.tokens.has(m.mint) || !this.running) return;
    const now = Date.now();
    const mc = Number(m.marketCapSol) || 0;
    this.stats.launches++;
    this.launchTimes.push(now);
    if (this.launchTimes.length > 500) this.launchTimes.shift();
    const t = {
      mint: m.mint, name: String(m.name || '').slice(0, 40), symbol: String(m.symbol || '?').slice(0, 12),
      unsupported: Boolean(m.quoteMint && m.quoteMint !== WSOL),
      creator: m.fromChain ? m.creator : m.traderPublicKey, createdAt: now, mc, mcHist: mc > 0 ? [[now, mc]] : [],
      trades: [], devSold: false, status: 'watching', score: 0, reason: 'New launch', lastActivity: now,
      devBuySol: Number(m.solAmount) || 0, launched: true, sources: new Set(['launch']), lastStreamAt: now,
    };
    this.tokens.set(t.mint, t);
    this.stats.seen++;
    if (this.tokens.size > MAX_TRACKED) this._prune(true);
  }

  /**
   * The copy roster, parsed once per change: the shipped `copyWallets` is a string a person types, so it may carry
   * commas, newlines or spaces between addresses. A bad token is dropped rather than thrown, because a half-typed
   * address must never turn the desk off - and it must never silently widen what is watched either.
   */
  _copySet() {
    const raw = String(this.s.copyWallets || '');
    if (raw === this._copyRaw && this._copyCache) return this._copyCache;
    const set = new Set();
    for (const word of raw.split(/[\s,;]+/)) {
      const w = word.trim();
      if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(w)) set.add(w);
      if (set.size >= 20) break;
    }
    this._copyRaw = raw;
    this._copyCache = set;
    return set;
  }

  /** Is this trader one of the wallets we follow? */
  _isCopyWallet(who) {
    const set = this._copySet();
    return Boolean(who) && set.has(String(who));
  }

  /**
   * A followed wallet bought something we are watching. The coin is entered NOW, without waiting for the score, the
   * buyer bar or the five minute band - that is the whole point of following somebody - but every guard that protects
   * the money still applies inside `_buy`, and two things refuse outright here: a mint quoted in another token, and a
   * creator who has already sold his own launch.
   */
  _copyBuy(t, now, who) {
    if (!this.running || t.status !== 'watching') return;
    if (t.unsupported) { t.reason = 'Copied, but quoted in another token'; return; }
    if (t.devSold) { t.reason = 'Copied, but the creator already sold'; return; }
    const short = String(who).slice(0, 4);
    const ev = {
      score: Number(t.score) || 0, pass: true, reason: `Copied ${short}`, trending: Boolean(t.trending),
      m: { buyers: Number(t.buyers) || 0, net: Number(t.net) || 0, buys: 0, sells: 0, topShare: 0, growth: Number(t.growth) || 0 },
    };
    this._log('info', `Copy: ${short} just bought ${t.symbol || t.mint.slice(0, 4)} - entering through the usual money guards.`);
    // The pet's whale alert listens to this: a followed wallet opening is the one event worth a bubble of its own.
    this.emit('copy', { wallet: String(who), mint: t.mint, symbol: t.symbol || null, name: t.name || null, mc: t.mc || null });
    this._buy(t, ev);
  }

  _onTrade(m) {
    const t = this.tokens.get(m.mint);
    if (!t) return;
    const now = Date.now();
    const mc = Number(m.marketCapSol);
    if (!m.traderPublicKey || !Number.isFinite(Number(m.solAmount)) || Number(m.solAmount) <= 0) return;
    t.lastStreamAt = now;
    if (mc > 0) {
      t.mc = mc;
      t.mcHist.push([now, mc]);
      if (t.mcHist.length > 150) t.mcHist.shift();
    }
    t.lastActivity = now;
    this._recordTick(t);
    const side = m.txType;
    if (m.traderPublicKey === t.creator) {
      if (side === 'sell') {
        t.devSold = true;
        if (m.fromChain && t.launched && now - t.createdAt < 30000) {
          if (this.earlyCreatorSales.size >= 2048) this.earlyCreatorSales.delete(this.earlyCreatorSales.keys().next().value);
          this.earlyCreatorSales.set(t.creator, { mint: t.mint, at: now });
        }
      }
      else t.devBuySol = (t.devBuySol || 0) + (Number(m.solAmount) || 0);
    } else {
      t.trades.push({ ts: now, side, sol: Number(m.solAmount) || 0, trader: m.traderPublicKey });
      if (t.trades.length > TRADES_KEPT) t.trades.shift();
    }
    const p = this.positions.get(m.mint);
    if (p && mc > 0) {
      p.extRef = null;
      this._pricePosition(p, now);
    }
    if (this.running && t.status === 'watching' && side === 'buy' && now - (t.lastEval || 0) >= 40) {
      t.lastEval = now;
      this._evalOne(t, now);
    }
    // The copy roster is checked after the normal judgement, and only on a BUY: mirroring a sell would hand an exit
    // decision to somebody else's wallet, and the exit ladder in this app is the thing that keeps a winner.
    if (side === 'buy' && this._isCopyWallet(m.traderPublicKey)) this._copyBuy(t, now, m.traderPublicKey);
  }

  _evalOne(t, now, candidates) {
    const s = this.s;
    if (t.status !== 'watching') return;
    if (this._unsupported.has(t.mint)) { t.status = 'skipped'; t.reason = 'Quoted in another token, not SOL'; return; }
    const until = this.cooldowns.get(t.mint);
    if (until) {
      if (now < until) {
        t.reason = `Cooling down after a close (${Math.ceil((until - now) / 60000)} min)`;
        return;
      }
      this.cooldowns.delete(t.mint);
    }
    const age = (now - t.createdAt) / 1000;
    if (age < s.watchSec) { t.reason = 'Watching…'; return; }
    if (t.retryAt && now < t.retryAt) return;
    const ev = this._eval(t, now);
    t.score = ev.score;
    t.reason = ev.reason;
    t.buyers = ev.m.buyers;
    t.net = ev.m.net;
    t.growth = ev.m.growth;
    t.metricSource = ev.m.source;
    if (ev.dead) { t.status = 'skipped'; return; }
    if (ev.pass) {
      if (candidates) candidates.push({ token: t, evaluation: ev });
      else this._buy(t, ev);
    }
  }

  _startMarket() {
    if (this._marketTimer) return;
    this._marketBusy = false;
    // The three pollers are staggered on purpose: fired together they are a burst at a public host that answers with
    // a rate limit before it has served anything, and the first thing it refuses is a price an exit needs.
    this._marketStart = setTimeout(() => { if (this.running || this.positions.size) this._pollMarket(); }, 400);
    this._marketTimer = setInterval(() => this._pollMarket(), MARKET_EVERY_MS);
    this._hotStart = setTimeout(() => { this._hotTimer = setInterval(() => this._pollHot(), HOT_EVERY_MS); }, 800);
    this._posTimer = setInterval(() => this._pollPositions(), POS_EVERY_MS);
  }

  /** Prices for the open positions alone, on the shortest cadence the market allows. */
  async _pollPositions() {
    if (!this.positions.size) return;
    // One poll may still be in flight; a second is allowed after a tenth of a second, so a slow answer cannot shut the
    // feed for a whole cycle. Two in flight at once is the ceiling.
    if (this._posBusy >= 2 || (this._posBusy && Date.now() - this._posAt < 100)) return;
    this._posBusy = (this._posBusy || 0) + 1;
    this._posAt = Date.now();
    try {
      const mints = [...this.positions.keys()];
      // The curve price first, with no network in front of it. The stream already carries it, so an exit never waits
      // for a quote request to come back before it can see a move - that wait was the slowest part of a sell.
      const before = Date.now();
      for (const mint of mints) {
        const p = this.positions.get(mint);
        if (p) this._pricePosition(p, before);
      }
      const quiet = mints.filter((mint) => {
        const t = this.tokens.get(mint);
        return !(t && t.mc > 0 && before - (t.lastStreamAt || 0) < 2000);
      });
      const quick = quiet.length ? await this.market.prices(quiet).catch(() => new Map()) : new Map();
      const now = Date.now();
      for (const mint of mints) {
        const p = this.positions.get(mint);
        if (!p) continue;
        // A quote only replaces the previous one when a quote was actually asked for: zeroing it would take the
        // fallback away from a coin whose stream went quiet a moment ago.
        if (quick.has(mint)) {
          const row = quick.get(mint);
          p.pxPull = row ? row.priceUsd : 0;
          if (p.pxPull > 0) p.pxPullAt = now;
        }
        this._pricePosition(p, now);
      }
      if (now - (this._curveAt || 0) > CURVE_EVERY_MS) {
        this._curveAt = now;
        const blind = mints.filter((mint) => {
          const p = this.positions.get(mint);
          if (!p || p.closing) return false;
          const t = this.tokens.get(mint);
          const curveLive = t && t.mc > 0 && now - (t.lastStreamAt || 0) < 2000;
          const quoteFresh = p.pxPull > 0 && now - (p.pxPullAt || 0) < PX_STALE_MS;
          return !curveLive && !quoteFresh;
        });
        if (blind.length) {
          const curves = await readCurves((fn, opts) => this.rpcCall(fn, opts), blind).catch(() => new Map());
          const at = Date.now();
          for (const [mint, c] of curves) {
            const p = this.positions.get(mint);
            if (!p || p.closing) continue;
            // A graduated coin's curve stopped at the graduation figure: it is not a price any more, and using it made
            // a coin on PumpSwap look like it had fallen 70% (or risen 300%) the moment the fossil was first read.
            if (c.complete) continue;
            if (p.mc > 0 && c.mcSol > p.mc * CURVE_JUMP_UP) {
              const prev = p.pxOddCurve;
              p.pxOddCurve = c.mcSol;
              if (!(prev > 0 && Math.abs(c.mcSol / prev - 1) < 0.25)) continue;
            }
            p.mcPrev = p.mc;
            p.mc = c.mcSol;
            p.pxAt = at;
            p.pxSource = 'curve';
            this._pxDirty = true;
          }
        }
      }
      if (now - (this._posBoardAt || 0) > POS_BOARD_EVERY_MS) {
        this._posBoardAt = now;
        const quietHeld = mints.filter((mint) => {
          const t = this.tokens.get(mint);
          const p = this.positions.get(mint);
          // A position that asked for a fresh reading (see `PROFIT_FRESH_MS`) is asked for directly, even when its
          // stream is talking: the number the stream carried is the one that was already judged too old to sell on.
          if (p && p.wantPx && !p.closing) return true;
          return !(t && t.mc > 0 && now - (t.lastStreamAt || 0) < 2000);
        });
        if (quietHeld.length) {
          const rows = await this.market.enrich(quietHeld, true).catch(() => new Map());
          const at = Date.now();
          for (const [mint, row] of rows) {
            const p = this.positions.get(mint);
            if (!p || p.closing || !row || !(row.priceUsd > 0) || !this._ownPool(row, this.tokens.get(mint))) continue;
            p.pxPull = row.priceUsd;
            p.pxPullAt = at;
            this._pricePosition(p, at);
          }
        }
      }
      if (now - (this._posEnrichAt || 0) > 1200) {
        this._posEnrichAt = now;
        const rows = await this.market.enrich(mints, true);
        for (const [mint, row] of rows) {
          this._applyMarket(mint, row, { price: false });
          const p = this.positions.get(mint);
          const t = this.tokens.get(mint);
          const curveLive = t && t.mc > 0 && now - (t.lastStreamAt || 0) < 2000;
          const quoteFresh = p && p.pxPull > 0 && now - (p.pxPullAt || 0) < PX_STALE_MS;
          if (p && !curveLive && !quoteFresh && row.priceUsd > 0 && this._ownPool(row, t)) {
            p.pxPull = row.priceUsd;
            p.pxPullAt = Date.now();
            this._pricePosition(p, Date.now());
          }
        }
      }
      if (now - (this._lostAt || 0) > 3000) {
        this._lostAt = now;
        const lost = mints.filter((mint) => {
          const p = this.positions.get(mint);
          return p && !p.closing && now - (p.pxAt || p.bookedAt || now) > PX_DEAD_MS;
        });
        if (lost.length) {
          const rows = await this.market.enrich(lost, true).catch(() => new Map());
          const at = Date.now();
          for (const [mint, row] of rows) {
            const p = this.positions.get(mint);
            if (!p || p.closing || !row || !(row.priceUsd > 0) || !this._ownPool(row, this.tokens.get(mint))) continue;
            p.pxPull = row.priceUsd;
            p.pxPullAt = at;
            this._pricePosition(p, at);
          }
          this._lostAt = Date.now();
        }
      }
    } catch (_) {
      /* the wide sweep reports its own failures */
    } finally {
      this._posBusy--;
    }
  }

  _ownPool(row, t) {
    const dex = row && row.dexId ? String(row.dexId) : '';
    if (!dex) return true;
    if (t && t.graduated) return dex === 'pumpswap' || dex === 'pump-amm';
    return dex === 'pumpfun' || dex === 'pumpswap' || dex === 'pump-amm';
  }

  /**
   * How long the entry may wait for the pool's own price. A coin whose trade stream spoke within the last two seconds
   * has a price already, so the read is confirmation and gets 450 ms; otherwise the pool is the only number there is and
   * gets the full 700. Split out so the rule can be read (and tested) instead of living inside an options object.
   */
  _entryBudget(t) {
    const fresh = t && t.lastStreamAt && Date.now() - t.lastStreamAt < 2000;
    // RULE CHANGED 2026-11-05 (1.0.4): 450/700 ms down to 300/500. This wait is on the critical path of every entry, and a
    // node that cannot answer in half a second is a node to give up on rather than to hang the order behind (the entry is
    // refused, said on screen, and the next print comes in a moment). The fresh-tape case mostly never reaches here at all
    // now - see `_entryPrice`.
    return fresh ? 300 : 500;
  }

  _pricePosition(p, now = Date.now()) {
    if (p.closing) return;
    // A holding adopted from the wallet can arrive with no reference price. The first price it is seen at becomes
    // the reference, so the rules measure the move from where it was found instead of dividing by nothing.
    if (!(p.entryMc > 0) && p.mc > 0) { p.entryMc = p.mc; p.peakMc = p.mc; }
    const t = this.tokens.get(p.mint);
    if (t && t.mc > 0 && now - (t.lastStreamAt || 0) < 2000) {
      const next = t.mc;
      const seeded = p.pxSeed && p.pxSource === 'curve';
      const bar = seeded ? 0.2 : WILD_MOVE_FRAC;
      // RULE ADDED 2026-11-05 (1.0.2, measured on a live trade: a position that peaked at +30.7% was booked 28 points under its level and lost 13.1%,
      // -13.1%`): a FALL is the market and is taken on the first reading, exactly as the quote lane has always done.
      // Holding a fall back until a "clean" second print was the whole gap: consecutive prints of a dying coin are 25%
      // and 30% apart, the guard demanded two within 10%, so the position sat on the stale price while the coin
      // collapsed and then booked the first print that happened to look tidy - 28 points under the level it fired at.
      // The second look is kept for what it was written for: a spike UP, and a fall away from an entry that was itself
      // somebody else's number (a market-board price rather than the pool's own).
      const falling = p.mc > 0 && next < p.mc;
      const trustedEntry = seeded || p.pxEntry === 'curve';
      if (p.mc > 0 && !(falling && trustedEntry) && Math.abs(next / p.mc - 1) > bar) {
        const prev = p.pxOddChain;
        p.pxOddChain = next;
        if (!(prev > 0 && Math.abs(next / prev - 1) < 0.1)) return;
      }
      p.pxOddChain = 0;
      p.pxSeed = false;
      p.mcPrev = p.mc;
      p.mc = next;
      p.pxAt = now;
      p.pxSource = 'chain';
      p.wantPx = 0;
      this._pxDirty = true;
      return;
    }
    const px = p.pxPull;
    // A quote is only a price while it is recent. One that stopped being refreshed is the last thing known about the
    // coin, not what it is worth now, and a rule must not fire on it as if it were live.
    if (!(px > 0) || now - (p.pxPullAt || 0) > PX_STALE_MS) return;
    if (!p.extRef || !(p.extRef.priceUsd > 0)) {
      p.extRef = { priceUsd: px, mc: p.mc };
      p.pxSource = 'quote';
      // The anchor IS this reading: the price did not move, and that has to count as a fresh look at the coin, or a
      // position whose first quote arrived late would look unseen and be sold by the watchdog below.
      p.pxAt = now;
      p.wantPx = 0;
      this._pxDirty = true;
      return;
    }
    const next = p.extRef.mc * (px / p.extRef.priceUsd);
    if (p.mc > 0 && next > p.mc && (next / p.mc - 1) * 100 > MAX_TICK_JUMP_PCT) {
      // A separate slot from the curve's: a quote and a curve reading are two different pools, so one cannot be the
      // second opinion the other needs.
      const prev = p.pxOddQuote;
      p.pxOddQuote = next;
      if (!(prev > 0 && Math.abs(next / prev - 1) < 0.25)) return;
    }
    p.mcPrev = p.mc;
    p.mc = next;
    p.pxAt = now;
    p.pxSource = 'quote';
    p.wantPx = 0;
    this._pxDirty = true;
  }

  _pnlView(p) {
    if (!(p.entryMc > 0) || !(p.mc > 0)) return null;
    const v = this._pnlPct(p);
    return Number.isFinite(v) ? v : null;
  }

  _openPositions() {
    return [...this.positions.values()].filter((p) => p.priced !== false);
  }

  /** The open positions exactly as the panel draws them: small enough to push twenty times a second. */
  _positionsView() {
    const now = Date.now();
    return this._openPositions().map((p) => ({
      mint: p.mint, symbol: p.symbol, pnlPct: this._pnlView(p), mc: p.mc, solIn: p.solIn,
      heldSec: Math.round((now - p.openedAt) / 1000), status: p.status, paper: p.paper,
      pending: Boolean(p.pending), closing: Boolean(p.closing),
      pxAgeSec: p.pxAt ? Math.round((now - p.pxAt) / 1000) : null,
    }));
  }

  /** Push the positions when a price moved since the last push, and never on a quiet tick. */
  _pushPositions() {
    if (!this.positions.size || !this._pxDirty) return;
    this._pxDirty = false;
    this.emit('positions', this._positionsView());
  }

  // Prices for the coins that matter - open positions first, then the best candidates - refreshed about once a
  // second, so an exit never reads a quote that is minutes old. The wide sweep below keeps the rest honest.
  async _pollHot() {
    if (this._hotBusy) return;
    if (!this.market.ready()) return;
    const targets = [...this.positions.keys()];
    const ranked = [...this.tokens.values()]
      .filter((t) => !this.positions.has(t.mint) && t.status !== 'skipped' && t.score > 0)
      .sort((a, b) => b.score - a.score);
    for (const t of ranked) {
      if (targets.length >= HOT_BATCH) break;
      targets.push(t.mint);
    }
    if (!targets.length) return;
    // The exchange rate is what turns a dollar figure into SOL, and every market-priced coin is judged on that
    // conversion. Asking for it here means a session with the market scan switched off still learns it.
    if (!this.market.solPrice() && !targets.includes(WSOL)) targets.unshift(WSOL);
    this._hotBusy = true;
    try {
      const rows = await this.market.enrich(targets.slice(0, HOT_BATCH));
      for (const [mint, row] of rows) this._applyMarket(mint, row);
    } catch (_) {
      /* the wide sweep reports its own failures */
    } finally {
      this._hotBusy = false;
    }
  }

  async _pollMarket() {
    const holding = this.positions.size > 0;
    if ((!this.running && !holding) || this._marketBusy) return;
    if (!this.market.ready()) return;
    this._marketBusy = true;
    try {
      if (this.running && this.s.marketScan) {
        const found = await this.market.discover(this.s.wideDiscovery !== false);
        let added = 0;
        for (const c of found) if (this._adopt(c)) added++;
        if (added > 4) this._log('info', `Market scan: ${added} new coins (${this.tokens.size} tracked).`);
        if (!this.market.solPrice()) await this.market.enrich([WSOL]);
      }
      const all = [...this.tokens.keys()].concat([...this.positions.keys()]);
      if (!all.length) return;
      const batch = [];
      for (let i = 0; i < all.length && batch.length < ENRICH_PER_CYCLE; i++) {
        this._enrichCursor = ((this._enrichCursor || 0) + 1) % all.length;
        batch.push(all[this._enrichCursor]);
      }
      const rows = await this.market.enrich(batch);
      for (const [mint, row] of rows) this._applyMarket(mint, row);
    } catch (e) {
      this._log('warn', 'Market scan: ' + e.message);
    } finally {
      this._marketBusy = false;
    }
  }

  _marketError(e) {
    this._marketFails = (this._marketFails || 0) + 1;
    const now = Date.now();
    const host = e && e.host ? String(e.host) : 'market data';
    const where = e && e.host ? `${host}: ${e.message}` : e.message;
    this._hostDown = this._hostDown || {};
    // The count is per host: one shared counter printed next to whichever source failed last said "jup-price: 28
    // calls" when most of those twenty-eight were somebody else's refusals.
    this._hostFails = this._hostFails || {};
    const first = !this._hostDown[host];
    this._hostDown[host] = this._hostDown[host] || now;
    this._hostFails[host] = (this._hostFails[host] || 0) + 1;
    if (first || !this._marketWarnAt || now - this._marketWarnAt >= 60000) {
      const n = this._hostFails[host];
      this._marketWarnAt = now;
      this._hostFails[host] = 0;
      // A refused source is named, because "rate limited" alone told nobody WHICH door was shut: on 2026-11-05 the
      // whole Jupiter API and GeckoTerminal refused this address for hours while DexScreener answered normally.
      this._log('warn', first
        ? `Market data: ${where}. Every other door keeps working, a coin already held keeps its price, and new coins come in from the doors that answer.`
        : `Market data: still ${where} (${n} call${n > 1 ? 's' : ''} refused in the last minute, retrying quietly)`);
      return;
    }
  }

  _makeRoom() {
    if (this.tokens.size < MAX_TRACKED) return true;
    this._prune(true);
    if (this.tokens.size < MAX_TRACKED) return true;
    const spare = [...this.tokens.values()]
      .filter((t) => !this.positions.has(t.mint) && t.status !== 'bought')
      .sort((a, b) => (a.score - b.score) || (a.lastActivity - b.lastActivity));
    // A quarter of the map at a time: one eviction per newcomer would re-sort 400 coins on every launch.
    for (const t of spare) {
      if (this.tokens.size < MAX_TRACKED * 0.75) break;
      this.tokens.delete(t.mint);
    }
    return this.tokens.size < MAX_TRACKED;
  }

  _adopt(c) {
    if (!c?.mint || this.tokens.has(c.mint)) return false;
    if (!this._makeRoom()) return false;
    const now = Date.now();
    const hint = c.hint || null;
    const solUsd = this.market.solPrice();
    const hintMc = hint
      ? hint.priceNative > 0
        ? hint.priceNative * 1e9
        : solUsd > 0 && hint.mcapUsd > 0
          ? hint.mcapUsd / solUsd
          : 0
      : 0;
    const tok = {
      mint: c.mint,
      name: hint?.name || 'New coin',
      symbol: hint?.symbol || c.mint.slice(0, 4),
      creator: hint?.creator || null,
      creatorUnknown: !hint?.creator,
      createdAt: now - (this.s.entryWindowSec + 1) * 1000,
      launchedAt: hint?.createdAt || 0,
      mc: hintMc,
      mcHist: hintMc > 0 ? [[now, hintMc]] : [],
      trades: [],
      devSold: false,
      devBuySol: 0,
      status: 'watching',
      score: 0,
      reason: 'New from ' + c.source,
      lastActivity: now,
      trending: true,
      launched: Boolean(c.launched),
      sources: new Set([c.source]),
      ext: hint ? { ...hint, mcSol: hintMc, at: now } : null,
    };
    // A coin the discovery door already knows is on PumpSwap is graduated from its first second, exactly as if the
    // board had said so (see `_markMarket`).
    this._markMarket(tok, hint && hint.dexId);
    this.tokens.set(c.mint, tok);
    this.stats.seen++;
    return true;
  }

  _markMarket(t, dexId) {
    if (!t || !dexId) return;
    if (dexId === 'pumpswap' || dexId === 'pump-amm') { t.graduated = true; return; }
    // RULE CHANGED 2026-11-05 (1.0.2: a four minute hold showed a peak read from a graduated curve, not from a market): a coin
    // that has traded on PumpSwap KEEPS its own market. Its old pump.fun pair stays listed for ever, frozen at the
    // graduation figure, and a row from it is not evidence that the coin came back to the curve - treating it as such let
    // a fossil set the market cap (and un-graduate a coin that then got bought as a launch).
    if (dexId === 'pumpfun' && !t.graduated) t.graduated = false;
  }

  _applyMarket(mint, row, opts = {}) {
    const t = this.tokens.get(mint);
    const solUsd = this.market.solPrice();
    const quotedInSol = !row.quoteMint || row.quoteMint === WSOL;
    const mcSol = quotedInSol && row.priceNative > 0 ? row.priceNative * 1e9 : solUsd > 0 ? row.mcapUsd / solUsd : 0;
    const now = Date.now();
    if (!t) return;
    if (!t.launched && !this.market.isPumpCoin(row)) {
      t.status = 'skipped';
      t.reason = 'Not a Pump.fun coin';
      return;
    }
    // The dex tells the two markets apart, and the buy route uses it: the bonding curve is `pump`, a graduated coin
    // is `pump-amm` (see `_markMarket`).
    this._markMarket(t, row.dexId);
    const foreignPool = Boolean(row.dexId) && row.dexId !== 'pumpfun' && row.dexId !== 'pumpswap' && row.dexId !== 'pump-amm';
    t.ext = { ...row, mcSol, at: now, foreignPool };
    if (row.symbol && row.symbol !== '?') t.symbol = row.symbol;
    if (row.name) t.name = row.name;
    if (row.pairCreatedAt > 0) t.launchedAt = row.pairCreatedAt;
    // RULE CHANGED 2026-11-05 (1.0.2: a coin held four minutes showed a peak of +3102% that was a graduated curve, not a market,
    // while the take profit booked +77.6%): the exchange filter is not enough on its own. A GRADUATED coin keeps its old
    // pump.fun pair listed, frozen at the graduation figure, and a `pumpfun` row is not "foreign" - so it was allowed to
    // set the market cap of a coin that trades on PumpSwap and produce a thirty-one-fold "peak" out of a fossil. The
    // rule is the same one the position price lane uses (`_ownPool`), applied where the market cap is written.
    if (mcSol > 0 && this._ownPool(row, t) && now - (t.lastStreamAt || 0) > STREAM_FRESH_MS) {
      t.mc = mcSol;
      t.mcHist.push([now, mcSol]);
      if (t.mcHist.length > 150) t.mcHist.shift();
      t.lastBoardAt = now;
      this._recordTick(t);
    }
    const p = this.positions.get(mint);
    if (p && !foreignPool && row.priceUsd > 0 && opts.price !== false && !(p.pxPull > 0)) { p.pxPull = row.priceUsd; p.pxPullAt = now; }
  }

  _prune(force) {
    const now = Date.now();
    for (const [mint, t] of this.tokens) {
      if (this.positions.has(mint)) continue;
      const age = (now - t.createdAt) / 1000;
      const idle = (now - t.lastActivity) / 1000;
      // RULE CHANGED 2026-11-05 (1.0.3: the tracked-coin figure fell as the working set was pruned): the working set was trimmed
      // after two minutes of quiet, and the sweep then adopted the same coins again - a sawtooth the eye reads as a bug.
      // A quiet coin is now kept for four minutes (six when the map is full), which is still shorter than any coin's useful
      // life on this market and stops the churn.
      if (age > 1200 || t.status === 'skipped' || (idle > 240 && age > this.s.entryWindowSec) || (force && idle > 60)) {
        this.tokens.delete(mint);
      }
    }
  }

  _metrics(t, now, winSec) {
    const from = now - winSec * 1000;
    let buys = 0, sells = 0, bv = 0, sv = 0;
    const buyers = new Set();
    const per = new Map();
    for (let i = t.trades.length - 1; i >= 0; i--) {
      const x = t.trades[i];
      if (x.ts < from) break;
      if (x.side === 'buy') { buys++; bv += x.sol; buyers.add(x.trader); per.set(x.trader, (per.get(x.trader) || 0) + x.sol); } else { sells++; sv += x.sol; }
    }
    let base = t.mc;
    for (const [ts, mc] of t.mcHist) { if (ts >= from) { base = mc; break; } }
    const ext = t.ext;
    const marketFresh = Boolean(ext && ext.at && now - ext.at < 60000);
    // The five minute change is the market's own reading. It is kept beside the stream's growth so the entry rule
    // can refuse a coin that a single fresh trade makes look alive while the coin is really falling.
    const marketGrowth = marketFresh && typeof ext.change5m === 'number' ? ext.change5m / 100 : null;
    const streamFresh = now - (t.lastStreamAt || 0) < 15000;
    if ((buys || sells) && streamFresh) {
      let top = 0; for (const v of per.values()) if (v > top) top = v;
      return { buys, sells, buyers: buyers.size, net: bv - sv, growth: base > 0 ? t.mc / base - 1 : 0, topShare: bv > 0 ? top / bv : 0, source: 'stream', windowSec: winSec, marketGrowth };
    }
    if (marketFresh) {
      const solUsd = this.market.solPrice();
      return {
        buys: ext.buys || 0,
        sells: ext.sells || 0,
        // A market row counts transactions, not wallets, so distinct buyers are estimated at half the buys. Every
        // rule that compares against a buyer bar treats this number as the same kind of estimate.
        buyers: Math.round((ext.buys || 0) / 2),
        net: solUsd > 0 ? (ext.netUsd || 0) / solUsd : 0,
        growth: (ext.change5m || 0) / 100,
        topShare: 0,
        source: 'market',
        windowSec: 300,
        marketGrowth,
      };
    }
    let top = 0; for (const v of per.values()) if (v > top) top = v;
    return { buys, sells, buyers: buyers.size, net: bv - sv, growth: base > 0 ? t.mc / base - 1 : 0, topShare: bv > 0 ? top / bv : 0, source: 'stream', windowSec: winSec, marketGrowth };
  }

  _eval(t, now) {
    const s = this.s;
    const age = (now - t.createdAt) / 1000;
    const m = this._metrics(t, now, 20);
    if (t.devSold) return { score: 0, pass: false, dead: true, reason: 'Creator sold', m };
    if (t.unsupported) return { score: 0, pass: false, dead: true, reason: 'Quoted in another token, cannot be bought here', m };
    if (s.mode === 'live' && s.minLiqUsd > 0 && !(t.ext && !t.ext.foreignPool && now - t.ext.at >= 0
      && now - t.ext.at < 60000 && t.ext.liqUsd >= s.minLiqUsd)) {
      return { score: 0, pass: false, dead: false, reason: 'Waiting for current pool liquidity', m };
    }
    if (s.mode === 'live' && (!t.creator || m.source !== 'stream' || !t.lastStreamAt || now - t.lastStreamAt > STREAM_FRESH_MS)) {
      return { score: 0, pass: false, dead: false, reason: 'Waiting for verified creator and fresh wallet-level trades', m };
    }
    const previousSale = this.earlyCreatorSales.get(t.creator);
    if (previousSale && previousSale.mint !== t.mint && now - previousSale.at < 3600000) {
      return { score: 0, pass: false, dead: false, reason: 'Creator sold another launch within its first 30 seconds', m };
    }
    const trending = age > s.entryWindowSec;
    if (trending && !s.trendMode) return { score: t.score, pass: false, dead: true, reason: 'Entry window closed', m };
    const external = m.source === 'market';
    // The row the entry was judged on. It carries the creator's bag, the pool's depth and the biggest buyer's share, and
    // both kinds of plan read them (see the simple branch below).
    const ext = t.ext;
    const maxMc = s.simpleMode ? s.maxMcSol : (external ? s.maxMcSol * 4 : s.maxMcSol);
    const coinAgeSec = (now - (Number(t.launchedAt) || Number(t.createdAt) || 0)) / 1000;
    const ageKnown = Number.isFinite(coinAgeSec) && coinAgeSec > 0;
    const minAge = Number(s.minTokenAgeSec) || 0;
    const maxAge = Number(s.maxTokenAgeSec) || 0;
    const tooYoung = minAge > 0 && (!ageKnown || coinAgeSec < minAge);
    const tooOld = ageKnown && maxAge > 0 && coinAgeSec > maxAge;
    const minScore = s.minScore + (t.creatorUnknown ? 10 : 0);
    const needBuyers = external ? Math.max(6, Math.round(s.minBuyers * 2)) : s.minBuyers;
    const needNet = external ? Math.max(0.4, Math.round(s.minNetFlowSol * 100) / 100) : s.minNetFlowSol;
    const ratio = m.buys / Math.max(1, m.buys + m.sells);
    // Two readings of the same coin: the stream's own window and the market's five minute change. The entry is
    // judged on the worse one, because a single fresh buy must never make a coin that fell 80% look alive.
    const growth = m.marketGrowth == null ? m.growth : Math.min(m.growth, m.marketGrowth);
    let score = Math.min(m.buyers, Math.max(4, needBuyers)) / Math.max(4, needBuyers) * 35
      + Math.min(Math.max(m.net, 0), needNet * 2) / Math.max(0.5, needNet * 2) * 30
      + ratio * 20
      + Math.min(Math.max(growth, 0), 0.3) / 0.3 * 15;
    if (m.sells > m.buys) score -= 15;
    score = Math.round(clamp(score, 0, 100));
    // A number that is not a number can never be "below the minimum": every comparison against NaN is false, so a
    // broken input would walk straight through the entry gate. Zero is what it is worth.
    if (!Number.isFinite(score)) score = 0;
    if (s.simpleMode) {
      let reason = '';
      if (ext && ext.mintRisk) reason = 'Creator can still mint more';
      else if (ext && ext.freezeRisk) reason = 'Token can be frozen';
      else if (!s.allowGraduated && t.graduated) reason = 'Graduated to PumpSwap';
      else if (t.unsupported) reason = 'Quoted in another token, cannot be bought here';
      else if (tooYoung) reason = `Too new (${Math.round(coinAgeSec)}s old, needs ${minAge}s)`;
      else if (tooOld) reason = `Too old (${Math.round(coinAgeSec / 60)} min)`;
      else if (ext && s.maxDevHoldPct > 0 && ext.devHoldPct >= s.maxDevHoldPct) reason = 'Creator holds too much';
      else if (t.devBuySol > s.maxDevBuySol) reason = 'Creator holds too much';
      else if (m.buys >= 3 && m.topShare > s.maxTraderSharePct / 100) reason = 'One wallet dominates buying';
      else if (ext && s.minLiqUsd > 0 && ext.liqUsd > 0 && ext.liqUsd < s.minLiqUsd) reason = 'Pool too thin';
      else if (t.mc <= 0) reason = 'Waiting for a price';
      else if (t.mc < s.minMcSol || t.mc > maxMc) reason = `Market cap out of range (${s.minMcSol}-${Math.round(maxMc)} SOL)`;
      else if (m.buyers < needBuyers) reason = external ? `Needs ${needBuyers} buyers in 5m (has ${m.buyers})` : `Needs ${needBuyers} buyers (has ${m.buyers})`;
      else if (s.maxBuyers > 0 && m.buyers > s.maxBuyers) reason = `Too many buyers (${m.buyers}, cap ${s.maxBuyers})`;
      else if (growth <= -0.3) reason = `Dumping hard (${(growth * 100).toFixed(0)}% in 5m)`;
      else if (growth < (trending ? 0.03 : 0)) reason = trending ? 'Not pumping yet' : 'Price falling';
      const dead = t.mc > maxMc * 1.5;
      return { score, pass: !reason, dead, reason: reason || 'Looks strong', m, trending };
    }
    let reason = '';
    if (ext && ext.mintRisk) reason = 'Creator can still mint more';
    else if (ext && ext.freezeRisk) reason = 'Token can be frozen';
    else if (!s.allowGraduated && t.graduated) reason = 'Graduated to PumpSwap';
    else if (t.unsupported) reason = 'Quoted in another token, cannot be bought here';
    else if (tooYoung) reason = `Too new (${Math.round(coinAgeSec)}s old, needs ${minAge}s)`;
    else if (tooOld) reason = `Too old (${Math.round(coinAgeSec / 60)} min)`;
    else if (ext && s.maxDevHoldPct > 0 && ext.devHoldPct >= s.maxDevHoldPct) reason = 'Creator holds too much';
    else if (t.devBuySol > s.maxDevBuySol) reason = 'Creator holds too much';
    else if (m.buys >= 3 && m.topShare > s.maxTraderSharePct / 100) reason = 'One wallet dominates buying';
    else if (growth <= -0.3) reason = `Dumping hard (${(growth * 100).toFixed(0)}% in 5m)`;
    else if (m.buys >= 5 && ratio < 0.35) reason = `Sellers in control (${m.buys} buys, ${m.sells} sells)`;
    else if (ext && s.minLiqUsd > 0 && ext.liqUsd > 0 && ext.liqUsd < s.minLiqUsd) reason = 'Pool too thin';
    else if (t.mc <= 0) reason = 'Waiting for a price';
    else if (t.mc < s.minMcSol || t.mc > maxMc) reason = `Market cap out of range (${s.minMcSol}-${Math.round(maxMc)} SOL)`;
    else if (m.buyers < needBuyers) reason = external ? `Needs ${needBuyers} buyers in 5m (has ${m.buyers})` : `Needs ${needBuyers} buyers (has ${m.buyers})`;
    // The ceiling of the same bar: past it the crowd is already in, and a small ticket is buying their exit.
    else if (s.maxBuyers > 0 && m.buyers > s.maxBuyers) reason = `Too many buyers (${m.buyers}, cap ${s.maxBuyers})`;
    else if (m.net < needNet) reason = `Needs +${needNet} SOL net buying`;
    // A coin that is falling right now is never bought, however good its tape looked a minute ago: measured on the
    // live market, entries into weakness produced the stop-loss and time-limit cluster that dominates the losses.
    else if (growth < (trending ? 0.03 : 0)) reason = trending ? 'Not pumping yet' : 'Price falling';
    // Buying a coin that has already run a long way is buying somebody else's exit. The ceiling is the profile's
    // own number, so it is a policy the user can move, and it is checked after the depth and dump guards.
    else if (s.maxChange5mPct > 0 && m.marketGrowth != null && m.marketGrowth * 100 > s.maxChange5mPct) {
      reason = `Already up ${(m.marketGrowth * 100).toFixed(0)}% in 5m`;
    }
    else if (s.minChange5mPct > 0 && m.marketGrowth != null && m.marketGrowth * 100 < s.minChange5mPct) {
      reason = `Only up ${(m.marketGrowth * 100).toFixed(0)}% in 5m, no move to join yet`;
    }
    // The holder bar, from the cache the buy path fills: once the count is known, a coin under it is refused here
    // without another request. The buy path itself enforces the bar on the freshest count.
    else if (s.deepEntry && s.minHolders > 0 && t.holders > 0 && t.holders < s.minHolders) {
      reason = `Needs ${s.minHolders} holders (has ${t.holders})`;
    }
    else if (score < minScore) reason = `Score ${score} below ${minScore}${t.creatorUnknown ? ' (creator unknown)' : ''}`;
    const dead = t.mc > maxMc * 1.5;
    return { score, pass: !reason, dead, reason: reason || 'Looks strong', m, trending };
  }

  _scan(now) {
    const all = [...this.tokens.values()];
    if (!all.length) return;
    // RULE ADDED 2026-11-05 (1.0.4: a half-empty book looked like a stalled bot): when the book
    // is not full, the diary says WHAT is holding it back, once a minute, as counts of the reasons the last evaluation
    // left on each coin. Free slots are almost never a speed problem - they are the entry bar doing its job, and that is
    // impossible to see from a screen that only shows the coins which passed.
    if (this.running && this.positions.size < this.s.maxPositions && (!this._slotsAt || now - this._slotsAt > 60000)) {
      this._slotsAt = now;
      const why = new Map();
      for (const t of all) {
        if (this.positions.has(t.mint) || t.status === 'bought') continue;
        const key = String(t.reason || 'not judged yet')
          .replace(/\d+/g, 'N')
          .replace(/N-N/g, 'N - N')
          .replace(/\s+/g, ' ')
          .trim();
        why.set(key, (why.get(key) || 0) + 1);
      }
      const top = [...why.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
      if (top.length) {
        this._log('info', `${this.positions.size} of ${this.s.maxPositions} slots busy. The rest of the market: `
          + top.map(([k, n]) => `${n} × ${k.charAt(0).toLowerCase()}${k.slice(1)}`).join(', ')
          + '. Lower the entry bar in Settings if you want the book filled faster.');
      }
    }
    const due = [];
    for (let i = 0; i < all.length && due.length < SCAN_PER_TICK; i++) {
      this._scanCursor = ((this._scanCursor || 0) + 1) % all.length;
      const t = all[this._scanCursor];
      if (now - (t.lastCheck || 0) < SCAN_GATE_MS) continue;
      t.lastCheck = now;
      due.push(t);
    }
    const candidates = [];
    for (const t of due) this._evalOne(t, now, candidates);
    candidates.sort((a, b) => b.evaluation.score - a.evaluation.score || b.evaluation.m.net - a.evaluation.m.net);
    for (const { token, evaluation } of candidates) this._buy(token, evaluation);
    if (now - (this._pruneAt || 0) > 10000) { this._pruneAt = now; this._prune(false); }
  }

  _riskHoldMs(rule, pnl, peak, source) {
    const s = this.s;
    const stop = Math.abs(Number(s.stopLossPct) || 0);
    if (source === 'curve') return 0;
    if (rule === 'Stop loss' && stop > 0 && pnl <= -stop * 2) return 0;
    if (/^Take profit/.test(rule)) {
    const target = rule === 'Take profit' ? Number(this.s.takeProfitPct) || 0 : Number(this.s.tp1Pct) || 0;
    if (target > 0 && pnl >= target + 5) return 0;
    }
    if (rule === 'Peak give-back' && Number.isFinite(peak) && pnl <= peak / 2 - 5) return 0;
    if (rule === 'Break even' && Number.isFinite(peak) && pnl <= -5) return 0;
    if (rule === 'Trailing stop') {
      const give = this._trailGive(peak);
      if (give > 0 && Number.isFinite(peak) && pnl <= peak - give * 2) return 0;
    }
    return Math.min(Math.max(0, Number(s.triggerHoldMs) || 0), STOP_HOLD_MS);
  }

  _trailGive(peak) {
    const floor = Math.max(0, Number(this.s.trailGivePct) || 0);
    const wide = Math.max(0, Number(peak) || 0) * TRAIL_GIVE_FRAC;
    return Math.max(floor, wide);
  }

  _pnlPct(p) {
    // A position with no reference price cannot be measured. Returning 0 instead of Infinity keeps every rule quiet
    // until a real price arrives, which is the only honest reading of "nobody knows what this cost".
    if (!(p.entryMc > 0) || !(p.mc >= 0)) return 0;
    if (p.paper) {
      const gross = p.solIn * p.mc / p.entryMc;
      const proceeds = gross * (1 - this._paperSlippage(this.tokens.get(p.mint), gross)) * (1 - FEE);
      const cost = p.solIn * (1 + FEE) + (p.feeBuy || 0);
      return cost > 0 ? (proceeds - this._feeFor(true) - cost) / cost * 100 : 0;
    }
    return (p.mc / p.entryMc - 1) * 100 - this._costPct(p);
  }

  _costPct(p) {
    const ticket = Math.max(0.001, Number(p.solIn) || 0);
    const entry = Number(p.feeBuy) || 0;
    const exit = Number(p.feeExitEst) || Number(this._feeFor(true)) || 0;
    const tips = ((entry + exit) / ticket) * 100;
    return FEE * 2 * 100 + (Number.isFinite(tips) ? tips : 0);
  }

  /**
   * A chain rejection as a sentence. The raw code stays available to the engine, but nothing a person reads should
   * ever contain `{"InstructionError":[3,{"Custom":6002}]}`.
   */
  _whyRejected(err) {
    const text = String(err || '');
    if (/6063|UnsupportedQuoteMint/i.test(text)) return 'this coin is quoted in another token, not SOL';
    if (/6002|6003|SlippageExceeded|slippage/i.test(text)) return 'the price moved before the order landed';
    if (/6005|BondingCurveComplete/i.test(text)) return 'the curve closed while the order was in flight';
    if (/6004|MintDoesNotMatch/i.test(text)) return 'the market is not the one asked for';
    if (/6001|InsufficientFunds/i.test(text)) return 'the wallet did not have the SOL for it';
    // The rent-exempt floor is 0.00089 SOL: under it the runtime refuses to debit the fee payer at all, so the order
    // never lands and the position looks like it is simply not selling. Measured live at 0.000658 SOL.
    if (/InsufficientFundsForRent|rent.exempt|no record of a prior credit/i.test(text)) return 'the wallet is below the 0.00089 SOL the network keeps for rent, so it cannot pay a fee';
    if (/6006|BondingCurveNotComplete/i.test(text)) return 'the curve is not finished, so the new pool refused it';
    if (/BlockhashNotFound|blockhash/i.test(text)) return 'the transaction expired before it landed';
    if (/insufficient|not enough/i.test(text)) return 'the wallet did not have the SOL for it';
    return 'the chain refused it';
  }

  async _entryPrice(t) {
    const board = Number(t.mc) || 0;
    let pool = 0;
    // RULE ADDED 2026-11-05 (1.0.4: a slow entry is a missed entry):
    // a coin whose own tape printed in the last 1.2 s already carries the POOL's price in `t.mc` - the stream decode writes
    // it straight from the curve (see the trade handler) - so waiting 450-700 ms for a second RPC reading of the same
    // number only lets the price run away before the order goes out. The read still happens whenever the tape is quiet,
    // because then the pool is the only number there is. The provenance is kept: `pxEntry` stays 'curve', so the exit
    // ladder treats this exactly like any other pool entry.
    const tapeAge = Date.now() - (Number(t.lastStreamAt) || 0);
    if (!this.offline && board > 0 && t.lastStreamAt && tapeAge <= ENTRY_TAPE_MS) {
      t.mc = board;
      return { mc: board, src: 'curve', why: 'its own last trade' };
    }
    try {
      if (!this.offline) {
        // RULE CHANGED 2026-11-05 (1.0.2: entries were sometimes minutes behind the tape): a coin whose own tape is fresh
        // already has a price in hand, so the curve read is only confirmation and gets a shorter budget - 450 ms instead
        // of 700. On a coin with no recent trade the full wait stays, because then the pool IS the only number.
        const curves = await readCurves((fn, opts) => this.rpcCall(fn, { attempts: 1, budgetMs: this._entryBudget(t), ...opts }), [t.mint]);
        const row = curves.get(t.mint);
        if (row && row.mcSol > 0 && !row.complete) pool = row.mcSol;
      }
    } catch (_) { pool = 0; }
    if (!(pool > 0)) {
      const row = t.ext;
      const graduatedRow = row && (row.dexId === 'pumpswap' || row.dexId === 'pump-amm') && Date.now() - (row.at || 0) < ENTRY_PX_MAX_AGE_MS;
      if (!this.offline && !graduatedRow) return { mc: board, refuse: 'No pool price to buy on' };
      if (!(board > 0)) return { mc: board, refuse: 'No price to buy on' };
      const heard = Math.max(Number(t.lastActivity) || 0, Number(t.lastStreamAt) || 0, Number(t.lastBoardAt) || 0, Number(t.ext && t.ext.at) || 0);
      if (Date.now() - heard > ENTRY_PX_MAX_AGE_MS) return { mc: board, refuse: 'No fresh price to buy on' };
      return { mc: board, src: 'board', why: graduatedRow ? 'its PumpSwap row' : 'offline harness' };
    }
    const mc = board > 0 && pool >= board * 3 ? board : pool;
    t.mc = mc;
    if (board > 0 && pool < board * (1 - BOARD_STALE_FRAC)) {
      return { mc, src: 'curve', refuse: `Price dropped ${Math.round((1 - pool / board) * 100)}% while the coin was being judged` };
    }
    return { mc, src: 'curve' };
  }

  async _holdersFor(t) {
    const now = Date.now();
    if (t.holders > 0 && now - (t.holdersAt || 0) < 10 * 60000) return t.holders;
    try {
      const row = await this.market.holders(t.mint);
      if (row && row.holders > 0) {
        t.holders = row.holders;
        t.holdersAt = now;
        this._holderMisses = 0;
      }
    } catch (_) { /* unknown */ }
    if (!(t.holders > 0)) {
      this._holderMisses = (this._holderMisses || 0) + 1;
      if (this._holderMisses >= 3 && (!this._holderWarnAt || now - this._holderWarnAt > 5 * 60000)) {
        this._holderWarnAt = now;
        this._log('warn', 'Holder counts cannot be read right now (the pool list is refusing this connection), so the holder bar is blocking every buy. Turn the extra entry filters off in Settings, or wait - nothing else changes and exits keep working.');
      }
    }
    return t.holders > 0 ? t.holders : 0;
  }

  async _buy(t, ev) {
    const s = this.s;
    const now = Date.now();
    this.buyTimes = this.buyTimes.filter((x) => now - x < 60000);
    if (this.buyTimes.length >= s.maxBuysPerMin) { t.reason = 'Entry rate limit reached'; return; }
    if (this.positions.size >= s.maxPositions) { t.reason = 'All position slots are occupied'; return; }
    // One entry per coin at a time, and never a coin that was just closed. An exit takes about a second to land,
    // and checking this only when the decision is made let the same falling coin be bought again in that gap.
    if (this.positions.has(t.mint) || this._unsupported.has(t.mint)) return;
    const cool = this.cooldowns.get(t.mint);
    if (cool && now < cool) return;
    if (this.pausedUntil && now < this.pausedUntil) return;
    const book = this.books[s.mode === 'live' ? 'live' : 'paper'];
    if (book.sessionPnl <= -s.sessionLossLimitSol) {
      // The limit protects the wallet; it must not switch the desk off while it still holds coins. Entries stop,
      // exits keep working, and the reason is on screen with the time it ends.
      this.pausedUntil = now + 30 * 60000;
      this.pauseReason = `session loss limit reached (${book.sessionPnl.toFixed(3)} SOL)`;
      this._log('warn', `Session loss limit reached (${book.sessionPnl.toFixed(3)} SOL). New entries paused for 30 minutes. Open positions still close normally.`);
      return;
    }
    const sol = Math.min(s.buyAmountSol, HARD_MAX_SOL_PER_TRADE);
    const extraNetwork = s.mode === 'live' ? networkExtras(s) : 0;
    const roundTripPct = roundTripFeePct(sol, this._feeFor(false) + extraNetwork, this._feeFor(true) + extraNetwork);
    const maxTrip = clamp(Number(s.maxRoundTripPct) || 20, 5, 90);
    if (roundTripPct > maxTrip) {
      t.reason = `Estimated fees ${roundTripPct.toFixed(1)}% exceed the ${maxTrip}% limit`;
      if (!this._costWarnedAt || now - this._costWarnedAt > 300000) {
        this._costWarnedAt = now;
        this._log('warn', `Entry skipped: estimated round-trip fees are ${roundTripPct.toFixed(2)}% of the ticket, above the ${maxTrip}% limit. Price impact is additional.`);
      }
      return;
    }
    if (this._freeSol() < this._cashNeeded()) {
      // Once every five minutes: the numbers do not change until money moves, and a line every thirty seconds is
      // noise that buries the one warning worth reading.
      if (!this._lowBalWarned || now - this._lowBalWarned > 300000) {
        this._lowBalWarned = now;
        const free = this._freeSol();
        this._log('warn', `Not enough SOL to buy and keep the exit fees aside (${free.toFixed(4)} SOL free, ${this._cashNeeded().toFixed(4)} needed). Deposit SOL or lower the buy amount.`);
      }
      return;
    }
    if (!s.simpleMode && s.deepEntry && s.minHolders > 0) {
      const holders = await this._holdersFor(t);
      if (holders < s.minHolders) {
        t.reason = holders > 0 ? `Needs ${s.minHolders} holders (has ${holders})` : 'Holder count unknown';
        return;
      }
      const cool2 = this.cooldowns.get(t.mint);
      if (this.positions.has(t.mint) || this.positions.size >= s.maxPositions || (cool2 && Date.now() < cool2)) return;
    }
    if (s.mode === 'live') {
      if (t.riskChecking) return;
      t.riskChecking = true;
      let riskReason;
      try { riskReason = await this.risk.check(t.mint); } finally { t.riskChecking = false; }
      if (riskReason) {
        t.reason = riskReason;
        // RULE ADDED 2026-11-05 (1.0.1): a gate whose data source is down blocks EVERY live entry, and a silent block
        // looks exactly like a quiet market. The holder bar taught that lesson the expensive way on 2026-11-05 - hours
        // of "no trades" with the only trace on each coin. Said once, in words, with what it costs.
        if (/could not be verified|unavailable/i.test(riskReason)) {
          this._riskMisses = (this._riskMisses || 0) + 1;
          if (this._riskMisses >= 5 && (!this._riskWarnAt || now - this._riskWarnAt > 300000)) {
            this._riskWarnAt = now;
            this._log('warn', `Live entries are blocked: the on-chain mint check cannot be answered right now (${riskReason}). Practice mode is not affected, and nothing is bought with real money until the node answers.`);
          }
        } else this._riskMisses = 0;
        return;
      }
      this._riskMisses = 0;
      if (!this.running || this.s.mode !== 'live' || this.positions.has(t.mint) || this.positions.size >= this.s.maxPositions
        || this._freeSol() < this._cashNeeded() || Date.now() < this.pausedUntil) return;
    }
    t.status = 'bought';
    this._recordTick(t, true);
    const t0 = Date.now();
    const feeBuy = this._feeFor(false);
    const paper = s.mode !== 'live';
    const p = {
      mint: t.mint, symbol: t.symbol, name: t.name, entryMc: Number(t.mc) || 0, mc: Number(t.mc) || 0, peakMc: Number(t.mc) || 0,
      solIn: sol, feeBuy, feeExitEst: this._feeFor(true), openedAt: now, status: 'confirming', closing: false, paper, fails: 0, nextTry: 0, pending: !paper,
      // Not a position yet: this is the slot being held while the pool is asked for a price, and the panel must not draw
      // it (see `_openPositions`). Refused here, nothing was ever bought.
      priced: false,
      // What the coin looked like when it was taken, kept with the row: without it a closed trade says what it did and
      // never why it was chosen, and a plan cannot be judged from that.
      entryScore: ev.score, entryCh5: t.ext && typeof t.ext.change5m === 'number' ? t.ext.change5m : null,
      entryBuyers: ev.m ? ev.m.buyers : null,
      // Every tip this position pays is part of what it cost (see `_finishSell`).
      feesPaid: Number(feeBuy) || 0,
      entryLiquidityUsd: t.ext ? t.ext.liqUsd : null, entryDexId: t.ext ? t.ext.dexId : null,
    };
    this.positions.set(t.mint, p);
    this._persistPositions();
    const pxP = this._entryPrice(t).catch(() => ({ refuse: 'Entry price unavailable' }));
    let first = null;
    if (!paper) {
      p.spendNoted = true;
      p.spendEntry = this._noteSpend(sol + feeBuy + TOKEN_RENT_SOL);
      const slip = this._slippageFor(t.mint, false);
      const gate = pxP.then((px) => { if (px.refuse) { const e = new Error('Refused by the entry price gate'); e.aborted = true; throw e; } });
      first = this._tradeLive('buy', t.mint, sol, { slippage: slip, fee: feeBuy, pool: t.graduated ? 'auto' : 'pump', gate })
        .catch((e) => e);
    }
    const px = await pxP;
    // How long the pool took to answer. "The bot sometimes buys too slowly" is answerable only with the number, and this
    // is the wait that decides whether the entry lands or the price runs away.
    const priceMs = Date.now() - now;
    if (px.refuse) {
      this.positions.delete(t.mint);
      this._releaseSpend(p.spendEntry);
      this._persistPositions();
      t.status = 'watching';
      t.reason = px.refuse;
      this.stats.entryPx.refused++;
      return;
    }
    p.entryMc = px.mc;
    p.mc = px.mc;
    p.peakMc = px.mc;
    // The slot is a position now: the pool quoted a price and the order is going out (or the paper fill is booked).
    p.priced = true;
    p.pxAt = Date.now();
    p.pxSeed = true;
    p.pxSource = px.src === 'curve' ? 'curve' : 'entry';
    // Where the entry price came from, kept for the life of the position: a fall is taken at once only when the number
    // the position opened on was the pool's own (see `_pricePosition`).
    p.pxEntry = px.src === 'curve' ? 'curve' : 'board';
    this.stats.entryPx[px.src === 'curve' ? 'curve' : 'board']++;
    this.buyTimes.push(now);
    // A coin that was just bought has to be priced at its curve from the first second, not four seconds later when
    // the next scheduled sync runs: every exit rule is measured on that number.
    if (!paper && this._feedLabel === 'pumpdev') this._syncSubscriptions();
    // RULE CHANGED 2026-11-06 (1.1.1): the practice fill used to book `t.mc` - whatever the coin's price had become after
    // the simulated wait - while this line printed `px.mc`. On a launch being bought *because* it was moving up, that
    // gap booked an instant, invented loss of 10-40% and every exit rule then measured from a price nobody paid. Measured
    // on a live practice run: entry mc 178 printed, exit 155, booked as -39.9%. A practice fill costs the quoted price
    // plus the depth impact, and nothing else - so the number on this line, the number in the position and the number the
    // rules measure from are now one number.
    const paperSlip = paper ? this._paperSlippage(t, sol) : 0;
    const bookedMc = px.mc * (1 + paperSlip);
    this._log('buy', `Buying ${t.symbol} (${t.mint.slice(0, 4)}) for ${sol} SOL (${ev.m.buyers} buyers, mc ${Math.round(bookedMc)}`
      + `${s.simpleMode ? ', simple plan' : `, score ${ev.score}`}`
      // A board price is the risky one: it is somebody else's row, and the pool is the market. Naming it costs one
      // word and answers "why did it stop out at once" without anybody having to read the log of a coin that is gone.
      + `${px.src === 'board' ? `, board price (${px.why || 'no pool'})` : px.why ? `, priced from ${px.why}` : ''}`
      // A slow price is named on the buy line: over 900 ms the entry waited for the pool, and that wait is the one
      // thing in the path that can be shortened (see `_entryBudget`).
      + `${priceMs > 900 ? ` · pool price took ${priceMs} ms` : ''}`);
    try {
      if (paper) {
        await this._paperWait();
        // The same number the buy line printed: the quoted price plus the depth impact, never a price the coin moved to
        // while the fill was waiting (see `paperSlip` where the line is written).
        p.entryMc = bookedMc;
        p.mc = bookedMc;
        p.peakMc = Math.max(Number(p.peakMc) || 0, bookedMc);
        const debit = sol * (1 + FEE) + feeBuy;
        if (!this.running || this.s.mode !== 'paper' || this.paper.balance < debit) {
          throw Object.assign(new Error('Practice entry cancelled before fill'), { phase: 'build', definite: true });
        }
        this.paper.balance -= debit;
        p.status = 'open';
        p.pending = false;
        // RULE ADDED 2026-11-06 (1.1.1): the book and the bankroll are written in the same breath, because a stored
        // position whose cost was never subtracted is a restart that hands the money back.
        this._persistPositions();
      } else {
        const place = (slippage, via) => (via === 'backup'
          ? this._backupTrade('buy', t.mint, sol, { slippage })
          : this._tradeLive('buy', t.mint, sol, { slippage, fee: feeBuy, pool: t.graduated ? 'auto' : 'pump' }));
        // The ticket, the tip and the rent for the new token account leave the wallet the moment the order is
        // placed, so they are counted against it before the chain has confirmed anything.
        const order = (slippage, via) => {
          if (!p.spendNoted) { p.spendNoted = true; p.spendEntry = this._noteSpend(sol + feeBuy + TOKEN_RENT_SOL); }
          return place(slippage, via);
        };
        const settle = async (r) => {
          p.sig = r.sig;
          p.confirmingBuy = true;
          this._persistPositions();
          this.stats.lastLatencyMs = Date.now() - t0;
          if (r.landed) { await this.refreshBalance(); return { state: 'confirmed', err: '' }; }
          // The balance read and the first status poll run at once: neither answer depends on the other, and the
          // confirm loop is what decides whether the desk can act on this position.
          const confP = this._confirm(r.sig, r.raw);
          await this.refreshBalance();
          return confP;
        };
        let confirmed;
        if (first) {
          // The order that was already being built behind the gate: an error here is exactly the error the old
          // serial path would have thrown, so the retry ladder below sees the same thing.
          const r = await first;
          if (r instanceof Error) throw r;
          if (!p.spendNoted) { p.spendNoted = true; p.spendEntry = this._noteSpend(sol + feeBuy + TOKEN_RENT_SOL); }
          confirmed = await settle(r);
        } else {
          confirmed = await settle(await order(this._slippageFor(t.mint, false)));
        }
        if (confirmed.state === 'failed') {
          const unsupported = /6063|UnsupportedQuoteMint/i.test(confirmed.err);
          const wrongMarket = /6005|6004|BondingCurve|Complete/i.test(confirmed.err);
          const priceRefused = /6002|6003|slippage/i.test(confirmed.err);
          if (unsupported) {
            t.unsupported = true;
            this._unsupported.add(t.mint);
          } else if (wrongMarket) {
            t.graduated = true;
          }
          if (wrongMarket && !s.allowGraduated) {
            this._log('info', `${t.symbol} finished its curve while the order was in flight. Left alone, because graduated coins are switched off.`);
          } else if (priceRefused || wrongMarket) {
            // A refused order costs nothing but the fee, so it is retried once - through the backup route, which
            // quotes fresh against the same market and puts the tolerance on the tokens instead of on the SOL.
            this._log('info', `${t.symbol} moved while the order was in flight. Re-quoting.`);
            confirmed = await settle(await order(s.slippagePct, 'backup'));
            if (confirmed.state === 'confirmed') this._log('info', `${t.symbol} filled on the re-quote.`);
          }
        }
        // Live from the first byte on the wire: a stop, a target or the time limit must work while the chain is
        // still answering. `pending` is the only thing the confirmation decides.
        p.confirmingBuy = false;
        p.status = 'open';
        p.openedAt = Date.now();
        if (confirmed.state === 'unknown') {
          const held = await this._tokenBalanceRaw(t.mint).catch(() => null);
          if (held == null || held === 0n) {
            p.pendingBuy = true; p.pending = true; p.status = 'confirming';
            this._persistPositions();
            return;
          }
          p.pending = false;
          this._log('warn', held === null
            ? `The RPC could not confirm the buy of ${t.symbol}. Keeping it on the book and managing it.`
            : `Buy of ${t.symbol} verified through the wallet balance.`);
        } else if (confirmed.state === 'failed') {
          throw Object.assign(new Error(this._whyRejected(confirmed.err)), {
            definite: true, phase: 'rejected',
          });
        } else {
          p.pending = false;
          this._log('ok', `Bought ${t.symbol} for ${sol.toFixed(4)} SOL.`);
        }
        // The token amount the wallet really holds is the baseline every later sale is measured against.
        if (this.positions.get(t.mint) === p) {
          const seen = {};
          p.tokIn = await this._tokenBalanceRaw(t.mint, seen).catch(() => null);
          p.entrySettled = false;
          this._entryFromFill(p, sol, feeBuy, seen.decimals)
            .catch(() => {})
            .finally(() => { p.entrySettled = true; });
        }
      }
    } catch (e) {
      // An exit may have closed this position while the confirmation was still running.
      if (this.positions.get(t.mint) !== p) return;
      if (e.signature) {
        p.sig = e.signature;
        p.pendingBuy = true;
        p.pending = true;
        p.status = 'confirming';
        this._persistPositions();
        this._log('warn', `Buy of ${t.symbol} was submitted; waiting for its signature before allowing another order.`);
        return;
      }
      // A send that timed out may still land, so the wallet gets the last word before the buy is called off.
      const unsure = !paper && !e.definite && e.phase !== 'build';
      const held = unsure ? await this._tokenBalanceRaw(t.mint).catch(() => null) : null;
      if (held > 0n) {
        p.status = 'open'; p.pending = false; p.tokIn = held;
        this._persistPositions();
        this._log('warn', `Buy of ${t.symbol} landed after the error - now managing it.`);
        return;
      }
      if (held === null && unsure) {
        // The balance could not be read either, so nothing here proves the order failed. Keeping the position is
        // the safe side: if the tokens are there they get managed and sold, if not the first exit says so.
        p.status = 'open'; p.pending = false;
        this._persistPositions();
        this._log('warn', `The RPC could not tell whether the buy of ${t.symbol} landed (${e.message}). Managing it and checking on the first exit.`);
        return;
      }
      this.positions.delete(t.mint);
      // The order provably never bought anything, so the ticket it was holding against the balance goes back at once:
      // on a 0.022 SOL wallet, one skipped buy made every other buy answer "not enough SOL" for a whole minute.
      this._releaseSpend(p.spendEntry);
      this._persistPositions();
      t.tries = (t.tries || 0) + 1;
      const fatal = /locked|Safety check|Not enough/i.test(e.message);
      // A coin the chain refused on its own terms is not tried again: an unsupported quote mint cannot be bought
      // from here at all, and a graduated coin is only bought when the user switched that on.
      const settled = t.unsupported || (t.graduated && !this.s.allowGraduated);
      // Only an order that certainly never reached the chain is tried again: a second buy of a coin whose first
      // order might still land would leave twice the tokens on a book that tracks one entry.
      if (!fatal && !settled && (e.definite || e.phase === 'build') && t.tries < 2) {
        t.status = 'watching'; t.retryAt = Date.now() + 2500;
        this._log('info', `${t.symbol}: ${e.message}. Trying once more.`);
      } else {
        t.status = 'skipped';
        // A refusal from the chain is an ordinary event in a sniping desk - the price ran, the curve closed, the
        // market quotes another token - and it reads as one sentence, never as a program error.
        this._log(fatal ? 'error' : 'info', `Skipped ${t.symbol}: ${e.message}.`);
      }
    }
  }

  async _sell(p, why, pct = 100, opts = {}) {
    if (p.closing || Date.now() < p.nextTry) return;
    p.closing = true;
    const s = this.s;
    const t1 = Date.now();
    if (opts.manual || why === 'Price lost' || why === 'Sell all') {
      p.firedAt = Math.round(this._pnlPct(p) * 10) / 10;
      p.mcAtFire = p.mc;
    }
    const part = Math.max(1, Math.min(100, Number(p.pendingSell ? p.pendingSellPct : pct) || 100));
    const urgent = why !== 'Take profit' && why !== 'Take profit part 1';
    const feeSell = this._feeFor(urgent);
    try {
      if (!p.paper) {
        // No SOL in the wallet means no fee, and no fee means the order is refused before it reaches the chain. It
        // is said once, in plain words with the address to send to, instead of an endless "not confirmed".
        if (!p.pendingSell && this._balance() < EXIT_FEE_FLOOR_SOL) {
          this._warnNoFeeSol();
          throw Object.assign(new Error(this._noFeeSentence()), { noFee: true });
        }
        if (!p.pendingSell && !urgent && this._pnlPct(p) <= 0) {
          p.closing = false;
          p.nextTry = Date.now() + 250;
          p.trigger = null;
          this._log('info', `${p.symbol} slipped back to ${this._pnlPct(p).toFixed(1)}% before the order went out. Not selling it at a loss; watching again.`);
          return;
        }
        if (!opts.manual && !p.pendingSell) {
          const now2 = this._pnlPct(p);
          const peak = this._pnlPct({ ...p, mc: p.peakMc || p.mc });
          // The room the trail gives back has to be asked for from the same rule the sale came from: a fixed 4-5 points
          // here would call every legitimate trailing sale "gone", because the trail now fires 45% of a peak below it.
          const give = this._trailGive(peak);
          let gone = null;
          if (/^Stop loss/.test(why) && now2 > 0) gone = `it is back to +${now2.toFixed(1)}%`;
          else if (/^Break even/.test(why) && now2 > 0) gone = `it is back to +${now2.toFixed(1)}%`;
          else if (/^Trailing stop/.test(why) && peak > 0 && now2 > peak - give) {
            gone = `the give-back is gone (peak +${peak.toFixed(1)}%, now +${now2.toFixed(1)}%)`;
          }
          if (gone) {
            p.closing = false;
            p.nextTry = Date.now() + 150;
            p.trigger = null;
                // The fire is gone with the trigger: leaving it behind would let the next sale print - or book - the move
                // of an exit that never happened.
                p.firedAt = null;
                p.mcAtFire = null;
                this._log('info', `${p.symbol}: ${why} was about to sell a risk that is no longer there - ${gone}. Not selling it; watching again.`);
                return;
              }
        }
        const order = (slippage, via) => (via === 'backup'
          ? this._backupTrade('sell', p.mint, null, { slippage, pct: part })
          : this._tradeLive('sell', p.mint, null, { slippage, fee: feeSell, pct: part, pool: 'auto' }));
        // What the wallet holds before the order goes out is not needed any more: the trade's own transaction says
        // exactly what it moved, and that is the only number that cannot be a neighbour's opinion.
        const settle = async (r) => {
          this.stats.lastSellMs = Date.now() - t1;
          if (p.sellSig !== r.sig) { p.sellSubmittedAt = Date.now(); p.sellObservedAt = null; }
          p.sellSig = r.sig;
          p.pendingSell = r;
          p.pendingSellPct = part;
          this._persistPositions();
          const out = r.landed ? { state: 'confirmed', err: '' } : await this._confirm(r.sig, r.raw, { acceptProcessed: true, polls: 10 });
          if (out.state === 'confirmed' && r.sig) {
            const delta = await this._measureProceeds(r.sig);
            if (delta != null) p.proceeds = delta;
          }
          return out;
        };
        let confirmed;
        const pnlNow = this._pnlPct(p);
        const slip = this._slippageFor(p.mint, urgent, pnlNow);
        confirmed = await settle(p.pendingSell || await order(slip));
        if (confirmed.state === 'failed') {
          p.pendingSell = null;
          this._persistPositions();
          const wrongMarket = /6005|6004|BondingCurve|Complete/i.test(confirmed.err);
          const priceRefused = /6002|6003|6063|slippage/i.test(confirmed.err);
          // A coin can finish its curve while it is being held, and then the curve can no longer sell it. The
          // position follows the market: the retry asks the backup route, which finds the new pool itself.
          if (wrongMarket) { p.graduated = true; const tok = this.tokens.get(p.mint); if (tok) tok.graduated = true; }
          if (wrongMarket || priceRefused) {
            this._log('info', `${p.symbol} moved while the sell was in flight. Re-quoting.`);
            if (!urgent) {
              const now3 = this._pnlPct(p);
              if (now3 < Math.min(s.takeProfitPct, Number(p.firedAt) || 0)) {
                p.closing = false;
                p.nextTry = 0;
                p.trigger = null;
                p.firedAt = null;
                p.mcAtFire = null;
                this._log('info', `${p.symbol}: the take profit was no longer there (${now3.toFixed(1)}%). Not chasing it down; watching again.`);
                return;
              }
            }
            // The re-quote carries the exit's own tolerance, not the entry ceiling: a stop re-quoted at 10% after a
            // 20% refusal is a stop that gets refused twice while the coin keeps falling.
            confirmed = await settle(await order(this._slippageFor(p.mint, urgent, this._pnlPct(p)), 'backup'));
          }
        }
        if (confirmed.state === 'failed') {
          p.pendingSell = null;
          this._persistPositions();
          throw Object.assign(new Error(this._whyRejected(confirmed.err)), { phase: 'rejected' });
        }
        if (confirmed.state === 'unknown') throw new Error('Sell not confirmed by the RPC');
        if (!p.sellObservedAt) p.sellObservedAt = Date.now();
        this.refreshBalance();
      }
      let soldPct = p.paper ? part : await this._measuredPct(p, part);
      if (!p.paper && soldPct != null && soldPct < 0.5) {
        // A node that is a block behind still reports the tokens it just saw sold, so the reading is taken again a
        // moment later before the sale is called a no-op.
        await new Promise((r) => setTimeout(r, 700));
        soldPct = await this._measuredPct(p, part);
      }
      if (!p.paper && soldPct == null) throw new Error('The sale could not be measured against the wallet balance');
      if (soldPct < 0.5) throw new Error('The sale went through but the wallet still holds the tokens');
      if (p.paper) await this._paperWait();
      this._finishSell(p, why, feeSell, soldPct);
    } catch (e) {
      // A sell that landed after the timeout leaves nothing to sell: detect it instead of retrying forever.
      if (!p.paper) {
        if (e.signature) {
          p.sellSig = e.signature;
          p.pendingSellPct = part;
          p.pendingSell = { sig: e.signature, raw: e.raw || null };
          this._persistPositions();
        }
        try {
          const held = await this._tokenBalanceRaw(p.mint);
          if (held === 0n) {
            // A position kept on the safe side when the RPC could not say whether its buy landed, and which the
            // wallet now proves never did: nothing was spent, so nothing is booked against the live result.
            if (!p.sig && p.tokIn == null) {
              this.positions.delete(p.mint);
              this._persistPositions();
              this._log('warn', `${p.symbol}: the wallet holds none of it, so the buy never landed. Dropped from the book.`);
              return;
            }
            this._finishSell(p, why, feeSell, 100);
            return;
          }
          // The balance moved but the confirmation did not arrive: some of it sold, so that part is booked and the
          // rest stays a position instead of being sold twice.
          const soldPct = await this._measuredPct(p, part);
          if (soldPct != null && soldPct >= 0.5) { this._finishSell(p, why, feeSell, soldPct); return; }
        } catch (_) { /* unknown */ }
      }
      // The two doors are asked at once, so a failure arrives as an AggregateError whose message is the useless
      // "All promises were rejected". The reason a person reads is the one the chain gave.
      const real = (e) => {
        if (e && e.errors && e.errors.length) {
          const first = e.errors.find((x) => x && !x.noFee) || e.errors[0];
          if (first) return first;
        }
        return e;
      };
      p.closing = false;
      p.fails++;
      if (e.phase === 'rejected') p.feesPaid = (Number(p.feesPaid) || 0) + (Number(this.s.priorityFeeSol) || 0);
      p.nextTry = Date.now() + (p.fails === 1 ? 300 : Math.min(6000, 900 * p.fails));
      if (e.noFee) {
        // The automatic exits keep trying quietly; a press of Sell must answer, or the button looks broken.
        if (opts.manual) throw e;
        return;
      }
      const reason = real(e);
      const tok = this.tokens.get(p.mint);
      const ext = tok && tok.ext && Date.now() - (tok.ext.at || 0) < 60000 ? tok.ext : null;
      const dexId = ext ? String(ext.dexId || '') : '';
      const graduatedPool = Boolean(dexId) && dexId !== 'pumpfun';
      const depth = ext ? Number(ext.liqUsd) : null;
      if (!p.stuck && p.fails >= 3 && graduatedPool && depth != null && Number.isFinite(depth) && depth < 1
        && Date.now() - (p.openedAt || 0) > 90000) {
        p.stuck = true;
        p.nextTry = Date.now() + 10 * 60000;
        this._log('error', `${p.symbol}: this coin's pool has no liquidity left ($${Math.max(0, depth).toFixed(2)}), so there is nothing left to sell into. Kept on the book and checked again in ten minutes - the tokens are worth nothing, no setting can change that.`);
        return;
      }
      this._log(p.fails >= 5 ? 'error' : 'warn', `${p.symbol} has not sold yet: ${reason.message || 'the chain refused it'}. Retrying${p.fails >= 5 ? ' - if this keeps up, close it from the Wallet tab with Sell every coin' : ''}.`);
    }
  }

  /** The one sentence about the fee, written once so the log and the button say the same thing. */
  _noFeeSentence() {
    const addr = this.wallet.address() || 'your wallet';
    return `Out of SOL for the network fee: the wallet holds ${this._balance().toFixed(6)} SOL, under the 0.00089 SOL the network keeps for rent, so nothing can be sent. Send SOL to ${addr} and the coins sell by themselves.`;
  }

  /** One plain sentence per minute about the one thing only the operator can fix. */
  _warnNoFeeSol() {
    const now = Date.now();
    if (this._noFeeWarned && now - this._noFeeWarned < 60000) return;
    this._noFeeWarned = now;
    this._log('error', this._noFeeSentence());
  }

  /**
   * How much of the position really left, as a percentage of what it held before the sale. The wallet balance is
   * the only witness that cannot be wrong, so it is the one that is asked.
   */
  async _measuredPct(p, wantPct) {
    const seen = { gone: false };
    const now = await this._tokenBalanceRaw(p.mint, seen).catch(() => null);
    if (now == null) return null;
    // An account that is gone means its rent came back to the wallet in the same sale: that is not profit.
    if (now === 0n) { p.tokIn = 0n; p.rentBack = seen.gone ? TOKEN_RENT_SOL : 0; return 100; }
    const before = p.tokIn == null ? null : p.tokIn;
    if (before == null || before <= 0n) {
      // No baseline: assume the request is what happened, and keep the fresh balance as the new baseline.
      p.tokIn = now;
      return wantPct;
    }
    const sold = before > now ? Number(before - now) / Number(before) : 0;
    p.tokIn = now;
    return Math.round(sold * 1000) / 10;
  }

  async _txSolDelta(sig) {
    const kp = this.wallet.keypair;
    if (!kp || !sig) return null;
    const mine = kp.publicKey.toBase58();
    // An exit is confirmed at `processed`, which is often a moment before the transaction is readable at `confirmed`,
    // so the same lookup is tried twice at the looser level rather than falling back to an estimate.
    for (const commitment of ['confirmed', 'finalized']) {
      const tx = await this.rpcCall((c) => c.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment }), { attempts: 3, budgetMs: 8000 }).catch(() => null);
      const msg = tx && tx.transaction && tx.transaction.message;
      const keys = msg && (msg.staticAccountKeys || msg.accountKeys);
      if (!keys || !tx.meta || tx.meta.err) continue;
      const i = keys.findIndex((k) => (k && typeof k.equals === 'function' ? k.equals(kp.publicKey) : String(k) === mine));
      if (i < 0) continue;
      const delta = (Number(tx.meta.postBalances[i]) - Number(tx.meta.preBalances[i])) / 1e9;
      return Number.isFinite(delta) ? delta : null;
    }
    return null;
  }

  /** What the sale's own transaction moved, with two short second looks. A node that has not indexed the transaction
   *  yet answers "unknown", and "unknown" books an estimate that can be a third of the real number; the sale is already
   *  made at this point, so a couple of seconds costs nothing but the truth is worth it. Measured live on 2026-11-05:
   *  `Sold CR (Stop loss at -36.6%): -0.0037 SOL (estimated)` while the public nodes were rotating on 429. */
  async _measureProceeds(sig) {
    let first = await this._txSolDelta(sig);
    if (first != null) return first;
    // 0.5 s, then 2 s: the first covers a transaction that is simply a slot behind, the second a node that has just
    // been handed a different endpoint by the RPC pool.
    for (const wait of [500, 2000]) {
      await new Promise((r) => setTimeout(r, wait));
      first = await this._txSolDelta(sig);
      if (first != null) return first;
    }
    return null;
  }

  async _entryFromFill(p, sol, feeBuy, decimals) {
    if (!(p.tokIn > 0n) || decimals == null || !(p.entryMc > 0)) return;
    if (this.positions.get(p.mint) !== p) return;          // closed while the balance was being read
    const tok = this.tokens.get(p.mint);
    const pumpStyle = /pump$/i.test(p.mint) || (tok && (tok.graduated || (tok.ext && ['pumpfun', 'pumpswap', 'pump-amm'].includes(tok.ext.dexId))));
    if (!pumpStyle) return;
    const whole = Number(p.tokIn) / 10 ** decimals;
    if (!(whole > 0)) return;
    const paid = Number(sol) + (Number(feeBuy) || 0);
    const mcFromFill = (paid / whole) * PUMP_SUPPLY;
    if (!(mcFromFill > 0)) return;
    const ratio = mcFromFill / p.entryMc;
    if (!(ratio > 1 / ENTRY_FILL_MAX_RATIO) || !(ratio < ENTRY_FILL_MAX_RATIO)) return;
    const before = p.entryMc;
    p.entryMc = mcFromFill;
    p.mc = mcFromFill;
    p.peakMc = Math.max(p.peakMc || 0, mcFromFill);
    this._persistPositions();
    this._log('info', `${p.symbol}: entry measured from the fill - ${mcFromFill.toFixed(1)} SOL market cap for ${paid.toFixed(4)} SOL of tokens (the desk had read ${before.toFixed(1)}). Every percentage is measured from this.`);
  }

  /** The sale's own transaction, asked again in the background when the chain would not answer at the time. One row is
   *  corrected once, and only when the measurement is real: a booked estimate is replaced by the money, the book moves
   *  by the difference, and a win that was booked as a loss (or the reverse) swaps sides in the record. */
  async _remeasureSells() {
    const list = this._remeasure;
    if (!list || !list.length) return;
    const now = Date.now();
    for (let i = list.length - 1; i >= 0; i--) {
      const item = list[i];
      if (now < item.nextAt) continue;
      item.tries++;
      // Twelve looks over about six minutes: a node that has not indexed the transaction by then never will.
      if (item.tries > 12) { list.splice(i, 1); continue; }
      item.nextAt = now + 30000;
      const proceeds = await this._txSolDelta(item.sig).catch(() => null);
      if (proceeds == null) continue;
      list.splice(i, 1);
      const row = item.row;
      if (!row || row.measured) continue;
      const pnl = proceeds - item.rentBack - item.soldSol - item.feeBuy;
      const delta = pnl - row.pnlSol;
      if (!Number.isFinite(delta) || Math.abs(delta) < 1e-9) { row.measured = true; continue; }
      const book = this.books[row.paper ? 'paper' : 'live'];
      const wasWin = row.pnlSol >= 0;
      row.pnlSol = pnl;
      row.pnlPct = (pnl / Math.max(1e-9, row.basisSol || item.soldSol)) * 100;
      row.measured = true;
      book.pnl += delta;
      book.sessionPnl += delta;
      if (wasWin !== (pnl >= 0)) {
        if (pnl >= 0) { book.wins++; book.losses = Math.max(0, book.losses - 1); }
        else { book.losses++; book.wins = Math.max(0, book.wins - 1); }
      }
      this._persistBook();
      this._log('info', `${row.symbol}: the sale was finally measured on chain - ${pnl >= 0 ? '+' : ''}${pnl.toFixed(4)} SOL instead of the estimate ${(pnl - delta) >= 0 ? '+' : ''}${(pnl - delta).toFixed(4)}. The book is corrected.`);
    }
  }

  _finishSell(p, why, feeSell, pct = 100) {
    const s = this.s;
    // A sale has just landed or is about to: the balance is about to jump, and that jump is ours, not a deposit.
    this._lastSettleAt = Date.now();
    // A sale measured at 99.6% is a full exit with dust left over, not a partial one. Rounding it the other way
    // would keep a position whose whole value is a few tokens nobody can sell.
    const raw = Math.max(0, Math.min(100, Number(pct) || 100));
    const part = (raw >= 99.5 ? 100 : raw) / 100;
    const soldSol = Math.max(1e-9, p.solIn * part);
    let pnlSol;
    const measured = !p.paper && p.proceeds != null && part === 1;
    if (p.paper) {
      const exitMc = p.mc * (1 - this._paperSlippage(this.tokens.get(p.mint), soldSol * p.mc / p.entryMc));
      const proceeds = soldSol * (exitMc / p.entryMc) * (1 - FEE);
      this.paper.balance += proceeds - feeSell;
      pnlSol = proceeds - soldSol * (1 + FEE) - p.feeBuy * part - feeSell;
    } else if (measured) {
      // What the wallet actually gained, minus what was put in and the entry costs, minus any rent the same
      // transaction returned for a closed account. This is the money, not an estimate.
      pnlSol = p.proceeds - (p.rentBack || 0) - soldSol - p.feeBuy * part;
    } else {
      // The exit price is the one the rule fired at: `p.mc` may already be a quote of the pool our own sale moved.
      const exitMc = p.mcAtFire || p.mc;
      pnlSol = soldSol * (exitMc / p.entryMc) * (1 - FEE) - soldSol * (1 + FEE) - p.feeBuy * part - feeSell;
    }
    p.proceeds = null;
    p.pendingSell = null;
    const basisSol = p.paper ? soldSol * (1 + FEE) + p.feeBuy * part : soldSol + Math.max(0, Number(p.feesPaid) || 0) + Math.max(0, Number(feeSell) || 0);
    const pnlPct = (pnlSol / Math.max(1e-9, basisSol)) * 100;
    const book = this.books[p.paper ? 'paper' : 'live'];
    book.pnl += pnlSol;
    book.sessionPnl += pnlSol;
    const row = {
      ts: Date.now(), symbol: p.symbol, mint: p.mint, solIn: soldSol, basisSol, pnlSol, pnlPct, reason: why, paper: p.paper,
      measured: p.paper || measured, signature: p.sellSig || null, buySignature: p.sig || null,
      sellObservationMs: p.sellObservedAt && p.sellSubmittedAt ? Math.max(0, p.sellObservedAt - p.sellSubmittedAt) : null,
      heldSec: p.openedAt ? Math.round((Date.now() - p.openedAt) / 1000) : null,
      firedPct: p.firedAt == null ? null : Number(p.firedAt),
      peakPct: p.peakPct == null ? null : Math.round(Number(p.peakPct) * 10) / 10,
      src: p.pxSource || null,
      // Why the coin was taken, beside what it did.
      score: p.entryScore == null ? null : p.entryScore,
      ch5: p.entryCh5 == null ? null : Math.round(Number(p.entryCh5)),
      buyers: p.entryBuyers == null ? null : p.entryBuyers,
    };
    this.history.unshift(row);
    if (this.history.length > 100) this.history.pop();
    if (!p.paper && part === 1 && !measured && p.sellSig) {
      (this._remeasure || (this._remeasure = [])).push({
        sig: p.sellSig, row, soldSol, feeBuy: p.feeBuy, rentBack: p.rentBack || 0,
        tries: 0, nextAt: Date.now() + 20000,
      });
    }
    // The move that fired the rule is in the line, and so is the move that was actually filled when the two differ:
    // "Take profit at +70%, filled at -5%" is the truth about a spike that got away, and it must not be hidden.
    const firedAt = this._pnlPct({ ...p, mc: p.mcAtFire || p.mc });
    const slipNote = p.firedAt != null && Math.abs(firedAt - p.firedAt) >= 5
      ? `, filled at ${firedAt >= 0 ? '+' : ''}${firedAt.toFixed(1)}%`
      : '';
    const atNote = slipNote ? ` (${why} at ${p.firedAt >= 0 ? '+' : ''}${p.firedAt.toFixed(1)}%${slipNote})` : ` (${why} at ${firedAt >= 0 ? '+' : ''}${firedAt.toFixed(1)}%)`;
    // The mint travels with the symbol: three coins called "titcoin" in one paper session were three different mints,
    // and a line that names only the symbol cannot be read afterwards - not by the trader and not by whoever reads the log the next morning.
    const tag = `${p.symbol} (${p.mint.slice(0, 4)})`;
    const basis = p.paper ? '' : measured ? ' (paid by the chain)' : ' (estimated)';
    const mcNote = p.entryMc > 0 && p.mc > 0 && Math.abs(firedAt) > (Number(this.s.stopLossPct) || 0)
      ? ` [mc ${Math.round(p.entryMc)} → ${Math.round(p.mc)}]` : '';
    this._log(pnlSol >= 0 ? 'ok' : 'sell', `Sold ${part < 1 ? Math.round(part * 100) + '% of ' : ''}${tag}${atNote}: ${pnlSol >= 0 ? '+' : ''}${pnlSol.toFixed(4)} SOL${basis}${p.pxSource ? ` [${p.pxSource}]` : ''}${mcNote}`);

    if (part < 1) {
      p.solIn -= soldSol;
      // The entry tip is spent once, so the part that is still open must not carry it again: without this a remainder
      // sold at +14% was booked as a small loss.
      p.feeBuy = Math.max(0, p.feeBuy * (1 - part));
      p.tp1Done = true;
      p.peakMc = p.mc;
      p.peakPct = this._pnlPct({ ...p, mc: p.peakMc });
      p.closing = false;
      p.nextTry = 0;
      this._persistPositions();
      this._persistBook();
      return;
    }

    this.positions.delete(p.mint);
    this._persistPositions();
    book.trades++;
    const tok = this.tokens.get(p.mint);
    if (tok && tok.status === 'bought') { tok.status = 'watching'; tok.reason = 'Sold, waiting for the cooldown'; }
    // A coin that just closed is left alone for a while. Without this the desk bought the same falling coin three
    // times in a row (measured on the live feed: one mint, four entries, three losses).
    this.cooldowns.set(p.mint, Date.now() + 15 * 60000);
    if (pnlSol >= 0) {
      book.wins++;
      this.lossStreak = 0;
    } else {
      book.losses++;
      this.lossStreak = (this.lossStreak || 0) + 1;
      if (s.pauseMinutes > 0 && this.lossStreak >= s.maxLossStreak) {
        this.pausedUntil = Date.now() + s.pauseMinutes * 60000;
        this.pauseReason = `${this.lossStreak} losses in a row`;
        this._log('warn', `${this.lossStreak} losses in a row - new entries paused for ${s.pauseMinutes} minutes. Open positions still close normally.`);
        this.lossStreak = 0;
      }
    }
    if (!p.paper) this._settleMint(p.mint);
    this._persistBook();
    this._shutdownIfIdle();
  }

  /** The closed trades and the running totals, on disk. They used to live in memory only, so every restart wiped the
   *  day's profit and loss and the panel claimed a session that had never traded. The book is a record of what was
   *  booked, never of the wallet balance, so a deposit or a withdrawal cannot flatter it. */
  _persistBook() {
    try {
      this.store.set({
        bookHistory: this.history.slice(0, 100),
        books: { paper: { ...this.books.paper }, live: { ...this.books.live } },
      });
    } catch (_) { /* a full disk is not a reason to stop trading */ }
  }

  _loadBook() {
    const saved = Array.isArray(this.s.bookHistory) ? this.s.bookHistory : [];
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    this.history = saved
      .filter((h) => h && h.mint && h.symbol)
      .map((h) => ({
        ts: num(h.ts), symbol: String(h.symbol).slice(0, 12), mint: String(h.mint), solIn: num(h.solIn),
        pnlSol: num(h.pnlSol), pnlPct: num(h.pnlPct), reason: String(h.reason || 'Sold'), paper: Boolean(h.paper),
        buySignature: h.buySignature || null, sellObservationMs: h.sellObservationMs == null ? null : num(h.sellObservationMs),
        measured: Boolean(h.measured), signature: h.signature || null, basisSol: num(h.basisSol),
        heldSec: h.heldSec == null ? null : num(h.heldSec),
        firedPct: h.firedPct == null ? null : num(h.firedPct),
        peakPct: h.peakPct == null ? null : num(h.peakPct),
        src: h.src || null, score: h.score == null ? null : num(h.score),
        ch5: h.ch5 == null ? null : num(h.ch5), buyers: h.buyers == null ? null : num(h.buyers),
      }))
      .slice(0, 100);
    for (const key of ['paper', 'live']) {
      const b = this.s.books && this.s.books[key];
      if (!b) continue;
      this.books[key] = {
        trades: num(b.trades), wins: num(b.wins), losses: num(b.losses),
        pnl: num(b.pnl), sessionPnl: num(b.sessionPnl),
      };
    }
  }

  /** Sell a balance the book does not track. The trade door comes first: the backup route has no quote for amounts
   *  that small, which is why leftovers used to stay in the wallet for ever. */
  async _sellAny(mint, slippage) {
    const slip = Math.max(Number(slippage) || 0, this.s.slippagePct, 20);
    try {
      const r = await this._tradeLive('sell', mint, null, { slippage: slip, fee: this._feeFor(true), pct: 100, pool: 'auto' });
      const left = await this._tokenBalanceRaw(mint).catch(() => null);
      if (left === 0n) return true;
      if (r && r.landed) return true;
    } catch (_) { /* the next door may still fill it */ }
    await this._backupTrade('sell', mint, null, { slippage: slip, pct: 100 }).catch(() => {});
    const left = await this._tokenBalanceRaw(mint).catch(() => null);
    return left === 0n;
  }

  /** Every sale ends here: the remainder is sold (or burned when it is worth less than its rent), the account is
   *  closed and the ~0.00204 SOL of rent comes back. One at a time, never in the way of the next exit - and never
   *  dropped: a coin that arrives while another is settling waits its turn in the queue. */
  async _settleMint(mint) {
    if (this.s.mode !== 'live' || !this.wallet.isUnlocked() || !this.s.autoReclaim) return;
    if (this.positions.has(mint)) return;
    this._settleQueue.add(mint);
    if (this._settling) return;
    this._settling = true;
    try {
      while (this._settleQueue.size) {
        const next = this._settleQueue.values().next().value;
        this._settleQueue.delete(next);
        await this._settleOne(next).catch(() => {});
      }
    } finally {
      this._settling = false;
    }
  }

  async _settleOne(mint) {
    const before = await this._tokenBalanceRaw(mint).catch(() => null);
    if (before == null) return;
    let left = before;
    // The remainder a full sell leaves is the trade door's own cut. It goes back out through that door first.
    if (left > 0n) {
      await this._sellAny(mint, Math.max(this.s.slippagePct, 20)).catch(() => {});
      left = await this._tokenBalanceRaw(mint).catch(() => null);
      if (left == null) return;
    }
    // What neither door could sell is dust worth less than the rent it is holding: burning it and closing the
    // account returns the ~0.00204 SOL instead of leaving it locked for good. Anything worth more is left alone.
    if (left > 0n) {
      const freed = await this._burnDust(mint, left).catch(() => false);
      if (freed) left = 0n;
    }
    if (left > 0n) return;
    await this._closeEmptyWhenFree();
    // The rent of the closed accounts is landing in the wallet in this same breath: not a deposit.
    this._lastReclaimAt = Date.now();
    await this.refreshBalance();
  }

  /** Close the accounts an exit just emptied. A cleanup already running (the sweep, a press of Recover rent) holds
   *  the lock for a moment; waiting for it beats throwing the rent the exit just freed away. */
  async _closeEmptyWhenFree(tries = 8) {
    for (let i = 0; i < tries; i++) {
      if (!this._reclaiming) return this.closeEmptyAccounts().catch(() => null);
      await new Promise((r) => setTimeout(r, 300));
    }
    this._scheduleReclaim();
    return null;
  }

  /** True when the leftover was burned and its account closed, which is only worth doing for dust. */
  async _burnDust(mint, amountRaw) {
    if (!this.s.recoverDust) return false;
    const scan = await this._tokenAccounts().catch(() => null);
    const acct = scan && scan.accounts.find((a) => a.mint === mint);
    if (!acct) return false;
    const price = (await this.market.prices([mint]).catch(() => new Map())).get(mint);
    const usd = price ? Number(acct.uiAmount) * price.priceUsd : null;
    const rentSol = acct.lamports / 1e9;
    const rentUsd = rentSol * (this.market.solPrice() || 0);
    if (usd != null && (!(rentUsd > 0) || usd > rentUsd * 0.5)) return false;
    const kp = this._requireWallet();
    const burn = reclaim.makeBurner((fn, opts) => this.rpcCall(fn, opts), kp);
    await burn({ ...acct, amount: amountRaw.toString() });
    if (acct.lamports) this.stats.reclaimedSol += rentSol;
    this._log('ok', `Closed the dust account of ${mint.slice(0, 6)}: ${usd == null ? 'a leftover no market prices' : usd < 0.01 ? 'under a cent' : '$' + usd.toFixed(2)} of tokens burned to get ${rentSol.toFixed(5)} SOL of rent back.`);
    return true;
  }

  async sellPosition(mint) {
    const p = this.positions.get(mint);
    if (!p) throw new Error('That coin is not an open position.');
    if (p.status !== 'open') throw new Error(`${p.symbol} is still confirming its buy. Try again in a second.`);
    p.nextTry = 0;
    await this._sell(p, 'Manual sell', 100, { manual: true });
    const left = p.paper ? 0n : await this._tokenBalanceRaw(mint).catch(() => null);
    if (left && left > 0n) throw new Error(`${p.symbol} did not sell: the wallet still holds it. Press Sell again, or use Sell all in the Wallet tab.`);
    return { sold: true, symbol: p.symbol };
  }

  async sellAll() {
    const open = [...this.positions.values()].filter((p) => p.status === 'open');
    if (!open.length) throw new Error('No open positions to sell.');
    const failed = [];
    for (const p of open) {
      p.nextTry = 0;
      try {
        await this._sell(p, 'Manual sell', 100, { manual: true });
        const left = p.paper ? 0n : await this._tokenBalanceRaw(p.mint).catch(() => null);
        if (left && left > 0n) failed.push(`${p.symbol}: still in the wallet`);
      } catch (e) { failed.push(`${p.symbol}: ${e.message}`); }
    }
    if (failed.length) throw new Error(failed[0]);
    // Closing everything is an instruction about the market, not only about the coins: without this the desk bought
    // again in the same second and the hand that pressed "sell all" watched it refill.
    this.pausedUntil = Date.now() + 2 * 60000;
    this.pauseReason = 'you sold everything';
    this._log('info', 'All positions sold. New entries paused for 2 minutes; anything open now still closes by its rules.');
    return { sold: open.length };
  }

  _tick() {
    const now = Date.now();
    const s = this.s;
    this._seq = (this._seq || 0) + 1;
    for (const p of this.positions.values()) {
      if (p.pendingBuy) {
        if (!p.checkingBuy && now >= (p.nextBuyCheck || 0)) {
          p.checkingBuy = true;
          p.nextBuyCheck = now + 3000;
          this._confirm(p.sig, null, { polls: 2 }).then(async (result) => {
            if (result.state === 'failed') {
              this.positions.delete(p.mint); this._releaseSpend(p.spendEntry);
            } else if (result.state === 'confirmed') {
              p.pendingBuy = false; p.pending = false; p.status = 'open';
              p.tokIn = await this._tokenBalanceRaw(p.mint).catch(() => null);
            }
            this._persistPositions();
          }).catch((e) => this._log('warn', e.message)).finally(() => { p.checkingBuy = false; });
        }
        continue;
      }
      if (p.status !== 'open' || p.closing) continue;
      if (p.pendingSell) { this._sell(p, 'Pending sale confirmation', 100, { manual: true }).catch((e) => this._log('warn', e.message)); continue; }
      const t = this.tokens.get(p.mint);
      const flowExit = adaptiveExit(p, t, s, now);
      if (flowExit) { this._sell(p, flowExit, 100); continue; }
      const lastPx = p.pxAt || p.bookedAt || p.openedAt || now;
      const blindFor = p.pxAt ? PX_LOST_MS : PX_LOST_MS * 3;
      if (now - lastPx > blindFor) {
        p.trigger = null;
        this._sell(p, 'Price lost', 100);
        continue;
      }
      if (p.entrySettled !== false && p.mc > (p.peakMc || 0)) { p.peakMc = p.mc; p.peakPct = this._pnlPct(p); }
      const pnl = this._pnlPct(p);
      const peak = this._pnlPct({ ...p, mc: p.peakMc || p.mc });
      let why = null;
      let rule = null;
      let pct = 100;
      if (t && t.devSold) { rule = 'Creator sold'; why = rule; }
      else if (pnl >= s.takeProfitPct && p.entrySettled !== false) { rule = 'Take profit'; why = rule; }
      // Simple settings closes only on the target, the stop and the time limit: the first rung, the trail and the
      // break even are advanced rules, and while the simple mode is on they are off by definition.
      else if (!s.simpleMode && s.tp1Pct > 0 && !p.tp1Done && pnl >= s.tp1Pct && p.entrySettled !== false) { rule = 'Take profit part 1'; why = rule; pct = clamp(s.tp1SellPct, 10, 90); }
      else if (pnl <= -s.stopLossPct) { rule = 'Stop loss'; why = rule; }
      else if (s.simpleMode && p.entrySettled !== false && peak >= SIMPLE_RUN_ARM && pnl <= peak / 2) { rule = 'Peak give-back'; why = `${rule} (peaked at +${peak.toFixed(1)}%, level +${(peak / 2).toFixed(1)}%)`; }
      // After the first rung has been banked the rest is a runner, and a runner is given less room: the whole point of
      // taking the first bite is that the remainder can be sold at the top instead of giving the move back.
      else if (!s.simpleMode && p.entrySettled !== false && s.trailArmPct > 0 && s.trailGivePct > 0 && peak >= s.trailArmPct && pnl <= peak - this._trailGive(peak)) { rule = 'Trailing stop'; why = `${rule} (peaked at +${peak.toFixed(1)}%)`; }
      // A coin that has already shown a real gain is not allowed to become a loss: most of the losing trades in
      // this market are winners that were given back, and the fees make a round trip to zero worse than nothing.
      else if (!s.simpleMode && p.entrySettled !== false && s.breakEvenPct > 0 && peak >= s.breakEvenPct && pnl <= 0) { rule = 'Break even'; why = rule; }
      else if ((now - p.openedAt) / 1000 >= s.maxHoldSec) { rule = 'Time limit'; why = rule; }
      if (!why) { p.trigger = null; continue; }
      // The freshness guard (see `PROFIT_FRESH_MS`): a rule that protects a gain waits for a fresh reading, and the
      // position asks for one instead of acting on an old number. Stops and the time limit are not held back.
      if (rule !== 'Stop loss' && rule !== 'Creator sold' && rule !== 'Time limit' && now - (p.pxAt || p.openedAt || 0) > PROFIT_FRESH_MS) {
        p.wantPx = now;
        p.trigger = null;
        continue;
      }
      if (rule === 'Creator sold' || rule === 'Time limit') { this._sell(p, why, pct); continue; }
      const seen = p.trigger;
      if (!seen || seen.rule !== rule || now - seen.at > 3000) { p.trigger = { rule, at: now, pxAt: p.pxAt || 0, seq: this._seq }; continue; }
      const holdMs = RISK_RULES.has(rule) ? this._riskHoldMs(rule, pnl, peak, p.pxSource) : Math.max(0, Number(s.triggerHoldMs) || 0);
      const held = now - seen.at >= holdMs;
      const fresh = p.pxAt ? (p.pxAt || 0) > seen.pxAt : this._seq > seen.seq;
      if (!held || !fresh) continue;
      p.trigger = null;
      p.firedAt = Math.round(pnl * 10) / 10;
      p.mcAtFire = p.mc;
      this._sell(p, why, pct);
    }
    if (s.mode === 'live' && s.smartFees && now - (this._feeAt || 0) > 4000 && (this.running || this.positions.size)) { this._feeAt = now; this._refreshFee(); }
    if (this.ws && this._feedLabel === 'pumpdev' && now - (this._subAt || 0) > 4000) { this._subAt = now; this._syncSubscriptions(); }
    // A sale booked from an estimate is measured again in the background (`_remeasureSells`): the number on the card
    // must end up being the money, not the price the rule happened to fire at.
    if (this._remeasure && this._remeasure.length && now - (this._remeasureAt || 0) > 5000) { this._remeasureAt = now; this._remeasureSells(); }
    if (this.chain && now - Math.max(this._chainAt || 0, this._lastEv || 0) > 12000) {
      // The chain feed can be silently blocked by a public node. Say it once a minute, not on every tick.
      if (!this._chainWarnAt || now - this._chainWarnAt > 60000) {
        this._chainWarnAt = now;
        this._fallback('no data received for 12 s');
      }
    }
    if (this.running) this._scan(now);
    this._shutdownIfIdle();
  }

  /** Priority fee in SOL. Smart mode follows live network fees (cheap when quiet); profile value is the ceiling. */
  _feeFor(urgent) {
    const s = this.s;
    const cap = s.priorityFeeSol;
    if (s.mode === 'paper') return cap + networkExtras(s);
    if (!s.smartFees || s.mode !== 'live' || this._feeSol == null) return cap;
    const v = this._feeSol * (urgent ? 2 : 1);
    return Math.max(Math.min(FEE_FLOOR_SOL, cap), Math.min(cap, v));
  }

  async _refreshFee() {
    try {
      const rows = await this.rpcCall((c) => c.getRecentPrioritizationFees({ lockedWritableAccounts: [new PublicKey(PUMP_PROGRAM)] }));
      const vals = rows.slice(-30).map((r) => r.prioritizationFee).filter((x) => x > 0).sort((a, b) => a - b);
      const p75 = vals.length ? vals[Math.floor(vals.length * 0.75)] : 0;               // micro-lamports per CU
      this._feeSol = Math.max(FEE_FLOOR_SOL, (p75 * FEE_CU_ESTIMATE) / 1e6 / 1e9);
    } catch (_) { /* keep last known value */ }
  }

  /**
   * Slippage tolerance in %. The ceiling is a promise: nothing here ever goes above it. Smart mode only makes an
   * entry tighter on a calm coin, because an exit must be able to land at the number the user chose.
   */
  _slippageFor(mint, urgent, pnlPct = null) {
    const s = this.s;
    const cap = s.slippagePct;
    const inProfit = Number.isFinite(pnlPct) && pnlPct >= 0;
    // An exit that does not fill is worse than an exit that fills lower: a refused stop costs a whole second of
    // re-quoting while the coin keeps falling. So an urgent exit is never tighter than EXIT_SLIP_MIN.
    if (urgent) {
      const base = Math.min(EXIT_SLIP_MAX, Math.max(cap, EXIT_SLIP_MIN));
      return inProfit ? Math.min(base, SPIKE_SLIP) : base;
    }
    const floor = inProfit ? Math.min(SPIKE_SLIP, EXIT_SLIP_MAX) : 0;
    if (!s.smartFees) return Math.max(cap, floor);
    const t = this.tokens.get(mint);
    const g = t ? Math.abs(this._metrics(t, Date.now(), 5).growth) : 0.05;
    const lean = Math.round(clamp(MIN_SLIP + g * 100 * 1.2, Math.min(MIN_SLIP, cap), cap) * 10) / 10;
    return Math.max(lean, floor);
  }

  _guardTx(tx, amountSol) {
    const { payer, signers, instructions } = readTx(tx);
    const walletOwner = this.wallet.address();
    if (payer !== walletOwner || signers.length !== 1 || signers[0] !== walletOwner) throw new Error('Safety check: unexpected payer or signer.');
    assertFeeBudget(instructions, Math.max(0.000005, Number(this.s.priorityFeeSol) || 0) + 0.000005);
    assertSystemInstructions(instructions);
    const total = lamportsOut(instructions);
    const ticket = typeof amountSol === 'number' && amountSol > 0 ? amountSol : 0;
    const allowed = BigInt(Math.round((TX_GUARD_MAX_SOL + ticket * 1.1) * 1e9));
    if (total > allowed) throw new Error('Safety check blocked a suspicious transaction.');
    const owner = this.wallet.address();
    for (const ix of instructions) {
      if (ix.program !== TOKEN_PROGRAM && ix.program !== TOKEN_2022_PROGRAM) continue;
      if (!ix.data.length) throw new Error('Safety check blocked a transaction with an unreadable token instruction.');
      const tag = ix.data[0];
      if (tag === TOKEN_IX_APPROVE || tag === TOKEN_IX_APPROVE_CHECKED) throw new Error('Safety check blocked a transaction that asks for a token approval.');
      if (tag === TOKEN_IX_SET_AUTHORITY) throw new Error('Safety check blocked a transaction that changes a token authority.');
      if (tag === 8 || tag === 15) throw new Error('Safety check blocked a trade that burns tokens.');
      if (tag === TOKEN_IX_CLOSE_ACCOUNT && owner && ix.keys[1] !== owner) {
        throw new Error('Safety check blocked a transaction that closes an account with the rent going elsewhere.');
      }
    }
  }

  async _broadcast(raw) {
    const lane = this._jitoLane(raw).catch(() => false);
    const sig = this.rpc.broadcast ? await this.rpc.broadcast(raw) : await this.rpcCall((c) => c.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }), BROADCAST);
    lane.catch(() => {});
    return sig;
  }

  /**
   * The Jito lane: the trade's own signed bytes plus one tip transfer, as one bundle. Never throws and never changes
   * what the normal route did - the tip only leaves the wallet if the bundle lands.
   */
  async _jitoLane(raw) {
    if (!this.s.useJito || !raw) return false;
    const kp = this.wallet.keypair;
    if (!kp) return false;
    try {
      const lamports = Math.round(Math.max(0.000001, Number(this.s.jitoTipSol) || 0.0001) * 1e9);
      if (BigInt(lamports) < MIN_TIP_LAMPORTS) throw new Error("the tip is below Jito's own minimum");
      const tips = await this.jito.tipAccounts();
      const to = tips[Math.floor(Math.random() * tips.length)];
      // The tip transaction reuses the trade's blockhash, so both are valid for exactly as long as the trade is.
      const trade = VersionedTransaction.deserialize(new Uint8Array(raw));
      const { Transaction, SystemProgram } = require('@solana/web3.js');
      const tipTx = new Transaction({ feePayer: kp.publicKey, recentBlockhash: trade.message.recentBlockhash });
      tipTx.add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: new PublicKey(to), lamports }));
      tipTx.sign(kp);
      // The tip is built here and nowhere else: one transfer, to an address Jito itself named, for an amount the user
      // set. Anything else in this transaction would be a bug, so it is checked rather than trusted.
      if (tipTx.instructions.length !== 1) throw new Error('the tip transaction is not a single transfer');
      const ix = tipTx.instructions[0];
      if (!ix.programId.equals(SystemProgram.programId)) throw new Error('the tip is not a system transfer');
      if (!ix.keys[1].pubkey.equals(new PublicKey(to))) throw new Error('the tip does not pay a Jito account');
      const id = await this.jito.sendBundle([raw, tipTx.serialize()]);
      this._log('info', `Offered to Jito as a bundle (tip ${(lamports / 1e9).toFixed(6)} SOL, paid only if it lands).`);
      return Boolean(id);
    } catch (e) {
      const why = String(e.message || 'the block engine refused it').replace(/\.\s*$/, '');
      // The client's own sentence already starts with "Jito", so the line must not repeat it: "Jito: Jito refused the
      // request (HTTP 400)" is a stutter on the screen.
      const say = /^jito\b/i.test(why) ? why : `Jito: ${why}`;
      if (/already processed|already been processed/i.test(why)) {
        if (!this._jitoDupAt || Date.now() - this._jitoDupAt > 600000) {
          this._jitoDupAt = Date.now();
          this._log('info', `${say} - the order is already on chain, so the bundle had nothing to add. This is what a winning RPC race looks like, not a fault.`);
        }
        return false;
      }
      // Once a minute at most: a block engine that is down is not an error the trade depends on.
      if (!this._jitoWarnedAt || Date.now() - this._jitoWarnedAt > 60000) {
        this._jitoWarnedAt = Date.now();
        // The reason is the whole value of the line, and a message that already ends in a full stop must not be given
        // a second one: "(HTTP 400).. The normal route is unaffected." is a typo on the screen, not a sentence.
        this._log('warn', `${say}. The normal route is unaffected.`);
      }
      return false;
    }
  }

  /** Primary route: PumpPortal builds the transaction, we sign it locally and send it through our own RPC. */
  async _execLive(action, mint, amount, denomSol, opt = {}) {
    const kp = this.wallet.keypair;
    if (!kp) throw new Error('Wallet is locked');
    const s = this.s;
    const body = {
      publicKey: kp.publicKey.toBase58(), action, mint, amount,
      denominatedInSol: denomSol ? 'true' : 'false',
      slippage: opt.slippage != null ? opt.slippage : s.slippagePct,
      priorityFee: opt.fee != null ? opt.fee : s.priorityFeeSol, pool: opt.pool || 'auto',
    };
    const buildFail = (message) => Object.assign(new Error(message), { phase: 'build' });
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 5000);
    let r;
    try {
      r = await fetch(TRADE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
    } catch (e) {
      throw buildFail(e.name === 'AbortError' ? 'Trade API timed out' : 'Trade API unreachable: ' + e.message);
    } finally { clearTimeout(timer); }
    if (!r.ok) {
      const status = String(r.statusText || '').trim();
      const body = (await r.text().catch(() => '')).slice(0, 120);
      const why = status && status !== 'Bad Request' ? status : body;
      this.stats.lastTradeDoorWhy = why || null;
      throw buildFail(!why || /^bad request$/i.test(why)
        ? 'the trade door could not price this coin yet'
        : `the trade door refused it (${why})`);
    }
    let tx;
    try {
      tx = VersionedTransaction.deserialize(new Uint8Array(await r.arrayBuffer()));
    } catch (e) {
      throw buildFail('Trade API sent a transaction that could not be read: ' + e.message);
    }
    this._guardTx(tx, denomSol ? amount : null);
    tx.sign([kp]);
    const raw = tx.serialize();
    if (opt && opt.gate) await opt.gate;
    let sig;
    try { sig = await this._broadcast(raw); } catch (err) {
      err.phase = 'submitted'; err.signature = require('bs58').encode(tx.signatures[0]); err.raw = raw;
      throw err;
    }
    return { sig, raw };
  }

  async _tradeLive(action, mint, solAmount, opt) {
    const tip = Number(this.s.priorityFeeSol) || 0;
    try {
      const r = await this._execLive(action, mint, action === 'buy' ? solAmount : (opt && opt.pct && opt.pct < 100 ? opt.pct + '%' : '100%'), action === 'buy', opt);
      this.stats.feeSpentSol = (this.stats.feeSpentSol || 0) + tip;
      return r;
    } catch (e) {
      if (e.phase !== 'build' && e.phase !== 'rejected') throw e;
      if (/locked|Safety check/i.test(e.message)) throw e;
      // A rejection on chain is a transaction that landed and failed: the tip is gone, and the book must say so.
      if (e.phase === 'rejected') {
        this.stats.feeSpentSol = (this.stats.feeSpentSol || 0) + tip;
        this.stats.orderFails = (this.stats.orderFails || 0) + 1;
      }
      this._log('info', `The first route did not fill (${this._whyRejected(e.message)}). Trying the backup route.`);
      if (opt && opt.gate) await opt.gate;
      try {
        const sig = await this._jupiterSwap(action, mint, solAmount, opt);
        return { sig, raw: null, landed: true };
      } catch (jupErr) {
        if (jupErr.phase !== 'build' && !jupErr.definite) throw jupErr;
        // Neither door filled the order, so the caller still knows nothing was signed and may retry safely.
        throw Object.assign(new Error(`${e.message}; the backup route also failed (${jupErr.message})`), {
          phase: e.phase,
          definite: Boolean(e.definite),
        });
      }
    }
  }

  /**
   * The backup route as an order like any other: same shape as `_execLive`, so the retry ladders treat both doors
   * the same. A swap that answers with a signature has landed, which is why `landed` is true here.
   */
  async _backupTrade(action, mint, solAmount, opt) {
    if (this._jupDownUntil && Date.now() < this._jupDownUntil) {
      throw Object.assign(new Error('the backup route is resting after a refusal'), { rested: true });
    }
    try {
      // The fee counter is only for tips this wallet really paid on its own transactions. A swap route charges
      // inside the fill, so nothing is added here; the measured proceeds already carry that cost.
      const sig = await this._jupiterSwap(action, mint, solAmount, opt);
      this._jupDownUntil = 0;
      return { sig, raw: null, landed: true };
    } catch (e) {
      this.stats.orderFails = (this.stats.orderFails || 0) + 1;
      if (/429|rate limit|no route|Failed to get quotes|unreachable/i.test(String(e.message || ''))) this._jupDownUntil = Date.now() + 60000;
      throw e;
    }
  }

  async _jupiterSwap(action, mint, solAmount, opt) {
    const kp = this.wallet.keypair;
    if (!kp) throw new Error('Wallet is locked');
    let amountRaw;
    if (action === 'buy') amountRaw = BigInt(Math.floor(solAmount * 1e9));
    else {
      amountRaw = await this._tokenBalanceRaw(mint);
      // A partial exit must stay partial on the backup route too, otherwise the book keeps a position whose
      // tokens are already gone.
      const pct = Number(opt && opt.pct) || 100;
      if (pct < 100) amountRaw = (amountRaw * BigInt(Math.round(pct))) / 100n;
      if (amountRaw <= 0n) throw new Error('Nothing to sell');
    }
    return this.jup.swap({
      keypair: kp, inputMint: action === 'buy' ? WSOL : mint, outputMint: action === 'buy' ? mint : WSOL,
      amountRaw: amountRaw.toString(), slippageBps: (opt.slippage != null ? opt.slippage : this.s.slippagePct) * 100,
      guard: (tx, owner) => assertSwapTx(tx, owner, { maxSolOut: action === 'buy' ? solAmount : 0 }),
    });
  }

  async _balanceDetail(mint) {
    const owner = this.wallet.keypair && this.wallet.keypair.publicKey;
    if (!owner) throw new Error('Wallet is locked');
    // Bounded on purpose: this runs while a position is held back by an exit, so it must not stall the loop.
    const res = await this.rpcCall((c) => c.getParsedTokenAccountsByOwner(owner, { mint: new PublicKey(mint) }), { timeoutMs: 2500, attempts: 3, budgetMs: 6000 });
    let amount = 0n;
    let decimals = null;
    for (const it of res.value) {
      const info = it.account.data.parsed.info;
      amount += BigInt(info.tokenAmount.amount);
      if (decimals == null) decimals = Number(info.tokenAmount.decimals);
    }
    return { amount, gone: res.value.length === 0, decimals };
  }

  /** Raw token balance of the wallet for one mint (0n if there is no account). `out`, when given, receives whether
   *  the account itself is gone - which is what returns its rent. It is written into the caller's own object rather
   *  than a shared field, because another balance read can finish before the value is used. */
  async _tokenBalanceRaw(mint, out = null) {
    const d = await this._balanceDetail(mint);
    if (out) { out.gone = d.gone; out.decimals = d.decimals; }
    return d.amount;
  }

  async _confirm(sig, raw, opts = {}) {
    const step = opts.step || 250;
    const polls = Math.max(2, Number(opts.polls) || CONFIRM_POLLS);
    const acceptProcessed = Boolean(opts.acceptProcessed);
    for (let i = 0; i < polls; i++) {
      if (i) await new Promise((r) => setTimeout(r, step));
      if (raw && i % 8 === 7 && i < polls - 1) {
        this.rpcCall((c) => c.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }), BROADCAST).catch(() => {});
      }
      try {
        const { value } = await this.rpcCall((c) => c.getSignatureStatuses([sig]), { attempts: 2, budgetMs: 4000 });
        const st = value[0];
        if (st) {
          if (st.err) return { state: 'failed', err: JSON.stringify(st.err).slice(0, 200) };
          if (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized') return { state: 'confirmed', err: '' };
          if (acceptProcessed && st.confirmationStatus === 'processed') return { state: 'confirmed', err: '' };
        }
      } catch (_) { /* ask again */ }
    }
    return { state: 'unknown', err: '' };
  }

  _requireWallet() {
    if (!this.wallet.exists()) throw new Error('Create your wallet first.');
    if (!this.wallet.isUnlocked()) throw new Error('Unlock your wallet first.');
    return this.wallet.keypair;
  }

  async scanWallet() {
    const addr = this.wallet.address();
    if (!addr) throw new Error('Create your wallet first.');
    const r = await reclaim.scanTokenAccounts((fn, opts) => this.rpcCall(fn, opts), addr);
    const mini = (a) => ({ mint: a.mint, uiAmount: a.uiAmount, rentSol: a.lamports / 1e9, frozen: a.frozen });
    return {
      emptyCount: r.empty.length, emptyRentSol: r.emptyRentSol,
      dust: r.dust.map(mini), dustRentSol: r.dustRentSol,
      frozen: r.frozen.map(mini), frozenRentSol: r.frozenRentSol,
    };
  }

  /** Free local cleanup: closes only zero-balance token accounts and returns the rent to the wallet. */
  async closeEmptyAccounts() {
    const kp = this._requireWallet();
    if (this._reclaiming) throw new Error('A cleanup is already running.');
    this._reclaiming = true;
    try {
      const r = await reclaim.scanTokenAccounts((fn, opts) => this.rpcCall(fn, opts), kp.publicKey.toBase58());
      const held = new Set(this.positions.keys());
      const accounts = r.empty.filter((a) => !held.has(a.mint));
      if (!accounts.length) return { closed: 0, sol: 0, errors: [] };
      const res = await reclaim.closeEmpty({ accounts, sendChunk: reclaim.makeSender((fn, opts) => this.rpcCall(fn, opts), kp) });
      this.stats.reclaimedSol += res.sol;
      // Rent coming back is our own money returning, not a deposit: the baseline must know that before the balance is
      // read again, or reclaiming 0.02 SOL of rent would read as a 0.02 SOL profit.
      if (res.closed) this._lastReclaimAt = Date.now();
      if (res.closed) this._log('ok', `Recovered ${res.sol.toFixed(5)} SOL from ${res.closed} empty token account${res.closed > 1 ? 's' : ''}.`);
      if (res.errors.length) this._log('warn', 'Some accounts could not be closed: ' + res.errors[0]);
      this.refreshBalance();
      return res;
    } finally { this._reclaiming = false; }
  }

  /**
   * Sell one holding the wallet carries, whether or not the book has a position for it. Used for the leftover
   * balances listed in the Wallet tab, where burning would destroy value that can still be sold.
   */
  async sellHolding(mint) {
    this._requireWallet();
    const m = String(mint || '');
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m)) throw new Error('Invalid token address.');
    const held = await this._tokenBalanceRaw(m);
    if (held == null) throw new Error('The balance of that token could not be read.');
    if (held === 0n) throw new Error('The wallet holds none of that token.');
    const before = this.walletBalance;
    await this._sellAny(m, Math.max(this.s.slippagePct, 10));
    const left = await this._tokenBalanceRaw(m).catch(() => null);
    await this.refreshBalance();
    const gained = before != null && this.walletBalance != null ? this.walletBalance - before : null;
    this._log('ok', `Sold the leftover balance of ${m.slice(0, 6)}${gained != null && gained > 0 ? ` for about ${gained.toFixed(5)} SOL` : ''}${left === 0n ? '' : ' (some tokens are still there)'}.`);
    const p = this.positions.get(m);
    if (p && left === 0n) { p.nextTry = 0; this._finishSell(p, 'Sell all', this._feeFor(true), 100); }
    return { left: left == null ? null : left.toString(), gained };
  }

  async sellEverything() {
    this._requireWallet();
    if (this._sellingAll) throw new Error('A sell-all is already running.');
    // Said before anything is attempted: with no SOL for the fees every order is refused, and a button that spends
    // a minute failing in silence reads as a broken button.
    if (this._balance() < EXIT_FEE_FLOOR_SOL) { this._warnNoFeeSol(); throw new Error(this._noFeeSentence()); }
    this._sellingAll = true;
    const out = { sold: 0, tokens: 0, skipped: 0, failed: [], closed: 0, rentSol: 0, solBefore: this.walletBalance, solAfter: null };
    this._log('info', 'Selling every coin the wallet holds.');
    try {
      // Tracked positions first, through the normal ladder: it books the result and follows a coin that has moved
      // to PumpSwap. A position whose tokens are already gone is booked from the wallet, never sold twice.
      for (const p of [...this.positions.values()]) {
        if (p.paper) continue;
        p.nextTry = 0;
        const held = await this._tokenBalanceRaw(p.mint).catch(() => null);
        if (held === 0n) { this._finishSell(p, 'Sell all', this._feeFor(true), 100); continue; }
        await this._sell(p, 'Sell all', 100, { manual: true }).catch((e) => out.failed.push(`${p.symbol}: ${e.message}`));
        const left = await this._tokenBalanceRaw(p.mint).catch(() => null);
        if (left === 0n && this.positions.has(p.mint)) this._finishSell(p, 'Sell all', this._feeFor(true), 100);
      }
      // Then whatever is still on chain, tracked or not. Frozen accounts belong to the token's issuer, so they are
      // reported instead of attempted.
      const scan = await this._tokenAccounts();
      for (const a of scan.frozen) out.failed.push(`${a.mint.slice(0, 6)} is frozen by its issuer, so it cannot be sold`);
      for (const a of scan.dust) {
        out.tokens++;
        try {
          await this._sellAny(a.mint, Math.max(this.s.slippagePct, 10));
          const left = await this._tokenBalanceRaw(a.mint).catch(() => null);
          if (left === 0n) out.sold++;
          else {
            // Worth less than its own rent: burned and closed so the SOL comes home instead of sitting locked.
            if (await this._burnDust(a.mint, left).catch(() => false)) out.sold++;
            else out.failed.push(`${a.mint.slice(0, 6)}: the market took only part of the balance`);
          }
          this.refreshBalance();
        } catch (e) {
          out.failed.push(`${a.mint.slice(0, 6)}: ${this._whyRejected(e.message)}`);
        }
      }
      const closed = await this.closeEmptyAccounts().catch((e) => { out.failed.push('Closing accounts: ' + e.message); return null; });
      if (closed) { out.closed = closed.closed; out.rentSol = closed.sol; }
      // Selling everything is an instruction about the market, not only about the coins: without this the desk bought
      // again in the same second and the hand that pressed the button watched the wallet refill.
      this.pausedUntil = Date.now() + 2 * 60000;
      this.pauseReason = 'you sold every coin';
      await this.refreshBalance();
      out.solAfter = this.walletBalance;
      const recovered = out.solBefore != null && out.solAfter != null ? out.solAfter - out.solBefore : null;
      this._log(out.failed.length ? 'warn' : 'ok', `Sell-all finished: ${out.sold} of ${out.tokens} coin${out.tokens === 1 ? '' : 's'} sold, ${out.closed} account${out.closed === 1 ? '' : 's'} closed, ${out.rentSol.toFixed(5)} SOL of rent back${recovered != null ? `, wallet ${recovered >= 0 ? '+' : ''}${recovered.toFixed(5)} SOL` : ''}.`);
      for (const f of out.failed.slice(0, 3)) this._log('warn', `  ${f}`);
      return out;
    } finally { this._sellingAll = false; }
  }

  _scheduleReclaim() {
    if (!this.s.autoReclaim || this.s.mode !== 'live' || !this.wallet.isUnlocked()) return;
    clearTimeout(this._reclaimTimer);
    this._reclaimTimer = setTimeout(() => {
      this.closeEmptyAccounts().catch((e) => {
        // Housekeeping, never an alarm: a scan that could not be answered is retried on the next exit, and the
        // rent it would return is a fraction of a cent. Said once per ten minutes at most.
        if (this._reclaimWarned && Date.now() - this._reclaimWarned < 600000) return;
        this._reclaimWarned = Date.now();
        this._log('info', 'Rent recovery is waiting for a node that can list the token accounts; it runs again after the next sell.');
      });
    }, 20000);
  }

  async _signAndSendApi(b58tx, guard) {
    const kp = this.wallet.keypair;
    if (!kp) throw new Error('Wallet is locked');
    const { VersionedTransaction, Transaction } = require('@solana/web3.js');
    const bs58 = require('bs58');
    const bytes = bs58.decode(String(b58tx || ''));
    // A transaction built by an API is inspected before it is signed: whoever wrote those bytes decides what the
    // wallet does, and the signature is unconditional.
    let tx;
    try { tx = VersionedTransaction.deserialize(bytes); } catch (_) { tx = Transaction.from(bytes); }
    guard(tx, kp.publicKey.toBase58());
    if (tx instanceof VersionedTransaction) {
      tx.sign([kp]);
      const raw = tx.serialize();
      const sig = await this.rpcCall((c) => c.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 3 }), BROADCAST);
      return (await this._confirm(sig, raw)).state === 'confirmed';
    }
    tx.partialSign(kp);
    const raw = tx.serialize();
    const sig = await this.rpcCall((c) => c.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 3 }), BROADCAST);
    return (await this._confirm(sig, raw)).state === 'confirmed';
  }

  /** Sol Incinerator: close every empty account (API builds the transactions, we inspect, sign and send them). */
  async incineratorCloseAll() {
    const kp = this._requireWallet();
    const before = await this.rpcCall((c) => c.getBalance(kp.publicKey)).catch(() => null);
    const out = await this.inc.batchCloseAll(kp.publicKey.toBase58());
    const txs = Array.isArray(out.transactions) ? out.transactions : [];
    if (!txs.length) return { transactions: 0, confirmed: 0, accountsClosed: 0, sol: 0 };
    let ok = 0;
    const refused = [];
    for (const t of txs) {
      try {
        if (await this._signAndSendApi(t, (tx, owner) => assertCleanupTx(tx, owner))) ok++;
      } catch (e) { refused.push(e.message); }
    }
    // Only what the wallet actually gained counts. The API's own "reclaimed" figure is an estimate made before any
    // of these transactions existed, so it is never reported as money.
    const after = await this.rpcCall((c) => c.getBalance(kp.publicKey)).catch(() => null);
    const gained = before != null && after != null && after > before ? (after - before) / 1e9 : 0;
    if (refused.length) this._log('error', 'Sol Incinerator: ' + refused[0]);
    this._log(ok ? 'ok' : 'warn', `Sol Incinerator: ${ok} of ${txs.length} transactions confirmed${gained ? `, ${gained.toFixed(5)} SOL back in the wallet` : ''}.`);
    this.refreshBalance();
    return { transactions: txs.length, confirmed: ok, accountsClosed: out.accountsClosed || 0, sol: gained };
  }

  /** Sol Incinerator: burn the whole balance of one leftover token and close its account. */
  async incineratorBurn(mint) {
    const kp = this._requireWallet();
    if (this.positions.has(mint)) throw new Error('That coin is an open position. Sell it first.');
    if (String(mint) !== String(new PublicKey(mint).toBase58())) throw new Error('Invalid token address.');
    const out = await this.inc.burn(kp.publicKey.toBase58(), mint);
    if (out && out.assetId && String(out.assetId) !== String(mint)) throw new Error('The burn answer was for a different token and was refused.');
    const ok = await this._signAndSendApi(out.serializedTransaction, (tx, owner) => assertCleanupTx(tx, owner, { burnMint: mint }));
    if (!ok) throw new Error('The burn transaction was not confirmed.');
    this.refreshBalance();
    return { sol: Number(out.solanaReclaimed || 0) };
  }

  /**
   * SOL the wallet must keep for network fees: the rent-exempt floor plus a fee and a tip for every open position.
   * Public so the Wallet tab can hold it back from a withdrawal.
   */
  reserveForFees() { return this._reserveSol(); }

  _emitState() {
    const now = Date.now();
    const s = this.s;
    const all = [...this.tokens.values()];
    const list = all
      .sort((a, b) => (b.status === 'bought') - (a.status === 'bought') || b.score - a.score || b.createdAt - a.createdAt)
      .slice(0, 80)
      .map((t) => ({
        mint: t.mint, symbol: t.symbol, name: t.name, age: Math.round((now - (t.launchedAt || t.createdAt)) / 1000),
        mc: t.mc, score: t.score, buyers: t.buyers || 0, net: t.net || 0, status: t.status, reason: t.reason,
        source: [...(t.sources || [])].join('+') || 'launch',
        change5m: t.ext ? t.ext.change5m : null,
        liq: t.ext ? t.ext.liqUsd : null,
        live: now - (t.lastStreamAt || 0) < 15000,
      }));
    const buysPerMin = this.buyTimes.filter((x) => now - x < 60000).length;
    const launchesPerMin = this.launchTimes.filter((x) => now - x < 60000).length;
    const coverage = { total: all.length, launch: 0, trending: 0, callout: 0, new: 0, chain: 0, priced: 0, fresh: 0 };
    for (const t of all) {
      for (const src of t.sources || []) if (src in coverage) coverage[src]++;
      if (t.ext?.at) coverage.priced++;
      if (now - (t.lastStreamAt || 0) < 15000) coverage.fresh++;
    }
    this.emit('state', {
      running: this.running, mode: s.mode, connected: this.connected,
      recording: this.recorder ? this.recorder.status() : null,
      balance: this._balance(), walletBalance: this.walletBalance,
      reserveSol: s.mode === 'live' ? this._reserveSol() : 0,
      freeSol: s.mode === 'live' ? this._freeSol() : this._balance(),
      sessionStartSol: this.sessionStart ? this.sessionStart.balance : null,
      walletDeltaSol: this._walletDelta(),
      stats: { ...this.stats, ...this.books[s.mode === 'live' ? 'live' : 'paper'], buysPerMin, launchesPerMin },
      paused: this.pausedUntil && now < this.pausedUntil ? { until: this.pausedUntil, reason: this.pauseReason || 'taking a break' } : null,
      coverage,
      feed: list,
      positions: this._openPositions().map((p) => ({
        mint: p.mint, symbol: p.symbol, solIn: p.solIn, status: p.status, paper: p.paper, pending: Boolean(p.pending),
        pnlPct: this._pnlView(p), heldSec: Math.round((now - p.openedAt) / 1000), mc: p.mc,
        // The same age the fast channel carries: the two paths draw the same card, so they must carry the same facts
        // or the "no price" label would flicker with every full repaint.
        pxAgeSec: p.pxAt ? Math.round((now - p.pxAt) / 1000) : null,
      })),
      rpc: this.rpc.status(), feeSol: this._feeFor(false),
      feedInfo: {
        source: this.feedSource || null,
        label: this._feedLabel || null,
        rate: this.chain ? this.chain.rate : 0,
        solUsd: this.market.solPrice(),
      },
      history: this.history.filter((h) => h.paper === (s.mode !== 'live')).slice(0, 30),
      logs: this.logs.slice(-40),
    });
  }
}

module.exports = { Engine, DEFAULTS, PROFILES, AUTOPILOT };


