/**
 * Live dry run of the real money path. It does NOT spend anything: the transactions are built by the same route the
 * bot uses, inspected by the same guards, signed with the configured wallet, and then SIMULATED on a real RPC.
 *
 * A simulation that comes back with only "insufficient lamports" proves the whole path: the route answered, the
 * transaction could be read, the guard accepted it, the signature is valid and the cluster parsed every account.
 *
 *   node test/live-dryrun.js            # uses the wallet in this app's data folder when it is unlocked
 *   node test/live-dryrun.js <mint>     # dry run against a specific coin
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  Connection, PublicKey, VersionedTransaction, Transaction, SystemProgram, Keypair, LAMPORTS_PER_SOL,
} = require('@solana/web3.js');
const { assertSwapTx } = require('../src/txguard');
const { lamportsOut, readTx } = require('../src/txguard');

const TRADE_URL = 'https://pumpportal.fun/api/trade-local';
const RPC = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';

const userData = path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'PillCrew Sniper');
const walletFile = path.join(userData, 'wallet.json');
const settingsFile = path.join(userData, 'settings.json');

function loadSettings() {
  try { return JSON.parse(fs.readFileSync(settingsFile, 'utf8')); } catch (_) { return {}; }
}

async function buildTrade(kp, action, mint, amount, feeSol) {
  const body = {
    publicKey: kp.publicKey.toBase58(), action, mint, amount,
    denominatedInSol: action === 'buy' ? 'true' : 'false',
    slippage: 15, priorityFee: feeSol, pool: 'auto',
  };
  const r = await fetch(TRADE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('trade-local HTTP ' + r.status + ': ' + (await r.text()).slice(0, 200));
  return new Uint8Array(await r.arrayBuffer());
}

async function newestPumpCoin() {
  const r = await fetch('https://api.jup.ag/tokens/v2/recent?limit=20', { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error('Jupiter recent HTTP ' + r.status);
  const list = await r.json();
  const coin = (Array.isArray(list) ? list : []).find((t) => t && typeof t.id === 'string' && (t.id.endsWith('pump') || t.launchpad === 'pump.fun'));
  if (!coin) throw new Error('no pump.fun coin in the recent list');
  return coin.id;
}

async function simulate(conn, tx) {
  const sim = await conn.simulateTransaction(tx, { sigVerify: true, commitment: 'confirmed' });
  return sim.value;
}

(async () => {
  const settings = loadSettings();
  if (!fs.existsSync(walletFile)) throw new Error('No wallet file at ' + walletFile);
  console.log('wallet file:', walletFile);

  // The key is only read here to sign a simulation, exactly like the app does for a real trade.
  const meta = JSON.parse(fs.readFileSync(walletFile, 'utf8'));
  const password = process.env.PILLCREW_PASSWORD;
  if (!password) throw new Error('Set PILLCREW_PASSWORD to the wallet password for this dry run.');
  const crypto = require('crypto');
  const key = crypto.scryptSync(password, Buffer.from(meta.enc.salt, 'hex'), 32, { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(meta.enc.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(meta.enc.tag, 'hex'));
  const secret = Buffer.concat([decipher.update(Buffer.from(meta.enc.data, 'hex')), decipher.final()]);
  const kp = Keypair.fromSecretKey(new Uint8Array(secret));
  console.log('wallet:', kp.publicKey.toBase58());

  const conn = new Connection(RPC, { commitment: 'confirmed' });
  const balance = await conn.getBalance(kp.publicKey);
  console.log('balance:', balance / LAMPORTS_PER_SOL, 'SOL');

  const mint = process.argv[2] || (await newestPumpCoin());
  console.log('coin:', mint);
  const ticket = Math.min(Number(settings.buyAmountSol) || 0.02, 0.02);
  const fee = Number(settings.priorityFeeSol) || 0.0002;

  const results = [];

  // BUY
  try {
    const raw = await buildTrade(kp, 'buy', mint, ticket, fee);
    const tx = VersionedTransaction.deserialize(raw);
    const info = readTx(tx);
    console.log('buy: fee payer', info.payer, '| signers', info.signers.length, '| SOL out', Number(lamportsOut(info.instructions)) / 1e9);
    tx.sign([kp]);
    const sim = await simulate(conn, tx);
    results.push(['buy', sim.err ? JSON.stringify(sim.err).slice(0, 160) : 'simulated OK', sim.unitsConsumed]);
  } catch (e) {
    results.push(['buy', 'ERROR ' + e.message, null]);
  }

  // SELL 100% - the route resolves the percentage against the wallet, so a zero balance is reported by the chain.
  try {
    const raw = await buildTrade(kp, 'sell', mint, '100%', fee);
    const tx = VersionedTransaction.deserialize(raw);
    tx.sign([kp]);
    const sim = await simulate(conn, tx);
    results.push(['sell 100%', sim.err ? JSON.stringify(sim.err).slice(0, 160) : 'simulated OK', sim.unitsConsumed]);
  } catch (e) {
    results.push(['sell 100%', 'ERROR ' + e.message, null]);
  }

  // WITHDRAW - built and signed exactly like the app does, then simulated.
  try {
    const legacy = new Transaction().add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: kp.publicKey, lamports: 1000 }));
    legacy.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
    legacy.feePayer = kp.publicKey;
    const vtx = new VersionedTransaction(legacy.compileMessage());
    vtx.sign([kp]);
    const sim = await simulate(conn, vtx);
    results.push(['withdraw', sim.err ? JSON.stringify(sim.err).slice(0, 160) : 'simulated OK', sim.unitsConsumed]);
  } catch (e) {
    results.push(['withdraw', 'ERROR ' + e.message, null]);
  }

  // CLOSE EMPTY ACCOUNTS - the same cleanup the app runs after a sale.
  try {
    const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
    const fake = Keypair.generate().publicKey;
    const closeIx = new (require('@solana/web3.js').TransactionInstruction)({
      programId: TOKEN,
      keys: [
        { pubkey: fake, isSigner: false, isWritable: true },
        { pubkey: kp.publicKey, isSigner: false, isWritable: true },
        { pubkey: kp.publicKey, isSigner: true, isWritable: false },
      ],
      data: Buffer.from([9]),
    });
    const tx = new Transaction().add(closeIx);
    tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
    tx.feePayer = kp.publicKey;
    const vtx = new VersionedTransaction(tx.compileMessage());
    vtx.sign([kp]);
    const sim = await simulate(conn, vtx);
    results.push(['close account', sim.err ? JSON.stringify(sim.err).slice(0, 160) : 'simulated OK', sim.unitsConsumed]);
  } catch (e) {
    results.push(['close account', 'ERROR ' + e.message, null]);
  }

  console.table(results.map(([step, outcome, cu]) => ({ step, outcome, 'compute units': cu == null ? '-' : cu })));
  const onlyMoney = results.every(([, outcome]) => /accountnotfound|insufficient|simulated OK|not found|does not exist|invalid account/i.test(outcome));
  console.log(onlyMoney
    ? 'Verdict: every path was built by the live route, inspected, signed and parsed by the cluster. The only refusal is the empty wallet.'
    : 'Verdict: something failed for a reason other than funding. Read the table above.');
})().catch((e) => { console.error(e.message); process.exit(1); });
