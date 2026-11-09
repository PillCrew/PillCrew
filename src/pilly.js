/**
 * PILLY'S OWN VOICE — the proactive half of the mascot, ported from Pilly Desktop with the same behaviour and the same switch
 * for each feature (`petHotAlerts`, `petDailyBrief`, `petPillyPick`, `petWhaleAlerts`, `petPortfolioMood`, `petSniper`).
 *
 * What is different from Pilly, and why: Pilly scanned the market itself, with its own DexScreener calls and its own trend
 * cache. This app already has a feed and a state tick that carries `change5m`, `mc` and `liq` for every coin it watches, so the
 * radar reads THAT. One market layer, one set of numbers, and no second opinion about what a coin is worth.
 *
 * The rules that matter, all of them Pilly's:
 *  - every sentence is built from numbers the caller passes in, never invented, and a coin too small to matter is not news
 *    (that is what the floor is for — naming a $3K coin as the day's mover is the same embarrassment in a different bubble);
 *  - a coin is flagged once per cooldown, not on every scan, or he would say the same thing every three minutes;
 *  - an alert is time-sensitive: it outranks a joke, and a joke must never walk over it.
 *
 * It is pure logic (no Electron, no network, no clock of its own) so every rule below is a test with an injected `now`.
 */

// The chip tasks the chat offers, in our own words: each one turns the next question into a specific job for the model. They
// are the extras Pilly Desktop's chat had, and they are the reason a chat in a trading app is worth a panel: "meme this" and
// "size this" are one press, not a paragraph of prompting.
const CHAT_TASKS = {
  rewrite: 'Rewrite the text the operator gives you in meme-native language. Output ONLY the rewritten line, 1-2 short lines, no labels, no quoting.',
  caption: 'Write a short meme caption for what the operator describes. Output ONLY the caption, 4-12 words, no setup, no explanation.',
  name: 'Invent an absurd coin name (1-2 words, a pun is a bonus) plus one short line why. Output "NAME - reason".',
  react: 'React to what the operator says in a terminally-online tone. Output ONLY the reaction, one or two short lines.',
  roast: 'Give a playful, light roast of what the operator gives you. Funny and specific, never mean, 1-2 lines, no meta-commentary.',
  coin: 'The operator pasted a token and you were given its live snapshot. Give a short professional read using ONLY the printed numbers. Start with one call: I BUY / TRIM / hold / SELL / PASS. Name the numbers you used. Never invent one. Never promise a gain.',
  wallet: 'The operator pasted a wallet and you were given its holdings. Read the portfolio using ONLY the printed numbers: total value, the biggest holdings, SOL. Never invent one.',
  trending: 'The operator asked about the hottest coins and you were given a live list. Name 2-3 standouts and WHY, using only the printed numbers. Never invent one.',
};
// The language lock, ported from Pilly: the operator can force the reply language instead of letting the model follow.
const LANGUAGE_LOCK = {
  en: 'LANGUAGE LOCK: always answer in English, even when the operator writes in another language.',
  zh: 'LANGUAGE LOCK: always answer in Simplified Chinese, even when the operator writes in another language.',
};

/**
 * The system prompt for one chat turn: the operator's own instructions first (they are editable), then the task brief, then the
 * language lock. Assembled in the main process so nothing the model reads can be rewritten from the renderer.
 */
function chatSystem({ instructions, task, language } = {}) {
  const parts = [String(instructions || '').trim()];
  if (task && CHAT_TASKS[task]) parts.push(CHAT_TASKS[task]);
  if (language && LANGUAGE_LOCK[language]) parts.push(LANGUAGE_LOCK[language]);
  return parts.filter(Boolean).join('\n\n');
}

/**
 * The quick-action chips: what each one asks the model, and (when it needs data) which data it needs. The renderer only has to
 * say which chip was pressed; the question and the context are built here, once, in one place.
 * @returns {null | {kind: string, task: string|null, question: string, needs: string|null}}
 */
