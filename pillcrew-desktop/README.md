# 💊 Pilly Desktop

A tiny green pill AI friend that **lives in your Windows taskbar**. Click it, chat with it (free AI), and it answers like a sharp, terminally-online friend - short enough to screenshot.

Pilly is an original PillCrew character - its own persona, prompts and meme brain.

---

## ✨ What it does

- **Sits in the system tray** - a little green pill with eyes, gently bobbing.
- **One click = chat** - a small frameless window pops up right above the tray icon.
- **Free AI** - talks through your own API settings (⚙️ in the chat: paste any chat-completions endpoint, key and model - e.g. OpenRouter - with a one-click test) or the PillCrew web fallback.
- **Live Solana data (pro)** - paste a token address or a pump.fun/jup.ag link and Pilly pulls live data from free APIs (pump.fun, DexScreener, GeckoTerminal, Jupiter intel): price, mcap, volume, liquidity, 24h change, age, buy/sell txns, organic score, verification, holder/audit flags - then gives a trained pro read (I BUY / TRIM / hold / SELL with the real numbers).
- **🔥 Trending** - one click pulls the hottest Solana coins right now (GeckoTerminal trending) with real volume/change and a short rundown.
- **Meme brain** - detects what you want and switches mode:
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

Give Pilly **one** of these:

**Option A - PillCrew web fallback (optional, no key needed):**
```
PILLY_API_URL=https://pillcrew.fun
```
> This routes through the PillCrew web API - a convenient zero-config fallback. For full control and reliability, use Option B with your own keys.

**Option B - direct free-tier chain** (generic, no names in code) - **the reliable path.**
```
PILLY_TIER1_URL=https://...chat/completions
PILLY_TIER1_KEY=...
PILLY_TIER1_MODEL=...
PILLY_TIER2_URL=...
...
```
> 💡 Put any OpenAI-compatible endpoint into `PILLY_TIER1_URL`, its key into `PILLY_TIER1_KEY` and the model into `PILLY_TIER1_MODEL`. Add more tiers as fallbacks.

Tiers are tried in order until one answers (cheapest/free first). Tune with `PILLY_TEMPERATURE` and `PILLY_MAX_TOKENS`.

**Or set it all in the app** - click ⚙️ in the chat window: 3 API slots (URL / key / model), temperature, site-fallback toggle and a **Test connection** button. Saved on disk, no file edits.

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
