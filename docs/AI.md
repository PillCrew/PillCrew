# The council — the chat panel

Ported from PillyDesktop at the owner's request (*„czat na górze … po co nam dwa programy"*): one program, one repo, the
chat and its models inside the sniper instead of a second app.

## What it is

A chat panel with **your own models** behind it. A *tier* is only a URL, a key and a model name — no provider lives in the
code — so the same panel serves DeepSeek, OpenRouter's free lane, a local Ollama, or any OpenAI-compatible endpoint you
point it at. Three rows ship with the app and none of them has a key: **this app never ships one, and never pays for one.**

## The verdict: the worst answer decides

Every usable tier is asked **in parallel** (`src/ai.js`), and the answers are read as one:

| The answers | The verdict |
| --- | --- |
| any answer starts with `VETO` | **veto** — the coin is refused, and the sentence naming the number is carried |
| at least one real answer, no veto | **ok** — the first answer is the read, every answer is listed under it |
| nobody answered (refused, timed out, empty) | **silent** — never `ok`; *nothing answered* is not *no objections* |
| no tier has a key | **no-keys** — the panel says to paste one |

A tier that fails is reported as failed (`HTTP 401`, `no answer in 15 s`, an empty answer) and is never counted as
agreement. That is the whole point of a council: one veto is a veto, and silence is not consent.

## The quick actions (chips)

Thirteen one-press jobs, ported from Pilly Desktop's chat. A chip either **asks straight away** or **arms the next question**:

| Chip | What happens |
| --- | --- |
| 🔥 trending, 📡 radar, 🎲 pick a coin | asks the council about the live coins, with the numbers attached |
| 👛 watchlist | asks about your watchlist, each coin's bar beside its 5-minute move |
| 🧮 size | asks it to size a ticket from your own settings (ticket, slippage, fee, stops) |
| 🏆 scorecard | asks about his own record — calls, wins, losses, hit rate |
| 🐋 whales | asks which wallets you follow |
| 💊 PillCrew | asks about the home coin (`bumpMint`, or the row if it is priced) |
| 🎭 meme this, 🖼️ caption, 🏷️ name it, ⚡ react, 🔥 roast | **arms** the next question: type the text, press Ask |

**The page never supplies a number.** It asks the main process for a *kind* (`ai:context`), which assembles the block from the
app's own state (`lastState.list`, the watchlist, the scorecard, `copyWallets`, `settings`) and appends it as the last message.
The system prompt for a turn is built in `pilly.chatSystem`: **your instructions, then the chip's task, then the language lock** —
in that order, in the main process.

## The chat's look and language

| Setting | Values | What it does |
| --- | --- | --- |
| `aiBubble` | `sharp`, `rounded`, `glass`, `neon`, `minimal` | the look of his messages, applied to the log the moment it is saved |
| `aiFont` | `sm`, `normal`, `lg` | the size of the messages |
| `aiOnTop` | on / off | keeps the window above everything (`win.setAlwaysOnTop`), remembered across restarts |
| `aiLanguage` | `auto`, `en`, `zh` | `auto` follows you; `en` and `zh` **lock** the reply language, ported from Pilly |

*Reset the window position* puts the window back in the middle of the screen it is on.

## Where the keys live

- In `settings.json` on this computer, under `aiTiers`, and nowhere else.
- **Not** in a settings code: `src/share.js` carries a fixed list of numbers, and a test proves a shared code contains no key
  and no endpoint (`test/ai.test.js`, block 7).
- **Not** in the log, and never printed in the panel: the settings row shows `key set` / `no key`, and `maskKey` (used by
  anything that must display one) shows only the first three and last three characters.
- Only `http://` and `https://` endpoints are accepted — a `file:` URL in that field would turn the chat into a local file
  reader, so `cleanSettings` refuses it (`main.js`) and `normaliseTier` blanks it (`src/ai.js`).

## What it never does

- It never signs, sends or reads a transaction: `src/ai.js` has no Solana import at all.
- It never invents a number. The default system prompt (`DEFAULT_AI_SYSTEM` in `main.js`) tells the model to answer only
  from the numbers it is given, to say so when a coin has none, and to promise no profit.
- It never decides a trade. A `veto` is advice on screen; nothing in the engine reads it.

## The system prompt

The desk's instructions live in `aiSystem` (Settings → the chat panel). Empty means the default analyst. The prompt is
assembled in the **main process**, so a coin name pasted into the chat can never rewrite the instructions.

## Numbers the panel owns

| Setting | Default | Range |
| --- | --- | --- |
| `aiTiers` | empty (the three shipped rows) | at most 6 |
| `aiSystem` | empty (the default analyst) | 2000 characters |
| `aiTemperature` | 0.2 | 0 – 2 |
| `aiMaxTokens` | 300 | 16 – 700 |
| `aiTimeoutMs` | 15000 | 2000 – 60000 |

## Tests

`test/ai.test.js` (10 blocks, no network — `fetch` is injected): the tier clamp and the `file:` refusal, `no-keys`,
parallel asking, one veto refusing the coin, a failed tier never counting as agreement, a timeout naming itself, the key
never coming back in a reply, the shared code carrying no key, the message clamp, and the Test button's four answers.
`test/ui.test.js` opens the tab, pastes a key, asks a question and checks the answer — with a stub, so no real endpoint is
ever asked from a test.
