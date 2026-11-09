'use strict';

// Standard SOL bonding curve (1.25%) through PumpPortal Local (0.5%).
const curveLocalFee = 0.0175;

function networkExtras(settings) {
  return 0.000005 + (settings.useJito ? Number(settings.jitoTipSol || 0) + 0.000005 : 0);
}

function roundTripFeePct(ticket, entryNetworkSol, exitNetworkSol) {
  return curveLocalFee * 200 + (entryNetworkSol + exitNetworkSol) / ticket * 100;
}

if (typeof module !== 'undefined') module.exports = { curveLocalFee, networkExtras, roundTripFeePct };

