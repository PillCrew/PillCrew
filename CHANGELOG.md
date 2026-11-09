# Changelog

All notable changes to this project are recorded here. The format follows Keep a Changelog and the
project uses semantic versioning.

## [1.2.1] - 2026-11-09

### The last errors in the chat, and the mascot stops being cut off

The owner went through the program himself: *„NA CZACIE powtarza wiadomości nie wiem po co itp, widze sporo innych bledow
domysl sie i napraw"* and *„animacja cos jest nie tak bo skacze za bardzo po ekranie i ją ucina na górze … idzie do rogów
gdzie jej nie widac"*. Every one of these was found against the running application, fixed at the cause, and proved.

- **Saving the chat's look threw in the main process.** `applyWindowPrefs` — the helper that pins the window above everything —
  was declared *inside* `createWindow`, while the settings handler and the ready handler both called it from outside. The panel
  therefore answered `applyWindowPrefs is not defined` in a toast, the bubble style and the text size were never stored, and
  everything after that line in the ready handler (including the `activate` handler for macOS) never ran. It is one module-level
  function now, guarded against a window that has already closed. **A new `test/boot.test.js` boots the real application on a
  scratch profile and refuses any startup error**, so the whole class of "a helper exists only where nobody calls it" is caught:
  the test goes red on the old shape and green on the new one.
- **The page died at load: `$('#chatChips .chip')` was iterated as a list.** `$` returns one node, so `for…of` over it threw
  `TypeError: $ is not a function or its return value is not iterable`, the rest of the script never ran, and the Start button
  stayed disabled — the whole panel looked broken while every id-based assertion stayed green. Found by pausing the page on the
  first uncaught exception (`scripts/load-crash-probe.mjs`, which names the file and line), fixed to `$$`, and the UI test now
  asserts at the top that the page loads with **no console errors of its own**.
- **The chat's styles asked for colours this app does not have.** `.chat-msg.user` wanted `var(--accent)` and the answer labels
  `var(--fg)`; both fall back silently, so the panels came up in a violet that belongs to no other screen. And the neon style
  lit `.chat-msg.model`, a class no message ever carries — only the user's own bubble glowed. Now the real tokens (`--acc`,
  `--line-2`, `--cyan`, `--txt`) and `.chat-msg.assistant`.
- **The mascot's hop was drawn outside his own window.** Measured off the real canvas (`scripts/pet-canvas-probe.mjs`): his hat
  sits 13 px below the top of the 64 px window, and the hop asked for 18 px — five pixels of him were in the frame's edge, which
  is the owner's "ją ucina na górze". The hop is 11 px and **every** lift is capped at 12 px in one place at the end of the
  animation, so no single state (hop, bounce, breather, gesture) can push him out again.
- **He wandered into the corners of the screen** ("idzie do rogów gdzie jej nie widac"). His own walk now turns around
  `PET_EDGE_INSET` (48 px) short of the frame, on a narrow screen too; a hand can still put him anywhere, because that is the
  operator's decision and not his own feet.

Proofs, all against a real window: `test/boot.test.js` (1, proven by mutation — the old shape fails it), `test/pet.test.js` (16,
now including the edge inset and a guard that the hop stays inside the measured headroom), `scripts/chat-probe.mjs` **12/12**
offline against a stub provider (the answer reaches the panel, the desk data travels as a system message, a chip asks the app's
own question, the provider's own error words carried, an empty answer explained, the model list drawn and the best free one
picked, the watchlist, and the look applying at once), `scripts/chat-stress-probe.mjs` **10/10** (six presses in a row ask
once, ten turns are twenty messages and **not one sentence is printed twice**, the log scrolls and stays at the newest message,
Enter asks, Clear empties, six endpoints is the ceiling), `scripts/packaged-check.mjs` in the **packaged** build (the look saves
with no error, the log takes `bs-glass fs-lg`, the mascot draws), and `scripts/ui-sweep.mjs` across eight tabs with **no console
errors and nothing overflowing**.

## [1.2.0] - 2026-11-09

### One program named PillCrew: the council arrives, Pilly walks on the desktop, and the article is rewritten

The owner's decision: *„to repo aktualizujemy robimy jeden program https://github.com/PillCrew/PillCrew bez wstydu i
poprawiamy cały stary artykuł na nowy"*. So this release is the merge, not a second app.

- **The name is PillCrew** (`productName`, `appId fun.pillcrew.desktop`, artifact `PillCrew-<version>-<os>-<arch>`). A rename
  moves `%APPDATA%`, and that folder holds the wallet, the bump pool's sealed keys and every setting — so the old
  `PillCrew Sniper` profile is **copied across on the first boot** under the new name (`migrateOldProfile`), before anything
  opens a file, and only when the new folder has no settings yet. Nothing is deleted; a failed copy leaves the old profile
  untouched and the app simply starts fresh.
- **The council** (the chat) — `src/ai.js` + a Chat tab, ported from PillyDesktop: your own endpoints, your own keys, every
  usable tier asked in parallel, one `VETO` refuses, silence is never consent. Keys never leave the machine and never enter a
  settings code.
- **The chat's own window, with everything Pilly's chat had.** Thirteen quick actions, one press each: **trending**, **watchlist**,
  **pick a coin**, **radar**, **size**, **scorecard**, **whales**, **PillCrew** (the home coin), and the five meme jobs —
  **meme this**, **caption**, **name it**, **react**, **roast**. The data a chip needs is assembled **in the main process** from
  the app's own state (`ai:context`) and appended as the last message, so the page can never tell a model what a number is. The
  look is yours: **five bubble styles**, three text sizes, and **always-on-top** for the window; and the reply language can be
  **locked** (`auto`, English, 简体中文) instead of following you. The system prompt is your instructions + the chip's task + the
  language lock, concatenated in that order in `pilly.chatSystem`, and a pasted coin name still cannot rewrite it. Pilly's
  provider guide and a *reset the window position* button came across too.
- **Pilly on screen, with his whole configuration** — the desktop pet, ported from Pilly Desktop with its art unchanged
  (`renderer/pet.html` is Pilly's own file, byte for byte) and its reflex rules as `src/petmotion.js` with its own tests.
  `src/pet.js` is the new part: one always-on-top, transparent, focus-free overlay that walks, turns at the screen edge, naps,
  is spooked by a fast hand, stops under a resting cursor, and remembers where it was dragged. Its bridge is `pet-preload.js`
  (`window.pilly`), so the pet's renderer needed no changes at all. **Everything Pilly's panel could set, this panel sets**:
  his name, his colours, his size (¾ / 1× / 1.2×, and the window is resized with it), how fast he walks, **where** he walks
  (across the screen or along the taskbar line), how often he stops, his resting mood, speech bubbles with their size, text size
  and one of six styles, his voice and its volume, whether he may ask things, and reduce motion — saved through one channel
  (`pet:apply`) that **also applies the change to the window that is already walking**, so a size change is visible at once and
  a speed change is felt within a tick. It is **off by default**, holds no keys, and cannot touch a trade.
- **Your watchlist and his scorecard** — two more Pilly features, in the PillCrew tab. The **watchlist** holds up to twenty
  coins with a bar on the **5-minute move** (the same number the hot radar reads — the panel says so rather than pretending to
  watch a price this app does not carry), fires one alert per coin per half hour, and Pilly says it in a bubble. His
  **scorecard** writes down every coin he names on his own with the market cap it had at that moment, settles it later against
  the market cap it has now (a win above +1%, a loss below −1%, flat in between, and an unpriced coin stays open rather than
  being judged on nothing), and shows the record — wins and losses both — because a track record that only lists wins is
  marketing, not a record.
- **The article is rewritten** for one app named PillCrew, with eight real screenshots taken from a clean install — dashboard,
  bump desk, chat, settings, feed, wallet, the pet himself and one of his own speech bubbles.
- **And he has a voice, with everything Pilly's voice had.** `renderer/bubble.html` is Pilly's bubble page, and `Bubble` in
  `src/pet.js` glues it to the pet: it is never off the screen, its tail always points at him (`bubblePlacement`, arithmetic
  and tested), it grows so no sentence is ever clipped, it is click-through until it carries an alert, and a tap on an alert
  brings the window forward on the Chat tab. The look is the panel's: bubble size, text size and Pilly's six bubble styles.
  `src/pilly.js` is his brain, pure and tested: **the hot-coin radar** (the hottest 5-minute mover above a dust floor, one
  mention per coin per half hour, falling back to the day's extreme), **the sniper watch** (the freshest launch, said once),
  **the morning brief** (SOL on hand, the session's own PnL, what is open), **his pick of the day** (the council, every six
  hours, and nothing at all when no endpoint is configured), **whale alerts** (a followed wallet opening, from the engine's own
  copy event) and **his mood** (it follows your PnL). Every sentence is built from numbers the app already has — he never
  invents one — and each feature is one switch on the panel.
- Docs renamed with the product, and the settings path documented with its one-time migration.

Proofs: `test/ai.test.js` (10 blocks), `test/petmotion.test.js` (6, Pilly's own), `test/pilly.test.js` (9: the radar and its
cooldown, the dust floor, the day's extreme, the brief, the pick, a whale alert, his mood, the launch watch, one clock per
speaker, the thirteen chips turning into questions and their numbers, and the system prompt's order), `test/pilly-tab.test.js` (5: the watchlist's address check and its twenty-coin cap, an alert that fires once on the
5-minute move, a scorecard judged by market cap, and a flat call that is neither a win nor a loss), `test/pet.test.js` (13:
clamping, the walk step, the edge turn, the cursor hold, the saved spot, inert before start, the drag that remembers, every
mascot setting reaching the window it configures, speed / walk mode / stop frequency / reduce motion changing the walk itself,
every field stored rather than merely checked, the bubble's placement and tail, the bubble's own width, and a bubble that says
nothing when it is off) — each rule proven by a mutation that turns the suite red — and the UI test now opens the Chat tab,
pastes a key, asks a question, presses the pet switch, reads all twenty-three mascot fields, changes five of them and proves
the save reaches the main process, then opens the PillCrew tab and proves the scorecard and the watchlist draw and that adding a
coin reaches the main process (with stubs, so no real endpoint is asked and no real window is opened by a test). Pilly's own
harnesses were run against the source before the port: `npm test` 118/118 and `verify:anim` 201 checks, 0 failures. Then the
whole thing was proven **inside the packaged build** by `scripts/pet-packaged-proof.mjs` (thirteen checks: the switch, every
field saved and read back, the window resizing with the size, and the pet opening his own bubble, carrying a real sentence in
the style the panel chose) — not only in dev.

## [1.1.6] - 2026-11-11

The owner's question: *„nie lepiej do tego programu przenieść opcje z pillydesktop tzn czat na górze + opcje włączenia peta
na ekranie i pełne ustawienia? bo po co nam dwa repo i dwa programy? nie lepiej zrobić jedno porządne repo PillCrew"*. The
answer was yes for the chat, so the first piece is here: **`src/ai.js` + a Chat tab**, ported from PillyDesktop and given
the sniper's shape.

- **Your keys, your endpoints.** A tier is a URL, a key and a model name — nothing provider-specific lives in the code — so
  DeepSeek, OpenRouter's free lane, Ollama or any OpenAI-compatible endpoint works. Three rows ship with the app and none of
  them carries a key: this app never ships one and never pays for one.
- **The council: the worst answer decides.** Every usable tier is asked in parallel; one `VETO` refuses the coin, the first
  real answer is the read, and a tier that fails is reported as failed — **silence is never consent** (`silent`, not `ok`).
- **The keys never leave the machine**: not in a settings code (`src/share.js` carries a fixed list of numbers, and a test
  proves it), not in the log, never printed in the panel (`key set` / `no key`), and only `http(s)` endpoints are accepted —
  a `file:` URL in that field would turn the chat into a local file reader.
- **It touches nothing.** `src/ai.js` has no Solana import: no wallet, no transaction, no number invented. The default
  system prompt tells the model to answer only from the numbers it is given and to promise no profit.
- The instructions are editable (`aiSystem`), assembled in the **main process**, so a pasted coin name can never rewrite them.

Proofs: `test/ai.test.js` (10 blocks, `fetch` injected — no network, no key spent): tiers clamped and `file:` refused,
`no-keys`, parallel asking, veto, a failed tier not counted as agreement, a timeout naming itself, the key never echoed, the
shared code carrying no key, the message clamp, the Test button. `test/ui.test.js` opens the tab, pastes a key, asks and
reads the answer from a stub. Docs: [docs/AI.md](docs/AI.md).

Still to port from PillyDesktop (next, in this order): the **pet overlay** (an always-on-top window with a switch), then the
extra risk/filter settings. Its `bot_engine.py` is deliberately **not** ported — a second runtime inside one installer is the
first thing to break on macOS and Windows.

## [1.1.6] - 2026-11-11

### "Zacielo sie po 2min i nic" — a run that spent the pool into bags it never sold

The owner started a run on a 0.0116 SOL pool, three wallets, four buys a round. Two minutes later the desk said *"Run
finished: every wallet spent its budget"* with **8 buys and 0 sells**, one wallet holding a bag it could not sell, and a
"Could not sell back … Jupiter has no route" line that was not about the route at all. The log said it exactly:

```
01:29:16 Bump desk started on GxWq…pump with 6 wallets.
01:30:21 8v9m…5nGV has no SOL left for another trade (0.0033 SOL, a trade plus its rent needs 0.0034).
01:30:29 Run finished: every wallet spent its budget.
01:30:33 Could not sell back 8v9m…5nGV: Jupiter will not quote this wallet: it needs more SOL in it to pay for the swap
```

Three separate faults, all of them "the desk said yes to a plan the money could not pay for":

- **A round that cannot fit starves the wallet.** A wallet parks its rent, buys N tickets and only then sells, so its share
  must carry the whole round. 0.0116 SOL over three wallets is 0.0039 each; a round of four buys needs 0.0047 — so the
  desk bought until the wallet was dry and never reached a sell. `planBudget` now checks the round against the wallet's own
  share (`roundFits`, `buysThatFit`, `roundNeedSol`) and names the count that fits, **Start** and **Fund the pool** both
  refuse the combination, and a wallet mid-round that cannot pay for its remaining buys **closes the round now** (sells
  what it holds) instead of buying until it is dry.
- **The band's top was not what the plan checked.** The desk draws any ticket up to `ticket × 1.25`, so that top plus the
  rent is what has to fit in a share; it was the middle. The ticket is now capped by the share (`bandCap`), which is what
  stops the panel calling a plan fine that Start then refused (measured: 0.0222 SOL a bump against 0.03006 SOL needed).
- **Stop's sell-back was a bare swap.** It now floats the wallet's fee first and walks the same ladder a Rescue does (pump
  door → Jupiter legacy → Jupiter current), so a wallet with 0.0033 SOL gets its bag out instead of being told the market
  has no route.
- **The fitter scores instead of guessing.** It searches the plans it could give up (pace, then length, then the round,
  then the pool - in that order of cost), prices every one with the same arithmetic the panel prints, and returns the
  closest that fits: *"Fitted: 2 buys a round instead of 4, 2/min instead of 8 - about 39 bumps."* It never answers with a
  crawl below 1/min, and when nothing fits at all it names the SOL the plan would need.
- **The finish line is honest**: "Run finished: no wallet can pay for another round of 4 buys", not "every wallet spent its
  budget" while three wallets hold bags.
- **The end of a run is the full wind-down.** The owner: *"ZAWSZE jak stopuje po swoim czasie ma z każdego walleta wszystko
  sprzedać i kasa ma być na głównym wallecie"*. `_finish` now stops and then sweeps: every wallet's bag sold (the chain says
  what each holds, so a late-landed trade is found too), every emptied token account closed so its rent comes back, and every
  lamport sent home to the **main** wallet. One press at the end instead of three.
- **A park is a pause, and its bag still sells.** A park used to leave `sellAt` at zero, so a wallet parked for lack of SOL
  was out of the run for good while holding a bag — the owner's own row *"8v9m…5nGV · 0.0080 SOL · 3 bumps · 3/4 buys ·
  parked · bag"*. Now every park carries `PARK_MS` (two minutes), a bag always gets a sell time (round complete, cannot pay
  for the rest of the round, or parked), the run's sell floats the fee first when the wallet is short, and a sale **lifts the
  park**.
