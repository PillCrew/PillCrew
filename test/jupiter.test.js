// Jupiter: what its refusals actually mean, and the lane that can still trade from a wallet holding barely a fee.
// No network: `fetch` is replaced by a router that answers like the real service does.
const assert = require('assert');
const { Keypair, TransactionMessage, TransactionInstruction, VersionedTransaction } = require('@solana/web3.js');
const { Jupiter, WSOL } = require('../src/jupiter');

const PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const MINT = Keypair.generate().publicKey.toBase58();
const WSOL_MINT = WSOL;

/** A minimal but real transaction, so the client can deserialize and sign what the fake service returns. */
function fakeSwapTx(owner) {
  const msg = new TransactionMessage({
    payerKey: owner,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
    instructions: [new TransactionInstruction({ programId: new (require('@solana/web3.js').PublicKey)(PUMP), keys: [], data: Buffer.from([1, 2, 3]) })],
  }).compileToV0Message();
  return new VersionedTransaction(msg);
}

function stubFetch(routes) {
  const seen = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    seen.push(u);
    for (const [match, answer] of routes) {
      if (u.includes(match)) return answer(u, opts);
    }
    return { ok: false, status: 404, json: async () => ({ error: 'no stub for ' + u }), text: async () => 'no stub' };
  };
  return seen;
}

const json = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

(async () => {
  const realFetch = global.fetch;
  try {
    // ── 1. "Failed to get quotes" is TWO answers, and the desk must not read both as "this coin cannot be traded" ──
    {
      // With a taker: refused. Without one: a perfect quote. That is a WALLET that cannot pay, not a dead market (measured on
      // the owner's bag on 2026-11-10: a taker with 0.00218 SOL refused, one with 0.0622 SOL accepted, same mint and amount).
      const seen = stubFetch([
        ['/order?', (u) => (u.includes('taker=') ? json(400, { error: 'Failed to get quotes' })() : json(200, { outAmount: '2851400' })())],
      ]);
      const j = new Jupiter();
      const kp = Keypair.generate();
      const err = await j.swap({ keypair: kp, inputMint: MINT, outputMint: WSOL_MINT, amountRaw: '39018746966', slippageBps: 300 })
        .then(() => null, (e) => e);
      assert.ok(err, 'the thin wallet is refused');
      assert.strictEqual(err.kind, 'funds', 'and the refusal is named for what it is: ' + err.kind);
      assert.strictEqual(err.thin, true, 'a wallet problem, not a market problem');
      assert.ok(/needs more SOL/.test(err.message), 'the sentence says what to do about it: ' + err.message);
      assert.strictEqual(err.definite, true, 'and nothing was signed, so it is safe to try another lane');
      assert.ok(seen.some((u) => !u.includes('taker=')), 'the second opinion was asked without a taker: ' + seen.length);

      // Both refused: the market really has no route.
      stubFetch([['/order?', json(400, { error: 'Failed to get quotes' })]]);
      const j2 = new Jupiter();
      const err2 = await j2.swap({ keypair: kp, inputMint: MINT, outputMint: WSOL_MINT, amountRaw: '1', slippageBps: 300 })
        .then(() => null, (e) => e);
      assert.strictEqual(err2.kind, 'route', 'a dead market stays a dead market: ' + err2.kind);
      assert.strictEqual(err2.thin, false, 'and no wallet is blamed for it');
    }

    // ── 2. the legacy lane builds a swap for a thin wallet and hands back real signed bytes ──
    {
      const kp = Keypair.generate();
      const tx = fakeSwapTx(kp.publicKey);
      stubFetch([
        ['/swap/v1/quote?', json(200, { outAmount: '2851400', inputMint: MINT, outputMint: WSOL_MINT })],
        ['/swap/v1/swap', json(200, { swapTransaction: Buffer.from(tx.serialize()).toString('base64') })],
      ]);
      const j = new Jupiter();
      const built = await j.swapV1({ keypair: kp, inputMint: MINT, outputMint: WSOL_MINT, amountRaw: '39018746966', slippageBps: 300 });
      assert.ok(built.bytes && built.bytes.length > 100, 'bytes to send through the ordinary doors');
      assert.strictEqual(built.route, 'jupiter-v1');
      const sent = VersionedTransaction.deserialize(new Uint8Array(built.bytes));
      assert.ok(sent.signatures[0] && sent.signatures[0].some((b) => b !== 0), 'and they are signed here, never by the service');
    }

    // ── 3. the guard is applied to the legacy lane too: remote bytes are still inspected before signing ──
    {
      const kp = Keypair.generate();
      const tx = fakeSwapTx(kp.publicKey);
      stubFetch([
        ['/swap/v1/quote?', json(200, { outAmount: '1' })],
        ['/swap/v1/swap', json(200, { swapTransaction: Buffer.from(tx.serialize()).toString('base64') })],
      ]);
      let guarded = 0;
      const j = new Jupiter();
      await j.swapV1({
        keypair: kp, inputMint: MINT, outputMint: WSOL_MINT, amountRaw: '1', slippageBps: 300,
        guard: (t, owner) => { guarded++; assert.strictEqual(owner, kp.publicKey.toBase58()); assert.ok(t.message); },
      });
      assert.strictEqual(guarded, 1, 'the safety check saw the transaction before it was signed');
    }
  } finally {
    global.fetch = realFetch;
  }
  console.log('Jupiter route tests passed');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
