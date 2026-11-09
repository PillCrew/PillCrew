const { PublicKey } = require('@solana/web3.js');
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

function inspectMint(info) {
  if (!info || !info.owner || !Buffer.isBuffer(info.data) || info.data.length < 82) return 'Mint data unavailable';
  const owner = info.owner.toBase58();
  if (![TOKEN, TOKEN_2022].includes(owner)) return 'Unexpected mint program';
  if (info.data[45] !== 1) return 'Mint is not initialized';
  if (info.data.readUInt32LE(0) !== 0) return 'Creator can still mint more';
  if (info.data.readUInt32LE(46) !== 0) return 'Token can be frozen';
  if (owner === TOKEN_2022 && info.data.length > 82) return 'Token-2022 extensions require further review';
  return null;
}

class RiskAnalyzer {
  constructor(call) { this.call = call; this.cache = new Map(); }
  async check(mint) {
    const cached = this.cache.get(mint);
    if (cached && Date.now() - cached.at < 10000) return cached.reason;
    let reason;
    try { reason = inspectMint(await this.call((c) => c.getAccountInfo(new PublicKey(mint), 'confirmed'), { attempts: 1, timeoutMs: 1000, budgetMs: 1000 })); }
    catch (_) { return 'Mint risk could not be verified'; }
    if (this.cache.size >= 400) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(mint, { at: Date.now(), reason });
    return reason;
  }
}

function adaptiveExit(position, token, settings, now) {
  if (!settings.adaptiveExits || !token) return null;
  const ext = token.ext;
  if (position.entryLiquidityUsd > 0 && ext && now - ext.at < 10000 && ext.dexId === position.entryDexId
    && Number.isFinite(ext.liqUsd) && ext.liqUsd >= 0 && ext.liqUsd < position.entryLiquidityUsd * 0.5) return 'Liquidity fell by half';
  const recent = (token.trades || []).filter((t) => now - t.ts <= 3000);
  if (recent.length < 8) return null;
  const sells = recent.filter((t) => t.side === 'sell');
  const sold = sells.reduce((n, t) => n + t.sol, 0);
  const bought = recent.filter((t) => t.side === 'buy').reduce((n, t) => n + t.sol, 0);
  return sells.length / recent.length >= 0.8 && sold > bought * 3 ? 'Sustained sell pressure' : null;
}

module.exports = { inspectMint, RiskAnalyzer, adaptiveExit };
