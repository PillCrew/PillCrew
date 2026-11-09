/**
 * Jupiter swap client. The Swap API v2 builds an order, the wallet signs it here and the signed bytes go back to
 * Jupiter to execute, so this is a second execution route behind the native Pump.fun door.
 *
 * It answers without an API key (measured 2026-11-04: a real quote in about 120 ms from both hosts), which is what
 * makes it the free fallback that keeps a trade possible when the native route refuses the market.
 */
const HOSTS = ['https://lite-api.jup.ag/swap/v2', 'https://api.jup.ag/swap/v2'];
const WSOL = 'So11111111111111111111111111111111111111112';

class Jupiter {
  constructor(opts = {}) {
    this._host = 0;
    // The operator's own Jupiter key, when there is one: the free door answers about one request a second before it
    // starts refusing, and a key is the difference between a price lane that keeps up and one that waits its turn.
    this.getKey = opts.getKey || (() => '');
  }

  _headers(extra) {
    const key = this.getKey();
    const auth = key ? { 'x-api-key': key } : {};
    return { accept: 'application/json', ...auth, ...extra };
  }

  async _fetch(path, opts = {}, timeout = 6000, base = null) {
    const hosts = base ? HOSTS.map((h) => h.replace('/swap/v2', base)) : HOSTS;
    let lastErr = null;
    for (let attempt = 0; attempt < hosts.length * 2; attempt++) {
      const host = hosts[(this._host + attempt) % hosts.length];
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeout);
      try {
        const r = await fetch(host + path, { ...opts, signal: ctl.signal });
        if (r.status === 401 || r.status === 403) {
          throw Object.assign(new Error('Jupiter refused this request (' + r.status + ').'), { kind: 'auth' });
        }
        if (r.status === 429) { lastErr = Object.assign(new Error('Jupiter rate limit reached.'), { kind: 'rate' }); continue; }
        if (!r.ok) {
          // Jupiter explains a 400 in the body ("no route found", "amount too small", a mint it will not touch).
          // Reading it turns "Jupiter HTTP 400" into a sentence that says what the market did.
          let why = '';
          try { const b = await r.json(); why = b.errorMessage || b.message || b.error || (b.errorCode ? String(b.errorCode) : ''); } catch (_) { /* not json */ }
          lastErr = Object.assign(new Error(`Jupiter has no route (${r.status}${why ? ': ' + String(why).slice(0, 120) : ''})`), { kind: 'http' });
          continue;
        }
        this._host = (this._host + attempt) % hosts.length;
        return await r.json();
      } catch (err) {
        if (err.kind === 'auth') throw err;
        lastErr = err.name === 'AbortError' ? Object.assign(new Error('Jupiter timed out.'), { kind: 'timeout' }) : err;
      } finally { clearTimeout(timer); }
    }
    throw lastErr || new Error('Jupiter did not answer.');
  }

  /**
   * Swap through Jupiter (order -> sign -> execute). Returns the signature once Jupiter reports success.
   * `guard` inspects the transaction before it is signed, because the bytes come from a remote service.
   */
  async swap({ keypair, inputMint, outputMint, amountRaw, slippageBps, guard }) {
    const { VersionedTransaction } = require('@solana/web3.js');
    const q = new URLSearchParams({ inputMint, outputMint, amount: String(amountRaw), taker: keypair.publicKey.toBase58() });
    if (slippageBps) q.set('slippageBps', String(Math.round(slippageBps)));
    const order = await this._fetch(`/order?${q}`, { headers: this._headers() }, 8000)
      .catch(async (err) => {
        // RULE ADDED 2026-11-10 (1.1.4): "Failed to get quotes" is TWO different answers and the desk used to read both as
        // "this coin cannot be traded". Measured on the owner's own bag: the exchange answers exactly that for a WALLET that
        // cannot pay for the swap (a taker with 0.00218 SOL refused, one with 0.0622 SOL accepted, same mint, same amount),
        // while the very same order WITHOUT a taker quotes happily. So the answer is asked a second time with no taker: if
        // that one routes, the market is fine and the wallet is simply too thin - a reason to put SOL in it, not to give up.
        err.phase = 'build';
        err.definite = true;
        if (/failed to get quotes|insufficient funds/i.test(String(err.message))) {
          const bare = new URLSearchParams({ inputMint, outputMint, amount: String(amountRaw) });
          if (slippageBps) bare.set('slippageBps', String(Math.round(slippageBps)));
          const quote = await this._fetch(`/order?${bare}`, { headers: this._headers() }, 8000).catch(() => null);
          if (quote && quote.outAmount) {
            err.kind = 'funds';
            err.thin = true;
            err.message = `Jupiter will not quote this wallet: it needs more SOL in it to pay for the swap (${err.message})`;
          } else {
            err.kind = 'route';
            err.thin = false;
          }
        }
        throw err;
      });
    if (!order || !order.transaction) {
      throw Object.assign(new Error('Jupiter has no route: ' + ((order && (order.errorMessage || order.errorCode)) || 'unknown')), { phase: 'build', definite: true, kind: 'route' });
    }
    if (order.inAmount != null && String(order.inAmount) !== String(amountRaw)) {
      throw Object.assign(new Error('Jupiter quoted a different amount than the order and it was refused.'), { phase: 'build', definite: true });
    }
    const tx = VersionedTransaction.deserialize(Buffer.from(order.transaction, 'base64'));
    if (typeof guard === 'function') guard(tx, keypair.publicKey.toBase58());
    tx.sign([keypair]);
    const signature = require('bs58').encode(tx.signatures[0]);
    const res = await this._fetch('/execute', {
      method: 'POST',
      headers: this._headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({ signedTransaction: Buffer.from(tx.serialize()).toString('base64'), requestId: order.requestId }),
    }, 30000).catch((err) => {
      err.phase = 'submitted'; err.definite = false; err.signature = signature;
      throw err;
    });
    if (!res || res.status !== 'Success') {
      throw Object.assign(new Error('Jupiter swap outcome unknown: ' + ((res && (res.error || res.code)) || 'no answer')),
        { phase: 'submitted', definite: false, signature });
    }
    // A route may take a small platform fee out of the input, so the filled amount is compared with a tolerance:
    // 0.1% off is the fee, 5% off is a partial fill the book must not treat as a full exit.
    const asked = BigInt(amountRaw);
    if (res.inputAmountResult != null && asked > 0n) {
      const filled = BigInt(res.inputAmountResult);
      const shortfallPct = filled >= asked ? 0 : Number(((asked - filled) * 10000n) / asked) / 100;
      if (shortfallPct > 2) {
        // A successful partial fill is still an executed order. The engine reconciles the token balance.
        return res.signature || signature;
      }
    }
    return res.signature || signature;
  }

  /**
   * RULE ADDED 2026-11-10 (1.1.4): the LEGACY lane (swap/v1), which builds a swap for a wallet holding barely more than a
   * fee. Measured on the owner's own bag on 2026-11-10: the current lane refuses every taker below roughly 0.06 SOL with
   * "Failed to get quotes", and the desk's wallets are funded with a few thousandths - so the fallback route was dead on
   * exactly the wallets it exists for. This lane quotes (no taker needed) and returns a transaction to sign here and send
   * through the ordinary RPC doors, which is why it needs no extra service and no `/execute` call.
   */
  async swapV1({ keypair, inputMint, outputMint, amountRaw, slippageBps, guard, prioritizationFeeLamports = 5000 }) {
    const { VersionedTransaction } = require('@solana/web3.js');
    const owner = keypair.publicKey.toBase58();
    const q = new URLSearchParams({ inputMint, outputMint, amount: String(amountRaw), slippageBps: String(Math.round(slippageBps || 50)) });
    const quote = await this._fetch(`/quote?${q}`, { headers: this._headers() }, 8000, '/swap/v1')
      .catch((err) => { err.phase = 'build'; err.definite = true; err.kind = err.kind || 'route'; throw err; });
    if (!quote || !quote.outAmount) {
      throw Object.assign(new Error('Jupiter has no route for this trade.'), { phase: 'build', definite: true, kind: 'route' });
    }
    const res = await this._fetch('/swap', {
      method: 'POST',
      headers: this._headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: owner,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports,
      }),
    }, 12000, '/swap/v1').catch((err) => { err.phase = 'build'; err.definite = true; throw err; });
    if (!res || !res.swapTransaction) {
      throw Object.assign(new Error('Jupiter did not build a swap in its legacy lane.'), { phase: 'build', definite: true });
    }
    const tx = VersionedTransaction.deserialize(Buffer.from(res.swapTransaction, 'base64'));
    if (typeof guard === 'function') guard(tx, owner);
    tx.sign([keypair]);
    return { bytes: Buffer.from(tx.serialize()), signature: require('bs58').encode(tx.signatures[0]), route: 'jupiter-v1' };
  }
}

module.exports = { Jupiter, WSOL };
