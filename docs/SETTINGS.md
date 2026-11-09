# Settings reference

## The bump desk (1.1.2)

These live in the same settings file as everything else, are validated with the same limits, and are the only keys
prefixed `bump`. **The wallets that run them are not settings** — their keys live in their own sealed file and appear in
no settings code. Full explanation in [BUMP.md](BUMP.md).

| Key | Default | Range | Meaning |
| --- | --- | --- | --- |
| `bumpMint` | `''` | a Solana address | The token being bumped. Checked for shape before it is stored |
| — | — | — | **The desk address and the pool keys are not settings.** They are sealed in `bump-vault.json` and `bump-wallets.json` |
| `bumpBudgetSol` | `0.3` | 0.005–50 | The whole run's budget: trades, fees and rent, split evenly over the wallets |
| `bumpAutoAmount` | `true` | on/off | Work the ticket out of the budget, the length and the pace. The wallet count is always yours. Off means every number is yours |
| `bumpWallets` | `6` | 2–40 | The pool size, exactly. If the budget cannot park the rent for that many, the plan says so and names the pool it can carry instead of using fewer behind your back |
| `bumpMinSol` / `bumpMaxSol` | `0.004` / `0.012` | 0.0002–2 | The band each bump is drawn from, to the lamport. Derived from the budget unless `bumpAutoAmount` is off |
| `bumpPerMinute` | `18` | 0.1–600 | The pace, with jitter on every gap |
| `bumpBuysPerRound` | `1` | 1–10 | Buys in one round; the round ends with ONE sell of the whole bag, then the wallet starts again |
| `bumpBuysRandom` | `false` | on/off | Every round draws its own count, between 1 and `bumpBuysPerRound` |
| `bumpBuyRatio` | `70` | 0–100 | Kept so an old settings file still loads. The buy share is now `buys / (buys + 1)`, which the round decides |
| `bumpHoldMinSec` / `bumpHoldMaxSec` | `25` / `90` | 1–3600 / 1–7200 | How long a bag waits before it is sold. Below the gap between bumps, the hold decides the mix instead of the ratio |
| `bumpMinutes` | `15` | 0–1440 | Run length. `0` runs until you stop. Paused time is added back |
| `bumpSlippagePct` | `1` | 1–50 | 1 is the floor every route accepts and the cheapest setting there is |
| `bumpPriorityFeeSol` | `0.000001` | 0.000001–0.01 | The tip per transaction, jittered so no two are identical |
| `bumpUseJito` | `true` | on/off | Send each bump as a Jito bundle (one wallet's trade plus its tip). Lands the trade on a busy block; costs the tip on every bump |
| `bumpJitoTipSol` | `0.00001` | 0.000001–0.01 | Paid by the trading wallet, only when the bundle lands. 0.000001 is Jito's floor |
| `bumpJitoBundle` | `2` | 2–4 | Unused by the bump desk (a bundle is one trade plus its tip); kept so old settings files still load |
| `bumpSimulate` | `false` | on/off | Dry run: counts bumps and cost, sends nothing |
| `bumpSellBack` | `true` | on/off | Sell the bags back when the run ends |

## Pro defaults

New profiles and **Best Profit** use advanced scoring, one position, three entries per minute, an 8% round-trip fee limit, a 20% target and a 12% stop. A trailing stop arms at +14%. In Practice, the button starts broad discovery and opens Live Feed. In Live mode it applies settings only. The scanner ranks qualifying candidates in each scan batch by score and then net inflow. Streaming events can also trigger immediate evaluation. Applying the preset preserves the ticket, mode and any lower session loss limit. Historical presets and observations below describe earlier versions.

## Changes in 1.0.1

Practice settings now include `paperLatencyMs` (0–10000), `paperBaseSlippagePct` (0–50), `paperUnknownImpactPct` (0–90), `paperFailurePct` (0–100), and `paperSeed`. They appear in advanced settings and do not change live orders. The seed applies after restart.

The High capital preset uses the existing `aggressive` identifier, with two positions and four entries per minute. It enables advanced checks, requires five seconds of token age and caps estimated round-trip cost at 8%. It does not change the ticket or mode. No preset has a verified profitability result.

Live entries now require a known creator, a fresh wallet-level trade stream and a successful on-chain mint risk check. These gates also apply to simple mode. See [release audit](AUDIT-1.0.1.md) and [replay documentation](BACKTESTING.md) for accounting limits.

The remaining reference below includes historical provider observations; quotas and availability can change.

Every setting lives in `settings.json` in the app data folder and is editable in the app. Values are
validated on save, so a typo cannot turn into a ruinous number.

**Nothing is hidden.** Every number the rules read is a setting with a field in the app, so a plan can be
reproduced, shared (a settings code carries the plan, never a key) or replaced by your own. The keys below
are grouped the way the Settings screen groups them.

App data folders:

- Windows: `%APPDATA%\PillCrew` (copied from `PillCrew Sniper` on the first boot of 1.2.0 — nothing is lost by the rename)
- macOS: `~/Library/Application Support/PillCrew`
- Linux: `~/.config/PillCrew`

## Your own keys and endpoints

| Setting | What it does | Where to get it |
| --- | --- | --- |
| `rpcUrl` | Your own Solana RPC, tried before the public nodes. A paid node (Helius, Triton, FluxRPC, QuickNode) is the single biggest speed-up for a live desk: the feed, the entry price read and every transaction go through it | your provider's dashboard |
| `rpcBackupUrl` | A second private node, tried right after the first and still ahead of the public pool. Measured with two private nodes: FluxRPC timed out once during a session and the desk moved to Helius without losing a trade | your provider's dashboard |
| `rpcWsUrl` | The trade stream's own socket, used verbatim. A provider's WebSocket is often on a **different host** than its HTTP endpoint (FluxRPC: `wss://ws.eu.fluxrpc.com` against `https://eu.fluxrpc.com`), and a URL guessed by swapping the scheme simply never connects. Empty means derive it from the RPC URL | your provider's dashboard |
| `pumpdevKey` | The live trade stream (launches and per-coin trades). 50,000 messages a month on the free plan, launches are not counted. The free plan also caps **25 live subscriptions per address**, which the desk respects by watching twelve | pumpdev.io |
| `jupiterKey` | Sent as `x-api-key` on every Jupiter call: the backup swap route, the price service and the token lists | portal.jup.ag |
| `incineratorKey` | Burns leftovers and closes the empty accounts, returning the rent (2% of what is recovered). Closing empty accounts is free in the Wallet tab without a key | Sol Incinerator dashboard |
| `feedSource` | Which launch door to use: `auto`, `chain`, `pumpdev`, `pumpportal` | - |

**What a Jupiter key does and does not buy.** Measured with a real key on 2026-11-05: twenty quick calls answered
**five** and refused fifteen, one call every 700 ms broke on the fourth, and one every 1.1 s did not. The key is
accepted and sent on every call, but the public tier refills at about **one request a second**, so the desk keeps its
own bucket: two calls a second for Jupiter (a cycle asks the token index and then one wide door), separate from
DexScreener's four. A paid tier is what raises the ceiling - the setting is what lets you bring one.

Keys are validated (letters, digits, `.`, `_`, `-` only), are stored locally, are never printed back into the
window, are never logged, and are **never** included in a shared settings code.

## The clocks and the cost gate

| Setting | Default | Meaning |
| --- | --- | --- |
| `minTokenAgeSec` | 0 (off) | Do not buy a coin younger than this. A launch five seconds old has no tape to judge - its buyers are the dev and his friends |
| `maxTokenAgeSec` | 0 (off) | Do not buy a coin older than this. The whole-life version of the five minute ceiling: past it the move has happened |
| `maxRoundTripPct` | 20 | Refuse any ticket whose round trip (both fees plus both tips) costs more than this share of it. **5% is the floor**: at 0.001 SOL the two tips alone are 40% of the ticket, and a desk with no gate loses the ticket to its own fees |

### How fast a coin is looked at, and where the waiting went

Three numbers decide how quickly the desk reacts, and none of them is a setting — they are the shape of the engine:

| What | Value | Why that number |
| --- | --- | --- |
| Scan gate | 250 ms | A coin is re-judged four times a second. One judgement costs about 4 µs of CPU, so a full list of three hundred coins costs under half a percent of one core |
| Tick | 25 ms | The exit ladder is measured against the price forty times a second, so a stop or a target cannot sit unseen between two ticks |
| Entry price from the tape | 1.2 s | A coin that traded within this window already carries the pool's own price (`pxEntry` stays `curve`). Only a quiet coin waits for a node read, and that read is capped at 500 ms |

The point of the last row is what it removes: the entry used to wait 450–700 ms for a second copy of a number it was
already holding, exactly between "this coin qualifies" and "the order goes out". A fresh coin now reaches the order in
roughly a quarter of a second instead of more than a second. The provenance is unchanged, so a fall is still taken at
once only when the entry came from the pool — a price from a market row never gets that treatment.

## Styles

A style sets a whole plan at once. Choosing a style overwrites the current values.

Every percentage in this table is **net of everything the trade costs** - the 3% protocol fee on both sides
plus both priority tips, which at a 0.004 SOL ticket is about 13% of the ticket and at 0.02 SOL about 5%.
That is the number the cards show and the number the rules act on, so "+12%" means the trade is really 12%
ahead, not 12% before it paid for itself. See [Why the percentages are net](#why-the-percentages-are-net).

| Setting | Safe | Balanced (the shipped plan) | High roller |
| --- | --- | --- | --- |
| Minimum score | 70 | 50 (not a gate in the simple plan) | 78 |
| Buyers needed (20 second window) | 6 | 70 | 30 |
| Net buying needed (SOL) | 2 | 2 | 2 |
| Market cap band (SOL) | 20 to 80 | 60 to 15000 | 60 to 500 |
| Pool depth needed (USD) | 4000 | 4000 | 4000 |
| Five minute band (%) | off | off | off |
| Take profit (%) | 60 | 80 | 60 |
| First take profit (%) / how much | 18 / 50 | off / off | off / off |
| Stop loss (%) | 6 | 45 | 12 |
| Max hold (seconds) | 150 | 500 | 240 |
| Trailing stop arms at / gives back (%) | 14 / 8 | 14 / 8 (inert while simple is on) | off / off |
| Break even after a peak of (%) | off | off | off |
| Slippage ceiling (%) | 8 | 8 | 15 |
| Priority fee ceiling (SOL) | 0.0002 | 0.0002 | 0.0005 |
| Coins held at once | 1 | 6 | 2 |
| Buys per minute | 8 | 10 | 4 |
| Session loss limit (SOL) | 0.08 | 1 | 0.04 |
| Pause after losses in a row / minutes | 5 / 8 | 10 / 5 | 5 / 8 |
| Creator bag allowed (SOL / %) | 3 / 35 | 12 / 30 | 3 / 35 |
| One wallet may buy (%) | 45 | 40 | 45 |
| Fee gate (% of ticket) | 20 | 8 | 8 |

**Balanced is the shipped plan** (`PCS1~…`) , and it is built around one idea:
**wait for a crowd, then give it room.** Fifty distinct wallets and 2 SOL of net buying inside a 60-15000 SOL band
is a high bar, so the coin that passes it is given a wide stop (45%), a distant target (80%) and 500 seconds. The
five minute band is off - the crowd test replaces it - and the score is computed and shown but does not gate
anything while the simple mode is on.

Two things ship with it that are worth knowing before changing anything:

- **the fee gate is 8% of the ticket.** At 0.1 SOL a round trip is about 3.9%, so the plan has room; at 0.01 SOL the
  tips alone are 10% and the desk refuses the configuration in words instead of trading at a loss;
- **the trailing stop's 14/8 is carried but inert** while the simple mode is on: the simple ladder is the target, the
  stop, the time limit and the give-back floor. Turning the simple mode off makes those two numbers live again.

**Four checks stay on in the simple mode even though they are filters**, because they only ever *refuse* a
coin and never cost a request: the creator's bag (`maxDevHoldPct` 30%, `maxDevBuySol` 12 SOL), one wallet buying
40% of the tape (`maxTraderSharePct`) and a pool too thin to absorb an exit (`minLiqUsd` 4000). They read the row the
entry was judged on anyway. Measured: one rug (`$SAFU`, peaked at +3.5%, stopped at **-101.4%**) took a whole
session, and a coin whose creator holds most of the supply is the coin that does that.

No style carries a break-even rule any more, and that is a correction rather than a simplification. At a net
zero the trade has paid its costs and earned nothing, the fill lands under the reading that triggered it, and
the rule pre-empts the trailing stop, which sells at arm minus give - above water by construction. It also
fought the rule that protects a winner: three plans were run side by side against the live market in paper
mode, and banking part of the position at the first real move gave **44% wins and a positive result** over
seven minutes, where a single distant target with a wide stop gave **0% wins** and a loss over the same
period. Most winners on this market are given back before a distant target is reached.

**The trail gives back a share of the peak, not a fixed number of points.** The number in the table is the
floor: the room a runner gets is `max(trailGivePct, 45% of its own peak)`. Measured in paper with a fixed
give-back (4 points, tightened to 5 after the first rung and to 2 once the move passed three times the
target), every profit rule in the session closed between +6% and +12% while the losses filled at -21% to
-33% - a desk that cannot pay for its own losers, whatever the entry rule does. A coin up 100% wobbles by 15
to 20 points without changing trend, and a flat trail sells it at the first wobble. The floor still protects
a small peak tightly.

## Why the percentages are net

A pump.fun trade costs 1% each way, plus a priority tip on each transaction, plus the pool rent that comes
back when the account is closed. At a 0.004 SOL ticket the fixed part dominates: two tips at 0.0002 SOL are
10% of the ticket on their own. A rule written in gross percentages hides that - a "break even at +6%"
gross is a booked loss once the round trip is paid for, and a take profit that reads +12% before fees is
really +5%. `_costPct` is the fix: the engine subtracts the whole cost from every move before any rule looks
at it, so a stop loss at 10% fires only when the ticket is really 10% down, and a take profit at +12% books a
real 12%.

Coins found by the market scan get a wider market cap ceiling (four times the style value) because they
are already a few minutes old when they are first seen. The entry size and the stop limit the risk, not
the cap.

The slippage ceiling is the promise for **entries**. An urgent exit (stop loss, trailing stop, creator sold,
time limit, manual sell) is never tighter than **20%** and never wider than **40%**, whatever the ceiling
says: measured on chain, a stop refused for tolerance instead of filling cost 1.2 s of re-quoting while the
coin fell, and one more order is always worse than a lower price. The one exception is a runner far above
its target (twice the take profit): there the tolerance is cut to **15%**, because a wide tolerance does not
raise the fill, it removes the floor - measured live, a coin that peaked at +70% was given 40% and filled at
-5%, while the same coin given 15% either filled near the level or was refused and sold by the trailing
stop. A take profit is not urgent: it uses the ceiling, because that order is the one that is worth waiting
a moment for.

## One press preset

The Settings screen has a single button that applies a tuned set of numbers. It **only writes settings** — it never
starts the bot, in Practice or in Real Money (one press that both filled in a plan and began trading was a trap, and
it is gone). Press Start when you are ready. Every value it writes can still be edited by hand afterwards. It applies
the **same plan the app ships with** (the `balanced` style with the simple mode on), so a press of the button and a
fresh install cannot disagree.

| Key | Value | Why |
| --- | --- | --- |
| `simpleMode` | on | Only the target, the stop, the time limit and the give-back floor decide when a position leaves. Everything else is still computed and shown, it just does not gate anything |
| `minScore` | 78 | A coin should arrive with a crowd already buying it |
| `minBuyers` | 30 | Thirty wallets in the window (sixty buys over five minutes for a scanned coin) |
| `minNetFlowSol` | 2 | Demand has to beat supply by a real amount, not by noise |
| `minMcSol` / `maxMcSol` | 60 / 500 | The band where a twenty point move is still possible. The simple mode applies the ceiling literally - the four-times ceiling is for scanned movers on the full desk |
| `minLiqUsd` | 4000 | A pool that can absorb an exit without gapping |
| `maxChange5mPct` | 30 | Skip a coin already up 30% in five minutes: that is somebody else's exit. Measured in paper, entries bought under the old ceiling of 120% were all bought near their top and every one of them stopped out |
| `minChange5mPct` | 2 | The floor of the same band: a launch that has not moved yet is where a move starts |
| `deepEntry` / `minHolders` | off / 0 | The holder bar is an advanced filter, and the simple mode turns advanced filters off (a count that cannot be read refuses every coin, which happened for hours on 2026-11-05) |
| `maxDevHoldPct` / `maxDevBuySol` | 30 / 3 | No coin where the creator kept a third of the supply |
| `tp1Pct` / `tp1SellPct` | 0 / 0 | No first rung: on a three minute window a partial exit leaves the rest of the ticket to give everything back |
| `takeProfitPct` | 20 | The target, the same size as the stop |
| `trailArmPct` / `trailGivePct` | 0 / 0 | No trail in the simple plan (the give-back floor below does the job a trail would, without a second ladder) |
| `breakEvenPct` | 0 | Off. It would sell at the cost of the trade, which is a booked loss |
| `stopLossPct` | 20 | One ticket of risk, the same size as the target |
| `maxHoldSec` | 180 | Three minutes: a coin that has not paid by then is not going to |
| `triggerHoldMs` | 400 | A take profit has to hold this long before it sells: a spike that is gone in one tick is not a signal. Stops, trails and the give-back do not wait for it (see below) |
| `slippagePct` | 15 | A ceiling that still lands on a busy chain |
| `priorityFeeSol` | 0.0002 | The cheapest tip that is not ignored |
| `maxPositions` | 3 | Three slots: enough to see a session's worth of signals, few enough that one bad coin is a third of the book |
| `maxBuysPerMin` | 20 | An entry cap, not a target |
| `maxLossStreak` / `pauseMinutes` | 5 / 8 | A cold streak is the market telling you something; sit it out |
| `sessionLossLimitSol` | 8 tickets | Not a fixed number: the cap is eight tickets, clamped to 0.01-0.35 SOL |

The ticket size and the mode are never raised by the preset. A ticket larger than a third of the session
cap is lowered to that third, because a ticket that size turns the cap into a one-trade stop. The session
cap itself is rewritten as **eight tickets** (0.032 SOL at a 0.004 SOL ticket, 0.16 at 0.02): the old fixed
0.35 SOL was eighty-seven trades at the bottom of the range, which is not a limit, it is a countdown.

## Statistics

Practice money and real money keep separate books. Profit and loss, win rate and closed trades are
counted per book, and each can be reset on its own in Settings. Resetting clears the numbers and the
closed trades of that book; open positions are left alone and nothing on chain is touched. Both books are
written to `settings.json` (`bookHistory`, `books`), so they survive a restart, and a Reset stays reset.

Practice positions survive a restart too, and so does the practice bankroll (`paperBalance`) that paid for
them: the two are written together, so a restart cannot show a restored Profit / Loss above a balance that
was reset to 5.000. A closing trade still costs what it cost, whichever window it happened in.

**Profit / Loss in Real Money is the wallet, and it is measured as money**: what the wallet holds plus what
the open coins are worth at their current price (and the rent their accounts hold), against the same sum at
Start. The card says **since Start** for that reason. Coins already held when the bot starts are counted on
both sides, so a restart never opens with a profit that was already there, and SOL added to or taken from the
wallet moves the baseline instead of the result: the number only ever measures trading.

## Trading

| Key | Default | Range | Meaning |
| --- | --- | --- | --- |
| `mode` | `paper` | `paper`, `live` | Practice or real money. Cannot change while the bot runs |
| `buyAmountSol` | 0.02 | 0.001 to 5 | SOL per entry, hard capped at 5 |
| `maxPositions` | 4 | 1 to 50 | Open positions at once |
| `maxBuysPerMin` | 20 | any number | Speed cap. Any value you type is accepted |
| `watchSec` | 2 | any number | How long a coin is watched before it may be bought |
| `entryWindowSec` | 40 | any number | Age after which a coin counts as trending rather than new |
| `trendMode` | on | | Allow entries on coins that did not launch while the bot was running |
| `sessionLossLimitSol` | 0.35 | any number | The bot stops itself at this session loss |
| `maxLossStreak` | 4 | any number | Losses in a row before a pause |
| `pauseMinutes` | 5 | any number | Length of the pause. Open positions still close |

Only five numbers are clamped by the app: the ticket (0.001 to 5 SOL), the number of positions (1 to 50),
the slippage ceiling (1 to 90%), the priority fee (0.000001 to 0.05 SOL) and the Jito tip (0.000001 to 0.01
SOL), because those are the values that can empty a wallet. Everything else takes whatever you type.

## Exits

| Key | Meaning |
| --- | --- |
| `takeProfitPct` | Sell when the gain reaches this |
| `tp1Pct` | Sell part of the position when the gain reaches this. Zero turns the rung off |
| `tp1SellPct` | How much of the position leaves at that rung |
| `stopLossPct` | Sell when the loss reaches this |
| `trailArmPct` | Once the gain reaches this, the peak starts being tracked |
| `trailGivePct` | Sell when the price falls this far from the tracked peak |
| `breakEvenPct` | Off by default. Once the gain has reached this at any point, sell when it falls back to zero. Zero turns the rule off, and every style leaves it off: at a net zero the trade has paid its costs and earned nothing, the fill lands under the reading that triggered it, and the rule pre-empts the trailing stop, which sells above water |
| `maxHoldSec` | Sell when the position is older than this |
| `triggerHoldMs` | How long a take profit or a stop has to hold, on fresh prices, before it sells. The safeguard: a spike that is gone in one tick is not a signal. 400 is a blink; 0 acts on the first reading |

Order of checks, first match wins: creator sold, take profit, first rung, stop loss, trailing stop, break
even, time limit. Only the creator selling and the time limit act on the first reading; every price rule
has to hold for `triggerHoldMs`. Take profit, the first rung, the stop and the trail are measured on the net
move, which is the number the cards show. The stop with a 20% setting therefore fires when the ticket is
really 20% down, which at a small ticket's round trip is a price about 29% below the buy; a 12% target books
12%, not the 5% a gross reading would have booked.

The price a position is measured at comes from the bonding curve (the trade stream, the same number the
buy was priced at) while the stream is alive, and from a quote only while it is quiet. A quote that jumps
more than 40% in one tick is not believed, and the price is frozen as soon as an exit is in flight: our own
sale moves a thin pool enough to invent a crash.

The stop is checked before the rules that protect a profit, because a coin can gap straight through them.
A position that was up 12% and then fell 31% in one tick is reported as a stop loss, which is what
happened to the money, not as a break even.

## Simple settings

Quick setup has a **Simple settings** switch. While it is on, the settings form shows only the basic
numbers, and only those numbers decide:

| Key | Meaning |
| --- | --- |
| `minMcSol` / `maxMcSol` | The market cap band the coin must sit in |
| `minBuyers` | The buyer floor: fewer distinct wallets than this, no buy. A launch is counted over 20 seconds; a coin found by the market scan is counted over five minutes and must carry **double** the number (at 50 that is 100 buys in five), because that window holds far more trades |
| `maxBuyers` | The buyer ceiling: more wallets than this, no buy. `0` is off |
| `buyAmountSol` | The ticket per coin |
| `maxPositions` | How many coins may be open at once |
| `slippagePct` | How far the price may move while the order is in flight |
| `takeProfitPct` | Sell when the gain reaches this |
| `stopLossPct` | Sell when the loss reaches this |
| `maxHoldSec` | Sell if nothing happened by then |

Every advanced rule is off while the mode is on: the score bar, the net flow, the depth, the creator
bags, the five minute band, the holder bar, the first rung, the trail and the break even. **One protective
rule stays**, because it is not an advanced setting but the difference between a winner and a wipeout: once
a position has been up **+20%**, half of that run is kept (`Peak give-back`). A coin that reached +61% and
gives back more than half is closed at about +30% instead of being allowed to return to nothing.

A take profit is an exit even though it is not urgent: it never asks for less room than 15%, whatever the
slippage ceiling says, and it never re-quotes itself lower after a refusal. Chasing a falling price is how a
`+70%` row is printed as `-89%`. The safety
protections never turn off in either mode - a coin whose creator sold is not bought, a graduated coin is
not bought, and a position still has to close.

The numbers the mode hides stay in the store untouched: switching back restores the full desk exactly as
it was.

## Copy trading (following a wallet)

`copyWallets` holds up to twenty Solana addresses, separated by spaces, commas or new lines, in
**Settings → Copy these wallets**. When one of them **buys** a coin the desk is watching, the coin is entered at once
instead of waiting for the score, the buyer bar and the market cap band — that is the whole point of following
somebody.

What a copied entry still goes through, because they protect the money and not the opinion:

| Still enforced | Where |
| --- | --- |
| A free position slot, the buys-per-minute pace, the cooldown after a close | `_buy` |
| Round-trip fee gate, the session loss limit, the pause after a losing streak | `_buy` |
| The wallet has the SOL, with the exit fees kept aside | `_buy` |
| The pool's own price (or the coin's fresh tape) and the "price dropped while judged" refusal | `_entryPrice` |
| On-chain mint check in Real Money, so a copy cannot buy a mintable or freezable token | `risk.check` |
| A mint quoted in another token, or a creator who already sold his own launch | `_copyBuy` |

**Sells are never mirrored.** The exit ladder in this app — target, stop, trail, peak give-back, hold limit — is the
part that keeps a winner, and it stays ours. A wallet that buys twenty coins a minute is limited by the same slots and
pace as everything else.

The roster is plain text: a half-typed address is dropped, and Settings refuses to save a list with a line that is not
an address at all. Copy trading is off until an address is typed — the shipped default follows nobody.

## Market and data

| Key | Default | Meaning |
| --- | --- | --- |
| `geyserUrl` | empty | A Geyser-class transaction stream from your provider. Accepts `wss://`, `ws://`, `https://` or `http://`; `https` is upgraded to `wss`. Empty means the public program-log feed, exactly as before |
| `geyserToken` | empty | The provider's token. Appended as `?api-key=` only when the URL carries no key of its own, so a URL that already has one is never doubled |
| `feedSource` | `auto` | `auto` prefers a configured Geyser endpoint, then the chain feed when a private socket or node is set (the whole program, no per-coin limit), then PumpDev. Forcing `geyser` with no endpoint says so in the log and falls back rather than pretending |
| --- | --- | --- |
| `marketScan` | on | Run the rotating discovery doors |
| `feedSource` | `auto` | `auto`, `pumpdev`, `chain`, `pumpportal` |
| `smartFees` | on | Follow the live fee market, style values become ceilings |
| `maxDevBuySol` | 3 | Skip coins where the creator bought more than this at launch |
| `maxDevHoldPct` | 35 | Skip coins where the creator still holds this share of the supply, read from the token audit. `0` turns it off |
| `maxTraderSharePct` | 45 | Skip coins where one wallet is this share of recent buying |
| `maxChange5mPct` | 30 | Skip a coin that is already up more than this over five minutes. Buying a coin that has run is buying somebody else's exit. `0` switches the ceiling off, and the full desk widens it for scanned movers |
| `minChange5mPct` | 2 | The floor of the same band: skip a coin that has barely moved in five minutes, so a launch is joined while it is starting rather than after it has run |
| `deepEntry` | off | The extra entry filters switch: a minimum number of holders and the market cap band, in one panel below the number form. While on, a coin under the holder bar is skipped, and so is a coin whose holder count cannot be read |
| `minHolders` | 0 | The holder bar. Read from the live market at the moment of buying, cached for ten minutes |
| `simpleMode` | off | Simple settings: only the basic numbers decide (see below), and every advanced rule is off |
| `maxBuyers` | 0 | The buyer ceiling. A coin with more recent buyers than this is skipped, because past it the crowd is already in and a small ticket is buying their exit. `0` turns it off |
| `minLiqUsd` | 1500 | Skip a coin whose pool is smaller than this in USD. `0` turns it off |

Automatic uses PumpDev when a key is configured. Otherwise it subscribes to Solana program logs over the configured RPC or a public WebSocket. If the chain stream fails, PumpPortal provides launch discovery. Live entries still require fresh wallet-level trade evidence.

## Integrations

| Key | Meaning |
| --- | --- |
| `pumpdevKey` | Free key from pumpdev.io. Live trade stream, up to 25 coins watched at once on the free plan |
| `incineratorKey` | Sol Incinerator key. Burns leftovers and closes accounts for a fee. Not needed: selling and closing is free here |
| `rpcUrl` | Your own Solana RPC endpoint. Must start with `https://` |
| `autoReclaim` | Sell the leftover after every sale, close the empty account and return its ~0.00204 SOL |
| `recoverDust` | A leftover no market will buy is burned so the account can be closed and the rent returned |
| `useJito` | Off by default. Offers every signed trade to Jito's block engine as a bundle as well |
| `jitoTipSol` | The bundle tip, 0.0001 SOL by default. Only paid when the bundle lands, never counted as a fee when it does not |

**What `useJito` really does.** The same signed transaction goes to the RPC doors **and** to the block engine in the
same instant: the bundle either lands whole (trade and tip together) or not at all, and the RPC send is never given up
in exchange. Because the RPC is normally the faster of the two, the engine usually answers `bundle contains an already
processed transaction` - which means **the trade is already on chain**, not that anything failed, and the tip is not
paid. So Jito is a free hedge for a congested slot, not a faster route: a measured day on one wallet was 34 bundles,
9 lost races, 2 refusals that were logged, and no tip spent on a lost race. If it is switched off nothing else changes.

Jupiter needs no key: the swap route and the price service the bot falls back to answer without one. The
price service is polled at 150 ms, and only for a coin whose trade stream has gone quiet.

## Pilly on screen (the mascot)

| Setting | Default | Meaning |
| --- | --- | --- |
| `petOn` | off | Whether he is on the desktop. The switch is the only thing here that is not about his behaviour - the rest are saved with the button under the panel |
| `petName` | `Pilly` | What he is called, up to 14 characters. It is what the panel and the bubbles call him |
| `petTheme` | `ball` | His colours: `ball` (the brand's own crocheted green ball), `plush`, or one of the flat palettes (`green`, `blue`, `purple`, `pink`, `orange`). The art is Pilly's and these are its own names |
| `petSize` | `md` | `sm` (¾), `md` (1×) or `lg` (1.2×). The window is resized with him, so the click area and the art stay in step |
| `petSpeed` | `normal` | `slow` (×0.5), `normal` (×1) or `fast` (×2), applied to the walk itself |
| `petWalkMode` | `screen` | `screen` walks anywhere, `taskbar` pins him to the bottom line of the work area |
| `petStopFreq` | `normal` | How often he stops for a moment: `never`, `rare` (42 s), `normal` (22 s) or `often` (9 s) |
| `petMood` | `neutral` | What he looks like when nothing is happening: `neutral`, `happy`, `sad`. The live mood (below) overrides it for a moment |
| `petBubbles` | on | Whether he may speak in a bubble at all. Off means he is silent, including the alerts |
| `petBubbleSize` / `petBubbleText` | `md` | The bubble's padding and its letter size (`sm`, `md`, `lg`). The window is measured from them so no sentence is clipped |
| `petBubbleStyle` | `default` | `default`, `light`, `glass`, `neon`, `comic` or `minimal` - Pilly's own six bubble looks |
| `petSounds` / `petSoundVol` | on, 60 | His voice, and its volume - clamped to 0-100 |
| `petQuestions` | on | Whether he may ask things now and then |
| `petReduceMotion` | off | He stands still. Everything else (bubbles, sounds, the mood) still works |

### What he tells you, and where each number comes from

| Setting | Default | Meaning |
| --- | --- | --- |
| `petHotAlerts` + `petHotPct` | on, 10% | The **hot-coin radar**: the hottest fresh 5-minute mover in the app's own market list, flagged once per coin per half hour, and never a coin under the $8K dust floor. With nothing moving, the day's extreme (≥18%) stands in |
| `petSniper` | on | The **launch watch**: the freshest launch the desk is already watching (under 90 s old), said once |
| `petDailyBrief` | on | The **morning brief**, once per session: SOL on hand (or practice money), the session's own PnL and how many positions are open |
| `petPillyPick` | on | **His pick of the day**: the council is asked every six hours about the coins the desk is watching, and he says the answer. With no endpoint configured he says nothing at all |
| `petWhaleAlerts` | on | **A followed wallet opened**: the engine's own copy event, with the wallet shortened and the market cap if it has one |
| `petPortfolioMood` | on | **His mood follows your PnL**: up from +3%, down from −3%, on a fifteen-minute clock |
| `petAlertSound` | on | A ding when an alert fires (the pet page's own sound, so it follows his volume) |

An alert is **clickable**: a tap brings the window forward on the Chat tab. Every sentence is built from numbers the app
already has — the radar reads the same state the panels do, so there is one market layer and no second opinion — and a
number it was not given is left out rather than printed as `NaN`.

`petPos` is not on the panel: it is where you **dragged** him, saved once you let go, and clamped back onto an existing
screen at the next start (a laptop that was on a second monitor keeps him visible). Every other field goes through one
channel, `pet:apply`, which **saves and applies in the same breath**: a new size moves the window at once, a new speed is
felt in the next tick (24 ms), and a name change is in the bubbles without restarting anything.

He is **two windows**: the pet (always-on-top, transparent, framed off, skipped in the taskbar, unfocusable, and exempt from
Chromium's background throttling — otherwise a hidden app would freeze him mid-step) and his bubble, which lives and dies with
him, is click-through until it carries an alert, and is placed by arithmetic so it can never leave the screen. He holds no
keys, has no wallet, and cannot start, stop or size a trade: `src/pet.js` and `src/pilly.js` have no Solana import at all.

## The watchlist and his scorecard

Two files in the app's own folder, both written only by the panel:

| File | Contents |
| --- | --- |
| `watchlist.json` | Up to twenty coins you watch, each with `alertPct` — the **5-minute move** that fires an alert, or `null` for no alert. One alert per coin per half hour, said by Pilly in a bubble |
| `picks.json` | His scorecard: every coin he named on his own (a hot mover, a fresh launch, his pick of the day), the market cap it had at that moment, and the move since. A win above +1%, a loss below −1%, flat in between, and a call whose coin is not priced stays **open** rather than being judged on nothing |

Both are read again every time the PillCrew tab opens and after every state tick while it is open. An address that is not a
Solana address is refused on the way in (`That is not a Solana token address.`), and twenty coins is the cap, because a
watchlist that holds everything is a feed, not a watchlist.

The alert watches the **5-minute change**, not a 24-hour one: that is the number this app already carries for every coin it
watches, and the panel says so instead of pretending to watch a price it does not have.

## Sharing a setup

Settings has a **Share your settings** card. It writes a code of about 180 characters, `PCS1~<payload>~<checksum>`,
that carries the `SHARE_KEYS` list from `src/share.js`: the entry bar, the whole exit plan, the size and the pace,
and the cost ceilings. Another field applies a code somebody posted, and one button opens X with the line and the
code filled in.

The code carries **no dots on purpose**: `PCS1.<payload>` reads as `domain.tld` to the linkifier in every chat app,
and X answered a post containing one with "Blocked link". Codes written with a dot before this change still decode.

The payload is `{v, p, n}` - a format version, a style name and the numbers - so a code cannot carry an API key, an
RPC URL, a wallet, the mode, or an open position. The checksum refuses a mistyped or truncated code, applying a code
is refused while the bot runs, and the ticket on your machine is only replaced when the code's is smaller.

## Files

| File | Contents |
| --- | --- |
| `settings.json` | Everything above, plus the open positions and the closed-trade book |
| `wallet.json` | Encrypted key, never leaves the machine |
| `logs/pillcrew-<date>.log` | The day's diary: every line the window shows |
| `logs/` (the rest) | Chromium logs, safe to delete |

The app keeps no database. The closed trades and the running totals live in `settings.json` (`bookHistory` and
`books`), so they survive a restart; **Reset** clears one book and that clearing survives a restart too. The book is a
record of what was booked, never of the wallet balance, so a deposit or a withdrawal does not move it.
