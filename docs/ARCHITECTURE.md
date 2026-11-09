# Architecture

```
main.js              Electron entry, window, IPC surface, settings validation
preload.js           The only bridge between the renderer and the main process
src/engine.js        Everything that decides and trades: feeds, scoring, entries, exits, reclaim
src/bump.js          The bump desk: a pool of generated wallets, the schedule, the cost model, its own guards
src/secretbox.js     One implementation of the seal the wallet and the bump roster both use
src/market.js        Market scanner: discovery doors and batched pricing
src/chain.js         On chain decoder for the Pump.fun program (logs subscription)
src/rpc.js           RPC pool with health checks, failover and pacing
src/wallet.js        Encrypted key storage, create, import, unlock, sign, withdraw
src/reclaim.js       Local cleanup of empty token accounts
src/incinerator.js   Sol Incinerator client
src/jupiter.js       Jupiter tokens and swap client
src/txguard.js       Inspection of transactions built by a third party, before the wallet signs them
src/store.js         Small JSON settings store
src/ipcguard.js      Main-window and main-frame IPC sender verification
src/risk.js          Bounded on-chain mint authority checks
src/simulation.js    Shared slippage, deterministic random source and analytics
src/backtest.js      Recorded-signal replay with delayed fills
src/recorder.js      Bounded opt-in local market/entry-signal recordings
renderer/            UI: HTML, CSS, vanilla JS views
test/                Offline test suite
```

## Data flow

```
              +-------------------+        +--------------------+
              |  Discovery doors  |        |  Live trade stream |
              |  (HTTP)           |        |  (WebSocket)       |
              +---------+---------+        +----------+---------+
                        |                         |
                        v                         v
                  +-------------------------------------+
                  |             Engine                  |
                  |  tokens: score, reason, prices      |
                  |  positions: entry, peak, exit rules |
                  +------------------+------------------+
                                     |
                     +---------------+---------------+
                     |                               |
              +------v------+                 +------v------+
              | Market feed |                 | Trade route |
              | (batched)   |                 | (PumpPortal)|
              +-------------+                 +-------------+
```

The engine is the only place that decides anything. Nothing in the renderer can spend money: the IPC
surface offers start, stop, sell and cleanup, and the main process re-validates every argument.

## Discovery doors

New launches are polled on every cycle, because the newest-token list only spans about a minute. One wide
door rotates beside it, so no endpoint is hammered:

1. DexScreener boosted tokens, latest
2. DexScreener boosted tokens, top
3. DexScreener fresh token profiles
4. Jupiter trending, five minute window
5. Jupiter most traded, five minute window
6. GeckoTerminal pools on the Pump.fun dex, page by page
7. GeckoTerminal trending pools across Solana

Everything found is adopted into the token table with a source tag, so the UI can say where a coin came
from. GeckoTerminal rows arrive with price, depth, volume and buy and sell counts, so a coin from that door
can be scored immediately instead of waiting for its first price. Non Pump.fun coins are dropped as soon as
a price arrives for them.

## Pricing

Two loops:

- **Fast lane**, about 1.2 seconds: open positions first, then the best scoring candidates, 30 coins per
  request. This is what an exit rule reads.
- **Wide sweep**, about 3 seconds: rotates through the whole token table, 120 coins per cycle.

Both use the DexScreener batch endpoint, which takes 30 addresses per call. Market cap in SOL comes from
`priceNative`, so the dollar price of SOL is never needed for a Pump.fun coin.

When a live trade stream is connected, stream prices win and market prices are only used for coins the
stream is not watching.

## Subscription budget

A free trade stream plan allows 25 live token subscriptions and 40 control messages per ten seconds.
The engine keeps a budget of 20: open positions always, then the best scoring candidates. Changes are
sent as one batched subscribe and one batched unsubscribe, at most every four seconds. Coins outside the
budget are scored from market data instead.

## Entry path

```
scan -> prefilter (age, duplicates, retry window)
     -> advisor (market cap, buyers, net flow, growth, creator, pool)
     -> risk gate (positions, buys per minute, session loss, pause)
     -> build transaction (PumpPortal)
     -> guard (no unexpected SOL transfers)
     -> sign locally
     -> send through the RPC pool
     -> book the position as open, confirm in the background
```

The position is open from the moment the signed bytes are on the wire: stops, targets and the time limit
have to work while the chain is still answering, and a confirmation can take seconds on a busy RPC.
Confirmation has three outcomes, because "the RPC could not tell me" is not "it failed":

