```text
██████╗ ██╗██╗     ██╗      ██████╗██████╗ ███████╗██╗    ██╗
██╔══██╗██║██║     ██║     ██╔════╝██╔══██╗██╔════╝██║    ██║
██████╔╝██║██║     ██║     ██║     ██████╔╝█████╗  ██║ █╗ ██║
██╔═══╝ ██║██║     ██║     ██║     ██╔══██╗██╔══╝  ██║███╗██║
██║     ██║███████╗███████╗╚██████╗██║  ██║███████╗╚███╔███╔╝
╚═╝     ╚═╝╚══════╝╚══════╝ ╚═════╝╚═╝  ╚═╝╚══════╝ ╚══╝╚══╝
```

<div align="center">

# PillCrew

**A trading desk staffed by ten AI specialists. Not one bot. A crew.**

Live market intelligence · Crew verdicts · Smart alerts · Instant analysis

[![pillcrew.fun](https://img.shields.io/website?url=https%3A%2F%2Fpillcrew.fun&label=pillcrew.fun&style=flat-square&color=4caf50)](https://pillcrew.fun)
[![License](https://img.shields.io/badge/License-MIT-4caf50?style=flat-square)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-Welcome-4caf50?style=flat-square)](CONTRIBUTING.md)

</div>

---

## Overview

PillCrew is a free web platform that gives you a **team of ten specialized AI
agents** for analyzing Solana memecoins. Paste any token and receive instant
analysis in the style of each agent, from aggressive momentum calls to
rigorous risk management, all backed by live market data that refreshes in
real time across the entire application.

> **Disclaimer:** PillCrew is a beta product for entertainment and education
> only. It does not provide financial advice (NFA). Memecoins are highly
> volatile; never invest more than you can afford to lose.

---

## Why PillCrew is different

Most tools give you one bot. PillCrew gives you a **crew** with opinions,
and makes them argue in public.

- **A crew, not a single bot.** Ten agents with different risk profiles look
  at the same coin and disagree. You hear the bull case and the bear case.
- **Live data everywhere.** Prices, market caps, volumes and multi-timeframe
  moves refresh continuously on every screen, not just the chart.
- **Crew Verdict.** The whole crew scans the trending coins and commits to
  exactly one winner, with a real entry / stop / target plan.
- **Zero friction.** No account, no wallet, no sign-up. Open the site, paste a
  token, start analyzing.
- **Squad mode and War Room.** Pit two agents against each other, or throw all
  four into the room and watch them fight over your coin.

---

## The crew

| Agent | Callsign | Risk profile |
| --- | --- | --- |
| Max Rocket | The Degen | High risk, momentum first |
| Dr. Delta | The Analyst | Data-driven, structure and timing |
| Chad Bullington | The Bull | Maximalist upside |
| Prof. HODL | The Risk Manager | Capital preservation, stops |
| Whale Wanda | The Whale Tracker | Follows the biggest wallets |
| Skeptic Sam | The Bear | Red flags and devil's advocate |
| Meme Alchemist | The Memelord | Culture, virality, narrative |
| Quant Quinn | The Quant | Numbers-based setup scoring |
| Sniper Steve | The Sniper | Precision entries and exits |
| News Nora | The News Scanner | Catalysts and headlines |

Full roster and personalities: [docs/AGENTS.md](docs/AGENTS.md)

---

## A verdict looks like this

Crew Verdict is the signature feature. When the crew runs, three agents state
their case, then the crew commits to one winner with a plan:

```text
Max Rocket: PANTS has the freshest 6h momentum on the board (+616%) with $3.1M
             volume against $87K liquidity. That is real buying, not noise.
Dr. Delta:  Cleanest tape in the scan. 1h still accelerating (+18.7%) while the
             runners-up fade. A 35x volume/liquidity ratio is conviction.
Prof. HODL: Passes every risk gate. Real liquidity depth, no mint/freeze red
             flags, no bot-churn volume.

THE CREW VERDICT: The standout is PANTS. It clears every risk check with real
liquidity ($87K) and volume ($3.1M), beats EAGLE on fresh momentum (1h +18.7%
vs +3.2%), and edges GOAT on pool depth (its $22.5K pool is a slip-and-die trap).
Entry $0.0011 | Stop $0.00095 | Target $0.0016 | Horizon 2-6h
Invalidation: under $0.0010. Biggest risk: +616% in 6h invites profit-taking,
so respect the stop.

NFA - dyor, size small. Memecoins are volatile.
PICK: PANTS
```

Every verdict is one-click shareable to X, with the coin's contract address and
live stats attached.

---

## Screenshots

| | |
| --- | --- |
| ![Trending on Solana](assets/trending.png) | ![Chat with an agent](assets/chat.png) |
| ![Live callouts](assets/callouts.png) | ![Watchlist](assets/watchlist.png) |
| ![Docs](assets/docs.png) | |

---

## 🫧 Pilly Desktop - the app that lives in your taskbar

Pilly is a **standalone desktop app** (Windows) for the same PillCrew
philosophy - but it sits quietly in your **system tray** as a little animated
pill, ready on one hotkey. No browser tabs, no alt-tabbing. Paste a Solana
token address, get a live read, meme it, roast it, or just talk.

| | |
| --- | --- |
| ![Pilly chat](assets/pilly-chat.png) | ![Pilly coin analysis](assets/pilly-coin.png) |
| ![Pilly settings](assets/pilly-settings.png) | ![Pilly icon](assets/pilly-app.png) |

### What it does

- **Lives in the system tray** with an animated pill icon (3-frame blink) and
  a global hotkey (**Ctrl+Shift+P**) that summons the window from anywhere.
- **Live Solana coin checks** - paste a token address or a `pump.fun` link and
  Pilly pulls live price, market cap, volume, liquidity, age, buy/sell counts
  and an organic-score read from the public pump.fun / DexScreener / Jupiter
  APIs.
- **🔥 Trending** - the top movers on Solana right now, pulled from
  GeckoTerminal's public feed, no API key needed.
- **Meme lab** - rewrite, caption, name, react to or roast any coin, in Pilly's
  voice.
- **Trained AI read** - Pilly is primed to read the tape honestly: it says
  "no tape" when there is no volume, buys small dips, trims at 10-15% and gets
  out on big reversals - no lies, no guessing.
- **Bring your own AI** - Pilly runs on **free AI tiers out of the box**, and
  you can plug in your own keys for OpenRouter, Groq, Cerebras, NVIDIA NIM,
  DeepSeek, Together, Mistral - or any OpenAI-compatible endpoint (even a local
  Ollama server). Tiers are tried in order until one answers.

### Quick start

```bash
cd pillcrew-desktop
npm install
npm start
```

Build a Windows installer with:

```bash
npm run dist
```

No API keys are required to try it - free tiers are the default, with an
optional fallback to the pillcrew.fun web API. To add your own providers, open
**⚙️ settings** in the app or edit `.env` (see
[`.env.example`](pillcrew-desktop/.env.example)).

> **No secrets live in this repo.** Real keys belong in a local `.env` (which
> is git-ignored), never in the repository.

Full docs for the desktop app: [pillcrew-desktop/README.md](pillcrew-desktop/README.md)

---

## Capabilities

### AI Agents

- **Ten specialist agents**, each with a distinct analytical style and risk profile.
- **Conversational chat** with any agent. Paste a token address or a `pump.fun` link.
- **Squad mode** - two agents debate a single setup (bull vs. bear).
- **War Room** - four agents analyze a coin in parallel.
- **Safety Score** - a transparent 0-100 risk assessment.
- **Crew Verdict** - a collective pick with configurable filters (market cap,
  coin age, minimum volume) and a complete entry / stop / target plan.

### Live Market Intelligence

- **Trending on Solana** - a real-time, sortable market table.
- **Professional charts** with an integrated swap widget on desktop and
  one-tap trading on mobile.
- **Smart alerts** - per-coin ±% alerts over 1m-24h timeframes, with live
  popups and optional push notifications.
- **Live callouts** - new launches streamed in real time, plus a trending feed.
- **Portfolio analyzer** - inspect any wallet's holdings in seconds.
- **Watchlist** - persistent coin tracking that follows you to every page.

---

## Getting Started

Visit **[pillcrew.fun](https://pillcrew.fun)** - no account, wallet, or
installation required.

| Step | Action |
| --- | --- |
| 1 | Open `pillcrew.fun` |
| 2 | Choose an agent, or open **Trending** / **Watchlist** |
| 3 | Paste a token address or a `pump.fun` link |
| 4 | Request a full analysis, rug check, price target or safety audit |

---

## Documentation

- [Product documentation](docs/) - features, usage guide and FAQ.
- [The crew roster](docs/AGENTS.md) - all ten agents, their callsigns and roles.
- [Security policy](SECURITY.md) - how to report vulnerabilities.
- [Contributing](CONTRIBUTING.md) - how to help improve the project.

---

## Scripts

Useful, dependency-free CLI tools (Node.js 18+). No keys, no accounts - they
use the same public market APIs the platform itself reads.

| Script | What it does |
| --- | --- |
| `pumpfun-launch-watch.mjs` | Streams brand-new pump.fun launches into your terminal in real time |
| `dexscreener-trending.mjs` | Prints DexScreener's Trending tab with live prices, market caps and liquidity |
| `coin-lookup.mjs` | Paste a token address or a pump.fun / dexscreener link, get a compact live snapshot |

```bash
# Top 10 trending right now
node scripts/dexscreener-trending.mjs 10

# Quick look at any coin
node scripts/coin-lookup.mjs <token-address-or-url>

# Watch new launches (min $50K market cap)
node scripts/pumpfun-launch-watch.mjs --min-mcap 50000
```

---

## Roadmap

- Mobile-native experience polish
- Multi-chain support (beyond Solana)
- Agent personality presets and custom crews
- Verdict history and backtesting
- Community leaderboards

---

## FAQ

**Is an account required?**
No. The platform works without sign-up.

**Is a wallet required?**
Only to execute swaps; all analysis is wallet-free.

**Is this financial advice?**
No. The platform is for education and entertainment only. Always conduct your
own research before trading.

---

## License

This repository is published under the [MIT License](LICENSE).

---

<div align="center">

© 2026 PillCrew · Not financial advice

</div>
