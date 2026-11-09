# The bump desk

Volume and transaction activity for **one token**, from a pool of wallets this app creates itself. It lives in the
**Bump desk** tab and it is the honest version of what a "volume bot" is usually sold as.

Read the warning first: every bump is a **real buy and a real sell**, paid from your wallet. Nothing here is free, and
nothing here can make a coin trend by itself — it makes the tape read like several people instead of one.

---

## The one address

The desk has **one address for everything**: you send SOL to it, it splits that SOL across the pool wallets by itself, and
every lamport comes back to it when you withdraw. It is created with the wallets, sealed with the same password, and it is
the only address you ever need to copy.

```
you ──► desk address ──► wallet 1 … wallet N     (fund: one transaction, split evenly)
you ◄── desk address ◄── wallet 1 … wallet N     (withdraw: one transaction per six wallets, then one home)
```

- **Top up from my wallet** moves the budget from the wallet that already holds SOL into the desk address, in one press.
  **Fund the pool** does it for you when the desk address is short: the difference is moved across and split, one press.
- **Withdraw everything** sells the bags, closes the emptied token accounts so their 0.00204 SOL of rent comes back,
  returns every wallet to the desk address, and then sends what is left home to your wallet.
- **Delete keys** does the whole recovery itself before it removes anything: it sells every bag the chain reports, closes
  the emptied token accounts so their rent comes back, sends every lamport home, and drains each address to **zero** (a
  wallet keeping its rent-free floor would be deleted with that money inside it). Anything that cannot be moved stops it
  with the reason and needs a second, explicit press — which then says what is left on chain.

The pool's keys and the desk key are generated locally and kept in their own sealed files (`bump-wallets.json`,
`bump-vault.json`), never in `settings.json`, never in a settings code, and never in the log.

## Three sliders, and the ticket is worked out for you

| Slider | What it decides |
| --- | --- |
| **How much SOL you are putting in** | everything: the trades, the fees, the rent |
| **How long it should run** | the length of the run (paused time is added back) |
| **Bumps per minute** | the pace |

The ticket is **derived** from those three, because that is the only order in which a small budget is not a slow accident.
The **wallet count is yours**: six typed wallets are six wallets, and if the money cannot carry six the desk says so with
the pool that would, instead of quietly running two. Switch *Work the ticket out from the budget* off and every number is
yours again.

**A pool size is a request; the roster is what exists** (1.1.5). The number in *Wallets (the pool size)* is saved the
moment you leave the box, and **Create wallets** reads that number from the box itself — before 1.1.5 nothing listened to
that box at all, so typing 3 created as many wallets as the old setting said and the plan went on saying "2 wallets".
The plan is priced for the addresses that really exist, and when the two numbers differ the panel says it out loud:
*"You asked for 3 wallets and the pool holds 2: the plan is priced for the 2 that exist. Press "Create wallets" to add 1
more address and the split follows."* More addresses than the slider says is not a note — the slider decides how many
trade, and the rest wait (their SOL is named as idle outside the plan).

The arithmetic behind it is the honest part, and it is printed before a lamport moves:

```
budget − rent − funding fee  ≥  bumps × (2 × signature + ticket × 3.5%)  +  wallets × ticket
```

The SOL a bump spends is **not** consumed — it comes back when the bag is sold. What is consumed is the fee, and what has
to be parked is the float (every wallet may hold at once) plus the rent. So a budget buys a **finite number of bumps**, and
the desk says how many.

A worked example with a small budget — 0.02 SOL over six wallets, three hours, twenty bumps a minute:

> The budget buys about 120 bumps, not 3600: 6 minutes at 20/min, or 0.6/min for 180 minutes.

Six wallets park 0.0122 SOL of rent before a single bump, so 0.02 SOL is mostly rent and the run is short whatever the pace.
Three hours at twenty a minute would be 3 600 bumps and 0.043 SOL of fees — twice the budget. The desk will not start that
run, and **Fit it to my budget** re-plans it: same 0.02 SOL, same six wallets where the money allows them, a pace the money
can pay for — and when the *rent* is what does not fit, the fitter offers a smaller pool, named in the note
(*"2 wallets instead of 6 — 6 would park 0.0122 SOL of rent"*), because only the operator gets to shrink his own pool.

---

## What it actually does

One token, `N` wallets, one loop:

1. **A bump is an order.** Either a buy in the band you set (`bumpMinSol`…`bumpMaxSol`, drawn to the lamport, so no two
   transactions carry the same number) or a sell of a bag that is due.
