const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Every scratch directory this suite makes lives under one root that is removed on exit, and roots left by an
// earlier run are swept (see `test/scratch.js`).
const scratchDir = require('./scratch').root;
const { Store } = require('../src/store');
const { Engine, DEFAULTS } = require('../src/engine');
const reclaim = require('../src/reclaim');

const wallet = {
  exists: () => true,
  isUnlocked: () => true,
  address: () => 'Wallet111111111111111111111111111111111111111',
  keypair: null,
};

function engine(overrides = {}) {
  const store = new Store(fs.mkdtempSync(path.join(scratchDir, 'wallet-')), 's.json', DEFAULTS);
  store.set({ mode: 'live', buyAmountSol: 0.001, priorityFeeSol: 0.00005, ...overrides });
  const e = new Engine(wallet, store);
  clearInterval(e._bal);
  clearInterval(e._ui);
  e.refreshBalance = () => {};
  e._log = () => {};
  // No test reaches the network: a fixed exchange rate, a market that lists nothing, and one price for every mint.
  e.market.solPrice = () => 150;
  e.market.enrich = async () => new Map();
  e.market.prices = async (mints) => new Map(mints.map((m) => [m, { priceUsd: 0.0002 }]));
  return e;
}

/** One token account as the reclaim scanner reports it. */
const account = (mint, amount, lamports = 2039280) => ({
  pubkey: 'acct-' + mint, mint, program: reclaim.TOKEN_PROGRAM, lamports,
  amount: String(amount), uiAmount: Number(amount), decimals: 6, frozen: false, isNative: false,
});

function stubScan(accounts) {
  const r = reclaim.summarise(accounts);
  reclaim.scanTokenAccounts = async () => r;
  return r;
}

/** A scan that reports the balances as they are right now, the way a real chain read would. */
function stubScanFrom(map) {
  reclaim.scanTokenAccounts = async () => reclaim.summarise([...map.entries()].map(([mint, amount]) => account(mint, amount)));
}

/** A 32-character base58 string, which is what a mint looks like to the validator. */
const mkid = (s) => (String(s).replace(/[^1-9A-HJ-NP-Za-km-z]/g, '2') + '1'.repeat(32)).slice(0, 32);

const holds = (map) => (mint) => {
  const v = map.get(mint);
  return Promise.resolve(v == null ? 0n : BigInt(v));
};

