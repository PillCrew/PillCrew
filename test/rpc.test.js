const assert = require('assert');
const { RPCManager, DEFAULT_ENDPOINTS, classify } = require('../src/rpc');

(async () => {
  // RULE CHANGED: the pool now holds only endpoints that answered a funded-wallet call on 2026-11-04. Four public
  // hosts were removed for refusing service (paid plan, missing key, or 429 without one).
  assert.strictEqual(DEFAULT_ENDPOINTS.length, 5);
  assert.strictEqual(classify(new Error('429 Too Many Requests')).kind, '429');
  assert.strictEqual(classify(new Error('RPC timeout')).kind, 'timeout');
  assert.strictEqual(classify(new Error('fetch failed')).kind, 'network');
  assert.strictEqual(classify(new Error('Transaction simulation failed')).retry, false);
  // A provider that will not serve the method is a node problem, not a verdict on the transaction: leaving it
  // unclassified is what kept a real position unsellable while the pool rotated back to the same dead host.
  assert.strictEqual(classify(new Error('400 Bad Request: chain is not available on free plan, please upgrade to paid plan')).kind, 'plan');
  assert.strictEqual(classify(new Error('Method getBalance is available for paid plans only')).kind, 'plan');
  assert.strictEqual(classify(new Error('The free public RPC now requires an API key')).kind, 'plan');
  assert.strictEqual(classify(new Error('API key is not allowed to access blockchain')).kind, 'plan');
  // A provider that will only answer a narrower shape of the same question is a node problem too: one public host
  // refuses getParsedTokenAccountsByOwner without a mint filter, and taking that as fatal hid every coin in the
  // wallet - which is exactly what "my coins are not showing" looked like.
  assert.strictEqual(classify(new Error('400 Bad Request: {"error":{"code":-32602,"message":"getTokenAccountsByOwner requires a mint filter on this endpoint"}}')).kind, 'plan');
  // A real chain rejection stays fatal: rotating it to another node would only fail again.
  assert.strictEqual(classify(new Error('custom program error: 0x1771')).retry, false);

  // A public host refusing a burst is a short bench, not a ten-minute exile: a 403 that names nothing was what kept
  // the pool at zero live nodes while the network itself was fine.
  assert.strictEqual(classify(new Error('403 Forbidden: {"jsonrpc":"2.0","error":{"code":-32602,"message":"Request blocked"}}')).kind, '403');
  assert.strictEqual(classify(new Error('403 Forbidden: {"error":"invalid api key"}')).kind, 'auth');
  assert.strictEqual(classify(new Error('401 Unauthorized')).kind, 'auth');

  // 429 on node 0, timeout on node 1, network error on node 2, node 3 works
  const behaviour = { 0: '429', 1: 'slow', 2: 'net', 3: 'ok' };
  const switches = [];
  const m = new RPCManager({
    timeoutMs: 100,
    factory: (url) => ({ url, getBalance: async () => {
      const i = DEFAULT_ENDPOINTS.indexOf(url);
      const b = behaviour[i] || 'ok';
      if (b === '429') throw new Error('429 Too Many Requests');
      if (b === 'slow') await new Promise((r) => setTimeout(r, 500));
      if (b === 'net') throw new Error('fetch failed');
      return 42;
    } }),
    onSwitch: (f, t, why) => switches.push(why),
  });
  assert.strictEqual(await m.call((c) => c.getBalance()), 42);
  assert.strictEqual(m.current, DEFAULT_ENDPOINTS[3]);
  assert.deepStrictEqual(switches, ['429', 'timeout', 'network']);
  // cooled-down nodes are skipped later
  assert.ok(m.status().nodes[0].coolingDown);

  // real (non-network) errors are not retried on other nodes
  let calls = 0;
  const m2 = new RPCManager({ factory: () => ({ f: async () => { calls++; throw new Error('custom program error: 0x1771'); } }) });
  await assert.rejects(m2.call((c) => c.f()), /0x1771/);
  assert.strictEqual(calls, 1);

  // all nodes dead -> clear error, tried each node once
  let tries = 0;
  const m3 = new RPCManager({ factory: () => ({ f: async () => { tries++; throw new Error('429'); } }) });
  await assert.rejects(m3.call((c) => c.f()), /All RPC nodes/);
  assert.strictEqual(tries, DEFAULT_ENDPOINTS.length);

  // RULE ADDED 2026-11-10 (1.1.4): a press that is allowed a few seconds WAITS for a node to come off its cooldown, instead
  // of answering "All RPC nodes are busy or unreachable right now. (429 Too Many Requests)" to an operator holding a bag.
  // Nothing price-critical passes `waitMs`, so a buy or an exit is never held up by this.
  {
    // The node is refused until `openAt`: the only way to get an answer is to WAIT for it.
    const openAt = Date.now() + 400;
    let tries = 0;
    const m = new RPCManager({ timeoutMs: 100, factory: () => ({ f: async () => { tries++; if (Date.now() < openAt) throw new Error('429 Too Many Requests'); return 'answer'; } }) });
    await assert.rejects(() => m.call((c) => c.f(), { attempts: DEFAULT_ENDPOINTS.length, budgetMs: 500 }), /All RPC nodes/);
    const before = tries;
    const answered = await m.call((c) => c.f(), { attempts: 2, budgetMs: 4000, waitMs: 900 });
    assert.strictEqual(answered, 'answer', 'an operator press waits for the bench to end instead of failing');
    assert.ok(tries > before, 'and it really did try again: ' + tries);

    // without the wait budget it still refuses at once (a buy must never be delayed by a cooldown)
    const quickOpen = Date.now() + 600;
    const quick = new RPCManager({ timeoutMs: 100, factory: () => ({ f: async () => { if (Date.now() < quickOpen) throw new Error('429 Too Many Requests'); return 'late'; } }) });
    await assert.rejects(() => quick.call((c) => c.f(), { attempts: 2, budgetMs: 300 }), /All RPC nodes/);
  }

  // A pool where every node is cooling down still tries one instead of refusing the caller: a bench is not proof
  // that the node is dead, and an answer to the player of "all busy" while the chain is fine is worse.
  let tries4 = 0;
  const m3b = new RPCManager({ factory: () => ({ f: async () => { tries4++; throw new Error('429'); } }) });
  await assert.rejects(() => m3b.call((c) => c.f(), { attempts: 2, budgetMs: 2000 }), /All RPC nodes/);
  await m3b.call((c) => c.f(), { attempts: 1, budgetMs: 2000 }).catch(() => {});
  assert.strictEqual(tries4, 3, 'a cooldown does not stop the call from being attempted');

  // RULE ADDED 2026-11-08 (1.1.2): `confirm` is the only thing allowed to call a transaction done.
  {
    // Accepted-then-failed: the chain holds the error, so the money did NOT move and the caller must be told.
    const failed = new RPCManager({
      timeoutMs: 200,
      factory: () => ({ getSignatureStatuses: async () => ({ value: [{ slot: 5, err: { InstructionError: [0, { Custom: 1 }] }, confirmationStatus: 'confirmed' }] }) }),
    });
    await assert.rejects(() => failed.confirm('SIGX', { timeoutMs: 1500, pollMs: 50 }), /landed and FAILED.*InstructionError/, 'a transaction that failed on chain is an error, not a success');

    // Confirmed: resolves with the slot.
    let polls = 0;
    const slow = new RPCManager({
      timeoutMs: 200,
      factory: () => ({ getSignatureStatuses: async () => { polls++; return { value: [polls < 3 ? { slot: 9, confirmationStatus: 'processed' } : { slot: 9, confirmationStatus: 'confirmed' }] }; } }),
    });
    const done = await slow.confirm('SIGY', { timeoutMs: 3000, pollMs: 20 });
    assert.strictEqual(done.slot, 9, 'a confirmed transaction resolves with its slot');
    assert.ok(polls >= 3, 'and it waits instead of believing the first "processed" answer');

    // Never seen: says so, and NAMES the signature, because the money may still land and must not be sent twice.
    const gone = new RPCManager({ timeoutMs: 200, factory: () => ({ getSignatureStatuses: async () => ({ value: [null] }) }) });
    await assert.rejects(() => gone.confirm('SIGZ', { timeoutMs: 120, pollMs: 20 }), /SIGZ/, 'an unknown transaction is reported by signature, not as a payment');
  }

  // custom node goes first, and can be removed
  const m4 = new RPCManager({ custom: 'https://my.helius.example/x', factory: (u) => ({ u }) });
  assert.strictEqual(m4.current, 'https://my.helius.example/x');
  m4.setCustom('');
  assert.strictEqual(m4.current, DEFAULT_ENDPOINTS[0]);
  assert.strictEqual(m4.endpoints.length, DEFAULT_ENDPOINTS.length);

  // RULE ADDED 2026-11-05: a desk may hold TWO private nodes, tried in the order the operator typed them, and the
  // public pool stays behind them. Measured on live keys: a primary and a backup, both `https://`.
  const m4b = new RPCManager({ custom: ['https://a.example/rpc', 'https://b.example/rpc'], factory: (u) => ({ u }) });
  assert.strictEqual(m4b.current, 'https://a.example/rpc', 'the first node is the one that is used');
  assert.strictEqual(m4b.endpoints[1], 'https://b.example/rpc', 'the second is right behind it');
  assert.ok(m4b.endpoints.length > 2, 'and the public pool is still there as the last resort');
  m4b.setCustoms(['https://b.example/rpc']);
  assert.strictEqual(m4b.current, 'https://b.example/rpc', 'dropping the first node promotes the second');
  assert.ok(!m4b.endpoints.includes('https://a.example/rpc'), 'the dropped one is gone from the pool too');
  assert.strictEqual(m4b.endpoints.filter((u) => DEFAULT_ENDPOINTS.includes(u)).length, DEFAULT_ENDPOINTS.length,
    'and the pool was not eaten by the custom list');
  // A string is one node, never its characters.
  const m4c = new RPCManager({ custom: 'https://only.example/rpc', factory: (u) => ({ u }) });
  assert.strictEqual(m4c.current, 'https://only.example/rpc');

  // A call is bounded even when every node hangs: eight nodes timing out at eight seconds each used to hold a
  // sell for a minute while the price it wanted was gone.
  const m5 = new RPCManager({ timeoutMs: 400, factory: () => ({ hang: () => new Promise(() => {}) }) });
  const t5 = Date.now();
  await assert.rejects(m5.call((c) => c.hang(), { timeoutMs: 150, attempts: 3, budgetMs: 500 }), /All RPC nodes/);
  const spent = Date.now() - t5;
  assert.ok(spent < 900, `the whole failover must stay inside its budget, took ${spent} ms`);

  // The broadcast budget the engine uses stops the loop after a couple of tries, not all eight.
  let broadcastTries = 0;
  const m6 = new RPCManager({ factory: () => ({ send: async () => { broadcastTries++; throw new Error('RPC timeout'); } }) });
  await assert.rejects(m6.call((c) => c.send(), { timeoutMs: 200, attempts: 3, budgetMs: 1000 }), /All RPC nodes/);
  assert.strictEqual(broadcastTries, 3, 'a broadcast gets three tries, not eight');
  // The same bytes go out on parallel doors: the first signature wins and the rest are left to fail quietly. A
  // transaction only lands once it reaches a leader, so one door is one chance.
  {
    let sent = 0;
    const m7 = new RPCManager({
      factory: (url) => ({ sendRawTransaction: async () => { sent++; if (url === DEFAULT_ENDPOINTS[2]) return 'SIG'; throw new Error('fetch failed'); } }),
    });
    assert.strictEqual(await m7.broadcast(Buffer.from('x')), 'SIG');
    assert.strictEqual(sent, 3, 'three doors, not one');

    const m8 = new RPCManager({ factory: () => ({ sendRawTransaction: async () => { throw new Error('400 Bad Request'); } }) });
    await assert.rejects(() => m8.broadcast(Buffer.from('x'), { doors: 2 }), /400/);
  }

  // RULE ADDED 2026-11-06 (1.0.9): a provider's socket needs the same key its HTTP endpoint carries, and a socket URL
  // pasted without it answers 401 - after which the desk quietly used public nodes, which is the slowest feed in the room.
  // The key is copied across as the same name=value pair the RPC URL uses, so FluxRPC (`?key=`) and Helius (`?api-key=`)
  // both work, and a socket that already carries a key is left alone.
  {
    const { Engine } = require('../src/engine');
    const ws = (settings, url) => Engine.prototype._wsUrl.call({ s: settings }, url);
    assert.strictEqual(ws({ rpcUrl: 'https://eu.fluxrpc.com?key=ABC' }, 'wss://ws.eu.fluxrpc.com'), 'wss://ws.eu.fluxrpc.com?key=ABC', 'the key follows the socket');
    assert.strictEqual(ws({ rpcUrl: 'https://mainnet.helius-rpc.com/?api-key=HEL' }, 'wss://atlas.mainnet.helius-rpc.com'), 'wss://atlas.mainnet.helius-rpc.com?api-key=HEL', 'and it keeps the provider\'s own name for it');
    assert.strictEqual(ws({ rpcUrl: 'https://eu.fluxrpc.com?key=ABC' }, 'wss://ws.eu.fluxrpc.com?key=OWN'), 'wss://ws.eu.fluxrpc.com?key=OWN', 'a key already in the URL is never replaced');
    assert.strictEqual(ws({ rpcUrl: '' }, 'wss://ws.eu.fluxrpc.com'), 'wss://ws.eu.fluxrpc.com', 'no key to copy, nothing added');
    assert.strictEqual(ws({ rpcUrl: 'https://x.example?key=ABC' }, 'https://ws.x.example'), 'wss://ws.x.example?key=ABC', 'an https socket is upgraded and keyed in one step');
    assert.strictEqual(ws({ rpcUrl: 'https://x.example?key=ABC' }, ''), '', 'no socket configured stays empty');
  }

  // RULE ADDED 2026-11-06 (1.0.9): PumpDev caps a stream (25 coins per IP on the free plan, then 12), so the automatic
  // order asks for the full program first when this machine has a private socket or node to read it from. A key alone no
  // longer wins over a feed that can watch every coin.
  {
    const { Engine, DEFAULTS } = require('../src/engine');
    const { Store } = require('../src/store');
    const fs = require('fs');
    const os = require('os');
    const path = require('path');

// Every scratch directory this suite makes lives under one root that is removed on exit, and roots left by an
// earlier run are swept (see `test/scratch.js`).
const scratchDir = require('./scratch').root;
    const made = (patch) => {
      const store = new Store(fs.mkdtempSync(path.join(scratchDir, 'pc-feed-')), 's.json', { ...DEFAULTS, mode: 'paper', ...patch });
      const e = new Engine({ exists: () => true, isUnlocked: () => true, address: () => 'W', keypair: null }, store);
      for (const id of ['_loop', '_ui', '_pxTimer', '_bal', '_marketTimer', '_hotTimer', '_posTimer']) clearInterval(e[id]);
      e.refreshBalance = () => {};
      const picked = [];
      e._startChain = (geo) => picked.push(geo === true ? 'geyser' : 'chain');
      e._connectPortal = (url, label) => picked.push(label);
      e._connect();
      return picked[0] || 'nothing';
    };
    const KEY = 'pumpdev-secret';
    assert.strictEqual(made({ pumpdevKey: KEY }), 'pumpdev', 'a key alone is still the only door when nothing private is set');
    assert.strictEqual(made({ pumpdevKey: KEY, rpcWsUrl: 'wss://ws.example.com' }), 'chain', 'a private socket beats a capped stream');
    assert.strictEqual(made({ pumpdevKey: KEY, rpcUrl: 'https://rpc.example.com' }), 'chain', 'so does a private node');
    assert.strictEqual(made({ pumpdevKey: KEY, rpcUrl: 'https://rpc.example.com', geyserUrl: 'wss://geyser.example.com', geyserToken: 't' }), 'geyser', 'and Geyser beats both');
    assert.strictEqual(made({ pumpdevKey: KEY, feedSource: 'pumpdev', rpcWsUrl: 'wss://ws.example.com' }), 'pumpdev', 'an explicit choice is still honoured');
  }

  console.log('RPCManager tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
