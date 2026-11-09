/**
 * Inspection of transactions BUILT BY SOMEONE ELSE (the Sol Incinerator API and the Jupiter backup route) before
 * the wallet signs them. A signed transaction is an unconditional instruction to the chain: whoever writes the
 * bytes decides what the wallet does, and the only thing `sign()` checks is that our key is a required signer.
 *
 * So every foreign transaction is read here first. What is allowed is a short list, and anything the inspector
 * cannot resolve is refused instead of skipped.
 */
const SYS = '11111111111111111111111111111111';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111';

// SPL token instruction tags
const IX_TRANSFER = 3;
const IX_APPROVE = 4;
const IX_REVOKE = 5;
const IX_SET_AUTHORITY = 6;
const IX_BURN = 8;
const IX_CLOSE_ACCOUNT = 9;
const IX_TRANSFER_CHECKED = 12;
const IX_BURN_CHECKED = 15;
const IX_APPROVE_CHECKED = 13;

const SYSTEM_TRANSFER = 2;
const SYSTEM_CREATE_ACCOUNT = 0;

/**
 * The parts of a transaction the guards need, resolved or refused.
 * @returns {{payer: string, signers: string[], instructions: {program: string, keys: string[], data: Buffer}[]}}
 */
function readTx(tx) {
  const msg = tx.message;
  const keys = msg.staticAccountKeys.map((k) => k.toBase58());
  for (const ix of msg.compiledInstructions) {
    // On a v0 message the program id may sit in an address lookup table, which is not resolved here. Refusing is
    // the safe answer: skipping the instruction would let it through unseen.
    if (ix.programIdIndex >= keys.length) {
      throw new Error('Safety check: a transaction used an unresolved lookup table entry and was refused.');
    }
  }
  const signerCount = msg.header.numRequiredSignatures;
  const instructions = msg.compiledInstructions.map((ix) => ({
    program: keys[ix.programIdIndex],
    keys: [...ix.accountKeyIndexes].map((i) => (i < keys.length ? keys[i] : null)),
    data: Buffer.from(ix.data),
  }));
  return { payer: keys[0], signers: keys.slice(0, signerCount), instructions };
}

function lamportsOut(instructions) {
  let total = 0n;
  for (const ix of instructions) {
    if (ix.program !== SYS || ix.data.length < 12) continue;
    const tag = ix.data.readUInt32LE(0);
    // A plain transfer, and a CreateAccount that funds the new account: both move lamports out of the payer.
    if (tag === SYSTEM_TRANSFER) total += ix.data.readBigUInt64LE(4);
    else if (tag === SYSTEM_CREATE_ACCOUNT) total += ix.data.readBigUInt64LE(4);
  }
  return total;
}

function assertFeeBudget(instructions, maxFeeSol = 0.01) {
  if (!Number.isFinite(maxFeeSol) || maxFeeSol < 0) throw new Error('Safety check: invalid fee budget.');
  let units = 1400000n, price = 0n;
  const seen = new Set();
  for (const ix of instructions) {
    if (ix.program !== COMPUTE_BUDGET) continue;
    const tag = ix.data[0];
    if (seen.has(tag)) throw new Error('Safety check: duplicate compute budget instruction.');
    seen.add(tag);
    if (tag === 2 && ix.data.length === 5) units = BigInt(ix.data.readUInt32LE(1));
    else if (tag === 3 && ix.data.length === 9) price = ix.data.readBigUInt64LE(1);
    else if ((tag === 1 || tag === 4) && ix.data.length === 5) continue;
    else throw new Error('Safety check: unreadable compute budget instruction.');
  }
  const priority = (units * price + 999999n) / 1000000n;
  if (units > 1400000n || priority + 5000n > BigInt(Math.floor(maxFeeSol * 1e9))) {
    throw new Error('Safety check: transaction network fee exceeds the fee budget.');
  }
}

function assertSystemInstructions(instructions) {
  for (const ix of instructions) {
    if (ix.program !== SYS) continue;
    if (ix.data.length < 4) throw new Error('Safety check: unreadable system instruction.');
    const tag = ix.data.readUInt32LE(0);
    if (!((tag === SYSTEM_TRANSFER && ix.data.length === 12)
      || (tag === SYSTEM_CREATE_ACCOUNT && ix.data.length === 52))) {
      throw new Error('Safety check: unexpected system instruction.');
    }
  }
}

/**
 * A token instruction that only closes the caller's own empty account, or burns their own tokens, is the whole
 * point of the reclaim feature. Everything that could move a token or hand over authority is not.
 */
