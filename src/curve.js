const { PublicKey } = require('@solana/web3.js');

/**
 * The bonding curve account itself, read straight from the chain.
 *
 * This is the one price that always exists. A coin that is a minute old is usually in no price service and in no
 * aggregator yet, and a trade stream is a key most users do not have - so a held position could sit on the price it
 * was bought at for its whole life, and its stop could never fire. Reading the curve costs one account read for every
 * coin held (`getMultipleAccountsInfo`, one request), needs no key, and returns the number the order itself fills
 * against.
 *
 * Account layout, Anchor: 8 byte discriminator, then five u64 - virtual token reserves, virtual SOL reserves, real
 * token reserves, real SOL reserves, token total supply - then one byte that is set when the curve is finished.
 */
const PUMP_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const TOTAL_SUPPLY_TOKENS = 1e9;
const TOKEN_DECIMALS = 6;
// The account is read up to the flag; a shorter one belongs to some other program and is not a curve.
const MIN_LEN = 8 + 8 * 5 + 1;
// A launch curve starts at 30 SOL and 1.073e15 raw tokens, and its two reserves move against each other while the
// coin trades. An account whose product is far from that is not a launch curve - measured on a few mainnet accounts,
// a stale or foreign one came back 1000x off while every real curve sat within 15% of the launch figure.
const LAUNCH_PRODUCT = 30e9 * 1.073e15;
const PRODUCT_SLACK = 3;

/** The curve account address for a mint. Deterministic: seeds are the string and the mint. */
function curveAddress(mint) {
  let key;
  try { key = new PublicKey(String(mint)); } catch (_) { return null; }
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from('bonding-curve'), key.toBuffer()], PUMP_PROGRAM);
  return pda;
}

/**
 * Market cap in SOL from the account's own reserves, the same unit the trade stream and the entry price use.
 * Returns null for anything that is not a curve account, so a wrong or missing account can never be read as a price.
 */
function readCurveAccount(data) {
  if (!data || data.length < MIN_LEN) return null;
  const vTok = data.readBigUInt64LE(8);
  const vSol = data.readBigUInt64LE(16);
  if (vTok <= 0n || vSol <= 0n) return null;
  const product = Number(vSol) * Number(vTok);
  if (!Number.isFinite(product) || product > LAUNCH_PRODUCT * PRODUCT_SLACK || product < LAUNCH_PRODUCT / PRODUCT_SLACK) return null;
  const priceSol = Number(vSol) / 1e9 / (Number(vTok) / 10 ** TOKEN_DECIMALS);
  const mcSol = priceSol * TOTAL_SUPPLY_TOKENS;
  if (!Number.isFinite(mcSol) || mcSol <= 0) return null;
  return { mcSol, complete: data[48] === 1, vSol, vTok };
}

/** The curves of many mints in one request. Missing or unreadable accounts are simply absent from the map. */
async function readCurves(call, mints) {
  const list = [...new Set((mints || []).filter(Boolean))];
  const keys = [];
  const byKey = new Map();
  for (const mint of list) {
    const addr = curveAddress(mint);
    if (!addr) continue;
    keys.push(addr);
    byKey.set(addr.toBase58(), mint);
  }
  if (!keys.length) return new Map();
  // `processed` is the freshest state a node serves, and a price is exactly what wants freshness: a reading taken at
  // `confirmed` is a slot or two older than the pool really is. A fork rollback self-corrects on the next 120 ms poll,
  // and the constant-product guard already refuses any account that is not a launch curve at all.
  const infos = await call((c) => c.getMultipleAccountsInfo(keys, 'processed'));
  const out = new Map();
  (infos || []).forEach((info, i) => {
    const curve = readCurveAccount(info && info.data);
    if (!curve) return;
    const mint = byKey.get(keys[i].toBase58());
    if (mint) out.set(mint, curve);
  });
  return out;
}

module.exports = { PUMP_PROGRAM, curveAddress, readCurveAccount, readCurves, MIN_LEN };
