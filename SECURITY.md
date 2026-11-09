# Security policy

Report vulnerabilities through a private GitHub security advisory. Include the affected version, operating system, impact and a minimal reproduction. Do not include real wallet keys.

## Controls

- Wallet files use AES-256-GCM with a random salt and nonce and a scrypt-derived key. Files are written beside the destination and renamed. Unreadable wallets cannot be replaced through the normal create/import path.
- An unlocked wallet keeps its keypair in the main process until locked. Exporting a key intentionally returns it to the renderer after password verification. This is not hardware-wallet isolation or guaranteed memory erasure.
- The renderer uses context isolation, the Chromium sandbox, no Node integration and a restrictive Content Security Policy. IPC requests must come from the application's own main frame and window.
- Foreign transactions are checked for payer/signers, top-level authority changes, SOL allowances and compute-fee budgets. Cleanup SOL transfers are limited in aggregate. Unresolved program IDs are rejected.
- Real entries require fresh wallet-level evidence and a known creator. An on-chain mint check rejects active mint/freeze authorities, unknown data and unreviewed Token-2022 extensions.
- Concurrent withdrawals are blocked. RPC failover rebroadcasts the same signed bytes. Unknown trade outcomes are retained by signature; competing signed sell orders are not raced.
- Settings are persisted before a successful write changes the in-memory store.

## Trust boundaries and limits

Transaction inspection is not a formal verification of nested program invocations, every token extension or economic output. An allowed program can invoke another program. The current guards do not prove that a swap delivers a particular token quantity. Only use trusted builders and small, separately funded trading wallets.

RPCs and market services can lie, lag, disconnect or censor. Creator identity, single-wallet concentration and mint authority checks do not identify all related-wallet clusters, creator history, wash trades or rug mechanisms. Stops and reserves cannot create liquidity or guarantee execution.

API keys remain in the local settings file in clear text. A process running as the same OS user can read files or attack the wallet password offline. Password checks use synchronous scrypt and can briefly block the main process. No external security audit has been completed.

See the release audit for the exact dependency audit result and unverified paths. Supported fixes target the latest release.
