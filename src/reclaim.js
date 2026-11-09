/**
 * Recover SOL locked as rent in token accounts.
 * Every token you ever bought leaves a token account that holds ~0.002 SOL rent. Once the balance is
 * zero the account can be closed and the rent returns to your wallet. On a 0.02 SOL trade that is
 * roughly 10%, so closing them matters. Closing empty accounts is done locally and costs no service fee.
 * Only accounts with a balance of exactly 0 are closed here. Nothing is ever burned by this module.
 */
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const CLOSE_CHUNK = 12; // close instructions per transaction (stays well below the size limit)

// A wallet can hold hundreds of token accounts, so the scan gets a real budget. The broadcast gets a short one and
// re-sends the same signed bytes, which is idempotent. `listAccounts` asks the pool for a host that can answer a
// full listing: three of the five public hosts refuse it with "requires a mint filter" while serving everything else.
const SCAN = { timeoutMs: 9000, attempts: 5, budgetMs: 30000, listAccounts: true };
const SEND = { timeoutMs: 2000, attempts: 3, budgetMs: 6000 };
const STATUS = { timeoutMs: 4000, attempts: 2, budgetMs: 8000 };

const web3 = () => require('@solana/web3.js');

/** SPL Token / Token-2022 CloseAccount (instruction index 9): rent goes to `destination`. */
function closeInstruction(account, destination, owner, programId) {
  return {
    programId,
    keys: [
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data: Buffer.from([9]),
  };
}

function chunk(list, n) {
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

/** Normalise getParsedTokenAccountsByOwner results into plain objects. */
function normalise(programId, value) {
  const out = [];
  for (const it of value || []) {
    const info = it && it.account && it.account.data && it.account.data.parsed && it.account.data.parsed.info;
    if (!info || !info.tokenAmount) continue;
    out.push({
      pubkey: typeof it.pubkey === 'string' ? it.pubkey : it.pubkey.toBase58(),
      mint: info.mint, program: programId, lamports: it.account.lamports,
      amount: String(info.tokenAmount.amount), uiAmount: info.tokenAmount.uiAmount || 0, decimals: info.tokenAmount.decimals,
      frozen: info.state === 'frozen', isNative: !!info.isNative,
    });
  }
  return out;
}

function summarise(accounts) {
  const empty = accounts.filter((a) => a.amount === '0' && !a.frozen);
  const dust = accounts.filter((a) => a.amount !== '0' && !a.frozen);
  const frozen = accounts.filter((a) => a.frozen);
  const sum = (l) => l.reduce((n, a) => n + a.lamports, 0);
  return {
    accounts, empty, dust, frozen,
    emptyRentSol: sum(empty) / 1e9, dustRentSol: sum(dust) / 1e9, frozenRentSol: sum(frozen) / 1e9,
  };
}

async function scanTokenAccounts(rpcCall, owner) {
  const { PublicKey } = web3();
  const all = [];
  let failed = 0;
  let lastErr = null;
  // Some hosts index only the original token program. One program refusing must not throw away the other one's
  // answer: the rent of every account this wallet can close is what the scan is for, and losing it was how the rent
  // went missing in the first place. Only two failures together are a real failure.
  for (const programId of [TOKEN_PROGRAM, TOKEN_2022_PROGRAM]) {
    try {
      const res = await rpcCall((c) => c.getParsedTokenAccountsByOwner(new PublicKey(owner), { programId: new PublicKey(programId) }), SCAN);
      all.push(...normalise(programId, res.value));
    } catch (e) {
      failed++;
      lastErr = e;
    }
  }
  if (failed === 2) throw lastErr;
  return summarise(all);
}

/** Default transaction sender: build, sign and send one transaction that closes the given accounts. */
function makeSender(rpcCall, keypair) {
  return async (accounts) => {
    const { Transaction, TransactionInstruction, PublicKey } = web3();
    const owner = keypair.publicKey;
    const { blockhash, lastValidBlockHeight } = await rpcCall((c) => c.getLatestBlockhash(), SEND);
    const tx = new Transaction({ feePayer: owner, blockhash, lastValidBlockHeight });
    for (const a of accounts) {
      const ix = closeInstruction(new PublicKey(a.pubkey), owner, owner, new PublicKey(a.program));
      tx.add(new TransactionInstruction(ix));
    }
    tx.sign(keypair);
    const raw = tx.serialize();
    const sig = await rpcCall((c) => c.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 3 }), SEND);
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const { value } = await rpcCall((c) => c.getSignatureStatuses([sig]), STATUS).catch(() => ({ value: [] }));
      const st = value[0];
      if (st && st.err) throw new Error('Close transaction failed on-chain.');
      if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) return sig;
    }
    throw new Error('Close transaction was not confirmed in time.');
  };
}

/** SPL Token `Burn` (instruction index 8, amount as a little-endian u64), then `CloseAccount` (index 9). */
function burnInstruction(account, mint, owner, amount, programId) {
  const data = Buffer.alloc(9);
  data.writeUInt8(8, 0);
  data.writeBigUInt64LE(BigInt(amount), 1);
  return {
    programId,
    keys: [
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data,
  };
}

/**
 * Empty an account whose balance is worth less than the rent it holds: burn the remainder, close the account, and
 * the rent comes home. Used only for dust - a balance worth more than the rent is sold, never burned.
 */
function makeBurner(rpcCall, keypair) {
  return async (account) => {
    const { Transaction, TransactionInstruction, PublicKey } = web3();
    const owner = keypair.publicKey;
    const { blockhash, lastValidBlockHeight } = await rpcCall((c) => c.getLatestBlockhash(), SEND);
    const tx = new Transaction({ feePayer: owner, blockhash, lastValidBlockHeight });
    const programId = new PublicKey(account.program);
    tx.add(new TransactionInstruction(burnInstruction(new PublicKey(account.pubkey), new PublicKey(account.mint), owner, account.amount, programId)));
    tx.add(new TransactionInstruction(closeInstruction(new PublicKey(account.pubkey), owner, owner, programId)));
    tx.sign(keypair);
    const raw = tx.serialize();
    const sig = await rpcCall((c) => c.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 3 }), SEND);
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const { value } = await rpcCall((c) => c.getSignatureStatuses([sig]), STATUS).catch(() => ({ value: [] }));
      const st = value[0];
      if (st && st.err) throw new Error('The dust account could not be closed.');
      if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) return sig;
    }
    throw new Error('The dust account was not closed in time.');
  };
}

/**
 * Close zero-balance accounts in batches. `sendChunk(accounts)` returns a signature.
 * One failed batch does not stop the others.
 */
async function closeEmpty({ accounts, sendChunk, chunkSize = CLOSE_CHUNK }) {
  const targets = accounts.filter((a) => a.amount === '0' && !a.frozen);
  const result = { closed: 0, lamports: 0, signatures: [], errors: [] };
  for (const group of chunk(targets, chunkSize)) {
    try {
      const sig = await sendChunk(group);
      result.signatures.push(sig);
      result.closed += group.length;
      result.lamports += group.reduce((n, a) => n + a.lamports, 0);
    } catch (e) {
      result.errors.push(e.message);
    }
  }
  result.sol = result.lamports / 1e9;
  return result;
}

module.exports = { scanTokenAccounts, closeEmpty, makeSender, makeBurner, burnInstruction, closeInstruction, summarise, normalise, chunk, TOKEN_PROGRAM, TOKEN_2022_PROGRAM };