function tokenVerdict(ix, owner, burnMint) {
  if (ix.data.length < 1) return 'token instruction with no data';
  const tag = ix.data[0];
  if (tag === IX_CLOSE_ACCOUNT) {
    if (ix.keys[1] !== owner) return 'close of an account whose rent goes somewhere else';
    return null;
  }
  if (tag === IX_BURN || tag === IX_BURN_CHECKED) {
    if (!burnMint) return 'burn while no token was selected';
    // The mint being burned is account 1 of a Burn: without this check the route could burn any holding the wallet
    // has while the user asked for one.
    if (ix.keys[1] !== burnMint) return 'burn of a token that was not the one selected';
    return null;
  }
  if (tag === IX_TRANSFER || tag === IX_TRANSFER_CHECKED) return 'token transfer';
  if (tag === IX_APPROVE || tag === IX_APPROVE_CHECKED) return 'token approval';
  if (tag === IX_SET_AUTHORITY) return 'authority change';
  if (tag === IX_REVOKE) return null;
  return 'unexpected token instruction ' + tag;
}

/**
 * Guard for the cleanup route: only closing empty accounts and burning the selected token may be signed.
 */
function assertCleanupTx(tx, owner, { burnMint = null, maxFeeSol = 0.01 } = {}) {
  const { payer, signers, instructions } = readTx(tx);
  if (payer !== owner) throw new Error('Safety check: that cleanup transaction would be paid by another wallet.');
  if (signers.length !== 1 || signers[0] !== owner) throw new Error('Safety check: that cleanup transaction asks for another signature.');
  assertFeeBudget(instructions, maxFeeSol);
  assertSystemInstructions(instructions);
  if (lamportsOut(instructions) > BigInt(Math.floor(maxFeeSol * 1e9))) throw new Error('Safety check: that cleanup transaction moves SOL out of the wallet.');
  for (const ix of instructions) {
    if (ix.program === COMPUTE_BUDGET) continue;
    if (ix.program === SYS) {
      const out = lamportsOut([ix]);
      if (out === 0n) continue;                          // a plain account creation, no SOL moves out
      if (Number(out) / 1e9 > maxFeeSol) throw new Error('Safety check: that cleanup transaction moves SOL out of the wallet.');
      continue;
    }
    if (ix.program === TOKEN || ix.program === TOKEN_2022) {
      const bad = tokenVerdict(ix, owner, burnMint);
      if (bad) throw new Error('Safety check: refused a cleanup transaction (' + bad + ').');
      continue;
    }
    throw new Error('Safety check: refused a cleanup transaction that talks to an unexpected program.');
  }
}

/**
 * Guard for the backup trade route. A swap legitimately talks to many programs, so the rules here are the ones a
 * swap never needs to break: our key is the only signer and the payer, no approval, no authority change, no SOL
 * leaving the wallet beyond the ticket.
 */
function assertSwapTx(tx, owner, { maxSolOut = 0, allowSolOut = 0.02, maxFeeSol = 0.01 } = {}) {
  const { payer, signers, instructions } = readTx(tx);
  if (payer !== owner) throw new Error('Safety check: that swap would be paid by another wallet.');
  if (signers.length !== 1 || signers[0] !== owner) throw new Error('Safety check: that swap asks for another signature.');
  assertFeeBudget(instructions, maxFeeSol);
  assertSystemInstructions(instructions);
  for (const ix of instructions) {
    if (ix.program === TOKEN || ix.program === TOKEN_2022) {
      if (ix.data.length < 1) throw new Error('Safety check: refused a swap with an unreadable token instruction.');
      const tag = ix.data[0];
      if (tag === IX_APPROVE || tag === IX_APPROVE_CHECKED) throw new Error('Safety check: refused a swap that asks for a token approval.');
      if (tag === IX_SET_AUTHORITY) throw new Error('Safety check: refused a swap that changes a token authority.');
      if (tag === IX_CLOSE_ACCOUNT && ix.keys[1] !== owner) throw new Error('Safety check: refused a swap whose rent goes somewhere else.');
      if (tag === IX_BURN || tag === IX_BURN_CHECKED) throw new Error('Safety check: refused a swap that burns tokens.');
    }
  }
  const out = lamportsOut(instructions);
  const allowed = BigInt(Math.round((allowSolOut + Math.max(0, maxSolOut) * 1.1) * 1e9));
  if (out > allowed) throw new Error('Safety check: refused a swap that moves too much SOL out of the wallet.');
}

module.exports = { assertCleanupTx, assertSwapTx, assertFeeBudget, assertSystemInstructions, readTx, lamportsOut, SYS, TOKEN, TOKEN_2022 };
