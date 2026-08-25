# 💊 Pilly Desktop

A tiny green pill AI friend that **lives in your Windows taskbar**. Click it, chat with it (free AI), and it answers like a sharp, terminally-online friend - short enough to screenshot.

Pilly is an original PillCrew character - its own persona, prompts and meme brain.

---

## ✨ What it does

- **Sits in the system tray** - a little green pill with eyes, gently bobbing.
- **One click = chat** - a small frameless window pops up right above the tray icon.
- **Free AI** - talks through your own API settings (⚙️ in the chat: paste any chat-completions endpoint and key, pick a free model with one click, test, done).
- **Live Solana data (pro)** - paste a token address or a pump.fun/jup.ag link and Pilly pulls live data from free APIs (pump.fun, DexScreener, GeckoTerminal, Jupiter intel): price, mcap, volume, liquidity, 24h change, age, buy/sell txns, organic score, verification, holder/audit flags - then gives a trained pro read (I BUY / TRIM / hold / SELL with the real numbers).
- **🔥 Trending** - one click pulls the hottest Solana coins right now with **real market caps** (GeckoTerminal + DexScreener + pump.fun) and a short rundown.
- **💼 Wallet portfolio** - paste your Solana wallet address and Pilly lists your SOL + token holdings with real prices, weighted 24h change and total value (both Token and Token-2022 accounts).
- **🐾 Taskbar pet** - Pilly walks the taskbar (or the whole monitor), pauses, hops, follows your cursor, drops jokes, asks you questions - and gets annoyed when you drag him around.
- **Meme brain** - detects what you want and switches mode (from the chips, or just by typing it - `roast me`, `caption this: …`):
  - `meme this` → rewrites your text in meme-native language
  - `caption this` → a punchy meme caption
  - `name this` → an absurd coin / token / character name
  - `react` → a short, terminally-online reaction
  - `roast` → a playful light roast
- **Short replies** - everything fits in a screenshot, never over-explains a joke.
- **Hotkey** - `Ctrl+Shift+P` summons Pilly from anywhere.
- **Start with Windows** - optional, from the tray menu.

## 🖼️ Screenshot

![Pilly](assets/pilly.png)

## 🚀 Run it

Requires **Node.js 20+**.

```bash
cd pillcrew-desktop
npm install        # also generates the tray icons
cp .env.example .env
npm start
```

### Config (`.env`)

Pilly talks to any OpenAI-compatible chat-completions API. Put one (or several
as fallbacks) in `.env`:

```
PILLY_TIER1_URL=https://...chat/completions
PILLY_TIER1_KEY=...
PILLY_TIER1_MODEL=...
PILLY_TIER2_URL=...
...
```
> 💡 Put any endpoint into `PILLY_TIER1_URL`, its key into `PILLY_TIER1_KEY` and
> its model into `PILLY_TIER1_MODEL` (most providers require one). Add more tiers
> as fallbacks - they are tried in order, cheapest/free first.

Tune with `PILLY_TEMPERATURE` and `PILLY_MAX_TOKENS`.

**Or set it all in the app** - click ⚙️ in the chat window: 3 API slots
(URL / key / model), **Find free models**, a **Test connection** button and
temperature. Saved on disk, no file edits.

### Which API for which AI (chat-completions format)

| Provider | API URL | Key from | Notes |
|---|---|---|---|
| OpenRouter | `https://openrouter.ai/api/v1/chat/completions` | openrouter.ai → Keys | One key, many models; free models end with `:free` |
| Groq | `https://api.groq.com/openai/v1/chat/completions` | console.groq.com | Very fast, free tier, generous limits |
| Cerebras | `https://api.cerebras.ai/v1/chat/completions` | cloud.cerebras.ai | Fast inference, free tier |
| NVIDIA NIM | `https://integrate.api.nvidia.com/v1/chat/completions` | build.nvidia.com | Free credits, strong open models |
| DeepSeek | `https://api.deepseek.com/chat/completions` | platform.deepseek.com | Cheap, strong reasoning |
| Together AI | `https://api.together.xyz/v1/chat/completions` | api.together.xyz | Many open models, cheap |
| Mistral | `https://api.mistral.ai/v1/chat/completions` | console.mistral.ai | Free tier available |
| Any OpenAI-compatible | `https://…/v1/chat/completions` | - | Also local: Ollama / LM Studio on `http://localhost:11434/v1` |

Auth is `Bearer <key>`. Leave Model empty if the endpoint defaults it.

## 📦 Build an installer

```bash
npm run dist
```

Outputs an NSIS installer + portable `.exe` in `dist/`.

## 🧪 Tests

```bash
npm test
```

## 🧠 How it's built

```
pillcrew-desktop/
├── main.js            # Electron: tray, window, hotkey, IPC
├── preload.js         # safe bridge to the renderer
├── src/
│   ├── ai.js          # free AI chain + short-reply clamp
│   ├── pilly.js       # Pilly's persona + meme task briefs
│   └── meme.js        # client-side request-type detection
├── renderer/          # chat window (animated pill, bubbles, chips)
├── scripts/gen-icon.js# zero-dep tray icon generator (pure Node)
├── assets/            # generated pill PNGs
└── .env.example
```

## ⚠️ Disclaimer

Pilly is a fun tool for entertainment and education. It is **not financial advice (NFA)** - always do your own research.

---

MIT © PillCrew
