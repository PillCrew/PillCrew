# Install and run

This page is the exact, copy-paste guide for Windows, macOS and Linux. If you only want the short version, the
[README](../README.md) has it.

Two ways to get the app:

| | Who it is for | What you need |
| --- | --- | --- |
| **A · Installer** (recommended) | Traders. Nothing to build. | The file for your system, ~120 MB |
| **B · From source** | Anyone who wants to read the code, change it, or run the tests | Node.js 22 or newer |

Both run the same program. The app keeps **everything on your computer**: no account, no server, no subscription.
Your wallet key is encrypted with a password you choose and never leaves the machine.

> **No release published yet?** Route B works on all three systems and needs nothing but Node.js. Building the
> installer yourself takes one command on the matching system — see [BUILD.md](BUILD.md).

---

## Windows 10 / 11 (x64)

### A · Installer

1. Download `PillCrew-<version>-win-x64.exe` from the releases page of this repository.
2. Double-click it. It installs **for your user only** — no administrator rights, no UAC prompt — into
   `%LOCALAPPDATA%\Programs\PillCrew` and adds a Start-menu entry called **PillCrew**.
3. Windows SmartScreen will say *"Windows protected your PC"* for an unsigned build. Choose **More info**, then
   **Run anyway**. The build is not code-signed yet, and SmartScreen treats every unsigned installer that way. If you
   would rather not trust a binary, use option B — the source is the same code and you build it yourself.
4. Start **PillCrew** from the Start menu.

### B · From source