2. **The wallets take turns at random**, not in rotation. A strict rotation is the one pattern a spectator can see.
3. **A bag waits a random time** between `bumpHoldMinSec` and `bumpHoldMaxSec`, then it is sold whole.
4. **The pace is your number** (`bumpPerMinute`), with jitter on every gap: a wall of transactions exactly on the beat is
   the signature of a bot.
5. **The buy share** (`bumpBuyRatio`) decides how often a bump is a buy. Above 50% the desk is building a bag; that bag
   is sold back when the run ends, so the SOL is not left in the coin.

Two levers decide the shape of the run, and they pull against each other:

| Lever | Effect |
| --- | --- |
| `bumpBuyRatio` | the mix of transactions, while the bags are still open |
| `bumpHoldMinSec` / `bumpHoldMaxSec` | how long a bag is held. **Shorter than the gap between bumps, the hold decides the mix instead of the ratio**, because every buy is due for its sale almost at once |

That second row is the honest part of the design: a 70% buy share with a one-second hold is a 50/50 tape, and no amount
of configuration changes it. The panel shows the achieved share (`Buy share`) next to the target for exactly this reason,
and when the pool is saturated it says so in words:

> Every wallet is holding a bag: the pace is limited by the 25–90 s hold band, not by 240/min.

More wallets, or a shorter hold band, is how you go faster. Nothing else is.

## What it costs

`bumpEstimate` prices the configured run **before a single lamport moves**, and the panel prints it:

```
One bump, all in        0.000292 SOL   0.0080 SOL average, of which the curve and the door take 0.000280
Bundled into the price  4.32 SOL      270 bumps of volume over the configured run
Fees for the whole run  0.0788 SOL    at 1% slippage across 6 wallets
Rent to park            0.0122 SOL    one token account per wallet; it comes back when the account is closed
```

Where the money goes, per side:

| Cost | Amount | Notes |
| --- | --- | --- |
| Bonding curve fee | 1.25% of the trade | the token's own liquidity takes this |
| Trade door | 0.5% of the trade | PumpPortal Local |
| Network fee | 5000 lamports per transaction | per signature |
| Priority tip | `bumpPriorityFeeSol`, 1000 lamports by default | the cheapest that still lands |
| Token account rent | 0.00204 SOL per wallet, **once** | returned when the account is closed by *Withdraw everything* |
| Jito tip | `bumpJitoTipSol`, 0.00001 SOL by default | paid by the trading wallet, in its own transaction, only when the bundle lands |

So a round trip costs about **3.5% of what it moves**, and that is the number to compare against any price list: a
"500 bumps for 0.18 SOL" package is selling the same curve fee with a markup on top. At the default settings this desk
pushes 4.3 SOL of volume through the mint for under 0.08 SOL of fees.

## Cheapest settings that still work

These are the defaults, and they are the floor, not a starting point to go lower:

- `bumpSlippagePct: 1` — every route refuses less. On a fast coin 1% is also why a sell fails; that failure is retried
  and then the wallet is parked and named, never looped for ever.
- `bumpPriorityFeeSol: 0.000001` — 1000 lamports. A bigger tip on a 0.008 SOL bump is how a volume run costs more than
  the volume it buys.
- `bumpUseJito: true` — each bump is offered to Jito's block engine as a bundle: **one wallet's trade plus its own tip**,
  which lands it on a busy block exactly like any other transaction in the run. It is *not* several wallets in one block;
  the wallets still trade one at a time. What it costs is the tip (0.00001 SOL) and its signature (0.000005 SOL) on every
  bump, which is why a Jito run buys fewer bumps for the same money — the panel prints both numbers. Jito's own floor is
  1000 lamports; 10000 is the smallest tip that lands reliably.
- **A bundle is a first try, never the wire** (1.1.5). The block engine keeps a bundle for a slot or two, so one offer
  lands only when the next leader happens to run the Jito client — measured on this very coin: every bundle was accepted
  and none landed, which is why the switch looked dead. The same signed trade is now offered `BUNDLE_SENDS` (3) times, and
  if none of them lands **the identical bytes go out through the normal route**. That cannot trade twice: the bytes carry
  one signature and Solana executes a signature at most once. The tip is therefore only ever paid by a bundle that lands,
  and having Jito on can never cost a bump. It stands itself down for the rest of the run only after `JITO_MISS_LIMIT` (3)
  trades in a row whose bundle did not land, and the line under the plan says which of those three states it is in.
