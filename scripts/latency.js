// Measures the feed this app actually gets, on the machine it runs on. No secrets are printed, nothing is bought or
// sold, and it never touches a wallet.
//
//   node scripts/latency.js            # 60 seconds, every door the settings already hold
//   node scripts/latency.js 120        # a longer window
//
// It opens the same ChainFeed the desk opens - the public program-log socket AND your own private socket when one is
// configured - and answers one question with numbers: how fast is each door, and how much does the private one buy you?
//
// The comparison is by transaction signature: the same trade seen on two doors gives a difference in arrival time that
// needs no clock sync, no explorer and no trust in anybody's benchmark.

const path = require('path');
const os = require('os');
const { ChainFeed, decodeLogs } = require('../src/chain');
const { Store } = require('../src/store');
const { DEFAULTS } = require('../src/engine');

const SUITES = Number(process.argv[2] || 60) * 1000;
const dataDir = process.platform === 'win32'
  ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'PillCrew Sniper')
  : process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support', 'PillCrew Sniper')
    : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'PillCrew Sniper');

let settings = { ...DEFAULTS };
try {
  settings = { ...DEFAULTS, ...JSON.parse(require('fs').readFileSync(path.join(dataDir, 'settings.json'), 'utf8')) };
} catch (_) { /* no settings yet: the public door only */ }

const doors = [{ name: 'public', ws: '' }];
// The same key derivation the desk uses: a socket URL pasted without the provider's key answers 401 and the desk falls
// back to a public node - that is the mistake this script must not repeat while measuring. With no socket typed in,
// the address is derived from the node URL, exactly as the desk derives it: measuring only the public door on a
// machine that actually trades through a private socket answers a question nobody asked.
const { Engine } = require('../src/engine');
const derived = Engine.prototype._wsUrl.call({ s: settings }, settings.rpcWsUrl || settings.rpcUrl);
if (derived) doors.push({ name: 'your socket', ws: derived });

const seen = new Map();   // sig -> { [door]: arrival ms }
const stats = new Map();  // door -> { events, decodeUs, connectedAt, url }

// A socket address can carry the provider's key, and this script's whole point is that it prints no secret: a
// measurement that pastes the key into a terminal, a screenshot or a bug report is a leak, not a benchmark.
const mask = (url) => String(url || '').replace(/([?&](?:api-key|key|token)=)[^&\s]+/gi, '$1***');
const feeds = [];

function record(door, events, decodeUs) {
  const at = Date.now();
  const st = stats.get(door) || { events: 0, decodeUs: 0, decoded: 0, url: '' };
  st.events += events.length;
  st.decodeUs += decodeUs;
  st.decoded += 1;
  stats.set(door, st);
  for (const ev of events) {
    if (!ev.sig) continue;
    const row = seen.get(ev.sig) || {};
    if (row[door] == null) row[door] = at;
    seen.set(ev.sig, row);
  }
}

for (const d of doors) {
  const feed = new ChainFeed({ customWs: d.ws, customRpcs: d.ws ? [] : [] });
  // The public door is forced to a public node so the comparison is public-vs-yours, not yours-vs-yours.
  if (!d.ws) feed.endpoints = () => ['wss://api.mainnet-beta.solana.com', 'wss://solana-rpc.publicnode.com'];
  feed.on('status', (s) => { if (s.connected) stats.set(d.name, { ...(stats.get(d.name) || { events: 0, decodeUs: 0, decoded: 0 }), url: s.url }); });
  feed.on('event', (ev) => record(d.name, [ev], 0));
  feed.on('error', (e) => console.error(`[${d.name}] ${e.message}`));
  feed.on('giveup', () => console.error(`[${d.name}] gave up - that door does not allow log streaming`));
  feed.start();
  feeds.push(feed);
}

// Local decode cost, measured on synthetic data so it is comparable between machines.
const synthetic = 'Program data: ' + Buffer.concat([
  Buffer.from([189, 219, 127, 211, 78, 230, 97, 238]),
  Buffer.alloc(112),
]).toString('base64');
let decNs = 0n;
const DEC_RUNS = 20000;
for (let i = 0; i < DEC_RUNS; i++) {
  const t0 = process.hrtime.bigint();
  decodeLogs(['Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]', synthetic, 'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P success']);
  decNs += process.hrtime.bigint() - t0;
}

console.log(`measuring for ${SUITES / 1000}s across ${doors.length} door(s)…`);
setTimeout(() => {
  for (const f of feeds) f.stop();
  console.log('');
  console.log(`decode cost            ${(Number(decNs) / DEC_RUNS / 1000).toFixed(2)} us per notification (local, this machine)`);
  for (const d of doors) {
    const st = stats.get(d.name) || { events: 0 };
    const rate = (st.events / (SUITES / 1000)).toFixed(1);
    console.log(`${d.name.padEnd(12)}          ${String(st.events).padStart(6)} events  ${rate.padStart(6)}/s   ${mask(st.url) || '(no socket)'}`);
  }
  const pairs = [];
  for (const [, row] of seen) {
    const names = Object.keys(row);
    if (names.length === 2) pairs.push(row[doors[0].name] - row[doors[1].name]);
  }
  if (pairs.length >= 5) {
    pairs.sort((a, b) => a - b);
    const pct = (p) => pairs[Math.min(pairs.length - 1, Math.floor(pairs.length * p))];
    const mean = pairs.reduce((a, b) => a + b, 0) / pairs.length;
    console.log('');
    console.log(`matched trades         ${pairs.length}`);
    console.log(`your socket earlier by mean ${mean.toFixed(0)} ms · p50 ${pct(0.5)} ms · p95 ${pct(0.95)} ms (negative means the public door was faster)`);
  } else if (doors.length > 1) {
    console.log('');
    console.log(`matched trades         ${pairs.length} (too few to compare: the two doors must both deliver the same signature)`);
  }
  console.log('');
  console.log('Nothing was traded and no key was read. This is the feed only.');
  process.exit(0);
}, SUITES);
