# 1.0.1 audit and validation

Date: 2026-11-05. Baseline: cf2b157. Scope: local PillCrewSniper repository, main/preload boundary, trading and wallet modules, renderer, tests, packaging configuration and documentation. Assets were inventoried; historical screenshots were retained. This is a source review and regression pass, not a formal security audit or a complete proof of every path.

## Changes

1. Practice cash now subtracts the exit fee, matching realized PnL. Slippage includes estimated depth impact or a missing-depth penalty. Advanced settings expose delayed fills, seeded failures and slippage assumptions. Paper fees include a base network fee and the configured Jito tip when enabled.
2. Sale reconciliation uses sellSig instead of the buy signature. Transaction deltas are requested at confirmed/finalized commitment; failed transactions cannot become proceeds. History preserves its basis and measured/estimated label and rerenders after a correction.
3. Unknown buys/sells retain their signatures and survive saved-position recovery. A pending sale is checked rather than replaced with a newly signed order. Removed the race between independent primary and backup sell transactions. RPC fan-out still sends identical signed bytes.
4. Fallback buys must pass the original price gate. Jupiter submission errors retain an uncertain outcome instead of inheriting a safe-to-retry build error. Successful partial fills are reconciled with token balances rather than retried as failures.
5. IPC checks the originating window, main frame and entry URL. Transaction inspection now limits compute fees and aggregate cleanup transfers and rejects unexpected top-level system operations. Primary swaps reject burns. Wallet imports reject out-of-range JSON bytes; withdrawals reject non-finite/sub-lamport amounts and concurrent requests. Reset failures are reported.
6. Added bounded on-chain mint authority checks before real entries. Missing risk data blocks the entry. Simple mode also rejects reported mint/freeze risk. Live scoring requires a known creator and fresh wallet-level trades instead of estimating distinct wallets from market transaction counts.
7. Settings writes commit in-memory changes after the disk rename succeeds. Invalid settings documents are reported. Startup no longer deletes a saved Jupiter key. RPC broadcast handles synchronous node errors and reports observed request latency.
8. Added dependency-free recorded-signal replay, delayed observation-based fills, failed-order fees and basic performance metrics. See BACKTESTING.md for the input format and model limitations.
9. High capital keeps the existing aggressive profile ID, with two positions, four buys/min, five-second minimum age, an 8% estimated cost ceiling and advanced checks. It never changes the ticket or mode and has not been optimized for profit.
10. Removed 725 lines of long narrative comments from the main process, engine, market client and renderer. Replaced outdated README/build/security claims with current behavior. Existing trading functions, wallet encryption, recovery and feed routes were retained.
11. Added opt-in local JSONL recording with bounded write buffering and a 50 MB cap. No trader addresses or private keys are recorded. Added optional deterministic order-flow/liquidity exits, off by default, with stale-data tests. The dashboard shows observed RPC request latency and recent-exit drawdown/profit factor. Added narrower-window layout rules..

## Dependencies

Updated Electron from 33.x to 45.2.1, electron-builder from 25.x to 26.18.1, web3.js pinned to 1.98.4, with rpc-websockets 9.3.10 and jayson 5.0.0 overrides. Node 22+ is required.

The initial npm audit reported 23 findings: 1 critical, 13 high and 9 moderate. The updated full tree reported 6 moderate findings and no high/critical findings. npm audit --omit=dev reported zero findings. The remaining reports are in the packaging dependency chain (minimatch, @electron/universal, app-builder-lib, dmg-builder, electron-builder and electron-builder-squirrel-windows). Audit counts are advisory database snapshots, not a guarantee of safety. rpc-websockets remains deprecated upstream.

## Validation

The original 11 test scripts passed before changes. Updated regression scripts and the new audit regression suite cover cash/PnL consistency, aggregate transfers, excessive compute fees, IPC identity, failed writes, mint authority checks, unknown-sale deduplication, wallet amounts and deterministic replay. Final run results are recorded below after verification in the actual project folder.

On Windows, Electron 45.2.3 failed to load both the dashboard and a minimal page (ERR_FAILED). Electron 45.2.1 passed the same smoke test from the project folder, including the real preload, trusted IPC and settings navigation. The source application was launched with npm start. This release was tested from source. The older unpacked executable predates the fix.

## Limits and release blockers

- No real-money trades, wallet import/export of the user's keys, withdrawals or mainnet dry runs were performed. Router/API compatibility and fill quality have not been established with funded orders.
- Measured exit proceeds do not make the entire position an exact cash-flow ledger: entry costs, returned rent, failed orders and partial fills can still use estimates. Live equity marks are estimates. A full durable per-signature ledger remains work to do.
- An uncertain transaction can stay pending indefinitely if the RPC never supplies a definite status. Automatic replacement on expiry is deliberately not inferred from a missing status; inspect its signature before any external replacement.
- Restart recovery is improved but does not reproduce every possible crash timing. Wallet withdrawal uncertainty is still reported for manual reconciliation.
- HTTP timeout coverage was improved for Jito and Incinerator response bodies. Other clients still need comprehensive streamed-body size/deadline enforcement.
- The engine remains large. Risk checks, IPC checks and simulation/replay are separate modules; a complete discovery/strategy/execution/ledger split is not included.
- No Geyser/gRPC or ShredStream implementation, creator-history database, related-wallet clustering or trained adaptive-exit model was added. These need infrastructure, data and dedicated integration tests.
- No historical market recording was supplied. Replay accepts recorded signals and does not reconstruct live discovery/scoring, partial exits or all exit rules. It is not a profitability backtest of the complete bot.
- No macOS/Linux build or funded execution benchmark was run. Competitor READMEs were inspected, not benchmarked. [Chainstack](https://github.com/chainstacklabs/pumpfun-bonkfun-bot) and [Dexoryn](https://github.com/dexoryn-solana/pumpfun-sniper-bot) describe lower-level feed paths that this release does not implement; no superiority claim is supported.

The backup beside the original project includes source and Git history; reproducible node_modules and dist were excluded. The update does not alter the user's app-data wallet or settings and does not enable live mode.