- `bumpJitoTipSol: 0.000001` — the very cheapest tip Jito accepts. It lands on quiet blocks; for a run that has to land
  on busy ones, 0.00001 is the setting.

Higher slippage is the only thing that makes a sell more likely to fill, and it is paid by the trade, not by this app.

## A round: N buys, then one sell of the whole bag

**A round has to fit in one wallet's share** (1.1.6). A wallet parks its rent, buys N tickets, and only then sells, so its
share has to carry the whole round — otherwise it spends everything on bags it never sells. Measured on the owner's own
pool: 0.0116 SOL across three wallets with four buys a round did **8 buys and 0 sells**, then said "every wallet spent its
budget" two minutes into a twenty minute run, with a bag parked in a wallet. Now:

- the plan **refuses** that combination before a lamport moves, and names the count that does fit: *"4 buys a round need
  0.0047 SOL in one wallet, and each of the 3 gets 0.0039. Set "Buys in one round" to 2, or raise the budget (or use fewer
  wallets) so the round fits."*
- **Start** and **Fund the pool** both refuse it, so a run cannot begin that will starve;
- the **fitter** scores the plans it could give you and returns the closest one that fits — pace first, then length, then
  the round, then the pool: *"Fitted: 2 buys a round instead of 4, 2/min instead of 8 - about 39 bumps."* A crawl below
  1/min is never the answer; the fitter says what the run really needs in SOL instead;
- the band's **top** is what has to fit (`ticket × 1.25` plus the rent), because the desk draws any ticket up to there —
  without that cap the panel could call a plan fine that Start then refused;
- in a long run, a wallet that cannot pay for the buys it has left **closes its round now** (sells what it holds) instead of
  buying until it is dry;
- **Stop** sells bags back down the same ladder a Rescue uses (pump door → Jupiter legacy → Jupiter current) and floats the
  fee first, so a thin wallet gets its bag out instead of "Could not sell back … Jupiter has no route".

The desk works in **rounds**, and a round belongs to one wallet:

- it buys **N times** (the *Buys in one round* slider, 1–10; or, with *Random count every round*, a fresh count between
  one and N each time),
- the buys are spread by the pace and drawn from the ticket band, so no two are the same,
- when the last buy is in, the bag is held for the hold band and then **sold whole, in one transaction**,
- and the wallet starts a new round.

**One buy and one sell is the default** (a 50/50 tape). Three buys and one sell is a 75% buy tape. The buy share is no
longer a knob: it is what the round produces, `buys / (buys + 1)`, and the panel prints it. Two controls that can
contradict each other are how a desk ends up doing something nobody asked for.

The cost model follows the round exactly: every transaction pays **one** signature and the curve's share **once**, and
what has to be parked is `wallets × buys × ticket` (a wallet carrying three bags before its sell) plus the rent.

## The end of a run: everything sold, everything home

**A run that stops — by its own clock, by the money, or by your press — winds the desk down by itself** (1.1.6). The owner's
rule: *"ZAWSZE jak stopuje po swoim czasie ma z każdego walleta wszystko sprzedać i kasa ma być na głównym wallecie"*. So
`_finish` is not "stop and leave the bags for later": it stops, then runs the full sweep —

- **every bag in every wallet is sold**, and the **chain** says what each wallet holds (a trade that landed late is found
  and sold, not left behind),
- **every emptied token account is closed**, so its ~0.00204 SOL of rent comes back,
- **every lamport is sent home to the main wallet** — not just to the desk address,
- and the panel gets one sentence with the totals.

The switch `Stop sells the bags back` still governs it: with it off, nothing is sold and nothing is swept, and the bags stay
where they are — that is the only way to keep a bag on purpose.

**A parked wallet is a pause, and its bag still sells** (1.1.6). A park used to leave `sellAt` at zero, so a wallet parked
for lack of SOL was out of the run for good while it held a bag — the owner's own row: *"8v9m…5nGV · 0.0080 SOL · 3 bumps ·
3/4 buys · parked · bag"*. Now every park carries an expiry (`PARK_MS`, two minutes), a bag always has a sell time (when its
round is complete, when the wallet cannot pay for the buys it has left, or when it is parked), the run's own sell floats the
wallet's fee first if it is short, and a sell that goes through **lifts the park** — a wallet that proves it works is not
left marked broken.


- **A wallet can only spend the budget it was given.** The band is spread evenly (`budgetSol / wallets`), each wallet
  keeps the rent and two fees in reserve, and the schedule never picks a wallet whose budget is spent.