function chipAction(kind) {
  switch (kind) {
    case 'trending': return { kind, task: 'trending', question: 'What is moving right now?', needs: 'trending' };
    case 'watchlist': return { kind, task: null, question: 'How is my watchlist doing?', needs: 'watchlist' };
    case 'pick': return { kind, task: 'trending', question: 'Which one of these would you pick, and why?', needs: 'trending' };
    case 'radar': return { kind, task: 'trending', question: 'Anything hot enough to look at?', needs: 'hot' };
    case 'calc': return { kind, task: null, question: 'Size a ticket for me with my current settings.', needs: 'settings' };
    case 'scorecard': return { kind, task: null, question: 'How is your record so far?', needs: 'scorecard' };
    case 'whales': return { kind, task: null, question: 'Which wallets am I following, and what did they just do?', needs: 'whales' };
    case 'homecoin': return { kind, task: 'coin', question: 'What about our own coin, $PillCrew?', needs: 'homecoin' };
    case 'rewrite': case 'caption': case 'name': case 'react': case 'roast':
      return { kind, task: kind, question: '', needs: null };
    default: return null;
  }
}

/**
 * The block of numbers a chip attaches. Everything is printed from data the caller passes in, and an empty list says so
 * instead of leaving a hole in the prompt.
 */
function chipContext(kind, data = {}) {
  const lines = [];
  const rows = Array.isArray(data.rows) ? data.rows : [];
  if (kind === 'trending' || kind === 'hot') {
    if (!rows.length) return 'No live coin rows right now.';
    lines.push('LIVE COIN ROWS (use only these numbers):');
    for (const r of rows.slice(0, 12)) {
      lines.push(`- ${r.symbol || String(r.mint || '').slice(0, 4)}: 5m ${r.change5m == null ? 'n/a' : pct(r.change5m)}, mcap ${money(r.mc) || 'n/a'}, buyers ${r.buyers || 0}`);
    }
    return lines.join('\n');
  }
  if (kind === 'watchlist') {
    const items = Array.isArray(data.watchlist) ? data.watchlist : [];
    if (!items.length) return 'The watchlist is empty.';
    lines.push('WATCHLIST (coin, alert bar, current 5m move):');
    for (const it of items) {
      const row = rows.find((r) => r.mint === it.mint);
      lines.push(`- ${it.symbol || String(it.mint).slice(0, 4)}: alert ±${it.alertPct || 0}%, 5m ${row && row.change5m != null ? pct(row.change5m) : 'n/a'}`);
    }
    return lines.join('\n');
  }
  if (kind === 'scorecard') {
    const s = data.stats || {};
    return `MY SCORECARD: ${s.total || 0} calls, ${s.wins || 0} wins, ${s.losses || 0} losses, ${s.open || 0} still open, hit rate ${s.winRate == null ? 'n/a' : s.winRate + '%'}.`;
  }
  if (kind === 'whales') {
    const wallets = Array.isArray(data.wallets) ? data.wallets : [];
    if (!wallets.length) return 'No wallets are being followed.';
    return `FOLLOWED WALLETS: ${wallets.join(', ')}.`;
  }
  if (kind === 'settings') {
    const s = data.settings || {};
    return `MY TICKET SETTINGS: ticket ${s.buyAmountSol} SOL, slippage ${s.slippagePct}%, priority fee ${s.priorityFeeSol} SOL, max ${s.maxPositions} positions, stop ${s.stopLossPct}%, target ${s.takeProfitPct}%.`;
  }
  if (kind === 'homecoin') {
    return `HOME TOKEN: $PillCrew, mint ${data.mint || 'unknown'}${data.row ? `, 5m ${data.row.change5m == null ? 'n/a' : pct(data.row.change5m)}, mcap ${money(data.row.mc) || 'n/a'}` : ', no live row right now'}.`;
  }
  return '';
}


// The dust floor: below this a percentage is a bot or a rug rather than a signal worth pinging a trader about.
const FRESH_FLOOR_USD = 8000;
// One coin, one mention, per half hour (Pilly's own number).
const HOT_COOLDOWN_MS = 30 * 60000;
// A launch is announced once per coin, and a coin that just opened is not news ten minutes later.
const LAUNCH_COOLDOWN_MS = 20 * 60000;
// A 24h extreme stands in when nothing is moving right now; under this it is not worth a bubble.
const EXTREME_PCT = 18;

