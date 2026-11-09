const { curveLocalFee: PROTOCOL_FEE } = require('../renderer/fees');

function slippageFraction(amountSol, liquiditySol, basePct = 1, unknownPct = 2) {
  const impact = liquiditySol > 0 ? amountSol / (liquiditySol + amountSol) : unknownPct / 100;
  return Math.min(0.95, Math.max(0, basePct / 100) + Math.max(0, impact));
}

function seededRandom(seed = 1) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

function analytics(trades, initialBalance, equity) {
  let gains = 0, losses = 0, peak = initialBalance, maxDrawdownSol = 0;
  for (const row of trades) { if (row.pnlSol > 0) gains += row.pnlSol; else losses -= row.pnlSol; }
  for (const value of equity) { peak = Math.max(peak, value); maxDrawdownSol = Math.max(maxDrawdownSol, peak - value); }
  return { trades: trades.length, winRate: trades.length ? trades.filter((t) => t.pnlSol > 0).length / trades.length : 0,
    pnlSol: gains - losses, profitFactor: losses ? gains / losses : null, maxDrawdownSol };
}

module.exports = { PROTOCOL_FEE, slippageFraction, seededRandom, analytics };
