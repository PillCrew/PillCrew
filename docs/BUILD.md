# Build, package and release

How to go from a clone to an installer on Windows, macOS and Linux, and what has to be true before a release is
published. Installing a finished build is covered in [INSTALL.md](INSTALL.md).

## What you need

| | Windows | macOS | Linux |
| --- | --- | --- | --- |
| Node.js | 22+ (`winget install OpenJS.NodeJS.LTS`) | 22+ (`brew install node@22`) | 22+ (NodeSource, nvm, or a distribution package) |
| Native toolchain | not needed | not needed | not needed |
| Extra for packaging | — | Xcode Command Line Tools are **not** required | FUSE 2 only to *run* an AppImage |

The app has **no native modules**, so `npm ci` never compiles anything. Electron is pinned to 45.2.1 and
electron-builder to 26.18.1; packaging output goes to `dist/` and is ignored by Git.

## Get a working checkout

```sh
npm ci
npm test          # 13 node suites, stubbed network, no wallet, no real money
npm run test:ui   # Electron: hidden window, mock wallet, engine stopped
npm start         # Practice Mode
```

`npm ci` runs `scripts/vendor.js` after install, which copies three.js into `renderer/vendor/` (generated, ignored by
Git) and is re-run by `prestart` and `predist`.

The packaging commands deliberately use `--publish never`: they build files locally and never upload anything.

## Build the installers

Build each target **on its own operating system**.

### Windows

```powershell
npm run dist:win
```

Produces:

```
dist/PillCrew-<version>-win-x64.exe           NSIS installer, per-user, one click
dist/PillCrew-<version>-win-x64.exe.blockmap  delta-update metadata
dist/latest.yml                                      version manifest
dist/win-unpacked/                                   the unpacked app (useful for smoke tests)
```

The installer needs no administrator rights: it installs to `%LOCALAPPDATA%\Programs\PillCrew`, adds a
Start-menu entry, and keeps `%APPDATA%\PillCrew` (wallet and settings) on uninstall.

Smoke-test a packaged build without touching your own profile:

```powershell
.\dist\win-unpacked\PillCrew.exe --user-data-dir="$env:TEMP\pc-smoke"
```

### macOS

```sh
npm run dist:mac -- --universal
```

Produces `dist/PillCrew-<version>-mac-universal.dmg`: Intel and Apple silicon in one bundle (`--arm64` or `--x64`
alone makes a single-architecture build). A Mac bundle cannot be produced or signed from Windows or Linux — that is an
Apple requirement, not an electron-builder one. The CI builds this on a macOS runner for every version tag.

An unsigned `.dmg` triggers Gatekeeper on first launch; that is expected for a build without a Developer ID. Users
clear it with a right-click → Open, or:

```sh
xattr -dr com.apple.quarantine "/Applications/PillCrew.app"
```

### Linux

```sh
npm run dist:linux
```

Produces `dist/PillCrew-<version>-linux-x86_64.AppImage` and `dist/PillCrew-<version>-linux-amd64.deb`.
The `.deb` declares its runtime dependencies; `apt install ./file.deb` pulls them, `dpkg -i` does not.

## Code signing

Unsigned is fine for testing and for an open-source download, and every unsigned build shows one warning on first
launch. Signing removes it.

| Platform | How |
| --- | --- |
| Windows | electron-builder picks up a code-signing certificate from `CSC_LINK` (a `.pfx` path or base64) and `CSC_KEY_PASSWORD`. EV certificates also clear SmartScreen reputation faster |
| macOS | Set `CSC_LINK`, `CSC_KEY_PASSWORD` and `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` so electron-builder signs and notarizes; `CSC_IDENTITY_AUTO_DISCOVERY=false` disables signing entirely |
| Linux | Packages are not signed by default; publish a SHA-256 checksum next to the files |

Never commit a certificate or a password. The CI `package` job (manual `workflow_dispatch`) builds all three targets
with `CSC_IDENTITY_AUTO_DISCOVERY: false` and uploads them as artifacts — it is a build check, not a release.

## Release checklist

1. `npm test` green and `npm run test:ui` green on a clean clone.
2. Version bumped in `package.json` **and** `package-lock.json` (both places), with a `CHANGELOG.md` section written.
3. The app starts, wallet flows work, Practice Mode runs for a few minutes with no console errors.
4. `npm run dist:<os>` on each system; smoke-test the packaged binary with a throwaway `--user-data-dir`.
5. Tag `v<version>` and push it. The CI builds Windows, Linux and a universal macOS installer on real runners and puts
   all four files on a **draft** release with generated notes — nothing reaches a user until you read that draft and
   press **Publish**. Paste the changelog section into the notes before publishing; the generated notes list commits,
   not consequences.
6. Say what changed in plain words — including anything that got slower, louder, or was not fixed.

## Notes that save an afternoon

- **Overrides stay.** `rpc-websockets@9.3.10` and `jayson@5.0.0` in `overrides` keep the current web3.js client off an
  older uuid/stream-json chain. Review them when updating dependencies and run the suites afterwards.
- **Optional native WebSocket speed-ups** (`utf-8-validate`, `bufferutil`) are excluded from the packaged app on
  purpose, and `npmRebuild` is off. Keep both unless you add a verified native build pipeline.
- **Node version matters.** `engines: node >= 22` is enforced softly by npm; a Node 20 machine installs and then fails
  at runtime on syntax the app uses.
- **A successful package build says nothing about trading.** It proves the files are complete and the bundle launches.
  Money paths are proven by `test/` and by Practice Mode, not by an installer.

See also: [INSTALL.md](INSTALL.md) · [SETTINGS.md](SETTINGS.md) · [ARCHITECTURE.md](ARCHITECTURE.md) ·
[CHANGELOG.md](../CHANGELOG.md) · [SECURITY.md](../SECURITY.md)
