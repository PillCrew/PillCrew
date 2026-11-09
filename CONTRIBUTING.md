# Contributing

PillCrew Sniper is open source (MIT). The notes below are for anyone who wants to work on it.

## Ground rules

- Money paths come first. A change that can spend or lose SOL needs a test that fails without it.
- Never commit a wallet, a settings file or an API key.
- Keep the renderer dumb. It may ask the main process for data and for actions; it may never decide
  anything about a trade.
- Comments explain a reason, not an instruction. If the code already says what it does, the comment is
  noise.

## Workflow

```
npm ci        # exactly the versions in the lockfile
npm test      # 13 node suites
npm run test:ui
npm start
```

Installing on each system, and every common error, is covered in [docs/INSTALL.md](docs/INSTALL.md). Packaging is in
[docs/BUILD.md](docs/BUILD.md).

Before a release:

1. `npm test` is green.
2. The app starts, wallet flows work, Practice Mode runs for a few minutes with no console errors.
3. `CHANGELOG.md` has an entry for the new version.
4. `package.json` version is bumped.

## Code layout

`src/engine.js` holds every trading decision, `src/market.js` finds and prices coins, `src/rpc.js` keeps
the endpoint pool healthy, `src/wallet.js` owns the key, `src/txguard.js` inspects any transaction the app
did not build itself. New behaviour belongs in the module that already owns that concern, not in a new
file unless it is genuinely a new concern.

## Style

Plain CommonJS, two space indent, single quotes, semicolons. Function names describe the action. Log
lines are sentences a user can act on, not codes.
