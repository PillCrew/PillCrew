# Practice and recorded-signal replay

Enable **Record market observations** in advanced settings to create a local JSONL recording under the app-data `recordings` directory. It stores observed prices and entry signals without trader addresses or wallet keys. Each file is capped at 50 MB; the writer drops observations under disk backpressure rather than blocking trading. Recording is off by default. Missing or dropped data must be included in the interpretation of a replay. Replay failures charge the configured network fee; Practice build failures do not.

**Order-flow exits** are an optional experimental live/Practice rule, off by default. They exit after a fresh reading of the same pool loses half its recorded entry liquidity, or after at least eight observations in three seconds show at least 80% sells and sold volume above three times bought volume. This is a transparent rule, not a trained AI model. Recorded-signal replay currently uses TP/SL, trailing and time exits and does not reproduce this rule.

Practice fills include an estimated 1.75% per side for a standard SOL bonding-curve trade built through PumpPortal Local (1.25% curve fee plus 0.5% builder fee), network priority fees and adverse slippage. Slippage grows with ticket size relative to the available quote-side liquidity. When depth is missing, the model adds a configurable penalty; it does not assume infinite liquidity. This is an approximation, not a router quote.

Advanced settings expose latency, baseline slippage, unknown-depth impact and order failure rate. New profiles model 300 ms of latency; set 250–1000 ms and test several failure rates before comparing strategies. These are stress assumptions, not measurements of your RPC. Failed simulated orders do not imply a real network fee was paid.

Run a replay with:

```sh
npm run backtest -- events.jsonl settings.json
```

Each JSONL row contains `ts` (Unix milliseconds), `mint`, `mcSol`, optional `liquiditySol` (quote-side SOL reserve), and optional `signal: true` for an entry signal observed at that timestamp. Input must be ordered. Zero liquidity prevents fills. Missing depth adds an impact penalty. An order fills only at a subsequent observation after its latency; gaps beyond `maxQuoteAgeMs` cancel that attempt. Exits use net TP/SL and a holding-time limit. Replay does not reproduce the live scoring, partial exits or discovery feeds.

Example:

```jsonl
{"ts":0,"mint":"EXAMPLE","mcSol":100,"liquiditySol":20,"signal":true}
{"ts":300,"mint":"EXAMPLE","mcSol":101,"liquiditySol":20}
{"ts":1000,"mint":"EXAMPLE","mcSol":140,"liquiditySol":20}
{"ts":1300,"mint":"EXAMPLE","mcSol":135,"liquiditySol":20}
```

Settings include `initialBalance`, `buyAmountSol`, `maxPositions`, `takeProfitPct`, `stopLossPct`, `maxHoldSec`, `latencyMs`, `maxQuoteAgeMs`, `feeSol`, `jitoTipSol`, `failurePct`, `baseSlippagePct`, `unknownImpactPct` and `seed`. Pass a JSON array of settings objects to compare them on the same ordered tape. The comparison returns one summary per configuration. Use a separate recording for final evaluation. The report includes cash, marked equity, realized PnL, win rate, profit factor and absolute equity drawdown. Open positions are not converted into fictional closing trades. Stale holdings are marked at zero for conservative equity reporting.

There is no bundled historical market dataset. Preserve failed launches, gaps and delisted tokens when recording data. Selecting only surviving tokens, adding entry signals after a rally, or tuning on the evaluation sample invalidates the comparison. No profitability or competitor latency ranking has been established.
