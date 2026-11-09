/**
 * Jito block engine client. A transaction sent as a bundle goes into the block engine's auction instead of a public
 * RPC queue, and a bundle only executes when it lands as a whole - so a tip is paid only when the trade with it
 * lands. That is the one thing an auction genuinely buys a small trader: a better chance of landing in a crowded
 * slot, without paying for the attempts that fail.
 *
 * Public endpoint, no key (measured 2026-11-04: getTipAccounts answered in about 200 ms).
 */
const ENGINE = 'https://mainnet.block-engine.jito.wtf/api/v1/bundles';
// Below this the block engine drops the bundle before it is ever considered.
const MIN_TIP_LAMPORTS = 1000n;
const TIPS_TTL_MS = 10 * 60 * 1000;
const CALL = { timeout: 6000 };

class Jito {
  constructor(opts = {}) {
    this.url = opts.url || ENGINE;
    this._tips = null;
    this._tipsAt = 0;
    this.stats = { bundles: 0, refused: 0, errors: 0 };
  }

  async _post(method, params) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), CALL.timeout);
    let r;
    let text = '';
    try {
      r = await fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: ctl.signal,
      });
      text = typeof r.text === 'function' ? await r.text() : JSON.stringify(await r.json());
    } catch (e) {
      this.stats.errors++;
      throw new Error(e.name === 'AbortError' ? 'Jito did not answer in time.' : 'Jito is unreachable: ' + e.message);
    } finally {
      clearTimeout(timer);
    }
    if (r.status === 429) { this.stats.errors++; throw new Error('Jito rate limit reached.'); }
    // Read the answer once, as text: the refusal body is the only thing that explains a 400, and a response object that
    // only speaks JSON (a test double, an older fetch) still has to be understood here.
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (_) { body = null; }
    if (!r.ok) {
      this.stats.errors++;
      // The block engine explains a refusal in the body - "transaction #0 could not be decoded", "bundle simulation
      // failed", a duplicate or a stale blockhash - and a bare status code tells nobody anything. Measured against the
      // live endpoint: the same bundle WITHOUT the encoding named answers 400 "could not be decoded", and WITH it comes
      // back with a bundle id, so the shape here is right and a 400 is a real refusal worth reading.
      const why = (body && body.error && (body.error.message || body.error)) || text || '';
      const line = String(why).replace(/\s+/g, ' ').trim().slice(0, 140);
      throw new Error(`Jito refused the request (HTTP ${r.status})${line ? ': ' + line : ''}`);
    }
    if (!body) { this.stats.errors++; throw new Error('Jito answered with something that is not JSON.'); }
    if (body.error) {
      this.stats.errors++;
      const why = body.error.message || body.error.code || 'unknown error';
      throw new Error('Jito: ' + String(why).slice(0, 140));
    }
    return body.result;
  }

  /** The accounts a tip may be paid to. Jito expects the tip in the bundle, to one of its own addresses. */
  async tipAccounts() {
    if (this._tips && Date.now() - this._tipsAt < TIPS_TTL_MS) return this._tips;
    try {
      const list = await this._post('getTipAccounts', []);
      const tips = Array.isArray(list) ? list.filter((a) => typeof a === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)) : [];
      if (!tips.length) throw new Error('Jito did not name a tip account.');
      this._tips = tips;
      this._tipsAt = Date.now();
      return tips;
    } catch (e) {
      // A tip account is a stable address, so a list from an hour ago is still a valid place to pay a tip. Measured
      // against the live engine: `getTipAccounts` answered 429 while `sendBundle` was still accepting bundles, so
      // letting the lookup take the whole lane down for ten minutes would cost every trade in that window its
      // second chance at landing. The list is used, and retried a minute later instead of ten.
      if (this._tips && this._tips.length) {
        this._tipsAt = Date.now() - TIPS_TTL_MS + 60000;
        return this._tips;
      }
      throw e;
    }
  }

  /** Send signed transactions as one atomic bundle. Returns the bundle id. */
  async sendBundle(rawTransactions) {
    const list = (rawTransactions || []).map((raw) => Buffer.from(raw).toString('base64'));
    if (list.length < 1) throw new Error('A bundle needs at least one transaction.');
    this.stats.bundles++;
    return this._post('sendBundle', [list, { encoding: 'base64' }]);
  }
}

module.exports = { Jito, ENGINE, MIN_TIP_LAMPORTS };