- **Jito carries the Jupiter lane.** While the pump door is broken every trade goes through Jupiter, and that lane never
  asked the block engine (3 bundles for 110 bumps in the owner's run). It does now — a bundle first, the identical bytes on
  the normal route.

Proofs: 19c (his exact numbers: the plan refuses, Start refuses, Fund refuses, and the note names 2 buys), 19d (a wallet
never opens a round it cannot finish, and a short wallet closes its round early), 19e (Stop floats the fee and gets the bag
out), 19f (a parked wallet's bag still sells; the park expires; a sale unparks), 19g (the run's end sweeps everything home,
and the switch still governs it), 19h (the run's sell floats the fee; the Jupiter lane is bundled), plus the fitter tests
rewritten to the scoring rule. **Twelve mutations** — the round check removed, the band top unchecked, early-close removed, the
buy gate loosened, the float removed (twice), the bare swap back, the ticket uncapped, a bag left with no sell time, a park
with no expiry, a sale leaving the wallet parked, Jito skipped on the Jupiter lane, the wind-down skipped, and the money sent
to the desk address instead of the wallet — each turn the suite red.

## [1.1.5] - 2026-11-11

### "I typed 3 wallets and it made 2" — the box nobody listened to, and Jito that never really ran

The owner, twice: *"wpisałem w Wallets (the pool size) 3 i zrobiło 2 adresy + tu tez 2 napisane 2 wallets"* and *"TO POWINNO
z jito zapierdalac kurwa"*. Both turned out to be the same kind of fault: a number on the panel that was not the number the
desk was using.

- **The pool-size box was not wired to anything.** `#bumpSliders` held the pool size *and* the number box beside each of the
  three sliders, and the only listener in the app was on `#bumpForm` — a different container. So typing 3 saved nothing,
  `settings.bumpWallets` stayed 2, **Create wallets** made two addresses (it read the saved setting, not the box), and the
  plan went on printing "2 wallets". One listener now covers every box under the sliders: typing moves its slider with it and
  saves on the way out, and Create wallets is built from the number **in the box**, saved before the keys are made.
- **The plan is priced for the pool that exists.** `estimate(settings, { have })` takes the real roster size, prices the
  addresses that are actually there, and says the difference out loud: *"You asked for 3 wallets and the pool holds 2: the
  plan is priced for the 2 that exist. Press "Create wallets" to add 1 more address and the split follows."* `bump:estimate`
  answers with the roster's own count, and the state carries `pool: { asked, have }` so the wallet line can name the gap.
- **Create wallets reports what it did.** Growing is still the rule (nothing is ever deleted by that button), but a pool that
  already covers the number now says *"Nothing new to create: the pool already holds 6 addresses…"* instead of "Wallets
  created".
- **A Jito bundle is a first try, never the wire.** The old code sent one bundle, waited 15 s, and on a miss **retired Jito
  for the whole run and failed the bump** — which is exactly what the owner measured. The block engine only keeps a bundle
  for a slot or two, so one offer lands only when the next leader runs the Jito client. The same signed trade is now offered
  `BUNDLE_SENDS` (3) times, and if none lands **the identical bytes go out through the normal route**: one signature executes
  at most once on Solana, so the fallback can never trade twice, and the tip is only paid by a bundle that lands. Jito stands
  down only after `JITO_MISS_LIMIT` (3) misses in a row, and a landing bundle resets the count.
- **Jito is on by default again**, and the panel says what it is doing: on with its tip, or stood down after N misses. That
  line is `state().jito`.
- **Delete keys asks for the wallet password.** This is the one press nothing can undo, and an unlocked desk must not be
  enough: the password unlocks the keys (which is what lets the recovery sell a bag from a locked desk), a wrong one is
  refused in words, and nothing is touched before the check.
- **A wrong password stopped being a crypto error.** `Roster.unlock` and the desk vault answer *"Wrong password: the bump
  wallets were not opened, and nothing was changed."* instead of the box's own authentication failure.
- **Two live tiles had the same label** ("Volume pushed" twice); the second one is "Money moved".

Proofs: 19a (the plan follows the roster, and the gap is named), 19b (`state().pool` / `state().jito`), 17x (delete needs the
password; a wrong one changes nothing), 17b/17j rewritten to the new bundle rules (the fallback is byte-for-byte the bundled
transaction), and the Electron UI test types a pool size into the box and watches it reach the store. Five mutations — the
plan ignoring the roster, the slider listener removed, one bundle offer, one-miss retirement, no fallback — each turn the
suite red.

## [1.1.4] - 2026-11-10

### "Nothing held" about a wallet holding 39 000 000 000 tokens, and a Delete button that could not delete

The owner: *"tego sie dalej sprzedac nie da lol Rescued HoQr…2wJb: nothing held - Jupiter rate limit reached.; All RPC nodes
are busy or unreachable right now. (429 Too Many Requests) ... USUNAC tez nie moge"*. Three separate faults sat behind those
two lines, and each was reproduced against the real chain before it was touched.

- **A read that failed was read as an empty wallet.** The rescue wrapped the token read in `.catch(() => 0n)`, so a node
  answering 429 became the sentence "nothing held" — about a wallet that held 39 018 746 966 tokens. The read now retries,
  and an unanswerable chain is its own answer: `the chain could not be asked what it holds, so nothing was sold`. Nothing is
  ever claimed on a read that did not happen (the withdrawal says the same, instead of quietly skipping the wallet).
- **The fee float was skipped exactly when it was needed.** `lamports != null` meant "only float SOL when the balance read
  happened to succeed", so a 429 on the balance read sent the sell out of a wallet with 0.000891 SOL. The float is now
  unconditional (0.006 SOL, out of the main wallet, confirmed), and its size comes from a simulation of the owner's own bag:
  the route needs 1 488 440 lamports of account rent up front, not just a fee.
- **Jupiter's fallback route could not price the wallets this desk runs.** Measured on the live bag: the current lane refuses
  every taker below roughly 0.06 SOL with `Failed to get quotes` — which reached the panel as "Jupiter has no route" on a coin
  that routes perfectly (a thin taker refused, a 0.0622 SOL taker accepted, same mint, same amount; without a taker the
  quote is fine). The client now asks the order a second time without a taker and names the answer for what it is, and a
  **legacy lane** (`swap/v1`, which quotes without a taker) is tried first in the sell-out ladder so a wallet holding barely
  a fee can still get its bag out.
- **The sell-out ladder**: pump door → Jupiter legacy → Jupiter current, each rung only after a DEFINITE refusal, never
  after an unknown outcome, and the chain decides at every step.
- **Delete keys now does the whole job.** It used to only refuse while anything was left — and since the desk address
  deliberately keeps its rent floor, the refusal could never be satisfied, so the button was dead. It now sells every bag,
  closes every emptied token account (rent back), sends every lamport home, drains each address to zero, and only then
  removes the keys. Anything that genuinely cannot be moved stops it with the reason (`DELETE_NEEDS_FORCE`) and a second,
  explicit press deletes anyway and names what is abandoned on chain.
- **An operator press can wait out a rate limit.** `RPCManager.call` takes an optional `waitMs` and sits out a node's 429
  bench instead of answering "All RPC nodes are busy or unreachable right now"; price-critical calls never pass it.

Proven by `test/bump.test.js` (four new blocks, including the owner's exact 3-wallets-0.02-SOL case), a new
`test/jupiter.test.js`, and a `waitMs` block in `test/rpc.test.js`. Every rule has a mutation that turns the suite red:
unreadable bag → empty bag; float skipped on a failed read; ladder without the legacy lane; delete without selling;
cooldown never waited out; drain leaving the rent floor behind; thin-wallet refusal read as a dead market; delete forcing
past its own guard.

## [1.1.3] - 2026-11-09

### A jammed wallet really comes out: the rescue asks the chain, and a dry wallet gets its fee back

The owner pressed **Rescue** on `HoQr…2wJb` and was told `nothing held - sell: The transaction was sent but is not on
chain after 15 s`. The bag was there, the sell had gone out through a Jito bundle, and the bundle never landed. Worse, the
withdrawal that followed swept that wallet to zero lamports — which on Solana **destroys the account** — with 39 018 tokens
still inside it: a wallet that no longer exists cannot sign the sell that would get them out.

- **A rescue never uses a bundle.** Getting out of a jam is not a place to gamble on an auction; the button always takes
  the ordinary route (pump door, then Jupiter).
- **A rescue is answered by the chain, not by a timeout.** An unconfirmed sell is asked about again after six seconds, at
  most twice, and the wallet's **token balance** decides: `bag sold`, or `the bag is still there, nothing was sold`. It
  never says "nothing held" about a bag it just failed to sell, and it never sends a second sell after one that landed.
- **A sell nobody confirmed is settled by the balance — on both routes.** A wallet that holds none of the mint has sold it,
  so a round closes instead of leaving the desk believing in a bag that is gone, and a 100% sell of an already-empty wallet
  is a finished sell, not an error that poisons the round.
- **A wallet that still holds a bag is never swept out of existence.** *Withdraw everything* keeps the rent-exempt floor
  behind in any wallet whose sell did not go through, so the account survives to sign the next attempt.
- **A dry wallet is given its fee back.** **Rescue** — and *Withdraw everything* before it sells — puts 0.0011 SOL into a
  wallet that cannot pay a transaction, out of the main wallet, confirmed, and says so on the panel. If the main wallet is
  locked or too thin it refuses with the amount that is missing instead of a timeout.

Every rule above is proven by a test that fails when the rule is reverted (ten mutations, each turning the suite red).

## [1.1.2] - 2026-11-08

### The bump desk: volume from a pool of wallets, priced before you press Start

The **Bump desk** tab is a new desk of its own: one token, a pool of wallets generated on this computer, and a loop that
buys and sells with randomized amounts and randomized gaps so the tape reads like several people instead of one wallet
in a loop.

- **Every figure is yours**: budget, wallet count, the band each bump is drawn from, bumps per minute, the buy share, the
  hold band, the run length, slippage and the tip.
- **One address for everything.** Send SOL to the desk address and the desk splits it across the pool by itself; withdraw
  and every lamport comes back to it and then home to your wallet. The address is created with the wallets and sealed
  with the same password.
- **Three sliders, the rest is worked out**: how much SOL, how long, how fast — and the ticket and the wallet count are
  derived from those, because that is the only order in which a small budget is not a slow accident. `bumpAutoAmount` off
  gives every number back to the operator.
- **A plan the money cannot pay is refused before it starts**, with the numbers that do fit: 0.02 SOL over three hours at
  twenty a minute is 3 600 bumps and 0.043 SOL of fees, so the panel says *"23.2 minutes at 20/min, or 2.5/min for 180
  minutes"*, and **Fit it to my budget** re-plans it to 2.5/min for the full three hours.
- **The cost is printed before a lamport moves**, with the curve's own fee named separately from this app's: about
  **3.5% of a round trip** and 5000 lamports per transaction. At the defaults a 270-bump run pushes 4.3 SOL of volume
  through the mint for under 0.08 SOL of fees — the same arithmetic a "500 bumps for 0.18 SOL" price list is selling,
  without the markup.
- **The cheapest settings are the defaults**: 1% slippage (the floor every route accepts) and a 1000 lamport priority tip.
  **Jito is on**: every bump goes out as a bundle of one wallet's trade plus its own tip, which lands it on a busy block.
  The tip is 0.00001 SOL and it is priced per bump, because that is what it costs - a Jito run buys fewer bumps for the
  same money, and the panel prints both numbers instead of hiding one.
- **The money is guarded**: a wallet can only spend its own share and always keeps the rent for its token account; Stop
  sells the bags back; three refusals park a wallet instead of looping; **Withdraw everything** sells what is open,
  closes the emptied token accounts so their 0.00204 SOL of rent comes home, and returns every lamport to your wallet in
  as few transactions as the signature limit allows.
- **Every movement is confirmed on chain before the panel calls it done.** `broadcast` answering only means a node accepted
  the bytes, so the split, the top-up, the return and each bump wait for the transaction to be in a block; one that landed
  with an error is reported as a refusal, with the chain's reason. A withdrawal also keeps the 890 880-lamport rent-free
  floor in the desk address, because Solana rejects a transfer that would leave a wallet below it — that rejection, reported
  as a success, is what left 0.02 SOL sitting in a desk address through three "0.0200 SOL home" lines.
- **A pause gives the time back**: the run clock stops with the desk.
- **A round is N buys and then one sell of the whole bag** (`bumpBuysPerRound`, 1–10, one by default; `bumpBuysRandom`
  draws a fresh count between one and N every round). The buy share is no longer a setting — it is `buys / (buys + 1)`,
  which the round produces — because two controls that can contradict each other are how a desk does what nobody asked.
  The cost model follows: one signature and one curve share per transaction, and `wallets × buys × ticket` parked.
- **A coin that has migrated still trades.** The pump door prices the bonding curve, so on a PumpSwap coin its transaction is
  wrong by a wide margin (the owner's coin: 0.00247 SOL quoted against 0.00459 required, `ExceededSlippage` on chain). A trade
  that landed and provably failed is retried once through **Jupiter**; an unknown outcome never is. Every bump also confirms
  on chain before it is counted.
- **The keys are not settings.** The pool and the desk address live in their own sealed files (`bump-wallets.json`,
  `bump-vault.json`, scrypt + AES-256-GCM through `src/secretbox.js`), never in `settings.json`, never in a `PCS1~…`
  settings code, never in the log, and there is no channel that exports one.
- **A dry run** counts the bumps and the cost and sends nothing — the honest way to see what a run would do.
- **The panel names its own ceiling.** A pool of wallets is a hard limit: with three wallets and a ninety second hold band
  the desk can only do three bumps before it has to wait, whatever the pace says. The Live panel says so in words —
  *"Every wallet is holding a bag: the pace is limited by the 25–90 s hold band, not by 240/min"* — instead of looking
  broken.
- `docs/BUMP.md` explains the two levers that decide the shape of a run (the buy share and the hold time, which pull
  against each other) and what the desk deliberately does not do.
- 20 test blocks with every door and RPC answer injected, and each rule broken on purpose to prove the suite fails
  without it.

### Smaller

- The wallet's crypto moved into `src/secretbox.js`, so the wallet and the bump roster cannot drift apart. The file
  format is unchanged, which is why an existing wallet still opens.

## [1.1.1] - 2026-11-06

### A practice trade used to invent its own losses

Found by auditing a live practice session instead of trusting the code: two numbers on the same card could not both be
true. A position opened with the buy line printing **mc 178** and closed at **mc 155** — a 13% fall — was booked as
**−39.9%**. The cause was one line: the practice fill re-read the coin's price after the simulated delay and booked
*that*, while the entry price every exit rule measured from was the one the buy line had printed. On a coin being bought
*because* it was moving fast, the gap was the whole move, and it was invented.

- **The practice fill books the price the buy line prints.** The quote plus the depth impact is now one number, and it is
  the number in the log, in the position, and in every exit rule.
- **A fall books the move plus the costs, and never more.** A test takes a practice position through a −40% fall and
  refuses a booked loss outside −40…−60%: the round trip cannot be dearer than its own fees plus the impact.
- Measured on a live practice session afterwards: the booked result is the price move plus a steady −6.4 to −8.7 points
  of costs on every close, which is the arithmetic the Settings page describes.

### A restart no longer closes a practice trade or resets the money

Before this fix: one open practice position and a balance of **5.047** before restart; `open: []` and a balance of
**5.000** after it, under a Profit / Loss figure that had been restored. Practice positions were deliberately left out of
the saved book, and the bankroll was rebuilt from the default on every start.

- Practice positions are saved, restored on Start, and still managed by the normal exit rules; the practice bankroll
  (`paperBalance`) is written **in the same breath**, so a restored position can never sit above a balance that paid
  nothing for it. A row that belongs to the other desk is left on disk untouched, so switching between Practice and Real
  Money cannot delete the record of coins that are still in the wallet.
- A practice row has no token in the wallet, so the restore path never asks the chain about it — asking is exactly how a
  paper position used to look closed.
- `test/modules.test.js` proves it across a full rebuild of the engine from the same settings file, and each part of the
  fix was reverted in turn to confirm the test fails without it. Verified end to end on the packaged build: a practice
  position opened, the app killed, the app started again — the same coin came back on the dashboard with the same
  balance, still priced and still sold by its own rules.

### The connection doctor stops crying wolf

It reported *"the feed will use public nodes"* on a configuration that was working, because it only looked at the socket
address typed into Settings and ignored the one the app derives from the node address (a `wss://` copy of the `https://`
URL, with the same key). A doctor that warns about nothing trains you to ignore it.

- The derived socket is checked as well, labelled *"(derived from your node address)"*.
- The two node lines now report the desk's own live view — which endpoint is in a penalty box, and which host is covering
  for it — so a throttled free node reads as a throttled free node instead of a mystery.

### Smaller

- `node scripts/latency.js` now measures **your own socket** even when the socket field is empty: it derives the address
  from the node URL with the same key the desk derives, so the two doors are always compared. On the machine this was
  verified on, the private socket was earlier by **p50 2.3 s** (mean 2.4 s, p95 4.8 s) over a 45-second window. The key
  is printed as `?api-key=***`, because a report that carries a credential is a leak.
- The 3D decoration behind the panel is dimmed to 32%, so it stops covering the text it sits behind.

## [1.1.0] - 2026-11-06

### "Test my connection": the check that should have existed before the bug

The 401 socket and the capped PumpDev stream in 1.0.9 were both invisible from the app until the diary mentioned them.
Settings now has one button that opens **every** configured address once — main node, backup node, your socket, the
Geyser stream — and answers in words, in about five seconds, without starting the bot or touching a wallet:

- a node: `✓ Main node · 118 ms · Answered in 118 ms (solana-core 2.1.0)`
- a socket: `✓ Your socket · 104 ms · Subscribed to the Pump.fun program logs`
- the failure that started this: `✕ Your socket · Refused without a key. Your RPC URL carries one, so the socket needs
  it too …`
- and the honest note when nothing private is configured: *the feed will read public nodes, which measured nineteen
  seconds behind on this machine.*

`src/diag.js` turns a status into a sentence — 401/403, 404, refused connection, unknown host, timeout, "that is an HTTP
address, not a socket", 429, a dropped connection — and each sentence says what to change. `test/diag.test.js` holds
every one of those cases with injected fakes (no network), and the Electron UI test presses the button and checks that
the answer reaches the screen.

## [1.0.9] - 2026-11-06

### The feed was slow because the socket was refused, and nobody was told

Measured on a live machine (`node scripts/latency.js`, documented in [docs/LATENCY.md](docs/LATENCY.md)): the configured
socket `wss://ws.eu.fluxrpc.com` — exactly as the provider's panel prints it — answers **401** without the key its HTTP
endpoint carries, so the desk fell back to public nodes and read a feed that delivered **22.9 events/s** against
**56.5/s** on the keyed socket, arriving **p50 19.3 seconds later** for the same transaction signatures. That is what
"the bot is late" looked like from the outside.

- The key is now copied to the socket automatically, as the same `name=value` pair the RPC URL uses: `?key=` for
  FluxRPC, `?api-key=` for Helius, and a socket that already has a key is never touched.
- A feed that lands on a public node while a private one is configured says so once a minute, with the hostname, so a
  refused socket can never be invisible again.
- `scripts/latency.js` measures it anywhere: two doors, matched by transaction signature, no clock sync, no wallet, no
  key printed. Local decode cost measured at **4.2 µs per notification** — the decoder is not the bottleneck and never
  was.

- **A feed that can only watch twelve coins is a slow feed.** The automatic order used to prefer PumpDev whenever a key
  existed; PumpDev caps a stream (its free plan allows 25 coins per IP, then it drops the watch list to 12 and says so in
  the log). Automatic now prefers a Geyser endpoint, then the chain feed whenever this machine has a private socket or
  node to read it from — the whole program, no per-coin limit — and only then PumpDev. PumpDev remains the fallback when
  the chain feed cannot stream.

## [1.0.8] - 2026-11-06

### A Geyser-class feed, because the job is speed

`geyserUrl` / `geyserToken` in Settings (and `feedSource: geyser`) let the desk read Pump.fun from a provider that
streams **transactions with their logs** — the Geyser-class door Yellowstone and LaserStream expose — instead of the
public program-log subscription. Automatic order is now: a configured Geyser endpoint, then PumpDev with a key, then the
public chain feed.

What this is and is not, stated plainly:

- **Is:** the same decoder behind a faster envelope. A Geyser notification carries `meta.logMessages`, so every event
  still comes from the program's own `Program data:` bytes; only the transport changed, and a launch is seen sooner.
- **Is:** fail-safe. A bad or silent endpoint is named in the Activity log and the desk falls back on its own; with no
  endpoint configured nothing changes at all.
- **Is not:** the binary Yellowstone gRPC client. The official npm client ships native binaries for macOS and Linux
  only — a Windows build that cannot load it is worse than no client. WebSocket is pure JavaScript on all three systems.
- **Is not:** Jito ShredStream, which needs a separate proxy agent.

`test/geyser.test.js` holds the whole mapping offline: a transaction notification becomes the same event as a log
notification (price from the curve included), a replayed signature is counted once, a failed transaction is ignored, a
provider that nests the payload differently still works, `https://` becomes `wss://`, a token is appended once, and an
endpoint that is selected but empty says so and falls back. Both mutations — removing the notification branch, removing
the upgrade — fail it.

## [1.0.7] - 2026-11-06

### Copy trading: follow a wallet's buys

`copyWallets` (Settings → **Copy these wallets**) takes up to twenty Solana addresses. When one of them **buys** a coin
the desk is watching, the coin is entered at once instead of waiting for the score, the buyer bar and the market cap
band — the feature Dorado and Soldrift advertise as copy trading or "sniping po dev wallet".

What it deliberately does **not** bypass, because these protect the money and not the opinion: a free slot, the
buys-per-minute pace, the cooldown after a close, the round-trip fee gate, the session loss limit and the losing-streak
pause, the balance check with exit fees kept aside, the pool's own price (or the coin's fresh tape) with the "price
dropped while judged" refusal, and the live on-chain mint check. Two further refusals are its own: a mint quoted in
another token, and a creator who already sold his launch.

**Sells are never mirrored.** The exit ladder — target, stop, trail, peak give-back, hold limit — stays ours; a full
mirror hands the one decision that keeps a winner to a stranger.

The roster is validated where it is typed: a half-typed address is dropped, and Settings refuses to save a list with a
line that is not an address at all. Off until an address is typed, and `test/copy.test.js` holds every one of the rules
above (both mutations — removing the hook, removing the creator-sold refusal — fail it).

## [1.0.6] - 2026-11-06

### Documentation

- **A comparison anyone can check** — [docs/COMPARISON.md](docs/COMPARISON.md) sets this app beside Chainstack, Dexoryn,
  M8S, Dorado, Ferris and AllenHark, row by row, with the file that proves each of our ✅ and a plain list of where we
  lose: Geyser gRPC and ShredStream data, Raydium/Meteora after a migration, copy trading, Rust. Competitor cells come
  from their own READMEs on 2026-11-06 and were not benchmarked here, which the document says in its own words.
- **A real install guide** — [docs/INSTALL.md](docs/INSTALL.md) walks Windows, macOS and Linux through both the
  installer and a source checkout, with the exact commands, where the wallet, settings and logs live on each system,
  how to uninstall and wipe, and a troubleshooting table for the failures people actually hit (SmartScreen, Gatekeeper
  quarantine, FUSE 2 on Ubuntu 24.04, the Linux SUID sandbox helper, Wayland fractional scaling).
- **README rewritten** — banner, CI/licence/Node/platform badges, screenshots, a five-step first run, a feature table,
  the optional keys, the test commands and honest limits, instead of an internal audit note.
- **Build guide rewritten** — per-OS packaging outputs, a smoke test with a throwaway profile, code signing and
  notarization for all three platforms, and a release checklist. The Windows installer was built from this tree,
  installed silently, launched and uninstalled to prove the path end to end.
- `package.json` now carries `homepage`, `repository` and `bugs`, so the repository card and issue links are right.

## [1.0.5] - 2026-11-05

### One press stops starting the bot
The *Best Profit* button in Settings wrote the preset and then pressed Start itself, so a single press in Practice
mode began a run — and the same press in Real Money would have begun a live one. It now only applies the preset:
`Best Profit · Apply the Practice settings` / `Best Profit · Apply live settings`, and the message under it says
to press Start. The IPC handler no longer has a start path at all, so nothing behind that button can trade.

### The entry no longer waits for a price it already has
Every entry asked the node for the pool price and waited for the answer — 450 ms when the coin's own tape was fresh,
700 ms when it was quiet — and that wait sat exactly on the path between "this coin qualifies" and "the order goes
out", which is the one place a sniper cannot afford it. A coin that traded within the last 1.2 s already carries the
pool's own price: the trade handler writes it straight from the curve. `_entryPrice` now uses it, keeps the provenance
(`pxEntry` stays `curve`, so the exit ladder treats the entry exactly as before), and only asks the node when the tape
is quiet — where the wait also came down to 500 ms (300 ms when fresh). Measured effect on the buy path: ~1.15 s of
waiting before the order, now ~0.25 s. The buy line says which price it used (`priced from its own last trade`), so
the fast path can be seen working instead of assumed.

### The desk looks at a coin four times a second, not one and a half
The scan gate came down from 700 ms to 250 ms and the tick from 50 ms to 25 ms, so a coin that crosses its bar is
judged again in a quarter of a second instead of a second, and a stop or a target is measured twice as often. Priced
before shipping, not guessed: one judgement costs ~4 µs of CPU (`_bench-eval3.js`), so the extra cadence is noise next
to the RPC calls the desk already makes.

### The Profit / Loss card stops reading like a list of errors
Its line used to say `entries priced at the pool 0, at the board 0, refused 33` — the desk's own bookkeeping, which
read as errors counted against the money. The line under the number now says whose money it is, how many trades, what
the fees were, and whether the chain refused an order (a real error, and it keeps its place). Where a price came from
moved to the card's tooltip, where a diagnostic belongs.

### The lockfile installs again
`npm ci` refused the tree from 1.0.1 on: `jayson` needs `utf-8-validate@5.0.10` nested, and the lock carried only the
hoisted 6.0.6, so every CI run stopped at the install step before a single test. The lock is regenerated in a clean
tree with npm 10 and proved with a real `npm ci`, and CI is green on Windows and Linux again.

## [1.0.4] - 2026-11-05

### The desk says what is holding the book back
A book that is not full looks like a bot that is asleep, and it is almost never speed: it is the entry bar
refusing coins. Once a minute, while a run is open and there are free slots, the diary now counts the
reasons the rest of the market was left alone — `4 of 10 slots busy. The rest of the market: 36 × needs N
buyers in Nm, 33 × market cap out of range, 3 × pool too thin` — so a free slot can be read as a decision
instead of a fault. Nothing about the entry rules changed; this only makes the same rules visible.

The buyer setting also now says what it means for a scanned coin: a coin found by the market scan is
counted over five minutes and must carry **double** the number, because that window holds far more trades.
At 50 that is 100 buys in five minutes, which is why a market showing a median of seven buyers fills the
book slowly.

## [1.0.3] - 2026-11-05

### Winners stop being given back on a stale price

Measured on live trades, twice in one evening: two positions that peaked above +30% were given back to a loss, and one
showed a peak of **+3102%** while the take profit booked +77.6%. Two separate faults, both about which number
the rule is allowed to believe:

- **a profit rule may not act on a price nobody refreshed.** A position that has not been priced for more than
  **1.5 s** now asks for a fresh reading instead of firing a target or a give-back on the old one, and the price lane
  answers it directly even when the coin's stream is talking. A stop, the creator selling and the time limit are not
  held back - they protect money, not a gain;
- **a fall is the market and is taken at once** when the position opened on the pool's own price. Holding a fall back
  until two prints agreed within 10% is what let a dying coin sit on a stale number and then book the first tidy print
  28 points under its level;
- **a graduated coin keeps its own market for ever.** Its old pump.fun pair stays listed, frozen at the graduation
  figure; a row from it may no longer set the market cap (that is where a thirty-one-fold "peak" came from), and it may
  no longer un-graduate a coin that has traded on PumpSwap.

### The shipped plan is the shipped settings code, third revision

`minBuyers` 50, band **60-15000 SOL**, 10 slots, 30 buys a minute, target 80 / stop 45 / hold 500 s, pause after 10
losses for 5 minutes, `maxRoundTripPct` 8. The full desk is on (`simpleMode: false`), so the score gate at 50 and the
trail at 14/8 are live again.

### A buy that is slow now says so

- the pool-price wait is **450 ms instead of 700** when the coin's own tape is fresh (the pool number is only
  confirmation then), and the full 700 ms stays for a coin with no recent trades;
- the buy line carries `pool price took N ms` whenever that wait passed 900 ms, because "the bot sometimes buys too
  slowly" can only be answered with a number.

### The counter that looked like a bug

`Coins tracked` flickered between 190 and 250: it was showing the **working map**, which the pruner trims as coins go
quiet and the sweep refills. The card now reads **Coins seen** - the coins the desk has taken in this session, a number
that only grows - with the live map named under it (`N live now · launches/min · fresh`). The pruner also keeps a quiet
coin for four minutes instead of two, so the map churns less in the first place.

## [1.0.2] - 2026-11-05

### A fall is the market, and is never held back

Measured on a live trade: a position that peaked at +30.7% was booked at -13.1%. The rule fired 28 points under
its own level, and the reason was the price guard, not the exit: consecutive prints of a dying coin were 25% and 30%
apart, the guard demanded two within 10%, so the position sat on a stale price while the coin collapsed and then booked
the first print that happened to look tidy.

- a FALL is now taken on the **first** reading when the position opened on the **pool's own** price. That is what the
  quote lane has always done, and what a stop needs;
- the second look stays for what it was written for: a spike **up**, and a fall away from an entry that was itself
  somebody else's number (a board row, the `$sol` case);
- the entry's provenance (`pxEntry`) is kept with the position and on disk, so a restart does not change which rule
  protects it.

### The shipped plan is the settings code

`PCS1~…` is now what a fresh install runs, and what the **Balanced** card applies:

| Setting | Value | |
| --- | --- | --- |
| `minBuyers` | 70 | a crowd has to be in it |
| `minNetFlowSol` | 2 | real net buying, not noise |
| `minMcSol` / `maxMcSol` | 80 / 1500 | the band, applied literally in the simple plan |
| `minLiqUsd` | 4000 | a pool that can absorb an exit |
| `takeProfitPct` / `stopLossPct` | 80 / 45 | room to run, and a stop that does not fire on noise |
| `maxHoldSec` | 500 | eight minutes, not three |
| `maxPositions` / `maxBuysPerMin` | 6 / 10 | |
| `buyAmountSol` | 0.1 | the size the plan is built for (a card never moves it) |
| `sessionLossLimitSol` | 1 | ten tickets |
| `maxLossStreak` / `pauseMinutes` | 3 / 10 | |
| `maxDevBuySol` / `maxDevHoldPct` / `maxTraderSharePct` | 12 / 30 / 40 | the rug-shaped coins are refused |
| `maxRoundTripPct` | 8 | a ticket whose fees exceed this is refused, with the size that would work |
| `simpleMode` | on | the target, the stop, the time limit and the give-back floor decide |

`maxChange5mPct` and `minChange5mPct` are off in this plan (0), and the trailing stop's numbers (14/8) are carried but
inert while the simple mode is on - the simple ladder has no trail by definition. That is stated rather than hidden.

## [1.0.1] - 2026-11-05

- Verified Pump program log ownership and ignored reverted or duplicate notifications.
- Added the Pro preset, aligned Practice exit marks with settlement, and updated fee estimates for PumpPortal Local.
- Retained confirmed sale signatures while waiting for wallet reconciliation. Replay now supports side-by-side strategy summaries.

- Fixed Practice exit-fee accounting and sale-signature reconciliation.
- Kept uncertain orders pending and removed competing signed sell orders.
- Added IPC sender checks, aggregate cleanup limits and compute-fee inspection.
- Added on-chain mint risk checks and blocked unverified live entry evidence.
- Added depth-aware Practice slippage, stress controls and recorded-signal replay.
- Updated Electron and packaging dependencies; see the release audit for remaining advisories.
- Shortened narrative comments and replaced outdated README claims with current behavior.
- A blocked live mint check is now **said in words** once, instead of being visible only as a reason on each coin: a gate
  whose data source is down looks exactly like a quiet market, and the holder bar cost hours that way on 2026-11-05.
- `npm run test:ui` exists: the Electron UI smoke test was documented in `docs/BUILD.md` and the README but had no
  script behind it, so nobody could run it. It passes (hidden window, isolated mock wallet, trading stopped).

---

## [1.0.0] - 2026-11-05

The first public release.

### A second private node, and a socket the operator can name

- **`rpcBackupUrl`** - a second private node, tried right after the first and still ahead of the public pool. Measured
  with two private nodes in one session: FluxRPC took a timeout and the desk switched to Helius inside the same
  trade, with `RPC switched (timeout)` in the diary and nothing lost.
- **`rpcWsUrl`** - the trade stream's socket, used verbatim. A provider's WebSocket is often on a **different host**
  than its HTTP endpoint (FluxRPC: `wss://ws.eu.fluxrpc.com` against `https://eu.fluxrpc.com`); a URL guessed by
  swapping the scheme never connects, and the feed then quietly falls back to the public one.
- the RPC list is applied to the running desk the moment it is saved - before this, a corrected URL only took effect
  after a restart and the log kept naming the node that had been replaced.
- **the Jupiter budget is its own bucket**: two calls a second, kept apart from DexScreener's four. Measured with a real
  key: twenty quick calls answered five and refused fifteen, one every 700 ms broke on the fourth, one every 1.1 s did
  not - the public tier refills at about one request a second, and the token index (a thousand coins, all of them nice
  to have) was spending the allowance the price service needs for a coin that is being held.

### Your own keys, and every number on the desk is a setting

A professional desk is judged by what it lets the operator bring to it, so nothing it reads is hard-coded any more:

- **`jupiterKey`** - your own key from portal.jup.ag is now sent as `x-api-key` on **every** Jupiter call: the backup
  swap route, the price service and the token lists. Measured on this machine, the public door answers about one request
  a second and then refuses the whole connection for minutes - which is exactly the state that made exits wait for a
  price while the coin was moving. Without a key nothing changes and nothing is required.
- **`minTokenAgeSec` / `maxTokenAgeSec`** - the coin's own age, in both directions, as a setting. A launch younger than
  the floor has no tape to judge (its buyers are the dev and his friends); one older than the ceiling has already had
  its move.
- **`maxRoundTripPct`** - the fee gate that used to be a constant. A ticket whose round trip costs more than this share
  of it is refused, with the size that would work printed in the log. It has a **5% floor** and cannot be switched off.
- all three travel inside a **settings code**, so a plan can be shared and reproduced exactly - while the keys
  themselves never do: no API key, RPC URL, wallet address or mode is ever encoded (a test holds that).
- the Settings screen gained a **Jupiter key** field beside PumpDev and Sol Incinerator, and the three new numbers sit
  in the advanced panel with the rest of the desk.

### The High roller style, and why a big ticket wants the opposite plan

A serious bankroll does not pay 5.4% to round-trip a ticket - at 0.5 SOL and above it pays about 3%, and that changes
what an exit should be. The `aggressive` style (shown as **High roller** in the app) is now:

- **a 60% target against a 12% stop** - a loser costs an eighth of a ticket, a winner pays for five of them;
- **six slots and a bigger tip** (0.0005 SOL), because a ticket at this size is worth landing;
- the same entry bars as `balanced` (score 78, thirty buyers, 2 SOL of net buying, the 60-500 SOL band), because none
  of the measurements suggested a lower bar makes money - it only makes more rugs.

Measured in paper on the live market, the shape that LOSES money is the other one: a **wide** stop (35%), because the
rug that gaps to zero takes the whole ticket whether the stop sits at 12 or at 35, and a **small** target, because it
caps the one trade that pays for the session.

A style never raises the ticket. Pressing a card moves the plan, not the money at risk; the card says what size makes
the plan work and the operator types it.

### The Open positions panel no longer jumps, and never shows a coin that was not bought

Open positions flickered and briefly showed tokens that had not been bought. Two faults behind one symptom:

- the buy path holds a slot in `positions` **before** it asks the pool for a price, and drops it again when the price is
  refused (500 refusals in a single paper session), so a coin nobody bought was published to the panel for a fraction of
  a second. `_openPositions()` now publishes only the positions whose price was accepted (`priced`), and the preview lane
  and the full state both read it;
- the panel **cleared itself and rebuilt every row** whenever the set of mints changed. A coin arriving or leaving threw
  the whole list away, and the eye read that as a jump. Rows now stay put: one that left is removed, one that arrived is
  appended, the rest are left alone - and the Sell button's own state is patched instead of the row being rebuilt.

### A hint about PumpSwap is a graduated coin

`_markMarket` is now the only place that decides which market a coin trades on, and both doors call it - the market
board **and** the discovery hint. The hint carries the same `dexId`, but it never set the flag, so a coin already on
PumpSwap arrived as a launch: its PumpSwap row was then taken as "the pool it can buy on", which is the phantom-entry
class in reverse. Measured in a paper run on the shipped plan, `$BURNIT` opened and stopped out **32.9%** down six
seconds later and `$Microduck` at **-93.6%**. With the flag set at both doors those coins are refused like any other
graduated coin while `allowGraduated` is off.

### A pair on another exchange never prices a position

`enrich` returns the pair with the **deepest liquidity**, and a young pump.fun coin is often listed on a copy-cat
exchange with a few dollars in it. The price lane accepted any row's USD number, so one such pair moved a held position
**+434% in thirty seconds** and the target sold it there (measured in a paper run on the shipped plan). `_ownPool()`
now refuses a row from any exchange that is not `pumpfun`, `pumpswap` or `pump-amm`.

The same check is narrower still for a coin that has graduated: it keeps its old pump.fun pair listed, **frozen at the
graduation figure**, and that fossil is not a price. Measured on `$SAFU` in two runs minutes apart - stopped at
**-101.4%** in one, sold at **"+1142.5%"** in the next, which was the fossil and the live PumpSwap pool disagreeing by
an order of magnitude. A graduated coin is now priced by its PumpSwap pool only.

### The first print after a buy has to agree with the price paid

Measured in one five-minute run: `$ALIBI` stopped out at **-44.8% held 0s**, `$COGE` at **-67.5% held 1s**, and `$DNUT`
"peaked at **+159.3%**" two seconds after the buy. The first reading of a fresh position was trusted whenever the entry
had been priced at the pool, and a 45% disagreement sat inside the 50% wild-move bar anyway, so a single wrong number
opened the position 45% down and the stop fired on it. The first print now needs a **second agreeing reading** beyond
20% in either direction: a real move prints again within milliseconds, and the stop then fires at the price the market
really is.

### A stop that fires under its own level says which numbers moved

Four stops inside one minute fired between -31% and -79% on a 20% stop. The line now carries the market cap it was
entered at and the one it was priced at: `[mc 98 → 81]` is a 17% fall in a few seconds, which with a ~6% round trip is
the -21% the rule acted on. That is the entry being late, not the exit being wrong, and the diary has to say so.

### The shipped plan is the measured one

The defaults, the `balanced` style and the one press preset are now the same numbers, set by measurement rather than
taste:

- **the target and the stop are the same size (20% net)**, so a coin that reaches the target pays for one that does
  not: at a 50% hit rate the desk is level instead of bleeding. The old shape (a 90% target against a 9% stop) needed a
  run to win and paid to lose;
- **the entry bars are the high ones** (score 78, thirty buyers, 2 SOL of net buying) inside a **60-500 SOL** band and
  a **2-30%** five minute move, so a coin arrives with a crowd already buying it and is not bought at the top of a push;
- **the simple mode is on**, so only the target, the stop, the three minute limit and one protective give-back floor
  decide when a position leaves. The simple mode also applies the market cap ceiling **literally** - the four-times
  ceiling is for scanned movers on the full desk, and it let a 701 SOL coin into a 60-500 band;
- measured in paper on the live market over seven minutes right after the change: **5 wins of 10 trades (50%)**, with
  the give-back and the target doing exactly what they say.

### No pool price, no entry (the root of every wrong percentage)

Every wrong percentage of the day had one cause: **the desk bought on a number that was not the price the order would
fill at**.

- `$sol`, `$MGOAT`, `$WIMPOSTER` and the rest of the run were entered on a **board row** (`board price` in the log) and
  then filled through a re-quote or another pool, so the position opened at a price the wallet never paid and a print
  against it looked like `+301%`, `+414%`, `+159%` - all followed by a fill at a loss.
- **A live entry now requires the pool's own price.** No pool, no buy, with the reason on the coin: `No pool price to
  buy on`. The two exceptions are things that *are* the pool: the offline paper harness, and a graduated coin's own
  PumpSwap row (which is the market the `auto` order fills against). A board row from anywhere else is refused.
- **A profit rule may not fire before the entry is settled.** The fill-derived correction needs one RPC round trip and
  `$MGOAT` was sold two seconds after the buy. Targets, the first rung, the trail, the break even and the peak give-back
  stay quiet until the entry is known; a stop, the creator selling, the time limit and a lost price stay armed.
- **A floor does not wait to be confirmed.** `$JIMOTHY` fired its peak give-back *at* +36.7% and still booked **-5.5%**,
  because the 400 ms confirmation cost twenty points on a coin already under its level. A stop already skipped that wait
  when the price blew through it; the give-back and the break even now skip it too.

### A ticket whose fees eat it is refused

- At **0.001 SOL** the two tips (0.0004 SOL) are **40%** of the ticket, so every position opened at -42%, the stop fired
  at a 2% price move, and five losses landed inside a minute. The desk now refuses to trade a configuration whose round
  trip costs more than **20%** of the ticket and says what to set instead:
  `Raise the buy amount to at least 0.003 SOL, or lower the priority fee. Nothing is lost by waiting.`
- **A booked percentage can no longer go below -100%**: the denominator is the money the position put in (**ticket plus
  every tip it paid**, including retried orders), not the ticket alone - `-174.9%` was arithmetic, not a loss.

### One press out of a pause

- The pause after a cold streak (or after selling everything by hand) now has a **Resume now** button beside its own
  sentence. Pressing it lifts the pause, restarts the streak counter from zero, and says so in the log.

### An entry price the wallet never paid, and the phantom peak it produced

Measured on a live **$sol** trade: bought 0.005 SOL at 17:03:55, sold five seconds later and booked
**`Take profit · peaked +301.4% · -15.0%`**. Two faults, both in the same five seconds:

- **The entry was a board row while the order filled somewhere else.** The log itself says `sol filled on the
  re-quote` - the first order was refused and the fill came through the backup route at a different price - and the
  desk kept measuring every percentage from the board's market cap, a price the wallet never paid. The entry is now
  **measured from the fill**: the tokens the wallet received against the SOL it paid, times the one billion supply a
  pump.fun launch has. That is the exact price of the position, and a phantom +301% cannot come out of it.
- **A single print could move a position by any amount on its very first reading.** The exemption was written for a
  launch that doubles the moment it is bought, but it applied to board entries too, where the "entry" is another
  market's opinion. The first reading is now exempt **only when the entry was the same pool's own number**; a jump
  away from a board row must be seen twice, like any other wild move.
- The log line says when this happened: `entry measured from the fill - 1250.0 SOL market cap for 0.0050 SOL of tokens
  (the desk had read 56.0)`. The saved position carries the corrected entry, so a restart does not undo it.
- **...and the first version of that fix did nothing at all**, which the next live trade proved (**$MGOAT**,
  `peaked +414.4%`, sold at -15.2%): the decimals the arithmetic needs were read from the chain and then never passed
  on to it, so the correction returned early every time and said nothing. Both are now covered by a test that fails if
  the decimals stop travelling.
- **A price from another exchange is not this market.** A pump.fun coin also gets listed on Meteora/Raydium as a
  copy-cat pool with a handful of dollars in it, and the board hands back the row with the **deepest liquidity** - for
  a launch still on its curve that is often one of those. Its price cannot be sold into, so it is now kept for depth
  and buyer counts only: it may not set the market cap a position is measured at, nor its fallback quote. $MGOAT's
  curve said about 130 SOL while a copy-cat pair quoted five times that, and the desk believed the copy-cat.
- **No profit rule may fire before the entry is settled.** The correction above needs one RPC round trip, and $MGOAT
  was sold **two seconds** after the buy - faster than the answer. Until the fill's price is in, a target, the first
  rung, the trail, the break even and the peak give-back stay quiet, and the peak itself is not recorded from a price
  the entry has not been checked against. A stop, the creator selling, the time limit and a lost price stay armed
  throughout: those protect money rather than count it.
- **The arithmetic only assumes one supply where that is true**: the fill-derived entry is used for pump.fun launches
  (mints ending in `pump`, or a coin whose pool is pumpfun/pumpswap), because a different supply would make the answer
  wrong by exactly that factor.

### Why Jupiter and GeckoTerminal were refusing this machine, and what fixed it

Measured on 2026-11-05, one request after another from the same machine:

| Request | With our user agent | With a browser-shaped one |
| --- | --- | --- |
| `api.jup.ag/tokens/v2/recent` | **429 Too Many Requests** | **200 OK** |
| `api.gecko…/networks/solana/new_pools` | **429** | **200** (after a pause) |
| `dex­screener.com/tokens/v1/…` | 200 | 200 |

- **The user agent was the block.** The Jupiter edge answers `429` to an unknown client name and `200` to the very
  same request sent the way every desktop client sends it. Every launch door on that host was being refused because of
  one header - and the desk had been quietly discovering from DexScreener alone. The app now sends
  `Mozilla/5.0 (…) PillCrewSniper/1.0`: the compatibility token HTTP clients have used for thirty years, with this app's
  own name still in it, so the traffic stays identifiable.
- **Half of the flood was ours.** The price service was asked on every 150 ms exit tick, and the live diary showed
  **31 refusals in one minute** against it with a single position held. It is now asked at most **once a second**, which
  is still eight times faster than any stop needs, and the board lane (DexScreener, 500 ms) stays as the fast door.
- **A refused host rests for up to a minute** instead of eight seconds, so a hard block is not hammered.

### An estimate is corrected once the chain answers

- **A sale booked from an estimate is measured again in the background and the row is corrected.** When a node would
  not hand over the sale's own transaction, the row was booked from the price the rule fired at, said `(estimated)`,
  and stayed wrong for ever: measured live, LIBRE was booked **+0.0044 SOL** when the wallet really gained
  **+0.0146**. The signature is now queued, asked again every thirty seconds for six minutes, and when the answer
  arrives the row's SOL and percentage are replaced, the book moves by the difference, a win booked as a loss (or the
  reverse) swaps sides, and the log says so in one line.

### A position that cannot be sold now says why, and stops shouting

Measured on one stuck position (**SAFU**, bought 15:39, unsellable from 16:23): the log carried **25 identical error
lines** and not one of them named the cause, because the door's own sentence was thrown away.

- **The reason lives in the status line, not the body.** PumpPortal answers `HTTP/1.1 400 Pool account not found` with
  the body reading only `Bad Request`, and the desk read only the body - so a coin with no pool became "could not price
  this coin yet", a sentence nobody can act on. Both are read now.
- **A sale never names a pool.** Guessing `pump` for a coin the desk never saw graduate is exactly what produced that
  400: a sale has nothing to protect by naming a pool (an entry does), so the door finds it (`auto`).
- **The backup route rests for a minute after refusing to quote.** Jupiter answered `400 Failed to get quotes` for
  hours that afternoon; every refused sale waited for it before giving up while the door that could fill was ready.
- **A coin whose pool has no liquidity is said once, in words**, with the number: *"this coin's pool has no liquidity
  left ($0.00), so there is nothing left to sell into… the tokens are worth nothing, no setting can change that."* It
  is re-checked in ten minutes instead of every three hundred milliseconds.
- **"Not enough SOL to buy" is said once every five minutes**, not every thirty seconds - the numbers cannot change
  until money moves.
- **A refused buy gives its ticket back at once.** The order was held against the balance for a whole minute after the
  door refused it, so on a 0.022 SOL wallet one skipped coin made every following buy answer "not enough SOL"
  (measured live: `0.0078 SOL free, 0.0127 needed` right after a buy that never happened).
- **The dead-pool rule was corrected the same day it was written.** A *fresh* pump.fun coin reports **no liquidity at
  all** - its "pool" is the bonding curve - and the first version read that as an emptied pool and abandoned a live
  position for ten minutes. Measured on **lambo**: bought for 0.01 SOL, declared worthless sixteen seconds later while
  it was up +146%, and sold by hand at **+26.7%**. Death is now declared only for a **graduated** pool that reports
  zero depth, after three refusals, and never in a position's first ninety seconds.
- **`Jito: Jito refused…` is one Jito.** The client's sentence already names the engine, so the line no longer stutters,
  and the "already processed" case - the RPC winning the race, i.e. a trade that is on chain - is now said once every
  ten minutes in words that explain it is not a fault.

### Profit / Loss no longer invents money

- **A coin already held at Start is part of what the wallet was worth at Start.** Its value and its rent were added to
  the equity on every push but never to the baseline, so a restart with three restored positions opened the session at
  a fake **+0.035 SOL** profit (three tickets plus their rent, to the lamport) - measured on a live wallet.
  The baseline is now the wallet **plus** what the book was already worth (`_holdingsSol`), and the card says
  **"since Start"** so the number can be read without guessing.
- **An unpriced coin is marked at what was paid for it**, never at zero: a buy whose first reading has not arrived yet
  would otherwise read as a total loss for a second or two.
- **A deposit is not profit, and a withdrawal is not a loss.** A jump in the balance that no sale, no rent reclaim and
  no order in flight explains moves the baseline instead of the result, and says so in one line. The card then keeps
  measuring trading only.
- **A sale is measured on chain even when the node is slow.** Two short second looks (0.5 s, then 2 s) before the desk
  accepts an estimate: measured live, `Sold CR (Stop loss at -36.6%): -0.0037 SOL (estimated)` while the public nodes
  were rotating on 429.

### The desk stops going blind: a full map makes room for a launch

- **A newcomer is now tracked even when four hundred coins are already on the list.** This is the freeze a trader
  watched: the tracked set sat at **400**, and every launch after that was silently refused - the log stopped saying
  "new coins" and only the next line was ever printed again. The map now evicts the oldest, lowest-scoring coin that
  nobody holds; a launch five seconds old is worth more than a dead coin from ten minutes ago. A coin that is held is
  **never** evicted.
- **The market board answering is not the coin doing something.** `lastActivity` means "a trade arrived", and
  `_applyMarket` refreshed it for every coin it priced - so nothing ever looked idle, the pruner found nothing to
  remove, and the map could not empty itself. The board stamps its own clock (`lastBoardAt`) now, which is what the
  entry price freshness check reads.
- **A door on a host that is refusing is replaced by a working one.** Five of the nine discovery doors live on Jupiter
  or GeckoTerminal; measured on 2026-11-05 those two answered **429 for hours** while DexScreener answered normally,
  so most cycles discovered nothing at all.

### A warning that names the door

- **`Market data: <host>: rate limited`** - the old line said only "rate limited", so a source that was shut for hours
  could not be identified from the log. It is printed **once per host**, in words that say the desk still works, then
  once a minute with a count (`still jupiter: rate limited (26 calls refused in the last minute)`).
- **A filter whose data source is refusing says so.** GeckoTerminal was refusing this address for hours while the
  holder bar (which the one press preset switches on) blocked every buy, one "Holder count unknown" per coin at a
  time. Three unreadable counts in a row now produce one plain sentence naming the cause and what to do about it.

### A sale is booked at the price the chain paid, not at the one the rule fired

- **The wallet's own transaction is now the witness for every sale, asked twice.** `_txSolDelta` looked for the fee
  payer under the name a *versioned* transaction uses (`staticAccountKeys`); a **legacy** transaction names the same
  list `accountKeys`, so those sales silently fell back to an estimate - and an estimate is the pool price **before**
  the desk's own sell moved it. Measured on chain at 14:52 on 2026-11-05: the LIBRE sale booked
  **+0.0044 SOL (+43.8%)** while the wallet really gained **+0.0146 SOL (+25%)**. A refused RPC answer (the public
  nodes were rotating on 429 all afternoon) had the same effect, so a measurement that comes back unknown is asked
  again half a second later - the sale is already made, and the truth is worth half a second.
- **The closed trades and the running totals are kept on disk.** They lived in memory only, so every restart wiped the
  day's profit and loss and the panel claimed a session that had never traded - and this app is restarted constantly
  while it is being tended. The book is a record of what was *booked*, never of the wallet balance, so a deposit or a
  withdrawal still cannot flatter it, and **Reset** now sticks across a restart too.

### A warning that means "it worked" is not a warning

- **`bundle contains an already processed transaction` is information.** It means the RPC door won the race and the
  trade is on chain, so the bundle had nothing left to add; printed as a warning one second before
  `Bought QI`, it read like a failure next to a successful buy.
- **A rate-limited market call is reported once a minute with a count** (`still rate limited (12 calls refused in the
  last minute)`) instead of once per twenty failures. Measured live: ten identical lines in six minutes, all of them
  handled - and a wall of noise is how the next real warning gets missed.
- **The trade stream makes room when the plan says the allowance is gone.** Measured live: *"your free plan allows 25
  live subscriptions per IP and this IP has reached it"* while the desk was asking for twenty, because the rest of the
  address's allowance was not ours. The budget now drops to twelve - open positions first, then the best candidates -
  and returns to twenty after ten quiet minutes.

### A buy line that can be read afterwards

- `Buying CR (GpsE) for 0.01 SOL (56 buyers, mc 946, simple plan)` - the **market cap** that was actually gated on,
  the plan that judged it (the score is a gate only on the full desk, so printing `score 35` in the simple plan read
  as a bug), and `board price` when the entry was priced from somebody else's row instead of the pool.

### A take profit is an exit, and a winner is not sold into a hole

- **A 1% slippage setting could wedge every take profit.** The user's slippage is an **entry** ceiling, and a profit
  exit was asking for it too: measured live on **$MOSQUE**, the target fired at +61.3% peak, the order was refused
  because the pool had moved, the retry was priced where the coin was by then, and the row read
  **`Take profit · -89.2%` while the coin was back up two seconds later**. A profit exit now never asks for less room
  than 15%, and still never more than the exit ceiling.
- **A take profit never chases a falling price.** When an order is refused and the move that fired the rule is gone,
  the sale is abandoned instead of re-quoted lower: the stop and the trail decide from there. Chasing is worth it for a
  stop - any price beats no sale - and it is how a winner is sold at the bottom.
- **The simple plan keeps one protective rule.** It has no trail of its own, so a coin that ran to +61% had nothing
  between it and zero: once a position has been up **+20%**, half of that run is kept. The card names it.

### Jito: the reason is now in the line

- **A refused bundle says why.** The client threw away the block engine's answer and reported only `HTTP 400`, which
  told nobody anything; the body is now read and carried into the log (`transaction #0 could not be decoded`,
  `bundle simulation failed`, and so on). Measured against the live engine while fixing this: the same bundle sent
  **without** `encoding: base64` answers exactly `400 could not be decoded`, and **with** it comes back with a bundle
  id - so the shape was right and the refusal was real.
- **A rate-limited tip-account lookup no longer takes the lane down.** Measured live: `getTipAccounts` answered 429
  while `sendBundle` was still accepting bundles. The addresses are stable, so the last list is used and retried a
  minute later instead of losing every trade in that window its second chance at landing.
- **No more `(HTTP 400).. The normal route is unaffected.`** - a message that already ends in a full stop is not
  given a second one.

### A settings code X will not block

- **The code carries no dots any more.** `PCS1.<payload>.<checksum>` reads as `domain.tld` to the linkifier in every
  chat app, so pressing **Share on X** in Settings produced a post X answered with **"Blocked link"** and refused to
  publish. The separator is now a tilde (`PCS1~payload~checksum`), which no linkifier mistakes for an address, and
  every code posted with a dot before this change still decodes.

### One coin is bought once

- **The per-coin and slot checks are made again after the holder lookup.** That lookup is a network wait, and a guard
  made before an await is only a guess about the state after it: two decisions inside that window both passed, and a
  paper session showed **two buys of one coin 16 ms apart**. Worse than a double position - the book is a map, so the
  second entry **overwrote** the first, having spent the SOL: money gone, one position in the book.

### One trade print is not a market

- **A move of more than half a position's value in ONE reading now has to be seen twice.** A trade print or a quote
  can be another pool, a misparsed field or a single wash trade; measured in a paper session, a coin "stopped out" at
  **-63% one hundred and thirty milliseconds** after it was bought. A real crash prints again within milliseconds, so
  the second look costs nothing. The first reading after an entry is exempt: the entry price was the pool's own number
  a moment ago, and a launch that doubles in that moment is a launch.
- **Trade lines name the mint and the price source**: `Buying bottom (27Zh)…`, `Sold 40% of bottom (27Zh) (Take profit
  part 1 at +28.2%): +0.0020 SOL [quote]`. Three coins called "titcoin" in one session were three different mints, and
  a line that names only the symbol cannot be read afterwards.

### A percentage that moves with the price and nothing else

- **The exit tip is frozen at entry.** Smart fees follow the live fee market, so a position measured against the
  current tip showed a percentage that wandered while the price stood still - in a test, a fee change alone moved the
  same price from **+13% to -85%** - and the stop and the trail moved with it.
- **A card without a price shows a dash**, never `+0.0%`: "no reference price" and "the coin has not moved" are
  different facts. And a move under a twentieth of a point reads `0.0%`, not `-0.0%`.
- **A held coin with no live stream is priced twice as often** (500 ms instead of 1200): a graduated coin has no curve
  left to read and the price service answers for only some mints, so the board of its PumpSwap pair is the door that is
  always there.

### A price nobody refreshed is not a price, and a fall is never held back

- **A fall is taken on the first reading, whatever its size; only a jump UP needs a second opinion.** The guard in the
  quote path refused any move bigger than 40% - in both directions - and, because a refused reading never replaced the
  number it was measured against, the position froze at its last accepted price **for ever**: every later reading was
  "too big a jump" from that same ghost. Measured live on 2026-11-05: **$Saylor** went from a 50k market cap to
  nothing while the desk kept printing +71%, and the sale that ended it was a hand on the Sell button. With the number
  frozen, the stop could not fire, the target could not confirm (a signal has to be seen on a *fresh* price) and the
  time limit was the only thing left.
- **A position nobody is pricing is now asked about directly and, failing that, sold.** After ten seconds without a
  reading the engine asks the market for that one mint by itself, and the fresh answer replaces the old quote even
  though one is on record. After forty-five seconds it sells (`Price lost`): a coin the desk cannot see is a coin it
  cannot protect, and holding it blind is exactly how a winner becomes nothing.
- **The card says how old its number is** (`· no price 12s`), so a still percentage can never again look live.
- The entry price now stamps the price clock, so a brand-new position is never mistaken for one nobody has priced.

### The desk keeps a diary

- **Every line the window shows is also written to `logs/pillcrew-<date>.log`**, one file per day: buys, sells, the
  rule that fired, refusals, feed changes and errors. The build before this one kept its log in memory only, so a
  session could not be read after the fact - which is the first thing anyone asks when a trade looks wrong. The folder
  keeps the last fourteen days and prunes the rest on start-up (measured at 3 MB on a busy day).

### Simple settings and the buyer ceiling

- **A new switch in Quick setup turns the desk simple.** While it is on, the settings form shows only the
  basic numbers - the market cap band, the buyer floor and ceiling, the amount, the slots, the slippage,
  the target, the stop and the hold time - and only those decide. The score bar, the net flow, the depth,
  the creator bags, the five minute band, the holder bar, the first rung, the trail and the break even are
  off. The safety protections (creator sold, graduated coins, unsupported quotes) never turn off in either
  mode, and the hidden numbers stay in the store untouched, so switching back restores the full desk
  exactly as it was.
- **The buyer ceiling is a new gate for both desks.** `maxBuyers` refuses a coin whose recent buyer count
  is already past the cap: past it the crowd is in, and a small ticket is buying their exit. Zero is off.
  It travels with the shareable settings code like every other entry number.

### Extra entry filters: the holder bar and the market cap band

- **A new switch in Settings opens a panel** with a minimum holder count and the market cap band. While the switch
  is on, a coin with fewer holders than the bar is never bought, and neither is a coin whose holder count cannot be
  read - a filter that silently passes when its data source is down is not a filter.
- **The count is real data**: it is read from the live market at the moment of buying (GeckoTerminal's token page,
  the same number their own UI shows) and remembered for ten minutes, so a buy attempt costs one request at most.
  The evaluator refuses a coin on the cached count with no request at all.
- The one press preset turns the filters on with a bar of **25 holders**, and the bar travels with the shareable
  settings code.

### Speed: waits overlap instead of adding up

- **An entry now builds its order while the pool price is still being read.** The trade door build and the bonding
  curve read start at the same moment; the build waits behind a gate, and a coin the desk refuses is discarded signed
  but never broadcast - the wire is the only place money can leave. That is one network round trip saved on every
  entry, and the refusal (the `Price dropped X% while the coin was being judged` gate) stays exactly as strict.
- **An urgent exit asks both doors at once, every time.** The two-door race used to be reserved for a spike far above
  the target; now every full exit races the primary route and the backup route and the first signed transaction wins.
  Measured before, a refused stop cost 1.2 s of re-quoting while the coin fell - with both doors in the air a stalled
  primary cannot hold a stop any more. The tolerance is still the exit's own: tight 15% while the coin is up, wide
  while it is under water.
- **The slot is reserved before any network wait.** Two coins passing at the same moment could previously both enter
  because the position was only written to the book after the price read; the allowed number of coins is now a promise
  the desk keeps from the first millisecond of an entry.
- **The curve is read at `processed`, the freshest state a node serves.** A price read at `confirmed` is a slot or two
  older than the pool really is; a fork rollback self-corrects on the next 120 ms poll, and the constant-product guard
  still refuses any account that is not a launch curve.
- **A buy no longer waits for the balance read before asking the chain.** The confirm loop and the wallet refresh run
  at once on every entry; neither answer depends on the other.

### A settings code can no longer hand you a broken plan

- **A pasted settings code goes through the same validation as a typed number** (`cleanSettings` in `main.js`). It used
  to be written straight to the store, so the money keys were only clamped on the path a person types into: a stranger's
  code could carry a **5 SOL priority fee on every transaction**, a 900-coin position limit, or a negative stop (which
  turns a stop into a target). No setting may be negative, `sessionLossLimitSol` is now clamped too, and
  `maxHoldSec` cannot be set to 0 - which does not turn the time limit off, it sells every coin the moment it is bought.
- **Codes shared before a setting existed keep working**: the payload is a positional list and new settings are only
  appended, so a shorter list is an older code rather than a damaged one. Every code already posted on X still applies.
- **A closed trade records why the coin was taken** - its score, buyer count and the five-minute picture - beside
  what it did.

### The entry was blind, and that is where the win rate went

- **An entry is now priced at the bonding curve, right now** (`_entryPrice`), in both modes. The board price - what
  every entry rule was judged on - can be a minute old: a scanned coin's row is refreshed in tens of seconds, an
  exchange that is rate limiting answers with an older row than the moment it arrived, and a launch can give back half
  its move in that time. Measured in paper against the live market, entries booked at the board's price showed **-18%
  to -31% on the very first pool reading**, which booked a stop loss **0 to 16 seconds** after the buy on a coin that
  had not fallen that far since the order. The exit rules were not late; the entry was blind. The pool is the number
  the order fills against, so it is the number the position is opened at.
- **A coin whose pool sits more than 8% below the board is not bought** (`BOARD_STALE_FRAC`). That gap means the coin
  is falling right now while the row we judged says it is rising, which is the shape of nearly every losing entry.
  The coin stays on the list with the reason (`Price dropped 34% while the coin was being judged`).
- **A coin running away from a slow row is still bought**, at the pool's price, because that is what it would cost;
  and a pool that is three times the board is treated as a foreign account rather than as a price.
- **No pool to read (a graduated coin, a node that will not answer in 700 ms)**: the board price is used only while
  the coin has been heard about in the last 30 seconds. A row nobody has refreshed is not a price.
- **A FINISHED curve is a fossil, and it is not read as a price.** When a coin graduates, its bonding curve stops
  moving at the graduation figure, so the "curve price" of a graduated coin stays at ~84 SOL for ever while the coin
  trades on PumpSwap at whatever its pool there says. Measured in a paper run on the live market, two coins were
  entered at the fossil and then "ran" **+264% and +308% within a second** - a phantom win of 0.05-0.06 SOL that never
  existed. `readCurveAccount` reported `complete` and nothing looked at it; the entry, the position poll and the price
  panel now all ignore a completed curve, and a graduated coin is priced by its market.
- **A price that jumps UP more than three times in one 120 ms reading has to be seen twice** before it moves a
  position; a fall is taken at once, because a stop must fire on the first reading. Two numbers from two sources are
  not a market move, and a phantom print must never be able to sell anything.

### The exit shape: a winner has to be allowed to be big

- **Seventy percent of the position is banked at the first rung** (+18% net) instead of forty at +22%. Measured over
  several paper sessions on the live market, a coin that reaches +20% comes back more often than it runs: a forty
  percent rung left most of the ticket exposed, and one measured coin **peaked at +84% and closed at -9%** because the
  bid vanished inside a single 120 ms reading. The rung is the win; the 30% that stays is the bonus, trailed by a share
  of its own peak.

- **The trailing stop now gives back a share of the peak, not a fixed number of points** (`_trailGive`): the room a
  runner gets is `max(trailGivePct, 45% of its own peak)`. The old rule gave back a flat 4 points and *tightened* to 5
  after the first rung and to 2 once the move passed three times the target - the exact opposite of what a runner
  needs. Measured in paper against the live market, every profit rule in a session closed between **+6% and +12%**
  while the losses filled at **-21% to -33%**. That is a desk whose winners cannot pay for its losers, and no entry
  rule can rescue it. A coin up 100% wobbles 15-20 points without changing trend.
- **The preset's exit shape was rewritten for that arithmetic**: 70% banked at +18%, the rest a runner closed by the
  proportional trail (arm +12%, floor 8 points) or a +130% moon target, stop 9%, hold 240 s.
- **The entry ceiling came down: skip a coin already up 35% in five minutes** (was 120%, briefly 60%). Four entries
  measured in paper under the old ceiling were all bought near their top and every one of them stopped out; the bars
  are now score 68 and eight buyers, not 64 and six.
- **A closed trade keeps what it was worth at best**: the row carries `heldSec`, `peakPct` (the best net move while
  it was held), `firedPct` (the move that fired the rule) and the price source, and the window prints
  `peaked +41% · held 2m` beside the fill. A trade that peaked at +41% and filled at +8% is an exit that was too
  early, and that fact must not disappear with the position.
- **The styles follow the same shape** - take profit 60/90/150%, first rung 18-30% for 30-50%, stop 6/9/12%, trail
  arms 14/18/22% with floors of 8/12/15 points, hold 150/200/300 s.

### The percentages are net, and the plan follows them

- **Every rule is now measured net of the whole round trip** (`_costPct`): the protocol's 1% each way plus both
  priority tips. On a 0.004 SOL ticket that fixed part is about **13%**, so a take profit at a gross +12% was booked
  at roughly +5%, and a break-even order - armed "after a peak of 6%" - sold the coin at the cost of doing business.
  This is the root cause of the sale that read `Take profit, -5.2%`: the rule that fired was right, the number it
  fired on was gross. A percentage in the window is now the money the trade really made, and a rule fires only when
  the ticket is really that far up or down.
- **No style carries a break-even rule any more** (`breakEvenPct: 0` everywhere). At a net zero the trade has paid
  its costs and earned nothing, the fill lands under the reading that triggered it, and the rule pre-empts the
  trailing stop, which sells at arm minus give - above water by construction. A rule that sells winners early and
  books a small loss is worse than no rule.
- **The styles were rewritten around that cost**: take profit 18-45%, first rung 10-15% for half the position, stop
  7-15%, trail arms 6-12% and gives back 3-6%, hold 60-100 s. The exit ranges working snipers converge on, expressed
  in net numbers.
- **The one press preset is a patient one-slot desk** (the final numbers are in the exit-shape section above and in
  `docs/SETTINGS.md`): score 68+, eight buyers, +2 SOL net buying, pool 2000 USD+, the 4-35% five-minute band,
  70% banked at +18%, the rest to +130% or the proportional trail, stop 9%, hold 240 s, ten buys a minute, an
  eight-minute rest after five losses.
- **The session cap follows the ticket instead of being a fixed number.** A flat 0.35 SOL was eighty-seven trades at
  a 0.004 SOL ticket - a countdown, not a limit. The preset now writes **eight tickets** (clamped to 0.01-0.35 SOL),
  and a ticket bigger than a third of the cap is lowered to that third.

### Speed, and never selling a winner at a loss

- **The coins being held are priced at the bonding curve.** The trade stream (the same number the buy was priced
  at) sets the price; an aggregator quote is only the fallback while the stream is quiet. Measured live, an
  aggregator quote on a fresh coin moved **+135% to -70% within a second**, because our own sale is a large share of a
  pool that small - a take profit at +30% could be followed by a "fill" at -5%. The price is frozen while an exit is
  in flight, and a quote that jumps more than 40% in one tick is not believed.
- **A signal has to hold before the bot sells** (`triggerHoldMs`, 400 ms by default). A take profit or a stop must be
  seen again after that, on a fresh price. A spike that is gone in one tick is not a signal. The creator selling and
  the time limit act at once, because they are not price thresholds.
- **A winner is never closed at a loss.** If a take profit has slipped back to break-even before the order goes out,
  the sale is abandoned and the next tick decides.
- **An exit no longer waits ten seconds on an order that never landed**: its confirmation budget is 2.5 seconds, then
  it is retried. An urgent exit is never tighter than 20% tolerance and a runner far above its target gets 40% and
  both execution doors at once, because taking a worse price on the first order beats a second round trip.
- Positions are polled every 150 ms, the decision loop runs every 50 ms, the window repaints every 400 ms, and a
  signed transaction goes to three RPC nodes at once. Measured on chain: buys land **168 ms** after the decision,
  sells **163-419 ms**.
- **The open positions have a channel of their own.** They are pushed whenever a price moved - twenty times a second
  at most - and the panel patches the number in place instead of rebuilding itself, so the percentages follow the
  market and the Sell buttons are never thrown away under the pointer. Waiting for the whole window made a live
  position look frozen for up to 400 ms.
- **Nothing in the network sits in front of a decision.** A trade on a held coin prices it the moment it arrives, and
  the poll that closes a position now reads the curve before it asks any quote. It used to await a quote request
  first, so a move the stream had already delivered was acted on hundreds of milliseconds late. A quote is also only
  asked for a coin whose curve has gone quiet - the request itself was spending the rate limit the whole app shares.
- **Every sale line names the rule, the move that fired it and the move that filled** when the two differ:
  `Sold UNICORN (Take profit at +70.1%, filled at -5.2%)`.

### Money, shown honestly

- **Profit / Loss is the wallet.** In Real Money mode the figure is what the wallet really did since Start - every
  transaction, every tip, every rejected order - plus the coins it still holds at the price they trade at. The fees
  paid are printed under it (`fees 0.0020 SOL`, and how many orders were refused). A book that adds up trades can
  never show a tip that bought nothing.
- **The P&L of a sale comes from the transaction itself** (`meta.preBalances`/`postBalances`). Reading the wallet
  twice was wrong: two RPC nodes sit at different blocks, so the difference carried the previous trade and a real
  profit was reported as a loss of the whole ticket.
- **Two accounting bugs are gone**: rent returned by a closing transaction was counted as profit, and a partial sale
  charged the entry tip twice (a remainder sold at +14% was booked as a small loss).
- **A holding the book never bought is never given a made-up cost.** A coin found in the wallet used to be booked at
  the ticket size with an entry price of 1 when no price was known - which invented an entry nobody paid, a loss the
  moment it sold, and an instant "take profit at +3900%". The exchange rate is now fetched before anything is valued;
  a holding with a price is booked at its own market value, and one with no price anywhere is sold as a leftover
  instead of being called a position. A position with no reference price reads as 0% until its first real price, and
  that price becomes the reference.
- **The rent of a sale can no longer be counted twice or lost in a race.** Whether the token account was closed by
  the sale is now returned with the balance read itself, instead of a field another balance read could overwrite
  between the answer and its use.
### Sending, and landing in a crowded slot

- **Jito bundles, optional and off by default.** Every signed trade is also offered to Jito's block engine as a
  bundle - the trade plus one tip transfer - while the same bytes still go to the normal RPC doors. A bundle lands
  whole or not at all, so the tip is paid **only when the trade with it lands**; a lost auction costs nothing, and
  the fee counter never claims a tip that was not paid. The tip is a setting (0.0001 SOL by default), raised to the
  block engine's own floor if it is typed lower, and the tip transaction is checked instruction by instruction before
  it is signed. The client, the lane and the guards are covered by a tenth test suite.
- **The fee line counts the tips the wallet really paid.** A swap through the backup route pays no priority fee of
  ours - it takes its cut inside the fill - so charging the tip to the counter made the fee total a number that could
  not be reconciled with the wallet.
- **A number that could not be read is drawn as a dash, not as zero.** A balance the RPC did not answer used to
  appear as `0.0000 SOL`, which reads as an emptied wallet, and an unknown profit as `+0.000`.
- **The bot can no longer spend its own exit fees.** A reserve - the rent-exempt floor plus a fee and a tip for every
  open position - is never spent on an entry, an order in flight is counted against the wallet, and a withdrawal may
  not take it. Measured live: the wallet once sat at 0.00066 SOL with coins that no longer had a way out.

### Selling everything, and getting the rent back

- **Every sale ends with the coin's account closed and its rent returned.** The trade door keeps a cut of the tokens,
  so even a 100% sell leaves a remainder that holds ~0.00204 SOL of rent. The remainder goes out through the trade
  door first (the backup route has no quote for an amount that small - that is why leftovers sat in the wallet for
  ever), and only a leftover worth less than its own rent is burned so the account can be closed. Verified on chain:
  **0 token accounts left, 0.00799 SOL back in the wallet**.
- **The Sell buttons answer.** A press of Sell and of Sell all used to fire the trade in the background and return
  nothing, so with no SOL for the fee the button looked dead. Both now wait and say what happened, in plain words.
- **Sell all pauses new entries for two minutes**: the press is an instruction about the market, not only about the
  coins.
- **Recent trades can no longer disappear**: rows are built before the panel is swapped, so one bad value cannot
  leave an empty box that never re-renders.

### The whole market, and a plan that was measured

- **Ten discovery doors**, including the DexScreener search board (its query walks the words memecoin symbols are
  made of) and GeckoTerminal's newest pools. 150-220 coins tracked in a normal session, with a switch
  (**Every coin source**) to watch the launch feeds only.
- **A coin that is falling right now is never bought**, and a coin that is dumping hard is refused outright.
- **A plan that had been measured, not guessed.** Three plans ran side by side against the live market in paper mode
  on one slot: banking 60% at +15% and letting the rest run to +30% gave **44% wins and a positive result** where a
  single 45% target with an 18% stop gave **0% wins**. That shape - bank part early, let the rest run - is what the
  styles still carry; the numbers themselves were superseded by the net plan above, where the same rung is 50% at
  +12% and the target is +28%, because a gross +15% was only worth about +7% after the round trip.

### Share your settings
- **A code for X.** Settings has a **Share your settings** card: it writes a code of about 165 characters
  (`PCS1.…`) carrying the entry bar, the whole exit plan, the size and pace, and the cost ceilings. Another field
  takes someone else's code and applies it, and one button opens X with the line and the code filled in.
- **What a code can never carry**: no API keys, no RPC URL (a stranger's endpoint would see every transaction), no
  wallet, no mode, no open positions. The payload is a version, a profile name and a list of numbers, and a test
  asserts exactly that.
- **Damage is refused, not half applied**: a two-character checksum catches a mistyped or truncated code, and the
  ticket stays at the user's own value unless the code's is smaller.

### Fixed

- **Every refused sell skipped its rescue.** The re-quote path in `_sell` referenced an undeclared `s`, so a
  `6002`/`6005` on an exit threw `s is not defined` and the backup route was never asked. Found live and now covered
  by a test that asserts the sell ladder.
- **The same coin could be bought twice while its exit was landing.** The one-entry-per-coin and cooldown checks lived
  only in the decision path; both are checked again inside the buy now.
- **A leftover was booked as a position.** Adoption priced every token account at the ticket size, so dust entered
  the books as a full position, invented profit and was sold over and over. A holding is valued first now.
- **A refused exit is re-quoted at the exit's own tolerance**, not at the entry ceiling.
- **The guards around foreign transactions are stricter**: a burn is only signed for the token that was selected, and
  a `CreateAccount` that funds a new account counts against the SOL ceiling like a plain transfer does.
- **Public RPC reality**: the pool is the five hosts that answered a funded wallet, a host that refuses a full
  token-account listing is remembered instead of retried, market data is paced so three pollers cannot trip a rate
  limit, and a chain refusal reads as a sentence (`the price moved before the order landed`) instead of raw JSON.
  `6063` - a coin quoted in another token - retires the coin instead of paying for it again.
- **The price service has its own budget.** A rate limit on Jupiter's token index used to bench the price service with
  it, so a coin being held could lose its quote for eight seconds for a reason that had nothing to do with prices.
- **The DexScreener budget is spent by everything that talks to it**, not only by the slow sweep: a burst of
  discovery followed by three price calls was tripping a 429 that then benched the host. An exit never depends on
  that host, so nothing urgent is held back by it.
- **The settings file is written atomically, and damage is reported.** It used to be rewritten in place, so a crash,
  a full disk or a sync client could leave it half-written - and the app then read that as a first run and carried on
  with the defaults: a different ticket, a different plan, and a book of open positions that no longer existed. It is
  now written beside the real file and renamed over it like the wallet, a damaged file is kept as
  `settings.json.broken`, and the log says what happened before anybody presses Start.
- **One token programme refusing a scan no longer throws the scan away.** A host that does not index Token-2022 used
  to cost the wallet the rent of every account it could still close; only two failures together are a failure now.
- **Two coins closing in the same second both get their rent back.** The settle that sells the leftover and closes the
  account was guarded by a single flag and simply returned when another one was running, so on a sell-all only the
  first coin left the wallet clean and every other leftover stayed behind with its ~0.00204 SOL. Each settle now waits
  in a queue, and an account close that arrives while a cleanup is in flight waits for it instead of throwing the rent
  away.
- **The Jupiter API key setting is gone**: the route and the price service need no key, so the field was an option
  that changed nothing.

## Pre-release development

Notes written while the build that became [1.0.0] was in progress. The release itself is documented at
the top; where an early note below says something the release changed, the top wins.

### Trading

- Market scanner with seven discovery sources: newest tokens on the market, trending, top traded, boosted,
  fresh profiles, every pump-fun pool and the trending pools on GeckoTerminal. New launches are polled on
  every cycle because that list only spans about a minute.
- Two speed pricing. Open positions and the best candidates refresh about once a second, the whole token
  table every three.
- Score from 0 to 100 per coin, with the reason it was refused written next to it.
- Entries gated by market cap band, buyers, net flow, price movement, creator behaviour, pool depth,
  wallet concentration and token flags.
- Exits: take profit, trailing stop after the coin runs, stop loss, creator sold, time limit, and an
  optional first partial take profit that sells part of the position and lets the rest run.
- An optional break even rule that was later turned off everywhere before the release: at a net zero the
  rule sells at the round trip's own cost, and the trailing stop protects a winner better.
- Smart fees follow the live fee market and widen slippage when an exit must land.
- A refused order is answered by the backup route, not by the same door again. Measured on chain, the
  chain refuses a fresh buy with `6002` when the price ran between the quote and the landing, and the
  backup route quotes fresh and puts the tolerance on the tokens, so the ticket stands.
- A coin whose curve is quoted in another token is retired after one attempt. `6063` is
  `UnsupportedQuoteMint`, read off the program log of simulated orders: nothing on that curve can fill a
  SOL order, so a second attempt would only spend time.
- A coin that finished its curve mid order is marked graduated and followed to the new pool, or left
  alone when graduated coins are switched off. Both are remembered, so neither is asked twice.
- Pause after a losing streak, session loss limit, buys per minute cap, positions cap. The pause names the
  streak that caused it and lasts minutes, not a quarter of an hour.
- Practice Mode with the same rules and a fees aware fill model.

### Speed to the first trade

Measured on the live market with the default settings: the first coin is bought **4 to 10 seconds** after
Start, and three to eight entries are made in the first minute. Getting there needed three things:

- Coins found by the market scan are judged on a five minute window, so their buyer bar is scaled to that
  window instead of demanding a stream sized crowd. Measured before the change: 28 of 60 coins were
  refused on the buyer count alone.
- The score bar and the market cap band in the Balanced style, which is what a fresh install runs, are
  set for a coin that is still moving rather than for a coin that already proved itself.
- The watch time before an entry and the losing streak pause are short: two seconds and three minutes.

### Safety

- A position is open from the moment it is broadcast, so its stop, target and time limit work while the
  chain is still confirming the entry.
- Confirmation separates a rejection from a missing answer. Only an order the chain actually rejected is
  treated as "never landed", so a busy RPC can never buy the same coin twice.
- An open position follows the market board when the trade stream for its coin goes quiet, anchored at
  the last stream price, so a graduated coin can still hit its stop.
- Real positions are written to disk on every change and restored when the bot starts again, checked
  against the wallet: coins that are there are adopted, coins that are not are dropped.
- Every sale is booked from the wallet balance, not from the request. A fill that sells half of what was
  asked leaves the other half as a position and books exactly what left.
- A position the RPC could not vouch for, and which the wallet then proves never existed, is dropped
  instead of being booked as a sale, so the real result never carries a trade that did not happen.
- Every transaction built by a third party is inspected before it is signed: the Sol Incinerator route
  may only close our own empty accounts or burn the selected token, and the Jupiter route may not
  approve, change an authority or move more SOL than the ticket.
- A withdrawal is signed once and confirmed by signature, so a node failure cannot pay it twice.
- The wallet cannot be locked, replaced, removed or drained while positions are open, and the mode cannot
  be switched while the bot runs. Closing the window with real positions open asks first.
- A damaged wallet file is reported as damage, not as an empty slot, and is never overwritten by accident.

### Data and plumbing

- Works with no API keys. PumpDev is optional and only makes prices faster. The Jupiter swap route is
  keyless as well, so the backup door works on a fresh install.
- RPC pool with health scoring, cooling down and rotation on refusal. Every call carries a total budget,
  and a transaction broadcast gets a short one, so a slow node cannot hold an exit while the price moves.
  The public nodes in the pool were measured against a funded wallet, and the four that answered a paid
  plan or nothing at all were removed.
- On chain Pump.fun decoder as an alternative feed with a private RPC.
- Subscription budget, so a free trade stream plan is never exceeded: twenty coins batched into one
  subscribe and one unsubscribe per cycle.
- Market cap in SOL read from the native price, so the dollar price of SOL is never needed.

### Wallet

- Encrypted wallet with AES-256-GCM and a scrypt derived key.
- Create, import, unlock, lock, export with a password, withdraw.
- Every trade transaction is inspected before signing. Unexpected SOL transfers are refused.

### Recovery

- Automatic close of empty token accounts after a sell, about 0.00204 SOL each.
- Sol Incinerator integration for leftovers, optional.
- Wallet scan that shows what can be recovered before anything is touched.

### Interface

- One window, six tabs, no page reloads.
- One press preset that applies a tuned set of numbers for a small wallet.
- Practice and real money keep separate statistics, each resettable on its own.
- Live coverage line: how many launches arrived this minute, how many coins came from each door, how many
  are priced and how many are live.
- Every settings change re-renders the whole settings view, so the quick chips and the advanced form can
  never disagree.
- Custom ticket size from 0.001 to 1 SOL with one click, hard capped at 5 SOL in the engine.
- Wallet maintenance: create a new wallet or remove this one, both behind the password and both blocked
  while the bot is trading.

### Safety fixes in this release

- A buy whose transaction may already be on chain is never re-sent through the backup route, which used to
  risk buying the same coin twice.
- Slippage is a real ceiling for every order, exits included.
- A coin that fell hard over five minutes is refused even when a fresh trade makes it tick up.
- A market dominated by sellers is refused.
- The Start button waits for the settings to load, so an early press cannot be swallowed.
- A failing on chain feed reports once a minute instead of ten times a second.

### Data corrections in this release

- Jupiter reports `stats5m.priceChange` as a percentage, and the scanner was multiplying it by a hundred a
  second time. A coin down half a percent read as a fifty percent dump, so Jupiter-sourced coins were
  refused as "Dumping hard" while a real mover looked a hundred times stronger than it was.
- The two safety flags the scanner read from Jupiter (`isSus` and a top-level `freezeAuthority`) are not in
  the response at all, so the "flagged risky" and "can be frozen" rules could never fire. They now read the
  audit block the API really publishes, and a new `maxDevHoldPct` rule refuses a creator who still holds a
  third of the supply.
- A pair with an empty five minute bucket inherited the hour's trade counts, which made a pool that had
  stopped trading look like it was being bought.
- The reason shown next to a scanned coin said "buys" and compared a count of wallets. It says buyers, which
  is what the number is.
- Removing the wallet used to pull the full private key into the window just to check the password. The
  check now runs in the main process and the key never leaves it.
- The rent recovery path had no time budget on its RPC calls, so one slow node could hold the cleanup for a
  minute. It now has the same budgets as the trade path.
- A retired setting is dropped from the settings file on start instead of being carried forever.
- The exit that fired is reported in the order the money cares about. A coin that gapped from +12% to -31%
  in one tick used to be logged as "Break even" while it had actually blown through the stop; the stop is
  now checked first, so the card and the log describe what happened.