- **A plan the budget cannot pay is refused at Start**, in one sentence with the numbers that do fit — not ten minutes
  into the run, when the fees have already eaten the money.
- **Bags are sold back on Stop** (`bumpSellBack`, on by default). A run that stops with wallets full of a token has not
  finished.
- **Pause gives the time back**: the run clock stops with the desk, exactly as a customer pausing a boost expects.
- **Withdraw everything** sells what is open, closes the emptied token accounts so their rent comes home, and sends every
  lamport back to the desk address and then to your wallet.
- **A withdrawal counts only when the chain says so.** `broadcast` answering means a node *accepted* the bytes; the money
  moved only when the transaction is in a block with no error. Every movement on this desk — the split, the top-up, the
  return, and each bump itself — is confirmed that way (`RPCManager.confirm`) before the panel mentions it, and a
  transaction that landed with an error is reported as a refusal with the chain's own reason.
- **A wallet cannot be emptied to nothing.** Solana rejects a transaction that would leave an account holding between zero
  and its rent-exempt minimum (890 880 lamports), so the return keeps that floor plus one signature behind and the panel
  says how much stayed. It is still the customer's money: the next run spends it, and the next withdrawal picks it up.
  Without that floor the withdrawal was rejected on chain while the app reported it as sent — the owner's own 0.02 SOL sat
  in the desk address through three "0.0200 SOL home" lines.
- **A wallet that still holds a bag keeps that floor even when the sweep is not supposed to keep anything.** Taking every
  lamport does not just empty a wallet, it destroys the account, and an account that no longer exists cannot sign the sell
  that would get its tokens out. The owner's own `HoQr…2wJb` was found in exactly that state (39 018 tokens, no account,
  and a Rescue button that could not pay a fee). The sweep now leaves the floor behind in any wallet whose bag its sell
  could not get out, and **Rescue** (or the next *Withdraw everything*) floats 0.006 SOL into a wallet that cannot pay a
  transaction — out of the main wallet, confirmed, with the line on the panel saying so. 0.006 and not 0.0011, because the
  route that carries a sell out of a nearly empty wallet has to create its wrapped-SOL account up front: simulated on the
  owner's own bag, the transaction answered `Transfer: insufficient lamports 875880, need 1488440`.
- **A trade the pump door cannot make is taken by Jupiter.** The pump door's local transaction is priced for the bonding curve;
  once a coin has **migrated to PumpSwap** that price is wrong (measured on the owner's own coin: the door quoted 0.00247 SOL
  for tokens the AMM sells for 0.00459, and the chain answered `ExceededSlippage`). A transaction that landed and FAILED
  provably did nothing, so the same trade is retried through Jupiter — the client the sniper already trades with — and only
  then. An **unknown** outcome is never retried: it may be on chain, and sending it twice buys twice.
- **Three refusals in a row park a wallet** and the panel says why; it is never retried for ever.

## The keys

The pool's keys and the desk's deposit address are generated locally and written to `<userData>/bump-wallets.json` and
`<userData>/bump-vault.json`, sealed with **your wallet password** (scrypt + AES-256-GCM, the same code the wallet itself
uses — `src/secretbox.js`). The addresses stay readable so the panel can list them; the secrets are inside the ciphertext.

- They are **not settings**. They are never in `settings.json`, never in a `PCS1~…` settings code (`src/share.js` is an
  allowlist), never in the log, and there is no IPC channel that exports a secret key.