(async () => {
  const realScan = reclaim.scanTokenAccounts;
  const real = { _tokenBalanceRaw: Engine.prototype._tokenBalanceRaw, _backupTrade: Engine.prototype._backupTrade };

  try {
    // A coin the book never recorded is adopted from the wallet at the price it trades at now, so it shows on the
    // panel and the exit rules own it instead of it sitting invisible.
    {
      stubScan([account('CoinA', 1000), account('EmptyB', 0)]);
      const e = engine();
      e.tokens.set('CoinA', { mint: 'CoinA', symbol: 'AAA', mc: 42, mcHist: [], trades: [], sources: new Set(['launch']) });
      const added = await e._adoptOnChain();
      assert.strictEqual(added, 1, 'only the account with a balance is adopted');
      const p = e.positions.get('CoinA');
      assert.ok(p, 'the holding is on the book');
      assert.strictEqual(p.entryMc, 42, 'it is priced where it trades now');
      assert.strictEqual(p.adopted, true);
      assert.ok(p.solIn > 0 && p.solIn < 0.01, `it carries its own market value, not the ticket: ${p.solIn}`);
      assert.ok(!e.positions.has('EmptyB'), 'an empty account is rent, not a position');

      // A second pass is a no-op: an adopted coin is never adopted twice.
      assert.strictEqual(await e._adoptOnChain(), 0);
    }

    // A holding that no service will price is a leftover, not a position: booking it at the ticket size invented an
    // entry price nobody paid and a loss the moment it sold, so it goes down the settle path instead (sell, or burn
    // the dust, and close the account for its rent).
    {
      stubScan([account('Mystery', 700)]);
      const e = engine();
      e.market.prices = async () => new Map();
      const settled = [];
      e._settleMint = (mint) => { settled.push(mint); return Promise.resolve(); };
      const added = await e._adoptOnChain();
      assert.strictEqual(added, 0, 'an unpriced holding is not booked as a position');
      assert.ok(!e.positions.has('Mystery'));
      assert.deepStrictEqual(settled, ['Mystery'], 'it is sold as a leftover, which also returns its rent');
    }

    // Without an exchange rate the value of a holding cannot be worked out, and the rate is asked for before anything
    // is valued - a cold start has no rate at all, which used to make every holding look unpriced.
    {
      stubScan([account('CoinC', 1000)]);
      const e = engine();
      let asked = 0;
      let rate = 0;
      e.market.solPrice = () => rate;
      e.market.enrich = async () => { asked++; rate = 150; return new Map(); };
      const added = await e._adoptOnChain();
      assert.strictEqual(asked, 1, 'the exchange rate was fetched first');
      assert.strictEqual(added, 1, 'and the holding is then valued and managed');
      assert.ok(e.positions.get('CoinC').solIn > 0);
    }

    // Selling everything takes the wallet balance as the truth: a holding the book never recorded is sold too, and
    // what is left over is reported instead of being called a success.
    {
      const balances = new Map([['Tracked', 500], ['Loose', 900], ['Stuck', 700], ['Gone', 0]]);
      stubScanFrom(balances);
      const e = engine();
      e.walletBalance = 0.01;
      e._tokenBalanceRaw = holds(balances);
      const sold = [];
      e._backupTrade = async (action, mint) => {
        assert.strictEqual(action, 'sell');
        sold.push(mint);
        if (mint !== 'Stuck') balances.set(mint, 0);
        return { sig: 'sig-' + mint, landed: true };
      };
      // The book knows one of them, and its own ladder fills it.
      e.positions.set('Tracked', {
        mint: 'Tracked', symbol: 'TRK', entryMc: 100, mc: 100, peakMc: 100, solIn: 0.001, feeBuy: 0,
        openedAt: Date.now(), status: 'open', closing: false, paper: false, fails: 0, nextTry: 0, tokIn: 500n,
      });
      // RULE CHANGED: a leftover now goes through the trade door first (the backup route has no quote for amounts that
      // small), so a coin that neither door can sell is the one that must stay. Stuck is refused by both.
      e._tradeLive = async (action, mint) => {
        if (mint === 'Stuck') throw new Error('the trade door could not price this coin yet');
        balances.set(mint, 0); sold.push(mint); return { sig: 'sig-' + mint, raw: null, landed: true };
      };
      e._feeFor = () => 0.00001;
      let closed = 0;
      e.closeEmptyAccounts = async () => { closed++; return { closed: 2, sol: 0.004 }; };

      const out = await e.sellEverything();
      assert.strictEqual(sold[0], 'Tracked', 'the tracked position goes out through its own ladder first');
      assert.ok(sold.includes('Loose'), 'the untracked holding was sold');
      assert.ok(sold.includes('Stuck'), 'the stubborn holding was attempted');
      assert.strictEqual(out.sold, 1, 'only the coin that fully left counts as sold');
      assert.strictEqual(out.tokens, 2, 'two holdings were still on chain after the ladder ran');
      assert.strictEqual(out.closed, 2);
      assert.ok(Math.abs(out.rentSol - 0.004) < 1e-9);
      assert.ok(out.failed.some((f) => f.startsWith('Stuck')), 'the leftover balance is named in the report');
      assert.ok(!e.positions.has('Tracked'), 'the tracked position is booked and closed');
      // RULE CHANGED: a sale now closes the coin's account by itself (so the rent comes back with the sale, not three
      // seconds later), and the sell-all closes whatever is left once more. Two closings, both wanted.
      assert.strictEqual(closed, 2, 'the account is closed by the sale and again by the sweep afterwards');
      assert.strictEqual(e._sellingAll, false, 'the guard is released even when something failed');
    }

    // Sell every coin must not fire twice at once: the second press is refused instead of selling twice.
    {
      stubScan([account('X', 10)]);
      const e = engine();
      // RULE CHANGED: a sell-all now refuses up front when there is no SOL for the fees (it used to spend a minute
      // failing silently), so this scenario needs a wallet that can pay.
      e.walletBalance = 0.01;
      let release;
      // Either door may be the one that is slow now: the leftover goes through the trade door first.
      const hold = () => new Promise((r) => { release = () => r({ sig: 's', landed: true }); });
      e._tradeLive = hold;
      e._backupTrade = hold;
      e._tokenBalanceRaw = () => Promise.resolve(0n);
      e.closeEmptyAccounts = async () => ({ closed: 0, sol: 0 });
      const first = e.sellEverything();
      await assert.rejects(() => e.sellEverything(), /already running/);
      release();
      await first;
    }

    // Closing every position is an instruction about the market too: the desk must not refill the wallet in the same
    // second, or the hand that pressed the button watches it happen.
    {
      const e = engine();
      e.walletBalance = 0.02;
      e.positions.set('PAUSE', {
        mint: 'PAUSE', symbol: 'PAUSE', paper: false, status: 'open', solIn: 0.001, entryMc: 1, mc: 1, peakMc: 1,
        feeBuy: 0, openedAt: Date.now(), closing: false, fails: 0, nextTry: 0,
      });
      e._sell = async () => {};
      e._tokenBalanceRaw = async () => 0n;
      const out = await e.sellAll();
      assert.strictEqual(out.sold, 1);
      assert.ok(e.pausedUntil > Date.now(), 'new entries are paused after a manual sell-all');
      assert.match(e.pauseReason, /sold everything/i);
    }

    // One holding sold from the Wallet tab: the book keeps no ghost when its tokens are gone.
    {      const mint = mkid('Solo');
      const balances = new Map([[mint, 123]]);
      stubScanFrom(balances);
      const e = engine();
      e._tokenBalanceRaw = holds(balances);
      e.refreshBalance = () => {};
      e._log = () => {};
      e._backupTrade = async () => { balances.set(mint, 0); return { sig: 'sig', landed: true }; };
      e._feeFor = () => 0.00001;
      const info = await e.sellHolding(mint);
      assert.strictEqual(info.left, '0');
      await assert.rejects(() => e.sellHolding(mint), /holds none/);
      await assert.rejects(() => e.sellHolding('nope'), /Invalid token address/);
    }

    // A wallet whose free SOL sits inside open positions still starts: the exits need a fee, not the whole ticket.
    {
      stubScan([account('Held', 1000)]);
      const e = engine({ buyAmountSol: 0.5, priorityFeeSol: 0.0002 });
      e.walletBalance = 0.0007;
      e._tokenBalanceRaw = holds(new Map([['Held', 1000]]));
      // 1000 tokens at $0.0225 is 0.15 SOL, which is worth managing with a 0.5 SOL ticket.
      e.market.prices = async (mints) => new Map(mints.map((m) => [m, { priceUsd: 0.0225 }]));
      e._connect = () => {};
      e._startMarket = () => {};
      const res = await e.start();
      assert.strictEqual(res.ok, true, 'positions can be managed with almost no free SOL');
      assert.ok(e.positions.has('Held'), 'the coin came back on the panel');
      e.stop();
    }

    // With nothing on the book the same balance is not enough for an entry, and the bot says so in one sentence.
    {
      stubScan([]);
      const e = engine({ buyAmountSol: 0.5 });
      e.walletBalance = 0.0007;
      const res = await e.start();
      assert.strictEqual(res.ok, false);
      assert.match(res.error, /Not enough SOL in your wallet/);
    }

    // A saved position is restored and can be managed; one whose tokens are gone is dropped.
    {
      stubScan([]);
      const e = engine({
        openPositions: [
          { mint: 'Saved', symbol: 'SAV', entryMc: 10, mc: 12, peakMc: 12, solIn: 0.001, feeBuy: 0, openedAt: Date.now() },
          { mint: 'Vanished', symbol: 'VAN', entryMc: 10, mc: 10, peakMc: 10, solIn: 0.001, feeBuy: 0, openedAt: Date.now() },
        ],
      });
      e._tokenBalanceRaw = holds(new Map([['Saved', 42]]));
      await e._restorePositions();
      assert.ok(e.positions.has('Saved'), 'the coin bought in the last session is back');
      assert.ok(!e.positions.has('Vanished'), 'a position whose tokens are gone is removed');
      assert.strictEqual(e.s.openPositions.length, 1, 'the file no longer carries the ghost');
    }

    // Two coins closing in the same second both get their leftover sold and their rent back: a settle that arrives
    // while another is running waits in the queue instead of being dropped (it used to be dropped, so on a sell-all
    // only the first coin left the wallet).
    {
      const a = mkid('QueueA');
      const b = mkid('QueueB');
      const balances = new Map([[a, 500], [b, 500]]);
      stubScan([account(a, 500), account(b, 500)]);
      const e = engine();
      e.walletBalance = 0.02;
      e._tokenBalanceRaw = holds(balances);
      e._feeFor = () => 0.00001;
      const sold = [];
      // The first order is slow, so the second coin is handed over while it is still in flight.
      e._tradeLive = async (side, mint) => {
        await new Promise((r) => setTimeout(r, 60));
        sold.push(mint);
        balances.set(mint, 0);
        return { sig: 'sig-' + mint.slice(0, 4), landed: true };
      };
      let closes = 0;
      e.closeEmptyAccounts = async () => { closes++; return { closed: 1, sol: 0.002 }; };
      await Promise.all([e._settleMint(a), e._settleMint(b)]);
      assert.deepStrictEqual(sold.slice().sort(), [a, b].sort(), 'both remainders were sold');
      assert.strictEqual(closes, 2, 'each settled coin closed its own account');
      assert.strictEqual(e._settleQueue.size, 0, 'the queue drained');
    }

    // A host that indexes only the original token programme must not cost the wallet the rent of every account it can
    // still close. One programme failing is not the scan failing; two are.
    {
      const parsed = (mint, amount) => ({
        pubkey: 'acct-' + mint,
        account: { lamports: 2039280, data: { parsed: { info: { mint, tokenAmount: { amount, uiAmount: Number(amount), decimals: 6 }, state: 'initialized' } } } },
      });
      const scanWith = (refuse) => realScan(async (fn) => fn({
        getParsedTokenAccountsByOwner: async (_owner, filter) => {
          const program = filter.programId.toBase58();
          if (refuse === 'both' || refuse === program) throw new Error('requires a mint filter');
          return { value: [parsed('M' + program.slice(0, 3), '0')] };
        },
      }), '11111111111111111111111111111111');
      const half = await scanWith(reclaim.TOKEN_2022_PROGRAM);
      assert.strictEqual(half.empty.length, 1, 'the token-2020 accounts are still reported');
      assert.ok(half.emptyRentSol > 0.002, 'and their rent is still counted');
      await assert.rejects(() => scanWith('both'), /mint filter/, 'two failures are a real failure');
    }

    console.log('Wallet tests passed');
    process.exit(0);
  } finally {
    reclaim.scanTokenAccounts = realScan;
    Engine.prototype._tokenBalanceRaw = real._tokenBalanceRaw;
    Engine.prototype._backupTrade = real._backupTrade;
  }
})().catch((e) => { console.error(e); process.exit(1); });