const JOKES = [
  'still here? good. the tape rewards the patient and the shameless.',
  'i counted the candles. there are a lot of them. no thoughts. head empty. only vibes.',
  'tip: the coin does not know you exist. trade like it.',
  'gm. the chart is a rumour. your stop is a fact.',
  'i would never tell you to ape. i would merely look at you meaningfully.',
  'somewhere a dev is renaming his token. again.',
  'every candle is somebody\'s whole personality.',
];

const QUESTIONS = [
  'what are we buying today?',
  'did you set a stop, or are we feeling lucky?',
  'want the hot list, or a fresh launch?',
  'shall i keep an eye on the tape?',
  'you look like a man who is about to check the chart for the ninth time.',
];

function money(usd) {
  const n = Number(usd);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function pct(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return `${v >= 0 ? '+' : ''}${v.toFixed(0)}%`;
}

/** Whether a row is big enough to be worth a sentence: the floor is on market cap OR liquidity, whichever it has. */
function aboveFloor(row, floor = FRESH_FLOOR_USD) {
  const mc = Number(row && row.mc);
  const liq = Number(row && row.liq);
  if (Number.isFinite(mc) && mc > 0) return mc >= floor;
  if (Number.isFinite(liq) && liq > 0) return liq >= floor;
  // Nothing priced yet (a coin one block old). It is not a mover - it has no tape - so it is not news.
  return false;
}

/**
 * THE HOT RADAR: the single hottest fresh 5-minute mover in `rows`, or `null`.
 *
 * @param {Array} rows   the app's own state rows (`mint, symbol, name, mc, liq, change5m`)
 * @param {{pct?: number, floor?: number, now?: number, cooldown?: Map<string, number>}} opts
 * @returns {null | {mint, symbol, name, change5m, text}}
 */
function hotCoin(rows, opts = {}) {
  const pctBar = Number(opts.pct) > 0 ? Number(opts.pct) : 10;
  const floor = Number(opts.floor) > 0 ? Number(opts.floor) : FRESH_FLOOR_USD;
  const now = Number(opts.now) || Date.now();
  const cooldown = opts.cooldown instanceof Map ? opts.cooldown : null;
  const list = Array.isArray(rows) ? rows : [];
  let hot = null;
  for (const c of list) {
    const ch = Number(c && c.change5m);
    if (!Number.isFinite(ch) || ch < pctBar) continue;
    if (!aboveFloor(c, floor)) continue;
    if (cooldown && now - (cooldown.get(c.mint) || 0) <= HOT_COOLDOWN_MS) continue;
    if (!hot || ch > hot.change5m) hot = { ...c, change5m: ch };
  }
  if (!hot) return null;
  if (cooldown) cooldown.set(hot.mint, now);
  const label = hot.symbol || hot.name || String(hot.mint || '').slice(0, 4);
  return { mint: hot.mint, symbol: hot.symbol || null, name: hot.name || null, change5m: hot.change5m,
    text: `🚀 ${label} ${pct(hot.change5m)} in 5m. tap me for the details.` };
}

/**
 * THE SNIPER WATCH: the freshest launch the desk is already looking at, announced once. This app is the sniper — the pet is
 * not going to buy anything — so his job here is to say "something just opened, do you want it?", which is exactly what the
 * flag did in Pilly Desktop.
 * @param {Array} rows state rows (`mint, symbol, name, age, mc, liq, source`)
 * @param {{maxAgeSec?: number, now?: number, cooldown?: Map<string, number>, floor?: number}} opts
 */
function launchCoin(rows, opts = {}) {
  const maxAge = Number(opts.maxAgeSec) > 0 ? Number(opts.maxAgeSec) : 90;
  const floor = Number(opts.floor) > 0 ? Number(opts.floor) : FRESH_FLOOR_USD;
  const now = Number(opts.now) || Date.now();
  const cooldown = opts.cooldown instanceof Map ? opts.cooldown : null;
  const list = Array.isArray(rows) ? rows : [];
  let fresh = null;
  for (const c of list) {
    const age = Number(c && c.age);
    if (!Number.isFinite(age) || age > maxAge || age < 0) continue;
    if (!aboveFloor(c, floor)) continue;
    if (cooldown && now - (cooldown.get(c.mint) || 0) <= LAUNCH_COOLDOWN_MS) continue;
    if (!fresh || age < Number(fresh.age)) fresh = { ...c, age };
  }
  if (!fresh) return null;
  if (cooldown) cooldown.set(fresh.mint, now);
  const label = fresh.symbol || fresh.name || String(fresh.mint || '').slice(0, 4);
  return { mint: fresh.mint, symbol: fresh.symbol || null, name: fresh.name || null, age: fresh.age,
    text: `🆕 ${label} is ${Math.max(1, Math.round(fresh.age))}s old. want me to watch it?` };
}

/**
 * THE FALLBACK: with nothing moving right now, the day's worst or best coin — if it is extreme enough to be worth a bubble.
 * @returns {null | {kind: 'up'|'down', mint, symbol, name, change24h, text}}
 */
function extremeMover(rows, opts = {}) {
  const floor = Number(opts.floor) > 0 ? Number(opts.floor) : FRESH_FLOOR_USD;
  const bar = Number(opts.bar) > 0 ? Number(opts.bar) : EXTREME_PCT;
  const list = (Array.isArray(rows) ? rows : []).filter((c) => c && Number.isFinite(Number(c.change24h)) && aboveFloor(c, floor));
  if (!list.length) return null;
  const gainer = list.reduce((a, b) => (Number(b.change24h) > Number(a.change24h) ? b : a));
  const loser = list.reduce((a, b) => (Number(b.change24h) < Number(a.change24h) ? b : a));
  if (Number(gainer.change24h) >= bar) {
    return { kind: 'up', mint: gainer.mint, symbol: gainer.symbol || null, name: gainer.name || null,
      change24h: Number(gainer.change24h), text: `🚀 ${gainer.symbol || gainer.name} ${pct(gainer.change24h)} on the day. calling it now.` };
  }
  if (Number(loser.change24h) <= -bar) {
    return { kind: 'down', mint: loser.mint, symbol: loser.symbol || null, name: loser.name || null,
      change24h: Number(loser.change24h), text: `☠️ ${loser.symbol || loser.name} ${pct(loser.change24h)}… that's rough.` };
  }
  return null;
}

/**
 * THE DAILY BRIEF: SOL on hand and what the session has done, in one sentence. Numbers only — this app never predicts.
 * @param {{name?: string, sol?: number, sessionDeltaSol?: number, openCount?: number, hot?: object}} data
 */
function dailyBrief(data = {}) {
  const who = data.name || 'Pilly';
  const parts = [`☕ gm anon, ${who} here.`];
  const sol = Number(data.sol);
  if (Number.isFinite(sol)) parts.push(`${sol.toFixed(3)} SOL ${data.practice ? 'of practice money' : 'on hand'}.`);
  const delta = Number(data.sessionDeltaSol);
  if (Number.isFinite(delta) && delta !== 0) {
    parts.push(`${delta > 0 ? 'up' : 'down'} ${Math.abs(delta).toFixed(4)} SOL this session.`);
  } else {
    parts.push('nothing opened yet.');
  }
  const open = Number(data.openCount);
  if (Number.isFinite(open) && open > 0) parts.push(`${open} position${open === 1 ? '' : 's'} open.`);
  if (data.hot && data.hot.symbol) parts.push(`${data.hot.symbol} is the mover so far.`);
  return parts.join(' ');
}

/** HIS PICK OF THE DAY: the council's answer, said as one line. `null` when the council said nothing usable. */
function pickSentence(pick) {
  const symbol = pick && (pick.symbol || pick.name);
  if (!symbol) return null;
  const by = pick.by ? ` (${pick.by})` : '';
  const reason = String((pick && pick.reason) || '').trim();
  if (!reason) return `👀 ${symbol} is my pick${by}. no reason given — ask me for the numbers.`;
  return `👀 ${symbol} is my pick${by}: ${reason}`.slice(0, 220);
}

/** A FOLLOWED WALLET OPENED A POSITION — the whale alert, with the same rule as everything else: numbers or nothing. */
function whaleSentence(alert = {}) {
  const symbol = alert.symbol || alert.name;
  const who = String(alert.wallet || '').trim();
  if (!symbol) return null;
  const short = who.length > 10 ? `${who.slice(0, 4)}…${who.slice(-4)}` : who;
  const size = money(alert.usd);
  const head = who ? `🐋 ${short} just opened ${symbol}` : `🐋 ${symbol} just got opened`;
  return `${head}${size ? ` (${size})` : ''}. your call, not mine.`;
}

/** PORTFOLIO MOOD: how the open positions are doing decides how he looks, and one short line with it. */
function moodFor(data = {}) {
  const pctChange = Number(data.pnlPct);
  if (!Number.isFinite(pctChange)) return { kind: 'flat', text: null };
  if (pctChange >= 3) return { kind: 'up', text: `we're up ${pctChange.toFixed(1)}%. i'm not saying i'm smug.` };
  if (pctChange <= -3) return { kind: 'down', text: `down ${Math.abs(pctChange).toFixed(1)}%. breathe. the stop is a promise.` };
  return { kind: 'flat', text: null };
}

/**
 * THE RATE LIMITER. Every proactive feature keeps its own clock, so "say it once, then be quiet" is one place and not five
 * `if` statements in the middle of a timer.
 */
class Radar {
  constructor() {
    this.hotSeen = new Map();   // mint -> when it was last named
    this.launchSeen = new Map();
    this.briefDone = false;
    this.lastPickAt = 0;
    this.lastMoodAt = 0;
    this.lastWhaleAt = 0;
    this.lastJokeAt = 0;
  }

  /** The hot radar, with its cooldown of one mention per coin per half hour. */
  hot(rows, opts = {}) { return hotCoin(rows, { ...opts, cooldown: this.hotSeen }); }

  /** The sniper watch, with its own cooldown so a launch is said once. */
  launch(rows, opts = {}) { return launchCoin(rows, { ...opts, cooldown: this.launchSeen }); }

  /** The brief is a once-per-session event (a restart is what makes it say gm again). */
  brief(data) {
    if (this.briefDone) return null;
    this.briefDone = true;
    return dailyBrief(data);
  }

  /** His pick: every `everyMs` (Pilly used about six hours), never twice in a row. */
  pick(pick, now, everyMs = 6 * 3600000) {
    if (this.lastPickAt && now - this.lastPickAt < everyMs) return null;
    const text = pickSentence(pick);
    if (text) this.lastPickAt = now;
    return text;
  }

  mood(data, now, everyMs = 15 * 60000) {
    if (this.lastMoodAt && now - this.lastMoodAt < everyMs) return null;
    const out = moodFor(data);
    if (out.text) this.lastMoodAt = now;
    return out;
  }

  whale(alert, now, everyMs = 60000) {
    if (this.lastWhaleAt && now - this.lastWhaleAt < everyMs) return null;
    const text = whaleSentence(alert);
    if (text) this.lastWhaleAt = now;
    return text;
  }

  joke(now, everyMs = 240000) {
    if (this.lastJokeAt && now - this.lastJokeAt < everyMs) return null;
    this.lastJokeAt = now;
    return JOKES[Math.floor(Math.random() * JOKES.length)];
  }

  reset() {
    this.hotSeen.clear();
    this.launchSeen.clear();
    this.briefDone = false;
    this.lastPickAt = 0;
    this.lastMoodAt = 0;
    this.lastWhaleAt = 0;
    this.lastJokeAt = 0;
  }
}

module.exports = {
  hotCoin, launchCoin, extremeMover, dailyBrief, pickSentence, whaleSentence, moodFor, aboveFloor, money, pct, Radar,
  chatSystem, chipAction, chipContext, CHAT_TASKS, LANGUAGE_LOCK,
  JOKES, QUESTIONS, FRESH_FLOOR_USD, HOT_COOLDOWN_MS, LAUNCH_COOLDOWN_MS, EXTREME_PCT,
};