1. Install Node.js 22 or newer: `winget install OpenJS.NodeJS.LTS`, or the MSI from [nodejs.org](https://nodejs.org/).
2. Open **PowerShell** in the folder you cloned the repository into:
   ```powershell
   node -v          # must print v22.x or newer
   npm ci           # exactly the versions in the lockfile, plus three.js into renderer/vendor
   npm start
   ```
3. The window opens in **Practice Mode**. `npm ci` downloads Electron once (~100 MB), so the first run takes a few
   minutes.

### Where your data lives

`%APPDATA%\PillCrew` — `settings.json`, `wallet.json` and `logs\pillcrew-YYYY-MM-DD.log`.

### Uninstall

Settings → Apps → **PillCrew** → Uninstall. Your `%APPDATA%\PillCrew` folder is deliberately kept, so a
reinstall finds your wallet again. Delete that folder yourself to wipe everything — **back up the private key first**,
there is no recovery without it.

---

## macOS 12 or newer (Apple silicon and Intel)

### A · Installer

1. Download `PillCrew-<version>-mac-universal.dmg` — one file that runs on Apple silicon and on Intel Macs.
2. Open the `.dmg` and drag **PillCrew** into **Applications**.
3. The build is not notarized, so Gatekeeper blocks the first launch. Either **right-click the app → Open → Open**, or
   clear the quarantine flag once:
   ```sh
   xattr -dr com.apple.quarantine "/Applications/PillCrew.app"
   ```
4. Launch it from Applications or Spotlight.

The `.dmg` has to be built **on a Mac** — electron-builder cannot produce or sign a Mac bundle from Windows or Linux.
See [BUILD.md](BUILD.md).

### B · From source

1. Install Node.js 22 or newer — `brew install node@22` or the pkg from [nodejs.org](https://nodejs.org/). No Xcode
   Command Line Tools are needed: the app has **no native modules** to compile.
2. In Terminal, inside the cloned repository:
   ```sh
   node -v          # must print v22.x or newer
   npm ci
   npm start
   ```

### Where your data lives

`~/Library/Application Support/PillCrew` — `settings.json`, `wallet.json`, `logs/`.

### Uninstall

Drag **PillCrew** from Applications to the Bin, then remove the data folder:
```sh
rm -rf "$HOME/Library/Application Support/PillCrew"
```
That deletes the wallet file. Back up the private key before you do.

---

## Linux (x64, glibc distributions)

### A · AppImage — works on any distribution

1. Download `PillCrew-<version>-linux-x86_64.AppImage`.
2. Make it executable and run it:
   ```sh
   chmod +x PillCrew-*.AppImage
   ./PillCrew-*.AppImage
   ```
3. If it fails with *"dlopen(): error loading libfuse.so.2"*, install FUSE 2 once:

   | Distribution | Command |
   | --- | --- |
   | Ubuntu 24.04+ / Debian 13+ | `sudo apt install libfuse2t64` |
   | Ubuntu 22.04 / Debian 12 | `sudo apt install libfuse2` |
   | Fedora | `sudo dnf install fuse-libs` |
   | Arch | `sudo pacman -S fuse2` |

   Or skip FUSE entirely: `./PillCrew-*.AppImage --appimage-extract-and-run`.

### B · Debian / Ubuntu package

```sh
sudo apt install ./PillCrew-*.deb
pillcrew
```
(`apt install ./file.deb` pulls the dependencies for you; `dpkg -i` does not. The Debian package is named
`…-linux-amd64.deb`, the AppImage `…-linux-x86_64.AppImage`.)

### C · From source

1. Node.js 22 or newer. Distributions often ship older versions, so use NodeSource or nvm:
   ```sh
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt install -y nodejs
   ```
2. In the cloned repository:
   ```sh
   node -v          # must print v22.x or newer
   npm ci
   npm start
   ```
3. If Chromium refuses to start with *"The SUID sandbox helper binary was found, but is not configured
   correctly"*, either fix the helper once:
   ```sh
   sudo chown root:root node_modules/electron/dist/chrome-sandbox
   sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
   ```
   or start it unsandboxed for your own user only: `npm start -- --no-sandbox`. The second option weakens the
   renderer sandbox — prefer the first. The packaged AppImage and `.deb` set this up for you.

### Wayland and fractional scaling

Electron runs through XWayland by default. On a fractionally scaled display, start with
`npm start -- --ozone-platform-hint=auto --enable-features=WaylandWindowDecorations` (or the same flags after the
AppImage path). If the window is blurred at 125 %/150 % scaling, `--force-device-scale-factor=1` is the quick way out.

### Where your data lives

`~/.config/PillCrew` — `settings.json`, `wallet.json`, `logs/`.

### Uninstall

```sh
# AppImage: just delete the file
rm ~/PillCrew-*.AppImage

# deb
sudo apt remove pillcrew

# and the data (this deletes the wallet file)
rm -rf "$HOME/.config/PillCrew"
```

---

## First run — five steps

1. The app opens in **Practice Mode** with 5.000 fake SOL. Press **Start Bot** and watch for a few minutes; nothing
   real is at risk.
2. **Wallet → Create your wallet.** Choose a password (8+ characters). It encrypts `wallet.json` on this computer.
3. **Export the private key and store it offline.** If you lose both the password and the key, the funds are gone —
   nobody can recover them, including us.
4. Deposit a **small** amount of SOL to the address shown, switch to **Real Money**, and keep the ticket small until
   you have watched real exits land.
5. Optional: **Settings → Your own keys** for a private RPC, PumpDev, Jupiter or Sol Incinerator. The app works
   without them; a private RPC is the single biggest speed-up.

---

## Verify your checkout

Run these from the repository folder. They are the same commands CI runs on Windows and Linux for every push:

```sh
npm test          # 13 suites: RPC pool, chain feed, engine, market, exits, guards, wallet, settings sharing, Jito, curve, copy trading, audit
npm run test:ui   # opens a hidden window with a mock wallet and a stopped engine
npm run backtest -- events.jsonl settings.json   # optional: replay a recorded session
```

A healthy `npm test` ends with `Audit regression tests passed`. Nothing in the suite touches your wallet or real money,
and the market, Jito and RPC calls are stubbed. The separate `test/live-dryrun.js` script does reach the network and
needs a wallet password; it is never part of the suite.

---

## Troubleshooting

| What you see | Why | What to do |
| --- | --- | --- |
| `npm ci` fails with *"can only install packages when your package.json and package-lock.json are in sync"* | An older lockfile, or a hand-edited `package.json` | `npm install` once, then `npm ci` again; or use a prebuilt installer |
| `Unsupported engine` / syntax errors on start | Node older than 22 | Install Node 22+ (`node -v`) |
| SmartScreen / *"Windows protected your PC"* | The installer is unsigned | More info → Run anyway, or build from source |
| *"PillCrew is damaged"* on macOS | Quarantine on an unsigned app | `xattr -dr com.apple.quarantine "/Applications/PillCrew.app"` |
| *"dlopen(): error loading libfuse.so.2"* | AppImage without FUSE 2 | Install `libfuse2`/`libfuse2t64`, or use `--appimage-extract-and-run` |
| *"SUID sandbox helper binary"* on Linux | Source checkout, sandbox helper not set up | See the `chrome-sandbox` commands above |
| Window is blank / does not open | A renderer failure, logged to disk | Read `logs/pillcrew-YYYY-MM-DD.log` in your data folder |
| Everything works but the desk feels slow, or misses moves | The feed may be on public nodes — a provider socket without its key answers 401 and gets skipped | Settings → **Test my connection**: it opens each address once and says what it answered, then fix what is marked ✕ |
| The bot buys nothing | The entry bar is doing its job — free slots are not a bug | The Activity log counts the reasons once a minute (`needs N buyers`, `market cap out of range`) |
| *"Live entries are blocked: the on-chain mint check cannot be answered"* | The node cannot answer the safety check | Try another RPC in Settings; nothing is bought with real money until it answers |

More: [settings reference](SETTINGS.md) · [architecture](ARCHITECTURE.md) · [backtesting](BACKTESTING.md) ·
[security policy](../SECURITY.md) · [build and release](BUILD.md)
