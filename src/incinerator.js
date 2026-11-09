/**
 * Sol Incinerator Burn API (optional). Builds transactions that close empty accounts and burn dust tokens.
 * Docs: https://api.dashboard.sol-incinerator.com/docs/v2  (get a wallet-bound key in the portal).
 * The API only BUILDS transactions; they are signed here with your wallet and sent through your own RPC,
 * so the API never sees your private key. Protocol fee: 2% of the rent it recovers.
 */
const BASE = 'https://v2.api.sol-incinerator.com';

class Incinerator {
  /** @param {() => string} getKey */
  constructor(getKey) { this.getKey = getKey; }

  get enabled() { return !!this.getKey(); }

  async _post(path, body) {
    const key = this.getKey();
    if (!key) throw new Error('Add your Sol Incinerator API key in Settings first.');
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 20000);
    let r;
    let data = null;
    try {
      r = await fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key }, body: JSON.stringify(body), signal: ctl.signal });
      try { data = await r.json(); } catch (err) { if (ctl.signal.aborted) throw err; }
    } catch (e) {
      throw new Error(e.name === 'AbortError' ? 'Sol Incinerator did not answer in time.' : 'Could not reach Sol Incinerator: ' + e.message);
    } finally { clearTimeout(timer); }
    if (!r.ok) {
      const code = r.status;
      if (code === 401) throw new Error('Sol Incinerator rejected the API key (401). Check the key in Settings.');
      if (code === 429) throw new Error('Sol Incinerator rate limit reached. Try again in a minute.');
      const msg = data && (typeof data.error === 'string' ? data.error : data.error && data.error.code) || 'HTTP ' + code;
      throw new Error('Sol Incinerator: ' + msg);
    }
    return data;
  }

  /** Transactions that close every empty token account of the wallet (rent returns to the wallet). */
  batchCloseAll(owner, limit = 200, offset = 0) {
    return this._post('/batch/close-all', { userPublicKey: owner, limit, offset });
  }

  /** Transaction that burns the whole balance of one token and closes its account. */
  burn(owner, assetId) {
    return this._post('/burn', { userPublicKey: owner, assetId, autoCloseTokenAccounts: true });
  }
}

module.exports = { Incinerator, BASE };
