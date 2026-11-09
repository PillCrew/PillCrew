const { PROTOCOL_FEE, slippageFraction, seededRandom, analytics } = require('./simulation');

// Signals must be recorded at the time they became available, never reconstructed from a later price.
function replay(rows, options = {}) {
  const defaults = { initialBalance: 5, buyAmountSol: 0.02, maxPositions: 1, takeProfitPct: 20, stopLossPct: 12,
    maxHoldSec: 180, trailArmPct: 14, trailGivePct: 8, latencyMs: 300, maxQuoteAgeMs: 6000, feeSol: 0.000205, jitoTipSol: 0,
    failurePct: 0, baseSlippagePct: 1, unknownImpactPct: 2, seed: 1 };
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('Expected a replay settings object');
  for (const key of Object.keys(options)) {
    if (!Object.hasOwn(defaults, key)) throw new Error('Unknown replay setting: ' + key);
  }
  const s = { ...defaults, ...options };
  for (const [key, value] of Object.entries(s)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('Invalid replay setting: ' + key);
  }
  if (!(s.buyAmountSol > 0) || !(s.maxPositions >= 1) || s.failurePct > 100) throw new Error('Invalid replay sizing or failure rate');
  const rng = seededRandom(s.seed), held = new Map(), pending = new Map(), last = new Map();
  const trades = [], equity = [s.initialBalance];
  let balance = s.initialBalance, previous = -Infinity, failures = 0, failedOrderFeesSol = 0;
  const fee = s.feeSol + s.jitoTipSol;
  const slip = (amount, row) => slippageFraction(amount, row.liquiditySol, s.baseSlippagePct, s.unknownImpactPct);
  for (const row of rows) {
    if (!row || typeof row.mint !== 'string' || !row.mint || !Number.isFinite(row.ts) || row.ts < previous
      || !Number.isFinite(row.mcSol) || row.mcSol < 0 || (row.liquiditySol != null && (!Number.isFinite(row.liquiditySol) || row.liquiditySol < 0))) {
      throw new Error('Replay rows must contain ordered timestamps, a mint and a finite non-negative market cap');
    }
    previous = row.ts;
    for (const [mint, outstanding] of pending) {
      if (row.ts - outstanding.at > s.maxQuoteAgeMs) {
        pending.delete(mint);
        failures++;
      }
    }
    last.set(row.mint, row);
    const order = pending.get(row.mint);
    if (order && row.ts >= order.at) {
      pending.delete(row.mint);
      if (rng() * 100 < s.failurePct || row.liquiditySol === 0) {
        const charged = Math.min(balance, fee);
        balance -= charged; failedOrderFeesSol += charged; failures++;
      }
      else if (order.side === 'buy' && row.mcSol > 0 && balance >= s.buyAmountSol * (1 + PROTOCOL_FEE) + fee) {
        const cost = s.buyAmountSol * (1 + PROTOCOL_FEE) + fee;
        balance -= cost;
        held.set(row.mint, { entry: row.mcSol * (1 + slip(s.buyAmountSol, row)), cost, at: row.ts });
      } else if (order.side === 'buy') { failures++; }
      else if (order.side === 'sell') {
        const p = held.get(row.mint);
        if (p) {
          const gross = s.buyAmountSol * row.mcSol / p.entry;
          const received = gross * (1 - slip(gross, row)) * (1 - PROTOCOL_FEE) - fee;
          balance += received;
          trades.push({ mint: row.mint, enteredAt: p.at, exitedAt: row.ts, reason: order.reason,
            entryMc: p.entry, exitMc: row.mcSol, pnlSol: received - p.cost });
          held.delete(row.mint);
        }
      }
    }
    const p = held.get(row.mint);
    if (p && !pending.has(row.mint)) {
      const gross = s.buyAmountSol * row.mcSol / p.entry;
      const net = (gross * (1 - slip(gross, row)) * (1 - PROTOCOL_FEE) - fee - p.cost) / p.cost * 100;
      p.peak = Math.max(net, p.peak ?? net);
      const trailing = s.trailArmPct > 0 && s.trailGivePct > 0 && p.peak >= s.trailArmPct
        && net <= p.peak - Math.max(s.trailGivePct, p.peak * 0.45);
      const reason = net <= -s.stopLossPct ? 'Stop loss' : net >= s.takeProfitPct ? 'Take profit'
        : trailing ? 'Trailing stop' : row.ts - p.at >= s.maxHoldSec * 1000 ? 'Time limit' : null;
      if (reason) pending.set(row.mint, { side: 'sell', at: row.ts + s.latencyMs, reason });
    } else if (!p && !pending.has(row.mint) && row.signal === true && row.mcSol > 0
      && held.size + [...pending.values()].filter((x) => x.side === 'buy').length < s.maxPositions) {
      pending.set(row.mint, { side: 'buy', at: row.ts + s.latencyMs });
    }
    let marked = balance;
    for (const [mint, position] of held) {
      const quote = last.get(mint);
      if (quote.liquiditySol !== 0 && row.ts - quote.ts <= s.maxQuoteAgeMs) {
        const gross = s.buyAmountSol * quote.mcSol / position.entry;
        marked += Math.max(0, gross * (1 - slip(gross, quote)) * (1 - PROTOCOL_FEE) - fee);
      }
    }
    equity.push(marked);
  }
  const stats = analytics(trades, s.initialBalance, equity);
  return { settings: s, ...stats, tradePnlSol: stats.pnlSol, pnlSol: stats.pnlSol - failedOrderFeesSol, failedOrderFeesSol, balance, finalEquity: equity.at(-1),
    failures, openPositions: held.size, pendingOrders: pending.size, history: trades,
    note: 'Recorded-signal replay; open positions are marked, not force-filled. This does not replay live discovery or predict profitability.' };
}

module.exports = { replay };