- `confirmed` - the chain accepted it
- `failed` - the chain rejected it, or every status call answered and none ever saw it
- `unknown` - no node answered in time

On `unknown` the token balance decides. Tokens present means the buy is kept and managed; no tokens means
the position is dropped. Only a definite failure is ever retried, so a coin cannot be bought twice while
the first order might still land.

A rejection by the chain is free of tokens, so it is read for what it says about the market rather than
treated as a verdict on the coin:

| Program error | Meaning | What happens |
| --- | --- | --- |
| `6002` / `6003` | the price moved while the order was in flight | one order through the backup route, which quotes fresh and applies the tolerance to the tokens |
| `6005` / `6004` | the curve finished or the mint is not the one asked for | the coin is marked graduated and followed to the new pool, or left alone when graduated coins are switched off |
| `6063` | `UnsupportedQuoteMint`: the curve is not quoted in SOL | retired after one attempt, since no route on that curve can fill a SOL order |

The error codes were read off the program log of simulated orders on mainnet, not guessed.

## Exit path

Every tick reads the position price, updates the peak, and applies the exit rules in order. A sell that
cannot be confirmed is checked against the token balance, so a transaction that landed after the timeout
is not sold twice.

What a sale books is measured, not assumed: the token balance is read before and after, and the fraction
that really left the wallet is the fraction the book records. A fill that sells half of what was asked
leaves the other half as a position instead of closing it, and a sale that sold nothing measurable is
retried rather than booked. A position the RPC could not vouch for, and which the wallet proves never
existed, is dropped instead of being booked as a sale.

The price of an open position comes from the trade stream while that stream is fresh, which is what makes
the exits react in milliseconds. A stream that has been quiet for fifteen seconds is not the price any
more - the coin graduated, or the feed dropped it - so the position is handed over to the market board,
anchored to the last stream price so the card never jumps.

## Restart

Open positions are written to `openPositions` in the settings file on every change, and the closed-trade
book to `bookHistory` with the running totals beside it. On the next Start each saved position is checked
against the wallet: coins that are there are adopted into the book and managed by the normal exit rules,
coins that are not are dropped. A closed window therefore costs the time the app was shut, not the
position - and not the day's numbers either.

Practice positions are saved the same way, together with the practice bankroll in `paperBalance`, because a
practice trade was paid for out of that bankroll: restoring one without the other would show a Profit / Loss
figure that no balance on the card could explain. Start restores the rows belonging to the desk that is
running - a practice position when the app is in Practice Mode, a real one when it is in Real Money - and a
practice row is restored without asking the chain about a token it never had. Rows belonging to the other desk
are left on disk untouched, so switching mode cannot delete the record of coins still in the wallet. Both
`openPositions` and `paperBalance` are the engine's own records on disk; the settings form cannot write either.

## The bump desk

A second, independent desk in the same process, with the same wallet, settings and RPC pool but its own keys and its own
loop (`src/bump.js`):

```
Settings (bump*)  ──┐
                    ├─►  schedule (pace + jitter)  ──►  trade door (pump portal)  ──►  assertSwapTx  ──►  sign (pool key)
pool keys (sealed) ─┘            │                       builds the transaction        refuses anything      broadcast
                                 │                                                      that is not ours
                                 └─►  per-wallet budget: rent + two fees are never spent
```

- The schedule picks due sells first, then buys, keeping the configured buy share. Amounts are drawn from the band to the
  lamport and the tip is jittered, so no two transactions carry the same numbers.
- Every transaction is built by the trade door for **that pool wallet** and inspected by `assertSwapTx` before the key
  touches it; funding and sweeping are built here and inspected by `guardFunding` / `guardSweep`.
- Nothing about it is persisted in settings: only the numbers are. The keys live in `bump-wallets.json`, sealed with the
  wallet password through the same `secretbox` module, and there is no channel that exports one.

## Failure handling

- RPC: pool of nodes, health scored, cooling down on errors, rotation on refusal. Every call carries a
  total budget, so eight nodes timing out one after another can never hold an exit for a minute
- Market data: errors are counted and retried quietly, a failed door never stops the loop
- Feed: reconnect with backoff, and a fallback chain from PumpDev to PumpPortal
- Trades: a rejection is answered by one order through the backup route, then the coin is skipped and
  marked with the reason; an order that may have landed is never retried
