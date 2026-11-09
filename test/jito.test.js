// The Jito lane: a client that speaks the block engine's JSON-RPC, and the engine path that offers the same signed
// trade to it as a bundle with a tip. Nothing here may change what the normal route did.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Every scratch directory this suite makes lives under one root that is removed on exit, and roots left by an
// earlier run are swept (see `test/scratch.js`).
const scratchDir = require('./scratch').root;
const {
  Keypair, PublicKey, SystemProgram, Transaction, VersionedTransaction, LAMPORTS_PER_SOL,
} = require('@solana/web3.js');
const { Jito, MIN_TIP_LAMPORTS } = require('../src/jito');
const { Store } = require('../src/store');
const { Engine, DEFAULTS } = require('../src/engine');

const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const TIP = 'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh';

(async () => {
  const realFetch = global.fetch;
  const wallet = { exists: () => true, isUnlocked: () => true, address: () => 'W', keypair: Keypair.generate() };

  function engine(overrides = {}) {
    const store = new Store(fs.mkdtempSync(path.join(scratchDir, 'jito-')), 's.json', DEFAULTS);
    store.set({ mode: 'live', buyAmountSol: 0.004, priorityFeeSol: 0.0002, ...overrides });
    const e = new Engine(wallet, store);
    clearInterval(e._bal); clearInterval(e._ui); clearInterval(e._pxTimer);
    e.refreshBalance = () => {};
    const logs = [];
    e._log = (level, msg) => logs.push(level + ': ' + msg);
    e.logs2 = logs;
    return e;
  }

  /** A signed v0 transaction, the shape the trade door returns. */
  function signedTx() {
    const kp = wallet.keypair;
    const tx = new Transaction();
    tx.feePayer = kp.publicKey;
    tx.recentBlockhash = '11111111111111111111111111111111';
    tx.add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: new PublicKey(TIP), lamports: 1 }));
    const vtx = new VersionedTransaction(tx.compileMessage());
    vtx.sign([kp]);
    return Buffer.from(vtx.serialize());
  }

  try {
    // ---- the client ----
    {
      let calls = 0;
      let lastBody = null;
      global.fetch = async (_url, opts) => {
        calls++;
        lastBody = JSON.parse(opts.body);
        return res(200, { jsonrpc: '2.0', id: 1, result: [TIP, 'not-an-address'] });
      };
      const j = new Jito();
      const tips = await j.tipAccounts();
      assert.deepStrictEqual(tips, [TIP], 'only real addresses are kept');
      assert.strictEqual(lastBody.method, 'getTipAccounts');
      await j.tipAccounts();
      assert.strictEqual(calls, 1, 'the tip accounts are cached');

      // A rate-limited lookup must not take the lane down: the addresses are stable, so the last list is still a valid
      // place to pay a tip. Measured against the live engine: getTipAccounts answered 429 while sendBundle was fine.
      global.fetch = async () => res(429, {});
      j._tipsAt = Date.now() - 11 * 60 * 1000;
      assert.deepStrictEqual(await j.tipAccounts(), [TIP], 'the list from before is used instead of failing');
      j._tipsAt = 0; j._tips = null;
      await assert.rejects(() => j.tipAccounts(), /rate limit/, 'and with nothing cached it is still an error');

      // A bundle is posted as base64 with the encoding named, and the answer is the bundle id.
      global.fetch = async (_url, opts) => {
        lastBody = JSON.parse(opts.body);
        return res(200, { jsonrpc: '2.0', id: 1, result: 'BUNDLE_ID' });
      };
      const raw = signedTx();
      const id = await j.sendBundle([raw, raw]);
      assert.strictEqual(id, 'BUNDLE_ID');
      assert.strictEqual(lastBody.method, 'sendBundle');
      assert.strictEqual(lastBody.params[0].length, 2);
      assert.strictEqual(Buffer.from(lastBody.params[0][0], 'base64').equals(raw), true, 'the bytes are sent untouched');
      assert.strictEqual(lastBody.params[1].encoding, 'base64');

      // A refusal is a sentence, not a JSON blob, and it is counted.
      const errorsBefore = j.stats.errors;
      global.fetch = async () => res(200, { jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'Bundle simulation failed' } });
      await assert.rejects(() => j.sendBundle([raw]), /Bundle simulation failed/);
      assert.strictEqual(j.stats.errors, errorsBefore + 1);
      global.fetch = async () => res(429, {});
      await assert.rejects(() => j.sendBundle([raw]), /rate limit/);

      // A 400 carries the block engine's own reason, and that reason is the only thing that makes the line useful.
      // Measured against the live endpoint: a bundle sent without `encoding: base64` answers exactly this way.
      global.fetch = async () => ({
        ok: false, status: 400,
        text: async () => JSON.stringify({ jsonrpc: '2.0', error: { code: -32602, message: 'transaction #0 could not be decoded' }, id: 1 }),
      });
      await assert.rejects(() => j.sendBundle([raw]), /HTTP 400.*could not be decoded/);
    }

    // ---- the engine lane ----
    {
      const e = engine({ useJito: true, jitoTipSol: 0.0001 });
      const sent = [];
      e.jito = {
        tipAccounts: async () => [TIP],
        sendBundle: async (raws) => { sent.push(raws); return 'ID'; },
      };
      const raw = signedTx();
      const ok = await e._jitoLane(raw);
      assert.strictEqual(ok, true, 'the bundle was offered');
      assert.strictEqual(sent.length, 1, 'one bundle per trade, not one per retry');
      assert.strictEqual(sent[0].length, 2, 'the trade and one tip travel together');
      assert.strictEqual(Buffer.from(sent[0][0]).equals(raw), true, 'the trade bytes are identical to what the RPC got');
      const tipTx = Transaction.from(sent[0][1]);
      assert.strictEqual(tipTx.instructions.length, 1, 'the tip is one instruction');
      assert.strictEqual(tipTx.instructions[0].programId.equals(SystemProgram.programId), true);
      assert.strictEqual(tipTx.instructions[0].keys[1].pubkey.toBase58(), TIP, 'and it pays a Jito account');
      assert.strictEqual(Number(tipTx.instructions[0].data.readBigUInt64LE(4)), Math.round(0.0001 * LAMPORTS_PER_SOL));
      assert.strictEqual(tipTx.recentBlockhash, '11111111111111111111111111111111', 'the tip reuses the trade blockhash');
      assert.ok(e.logs2.some((l) => /Offered to Jito/.test(l)), 'and the log says what happened');
      assert.strictEqual(e.stats.feeSpentSol, 0, 'the tip is not a fee until the bundle lands');
    }

    // Switched off: no request at all.
    {
      const e = engine({ useJito: false });
      let called = 0;
      e.jito = { tipAccounts: async () => { called++; return [TIP]; }, sendBundle: async () => { called++; return 'ID'; } };
      assert.strictEqual(await e._jitoLane(signedTx()), false);
      assert.strictEqual(called, 0, 'off means nothing is sent to Jito');
    }

    // A tip typed below the block engine's own floor is raised to that floor rather than sent and dropped unseen.
    {
      const e = engine({ useJito: true, jitoTipSol: 0.0000001 });
      const sent = [];
      e.jito = { tipAccounts: async () => [TIP], sendBundle: async (raws) => { sent.push(raws); return 'ID'; } };
      assert.strictEqual(await e._jitoLane(signedTx()), true);
      const tipTx = Transaction.from(sent[0][1]);
      assert.strictEqual(Number(tipTx.instructions[0].data.readBigUInt64LE(4)), Number(MIN_TIP_LAMPORTS), 'raised to the floor');
      assert.ok(BigInt(Math.round(0.0000001 * 1e9)) < MIN_TIP_LAMPORTS, 'the typed value really was under it');
    }

    // A block engine that is down never breaks the trade: the broadcast still answers with the RPC signature.
    {
      const e = engine({ useJito: true });
      e.jito = { tipAccounts: async () => { throw new Error('Jito is unreachable: boom'); }, sendBundle: async () => 'ID' };
      e.rpc = { broadcast: async () => 'RPC_SIGNATURE' };
      const sig = await e._broadcast(signedTx());
      assert.strictEqual(sig, 'RPC_SIGNATURE', 'the normal route is untouched');
      await new Promise((r) => setTimeout(r, 30));
      assert.ok(e.logs2.some((l) => /Jito is unreachable/.test(l)), 'and the failure is one quiet line');
      assert.ok(!e.logs2.some((l) => /\.\. The normal route/.test(l)), 'and it does not end in two full stops');
      assert.strictEqual(e.logs2.filter((l) => /Jito is unreachable/.test(l)).length, 1, 'said once, not once per trade');
      await e._broadcast(signedTx());
      await new Promise((r) => setTimeout(r, 30));
      assert.strictEqual(e.logs2.filter((l) => /Jito is unreachable/.test(l)).length, 1, 'and not again inside a minute');
    }

    // RULE ADDED 2026-11-05: "bundle contains an already processed transaction" is not a fault and not Jito being
    // unwell - it means the RPC door won the race and the trade is on chain. Measured live at 14:44:26, one second
    // before "Bought QI": a warning line that reads like a failure next to a successful buy.
    {
      const e = engine({ useJito: true });
      e.jito = {
        tipAccounts: async () => [TIP],
        sendBundle: async () => { throw new Error('Jito refused the request (HTTP 400): bundle contains an already processed transaction'); },
      };
      assert.strictEqual(await e._jitoLane(signedTx()), false, 'the lane reports it did not carry the trade');
      const line = e.logs2.find((l) => /already processed/.test(l));
      assert.ok(line && line.startsWith('info:'), 'a trade that is already on chain is information, not a warning');
      assert.ok(/^info: Jito refused the request/.test(line), 'and the name is not said twice (Jito: Jito refused…)');
      assert.ok(/not a fault/.test(line), 'the line says what it means');
      // Once per ten minutes: the trade path offers every order to both doors at once, and the RPC usually wins.
      e._jitoDupAt = Date.now() - 5000;
      await e._jitoLane(signedTx());
      assert.strictEqual(e.logs2.filter((l) => /already processed/.test(l)).length, 1, 'not repeated inside ten minutes');
      // A real refusal is still a warning, and still names the engine only once.
      const w = engine({ useJito: true });
      w.jito = { tipAccounts: async () => [TIP], sendBundle: async () => { throw new Error('Bundle simulation failed'); } };
      await w._jitoLane(signedTx());
      const warn = w.logs2.find((l) => /simulation failed/.test(l));
      assert.ok(warn && warn.startsWith('warn:'), 'a genuine refusal keeps its warning');
      assert.ok(/^warn: Jito: Bundle simulation failed/.test(warn), 'and is prefixed once');
    }

    console.log('Jito tests passed');
    process.exit(0);
  } finally {
    global.fetch = realFetch;
  }
})().catch((e) => { console.error(e); process.exit(1); });
