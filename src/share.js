/**
 * A settings code that can be posted and pasted. It carries the policy a trader wants to share - the entry bar and the
 * exit plan - and never anything that could cost someone money: no API keys, no RPC URL (a stranger's endpoint sees
 * every transaction), no wallet, no mode, no open positions.
 *
 * The payload is a fixed list of numbers in a fixed order, base64url encoded, with a two character checksum so a
 * mistyped code is refused instead of applied half way. Version prefix `PCS1.`
 */
const SHARE_KEYS = [
  // entry
  'minScore', 'minBuyers', 'minNetFlowSol', 'minMcSol', 'maxMcSol', 'minLiqUsd', 'watchSec', 'entryWindowSec',
  // position size and pace
  'buyAmountSol', 'maxPositions', 'maxBuysPerMin',
  // exit plan
  'takeProfitPct', 'stopLossPct', 'maxHoldSec', 'tp1Pct', 'tp1SellPct', 'breakEvenPct', 'trailArmPct', 'trailGivePct',
  'triggerHoldMs',
  // risk and cost
  'slippagePct', 'priorityFeeSol', 'sessionLossLimitSol', 'maxLossStreak', 'pauseMinutes',
  'maxDevBuySol', 'maxDevHoldPct', 'maxTraderSharePct', 'maxChange5mPct', 'minChange5mPct',
  // extra entry filters: the holder bar and the switch that arms it
  'minHolders', 'deepEntry',
  // simple settings: the buyer ceiling and the mode switch
  'maxBuyers', 'simpleMode',
  // RULE ADDED 2026-11-05: the two clocks every sniper is judged on, and the fee gate. They are part of a plan, so a
  // code carries them - and it still carries nothing that is a credential (see the list below).
  'minTokenAgeSec', 'maxTokenAgeSec', 'maxRoundTripPct',
];

const PREFIX = 'PCS1.';
// The separator a NEW code uses. A dot made the code read as a host name to X's linkifier - `PCS1.eyJ2Ijox...` looks
// like `domain.tld` - so a shared code came back as "Blocked link" and could not be posted at all. A tilde is
// unreserved in a URL, never appears in base64url, and no linkifier mistakes it for a domain.
const SEP = '~';
const PREFIX_NEW = 'PCS1' + SEP;

const toB64 = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64 = (text) => Buffer.from(String(text).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function checksum(body) {
  let h = 0x811c9dc5;
  for (const ch of body) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return (h >>> 0).toString(36).slice(-2).padStart(2, '0');
}

/** @returns {string} a code like `PCS1~eyJ2Ijox...~k3` - no dots, so no chat app reads it as a link */
function encode(settings) {
  const values = SHARE_KEYS.map((k) => {
    const n = Number(settings[k]);
    return Number.isFinite(n) ? Math.round(n * 1e9) / 1e9 : 0;
  });
  const body = toB64(JSON.stringify({ v: 1, p: String(settings.profile || 'balanced'), n: values }));
  return PREFIX_NEW + body + SEP + checksum(body);
}

/**
 * @returns {{profile: string, values: object}} the settings a code carries
 * @throws when the code is not one of ours, is truncated, or does not match its checksum
 */
function decode(code) {
  // Both separators are accepted for ever: every code posted with a dot before this change has to keep working.
  const text = String(code || '').trim();
  const old = text.startsWith(PREFIX);
  if (!old && !text.startsWith(PREFIX_NEW)) throw new Error('That is not a PillCrew settings code (it starts with PCS1).');
  const sep = old ? '.' : SEP;
  const rest = text.slice(PREFIX_NEW.length);
  const cut = rest.lastIndexOf(sep);
  if (cut < 1) throw new Error('That settings code looks truncated.');
  const body = rest.slice(0, cut);
  const sum = rest.slice(cut + 1);
  if (checksum(body) !== sum) throw new Error('That settings code is damaged - a character is missing or wrong.');
  let payload;
  try { payload = JSON.parse(fromB64(body).toString('utf8')); } catch (_) { throw new Error('That settings code could not be read.'); }
  // A code is a positional array, and new settings are only ever APPENDED to `SHARE_KEYS`. A shorter array is therefore
  // an older code, not a broken one: every code shared on X before a setting existed must keep working for ever.
  if (!payload || payload.v !== 1 || !Array.isArray(payload.n) || payload.n.length > SHARE_KEYS.length) {
    throw new Error('That settings code is from an unknown version of the app.');
  }
  const values = {};
  SHARE_KEYS.slice(0, payload.n.length).forEach((k, i) => { const n = Number(payload.n[i]); if (Number.isFinite(n)) values[k] = n; });
  return { profile: String(payload.p || 'balanced'), values };
}

/** A one line description for the tweet: what someone is copying. */
function describe(settings) {
  return `score ${settings.minScore}+ · ${settings.takeProfitPct}% target · ${settings.tp1Pct}%/${settings.tp1SellPct}% first rung · ${settings.stopLossPct}% stop · ${settings.maxHoldSec}s hold`;
}

module.exports = { encode, decode, describe, SHARE_KEYS, PREFIX, PREFIX_NEW, SEP };
