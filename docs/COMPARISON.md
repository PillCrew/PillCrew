# How PillCrew compares

The honest version, because a comparison nobody can check is marketing.

**How to read this.** Every row marked ✅ for **PillCrew** was verified in this repository (the file that does it is
named). Cells for other projects come from **their own documentation** on the date below — they were not installed,
run, benchmarked or audited here. If a project documents nothing about a row, it is marked `—`, which means "not
stated", not "cannot".

Checked against the public READMEs on **2026-11-06**: Chainstack `pumpfun-bonkfun-bot`, Dexoryn
`pumpfun-sniper-bot`, M8S `solana-sniping-bot`, Dorado `solana-pumpfun-sniper-bot`, Ferris
`solana-pumpfun-bonk-sniper-bot`, AllenHark `PumpFun-Sniper`.

## The short answer

- **As a product, we are ahead of everything on that list.** We are the only one that is a desktop application with a
  wallet inside it, a visible scoring of every coin, a Practice Mode that costs nothing, presets you can undo, and a
  test suite plus CI that runs on every push. The others are scripts with a `.env` file and a log to read.
- **As a pure latency play, we are not the fastest, and the README says so.** Geyser gRPC and Jito ShredStream see
  transactions earlier than the public `logsSubscribe` stream we decode. Chainstack's own README puts it best: shreds
  arrive *pre-execution*. We cannot honestly claim to beat that without an endpoint to prove it on.
- **Nobody on that list has a verified profitability figure**, and neither do we. Anyone who says otherwise is
  selling something.

## Capability by capability

| | PillCrew | Chainstack | Dexoryn | M8S | Dorado | Ferris | AllenHark |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Desktop app with a UI | ✅ `renderer/` | — | — | — | — | — | — |
| Wallet created and encrypted inside the app | ✅ `src/wallet.js` | — | — | — | — | — | — |
| Practice Mode (fake SOL, real market) | ✅ `src/engine.js` | — | — | — | ✅ paper trading stated | — | — |
| One-press presets + shareable settings code | ✅ `src/share.js` | — | — | — | — | — | — |
| Bring your own RPC / backup RPC / WS | ✅ `src/rpc.js`, `src/chain.js` | ✅ `.env` endpoints | ✅ | ✅ | ✅ | ✅ | ✅ |
| Program-log WebSocket decoding | ✅ `src/chain.js` | ✅ `logs` listener | — | — | — | — | — |
| PumpPortal feed | ✅ `src/engine.js` (`feedSource: pumpportal`) | — | — | — | — | — | — |
| Geyser / Yellowstone gRPC | ⚠️ a Geyser-class **WebSocket** stream (`transactionSubscribe`, `src/chain.js`), not the binary gRPC client | ✅ `geyser` listener | — | — | — | — | — |
| Jito ShredStream (pre-execution) | ❌ (we have Jito **bundles** for sending, `src/jito.js`) | ✅ `shreds` listener | ✅ ShredStream + bundles | — | — | — | ✅ ShredStream |
| pump.fun bonding curve trading | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| PumpSwap after graduation | ✅ | ✅ | ✅ | ✅ | — | ✅ | — |
| Raydium / Meteora | ❌ | — | — | ✅ Raydium | — | ✅ both | — |
| Copy trading (follow a wallet) | ✅ `src/engine.js` (`copyWallets`) | — | — | — | ✅ stated | — | — |
| Take profit / stop loss | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Trailing stop / peak give-back / break-even | ✅ | — | — | — | ✅ trailing stop | — | — |
| Position, pace and session-loss limits | ✅ | — | — | — | — | — | — |
| Mint/freeze authority check before a live buy | ✅ `src/risk.js` | — | — | — | — | — | — |
| Transaction inspection before signing | ✅ `src/txguard.js` | — | — | — | — | — | — |
| One signed transaction to several RPCs | ✅ `src/rpc.js` | — | — | — | — | — | — |
| Rent recovery from empty token accounts | ✅ `src/reclaim.js` | ✅ cleanup | — | — | — | — | — |
| Recorded-session replay / backtest | ✅ `src/backtest.js`, `src/simulation.js` | — | — | — | — | — | — |
| Tests + CI on every push | ✅ 13 node suites + Electron UI, Windows **and** Linux | — | — | — | — | — | — |
| Installers for Windows, macOS, Linux | ✅ `docs/BUILD.md` | — | — | — | — | — | — |
| Its own README says "not for production" | — (we ship it as a product, with limits stated) | ✅ says exactly that | — | — | — | — | — |

`—` = not stated in that project's documentation. It is not a claim that the feature is missing.

## Where we lose, plainly

1. **Data latency, narrowed but not closed.** A Geyser-class endpoint is now a first-class feed (`geyserUrl` in Settings,
   `transactionSubscribe`, `src/chain.js`): the provider streams each transaction with its logs, so a launch is seen
   sooner than on the public program-log feed, and the decoder is the same one either way. What we still do not have is
   the **binary Yellowstone gRPC client** and **Jito ShredStream** (pre-execution data); ShredStream needs their proxy
   agent, which is not something a signed desktop app can ship. So: we are no longer the slowest door in this table, and
   we are not the fastest either.
2. **Raydium and Meteora.** We trade pump.fun curves and PumpSwap pools. A coin that migrates to Raydium left our
   market.
3. **Copy trading has a narrower promise than Dorado's.** We follow a wallet's *buys* and manage the exit ourselves; a
   bot that mirrors somebody's sells hands the one decision that keeps a winner to a stranger.
4. **Language of the market.** Two of those projects are Rust with a shred stream in front; our whole path is Node.js.
   Ours is fast enough for a UI-driven bot (the numbers are in [SETTINGS.md](SETTINGS.md)), it is not a Rust shred
   consumer and will not pretend to be.

## What we would add next

In the order that would actually pay for itself:

1. **The binary Yellowstone gRPC client** behind the same `geyserUrl` setting, so a provider that exposes only the gRPC
   port can be used as well as one that exposes the transaction stream. Needs an endpoint to prove, and a pure-JS
   transport: the current client ships native binaries for macOS and Linux only, and a Windows build that cannot load it
   is worse than no client at all.
2. **Post-migration trading** (Raydium CPMM / AMM and Meteora): the exits and the guards are already market-agnostic,
   the work is the pool math and the account layouts.
3. **Jito ShredStream** through a local proxy agent, if a proxy can be shipped in a way a desktop installer can manage.
4. **Alerts** (desktop notification when a position opens or closes) and a second submission route beside Jito.

Nothing above is a promise of profit.