- They are held in memory only while the window is open and the pool is unlocked.
- **Delete keys** removes the file — and it does the recovery first, so the button cannot throw money away: every bag the
  chain reports is sold (door, then Jupiter's legacy lane, then its current one), every emptied token account is closed so
  its rent comes back, and every lamport is sent home to your wallet. Each address is drained to **zero** on purpose (a
  wallet keeping its rent-free floor would be deleted *with* that money inside). Whatever cannot be moved — a bag nobody
  will buy, a node that will not answer — stops the delete with the reason, and a second, explicit press deletes anyway and
  names exactly what is being abandoned on chain.
- **Delete keys asks for the password** (1.1.5). It is the one press in this app that nothing can undo, and an unlocked
  desk is not proof of the operator: the panel asks, the IPC channel demands it, and the check runs *before* anything is
  touched. A wrong password is answered in words (`Wrong password: the bump wallets were not opened, and nothing was
  changed.`) rather than by a raw box error, and the unlock it performs is also what lets the recovery sell a bag out of a
  desk that was left locked.

## What it deliberately does not do

- It does not put several wallets in one block: a Jito bundle here is one wallet's trade plus its tip.
- It does not leave a bag behind silently.
- It does not invent a figure: every number in the panel comes from a transaction that was sent, or from the cost model
  printed before the run.
- It does not promise a trend. Volume is one input among many, and a coin with no buyers stays a coin with no buyers.

## Tests

`test/bump.test.js` (35 blocks, no network, no real keys — every door and RPC answer is injected) plus
`test/jupiter.test.js` (the two Jupiter lanes and what each refusal means):

| What is proven | How |
| --- | --- |
| Settings are clamped to what can run | a 999-wallet, 9999-SOL, 0% slippage configuration becomes 40 / 50 / 1 |
| The cost model is arithmetic, not a price list | the curve fee, the network fee, the run total and the rent are checked against numbers computed by hand |
| The roster seals its keys | the file is searched for every secret in base58 **and** hex; a wrong password is refused; a damaged file is refused, never replaced |
| A settings code cannot carry the desk | `Share.encode`/`decode` round trip with bump settings present |
| Funding is one transaction | one broadcast, one transfer per wallet, summing to the budget exactly, every destination in the pool |
| Funding refuses in words | too little SOL, or a budget smaller than one trade, is refused before anything is signed |
| The pace is the configured pace | sixty a minute over ten seconds is about ten bumps |
| Amounts are all different | forty draws from the band are forty distinct lamports values |
| The buy share is the target | 70% lands between 55 and 85, and a 100% desk never sells by itself |
| No wallet overspends | the schedule never picks a spent wallet; the whole run stays inside the budget |
| A foreign transaction is refused | a swap built for another wallet is refused and nothing is broadcast; a swap that drains the wallet is refused |
| A bag is sold whole | `amount: '100%'`, `denominatedInSol: 'false'` |
| A wallet that cannot sell is parked | three refusals, and the panel says why |
| Stop sells the bags back | unless `bumpSellBack` is off, in which case the count of held wallets is reported |
| A pause gives its time back | `endsAt` moves by exactly the paused milliseconds |
| The sweep pays only you | every transfer lands in the main wallet and comes out of a pool wallet, in one transaction |
| A withdrawal the chain rejects is not called money returned | the same sweep with a refusing confirmation reports `toWalletSol: 0`, the refusal in `stuck`, and the chain's reason in the line the operator reads |
| A withdrawal keeps the rent-free floor | the desk address keeps at least 890 880 lamports, and the panel says how much stayed |
| A wallet can be rescued on its own | **Rescue** on a row sells whatever the chain says it holds, closes its empty token accounts (rent back), puts the fee float back if the wallet cannot pay one, and unparks it - without touching the rest of the pool |
| A rescue never gambles on a bundle | its sell always takes the ordinary route, because an unlanded bundle is exactly the jam the button exists for |
| A rescue is answered by the chain, not by a timeout | an unconfirmed sell is asked about again after six seconds (twice at most) and the wallet's token balance decides: `bag sold`, or `the bag is still there, nothing was sold` - never "nothing held" about a bag it just failed to sell |
| A sell nobody confirmed is settled by the balance | a wallet that holds none of the mint has sold it, on either route, so a round closes instead of piling up a bag that is gone |
| A wallet that still holds a bag is never swept out of existence | the sweep keeps the rent-exempt floor behind in every wallet whose sale did not go through: an account swept to zero lamports is destroyed and could never sign the sell that would get its bag out (the owner's own HoQr…2wJb: 39 018 tokens, no account left) |
| A dry wallet is given its fee back | a rescue or a sweep floats 0.006 SOL into a wallet that cannot pay a transaction, out of the main wallet, and says so - refusing when that wallet is locked or too thin. The float is not a fee: the withdrawal takes it back. |
| A read that failed is not an empty wallet | a rescue on a wallet holding a bag whose node keeps answering 429 reports `the chain could not be asked what it holds, so nothing was sold` and never `nothing held` (the owner's own line: "nothing held" about 39 018 746 966 tokens) |
| A refused read is retried | one 429 on the token read still finds and sells the bag; the fee float is put in even when the first balance read throws |
| The fallback route works from a thin wallet | the sell-out ladder tries the pump door, then Jupiter's legacy lane (which quotes without a taker and builds for a wallet holding barely a fee), then Jupiter's current one - each rung only after a DEFINITE refusal, never after an unknown outcome |
| Jupiter's "Failed to get quotes" is diagnosed | the same order is asked again without a taker: if that routes, the refusal is named a thin wallet (`kind: 'funds'`), not a dead market (`kind: 'route'`) |
| Delete recovers before it deletes | bags sold, token rent closed, every lamport home, each address drained to zero, and only then the keys |
| Delete asks for the password first | `bump:forget` refuses without it ("Type your wallet password to delete the keys.") and a wrong one is refused in words ("Wrong password: the bump wallets were not opened, and nothing was changed.") — an unlocked roster is not proof of the operator, and a debugger connection is exactly how the keys were once destroyed |
| A bundle is a first try, not the wire | the same signed trade is offered 3 times, then the **identical bytes** go out through the normal route — one signature executes at most once, so the fallback can never trade twice, and the tip is only paid by a bundle that lands |
| Jito stands down only after three misses in a row | one unlanded bundle costs a moment, not the switch; a bundle that lands resets the count |
| The panel says what Jito is doing | the line under the plan reports on / the tip / stood down after N misses, so "it never used Jito" can no longer be a guess |
| The pool size is the number in the box | typing 3 and leaving the box saves 3, and Create wallets is built from that box (before 1.1.5 only the range beside it was listened to, so 3 typed created 2 and the plan said "2 wallets") |
| The plan is priced for the pool that exists | `estimate(settings, { have })` prices the addresses the roster really holds and names the gap: *"You asked for 3 wallets and the pool holds 2 … Press "Create wallets" to add 1 more address"* |
| A round the money cannot carry is refused | `roundFits`/`buysThatFit` price a whole round against one wallet's share; Start and Fund the pool both refuse the combination and name the count that fits |
| A bag always has a sell time | a bag is sold when its round is complete, when the wallet cannot pay for the buys it has left, or when it is parked — a parked wallet with a bag is never invisible to the scheduler |
| A park is a pause with an expiry | every park carries `PARK_MS` (two minutes); a wallet parked for lack of SOL is retried, not parked for the run |
| A sale lifts the park | a wallet that sold is unparked (flag and expiry cleared), because a sale proves it works |
| The run's sell floats the fee too | the run's own sell puts back 0.006 SOL when the wallet is short, exactly as Stop and Rescue do, so a thin wallet still gets its bag out |
| Jito carries the Jupiter lane | once the pump door is broken every trade goes through Jupiter, and those trades are still offered to the block engine (a bundle first, the identical bytes on the normal route) |
| The run winds the desk down | a run that ends by itself sells every wallet's bag — the chain says what each holds — closes the emptied token accounts, and sends every lamport home to the main wallet, in one press |
| Delete never abandons money by accident | anything left on chain stops it with `DELETE_NEEDS_FORCE` and a sentence naming what would stay behind; the second press deletes and says what was abandoned |
| An operator press waits out a cooldown | `RPCManager.call(..., { waitMs })` sits out a node's 429 bench and answers, while a price-critical call never passes `waitMs` and still fails fast |
| A park is a pause, not a death sentence | a wallet parked after three refusals is eligible again two minutes later, and the rescue button is the manual version |
| The run adopts a bag it never booked | once a minute the chain is asked what each wallet holds; tokens the book does not know about are adopted and sold by the run, not left for the withdrawal |
| Growing the pool keeps its keys | creating five wallets over two returns all five keypairs, so the two that hold the money can still sign |
| The guards are unit-tested | `guardFunding` and `guardSweep` refuse a wrong amount, a wrong address, a wrong source and an empty transaction |
| The panel carries no key | the state payload is searched for every secret in base58 and hex |
| The panel explains a slow run | three wallets holding a bag report `free: 0` and a line naming the hold band as the ceiling; a spent pool names the budget |
| The sliders are the arithmetic | 0.02 SOL over three hours at 20/min is refused as impossible, the note names what the money really buys (5.9 minutes at 20/min, or 0.6/min for three hours with Jito on by default), and the fitter returns a plan that fits |
| The plan fits the money | rent + fees + float of the fitted plan never exceeds the budget |
| The desk address is a key | sealed like the others, refused with a wrong password, and **never deleted while it holds money** |
| A deposit is one transfer | wallet → desk address, for the amount asked: a different amount, a different address or an empty transaction is refused |

Every rule above was also broken on purpose (guards removed, budget check removed, ratio control removed, sell-back
removed, parking removed, schedule un-accumulated, sweep destination changed): **each mutation fails the suite.** The UI
test opens the tab, counts three wallet rows and six live figures, checks the 3.5% warning is on the panel, types an
address into the form to prove it reaches the store, and types a pool size into the box to prove that one does too.
