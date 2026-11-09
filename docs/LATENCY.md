# How fast is the feed, measured

A bot's speed is not an opinion, and it is not a screenshot. This page records what this app actually receives, on the
machine it runs on, with the method that produced each number so anyone can repeat it.

```
node scripts/latency.js        # 60 seconds
node scripts/latency.js 180    # three minutes
```

The script opens **the same feed the desk opens**, twice: once against the public pool (`api.mainnet-beta`,
`publicnode`) and once against the socket in your own settings — with the key derived exactly as the desk derives it. It
never touches a wallet, never signs anything, and prints no key. Matching is done **by transaction signature**, so a
difference in arrival time needs no clock sync and no trust in anybody's benchmark: the same trade, seen on two doors.

## Measured 2026-11-06, Windows 11, the endpoints that were configured at the time

| | Public pool | Private socket (FluxRPC, keyed) |
| --- | --- | --- |
| Pump.fun events received | 1 375 in 60 s (**22.9/s**) | 3 389 in 60 s (**56.5/s**) |
| Same trades seen on both doors | 1 349 matched signatures | |
| Arrival difference | — | **earlier by p50 19.3 s**, mean 17.0 s, p95 28.6 s |
| Local decode cost | 4.2 µs per notification | 4.2 µs per notification |

Read the first two rows together: the public pool delivered **less than half** the events the private socket delivered,
and the ones it did deliver arrived **about nineteen seconds later**. Two thirds of a pump.fun trade's life happens
inside that gap.

**The decode is not the bottleneck.** Four microseconds per notification is nothing; the desk could decode fifty
thousand trades a second. Everything that matters is in the transport and in the network path, which is why the app
spends its configuration surface on endpoints rather than on clever JavaScript.

## The bug this measurement found (fixed in 1.0.9)

The configured socket was `wss://ws.eu.fluxrpc.com` — exactly as the provider's panel prints it. That URL answers
**401** without the key its HTTP endpoint carries:

```
wss://ws.eu.fluxrpc.com                        -> 401 in 565 ms
wss://ws.eu.fluxrpc.com?key=<the same key>     -> subscribed in 104 ms
```

The desk saw the refusal, moved on to the public nodes, and said nothing about it. On a paid plan the feed was the
slowest door in the room, and every symptom — "the bot is late", "it missed the move" — followed from that.

Now the key is copied across automatically, as the same `name=value` pair the RPC URL uses, so `?key=` (FluxRPC) and
`?api-key=` (Helius) both work and a socket that already carries a key is never touched. And if the feed ever lands on
a public node while a private one is configured, the Activity log says so once a minute, with the hostname:

> The feed is on a PUBLIC node (solana-rpc.publicnode.com), not on your own socket. A private socket that refuses (a
> missing key answers 401) leaves the desk slower than the one you paid for — check the WebSocket URL in Settings.

## What this does **not** measure

- **Validator → provider.** The last mile between a transaction landing and your provider seeing it is theirs. A Geyser
  / Yellowstone provider and Jito ShredStream are closer to that edge than a public WebSocket, which is why
  `geyserUrl` exists and why ShredStream is still listed as missing in [COMPARISON.md](COMPARISON.md).
- **Order placement.** Reading a coin is not buying it. The entry path has its own numbers (the buy line in the
  Activity log), and Practice Mode has a configurable latency so the difference stays visible.
- **Another machine, another city.** Re-run the script where the bot runs. The numbers change; the method does not.

## Reproduce it

1. Settings → **WebSocket URL**: your provider's socket (a private node's socket, or a Geyser-class endpoint which the
   desk prefers automatically). Leave it empty and the address is derived from your node URL, key included — the same
   derivation the desk uses, so a measurement can no longer show only the public door on a machine that trades through a
   private socket.
2. Settings → **Test my connection** first: it opens each address once and says what it answered. A ✕ there is the
   problem, not the bot.
3. `node scripts/latency.js 120` from the repository.
4. Compare the two rows. If your socket is not the faster one by a clear margin, the problem is the socket or the
   provider — not the bot.

The key is printed as `?api-key=***`: the report is meant to be pasted into a message without handing anybody the
credential.
