// The council: the tiers, the verdict, and the promise that a key never leaves this machine.
const assert = require('assert');
const path = require('path');
const { ask, testTier, decide, normaliseTiers, usableTiers, maskKey, buildMessages, DEFAULT_TIERS, MAX_TIERS } = require('../src/ai');
const Share = require('../src/share');
const { DEFAULTS } = require('../src/engine');

const TIER = (over = {}) => ({ label: 'one', url: 'https://api.example.com/v1/chat/completions', key: 'sk-test-key-123456', model: 'm', on: true, ...over });

/** A fake endpoint that answers with a scripted body, and records what it was asked. */
function stub(reply) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const r = typeof reply === 'function' ? reply(calls.length, url) : reply;
    if (r && r.throw) throw new Error(r.throw);
    return { ok: r.status ? r.status < 400 : true, status: r.status || 200, json: async () => r.body || {} };
  };
  f.calls = calls;
  return f;
}
const answer = (text) => ({ body: { choices: [{ message: { content: text } }] } });

(async () => {
  // ── 1. a tier is only a URL, a key and a model - and only http(s) is a URL ──
  {
    const t = normaliseTiers([
      TIER({ label: '  deep  ', url: 'file:///etc/passwd' }),
      TIER({ url: 'https://ok.example/x' }),
      TIER({ url: '' }),
      TIER({ on: false }),
      TIER(), TIER(), TIER(),
    ]);
    assert.strictEqual(t.length, MAX_TIERS, 'at most six tiers are kept: ' + t.length);
    assert.strictEqual(t[0].label, 'deep', 'the label is trimmed');
    assert.strictEqual(t[0].url, '', 'a file: URL is not an endpoint');
    assert.strictEqual(t[1].url, 'https://ok.example/x', 'an https URL is kept');
    assert.deepStrictEqual(normaliseTiers([]).map((x) => x.label), DEFAULT_TIERS.map((x) => x.label), 'no tiers at all means the defaults');
    // A tier is only asked when it is switched on AND complete.
    assert.strictEqual(usableTiers([TIER({ on: false })]).length, 0, 'a tier switched off is not asked');
    assert.strictEqual(usableTiers([TIER({ key: '' })]).length, 0, 'a tier with no key is not asked');
    assert.strictEqual(usableTiers([TIER({ model: '' })]).length, 0, 'a tier with no model is not asked');
    assert.strictEqual(usableTiers([TIER()]).length, 1, 'a complete tier is asked');
  }

  // ── 2. no key is not "no objections" ──
  {
    const r = await ask({ messages: [{ role: 'user', content: 'coin?' }], tiers: [TIER({ key: '' })], fetch: stub(answer('buy')) });
    assert.strictEqual(r.verdict, 'no-keys', 'without a key the council says so: ' + r.verdict);
    assert.ok(/paste your DeepSeek or OpenRouter key/.test(r.reason), r.reason);
  }

  // ── 3. every usable tier is asked, in parallel, with the same question ──
  {
    const f = stub(answer('the read is fine'));
    const r = await ask({ messages: [{ role: 'user', content: 'coin?' }], tiers: [TIER({ label: 'a' }), TIER({ label: 'b', url: 'https://b.example/x' })], fetch: f });
    assert.strictEqual(f.calls.length, 2, 'two tiers, two requests');
    assert.strictEqual(r.verdict, 'ok');
    assert.strictEqual(r.by, 'a', 'the first real answer is the read');
    assert.strictEqual(r.answers.length, 2, 'both answers are reported');
    const body = f.calls[0].body;
    assert.strictEqual(body.model, 'm', 'the model comes from the tier');
    assert.strictEqual(body.messages[0].content, 'coin?', 'the question is passed through');
    assert.ok(f.calls[0].init.headers.authorization.startsWith('Bearer '), 'the key travels as a bearer token');
  }

  // ── 4. one VETO refuses the coin, whoever said it ──
  {
    const f = async (url) => (url.includes('b.example') ? { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'VETO: dev holds 22%' } }] }) } : { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'looks good' } }] }) });
    const r = await ask({ messages: [{ role: 'user', content: 'coin?' }], tiers: [TIER({ label: 'a' }), TIER({ label: 'b', url: 'https://b.example/x' })], fetch: f });
    assert.strictEqual(r.verdict, 'veto', 'a veto from one model is a veto');
    assert.strictEqual(r.by, 'b');
    assert.ok(/dev holds 22%/.test(r.reason), 'and its reason is carried: ' + r.reason);
  }

  // ── 5. a tier that fails is not agreement, and a council that says nothing is silent ──
  {
    const f = async (url) => (url.includes('bad.example') ? { status: 500, ok: false, json: async () => ({}) } : { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) });
    const mixed = await ask({ messages: [{ role: 'user', content: 'q' }], tiers: [TIER({ label: 'good' }), TIER({ label: 'bad', url: 'https://bad.example/x' })], fetch: f });
    assert.strictEqual(mixed.verdict, 'ok', 'one good answer carries the read');
    assert.strictEqual(mixed.answers.find((a) => a.label === 'bad').ok, false, 'the failing tier is reported as failed');
    const dead = await ask({ messages: [{ role: 'user', content: 'q' }], tiers: [TIER()], fetch: async () => ({ status: 429, ok: false, json: async () => ({}) }) });
    assert.strictEqual(dead.verdict, 'silent', 'nothing answered is silent, never ok: ' + dead.verdict);
    assert.ok(/no model answered/.test(dead.reason), dead.reason);
    const thrown = await ask({ messages: [{ role: 'user', content: 'q' }], tiers: [TIER()], fetch: async () => { throw new Error('socket hang up'); } });
    assert.strictEqual(thrown.verdict, 'silent', 'a thrown request is silent too');
    assert.ok(/socket hang up/.test(thrown.answers[0].error), 'and the reason is kept: ' + thrown.answers[0].error);
    const empty = await ask({ messages: [{ role: 'user', content: 'q' }], tiers: [TIER()], fetch: async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '' } }] }) }) });
    assert.strictEqual(empty.verdict, 'silent', 'an empty answer is not an opinion');
    // A timeout is reported as a timeout, not as a mysterious silence.
    const slow = await ask({ messages: [{ role: 'user', content: 'q' }], tiers: [TIER()], timeoutMs: 60, fetch: (url, init) => new Promise((res, rej) => { init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))); }) });
    assert.strictEqual(slow.verdict, 'silent');
    assert.ok(/no answer in/.test(slow.answers[0].error), 'a timeout names itself: ' + slow.answers[0].error);
  }

  // ── 6. a key is masked, never echoed ──
  {
    assert.strictEqual(maskKey(''), '');
    assert.strictEqual(maskKey('short'), '…');
    const masked = maskKey('sk-test-key-123456');
    assert.ok(!masked.includes('test'), 'the middle of a key is never shown: ' + masked);
    assert.ok(masked.startsWith('sk-') && masked.endsWith('456'), 'only the ends: ' + masked);
    // And the whole answer never carries one back.
    const r = await ask({ messages: [{ role: 'user', content: 'q' }], tiers: [TIER()], fetch: stub(answer('fine')) });
    assert.ok(!JSON.stringify(r).includes('sk-test-key-123456'), 'the key never comes back in a reply');
  }

  // ── 7. the settings code cannot carry a key ──
  {
    const settings = { ...DEFAULTS, aiTiers: [{ label: 'd', url: 'https://x.example/y', key: 'sk-SECRET-999999', model: 'm', on: true }] };
    const code = Share.encode(settings);
    const body = Buffer.from(code.split('~')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    assert.ok(!body.includes('SECRET'), 'no key in a shared code: ' + body.slice(0, 80));
    assert.ok(!body.includes('x.example'), 'and no endpoint either');
    assert.strictEqual(Share.decode(code).values.aiTiers, undefined, 'the decoded settings carry no tiers at all');
  }

  // ── 8. the messages are clamped: this is a chat, not a file upload ──
  {
    const long = 'x'.repeat(9000);
    const msgs = buildMessages([{ role: 'user', content: long }, { role: 'root', content: 'hi' }, { role: 'assistant', content: 'ok' }]);
    assert.strictEqual(msgs[0].content.length, 4000, 'one message is capped: ' + msgs[0].content.length);
    assert.strictEqual(msgs[1].role, 'user', 'an unknown role is a user, never a system prompt');
    assert.strictEqual(buildMessages(null).length, 0);
    const many = buildMessages(Array.from({ length: 60 }, (_, i) => ({ role: 'user', content: `m${i}` })));
    assert.strictEqual(many.length, 24, 'the history is capped: ' + many.length);
    assert.strictEqual(many[many.length - 1].content, 'm59', 'and it is the newest messages that are kept');
  }

  // ── 9. the Test button answers in words, and never throws ──
  {
    const ok = await testTier(TIER(), { fetch: stub(answer('ready')) });
    assert.strictEqual(ok.ok, true, 'a working tier says ok');
    assert.strictEqual(ok.text, 'ready');
    assert.strictEqual(ok.label, 'one');
    assert.ok(ok.ms >= 0);
    const noUrl = await testTier(TIER({ url: 'nope' }), { fetch: stub(answer('ready')) });
    assert.strictEqual(noUrl.ok, false, 'an endpoint that is not a URL is refused');
    assert.ok(/http:\/\/ or https:\/\//.test(noUrl.error), noUrl.error);
    const noKey = await testTier(TIER({ key: '' }), { fetch: stub(answer('ready')) });
    assert.ok(/paste the key/.test(noKey.error), noKey.error);
    const noModel = await testTier(TIER({ model: '' }), { fetch: stub(answer('ready')) });
    assert.ok(/name the model/.test(noModel.error), noModel.error);
    const bad = await testTier(TIER(), { fetch: async () => ({ status: 401, ok: false, json: async () => ({}) }) });
    assert.strictEqual(bad.ok, false, 'a refused key reports the status');
    assert.ok(/401/.test(bad.error), bad.error);
  }

  // ── 10. decide() on its own: the shape the panel reads ──
  {
    assert.strictEqual(decide([]).verdict, 'silent');
    assert.strictEqual(decide([{ ok: false }]).verdict, 'silent');
    assert.strictEqual(decide([{ ok: true, text: 'VETO because', label: 'x' }]).verdict, 'veto');
    assert.strictEqual(decide([{ ok: true, text: 'yes', label: 'x' }]).verdict, 'ok');
    assert.strictEqual(decide([{ ok: true, text: 'yes', label: 'x' }]).by, 'x');
  }

// ── 11. the provider's own model list, and the best free one ──
  {
    const { fetchModels, bestFreeModel, modelsUrl, askOne } = require('../src/ai');
    assert.strictEqual(modelsUrl('https://openrouter.ai/api/v1/chat/completions'), 'https://openrouter.ai/api/v1/models');
    const list = {
      data: [
        { id: 'deepseek/deepseek-chat', pricing: { prompt: '0.0000002' }, context_length: 64000 },
        { id: 'nvidia/nemotron-3.5-lightning:free', pricing: { prompt: '0' }, context_length: 128000 },
        { id: 'meta/llama-3.3:free', pricing: { prompt: '0' }, context_length: 32000 },
        { id: 'text-embedding-3-small', pricing: { prompt: '0' }, context_length: 8000 },
      ],
    };
    const fake = async (url) => {
      assert.match(url, /\/models$/, 'the list is asked for at the models endpoint');
      return { ok: true, status: 200, json: async () => list };
    };
    const out = await fetchModels({ url: 'https://openrouter.ai/api/v1/chat/completions', key: 'k' }, { fetch: fake });
    assert.strictEqual(out.ok, true);
    assert.deepEqual(out.free, ['nvidia/nemotron-3.5-lightning:free', 'meta/llama-3.3:free'], 'free chat models, and no embedding among them');
    assert.strictEqual(out.models.length, 3, 'every CHAT model is offered, free or paid — the embedding endpoint is kept out');
    assert.strictEqual(bestFreeModel(out.models), 'nvidia/nemotron-3.5-lightning:free', 'the biggest window wins');
    assert.strictEqual(bestFreeModel([{ id: 'x', free: false, context: 999999 }]), null, 'a paid-only list has no free pick');
    const refused = await fetchModels({ url: 'https://x.test/v1/chat/completions', key: 'k' }, { fetch: async () => ({ ok: false, status: 401, text: async () => '{"error":{"message":"invalid api key"}}' }) });
    assert.strictEqual(refused.ok, false);
    assert.match(refused.error, /401.*invalid api key/);
    assert.strictEqual((await fetchModels({ url: 'file:///etc/passwd' }, { fetch: fake })).ok, false, 'a non-http endpoint is never asked');

    // 12. an answer that lives in reasoning is still an answer
    const asking = (message) => askOne({ url: 'https://x.test/v1/chat/completions', key: 'k', model: 'm', label: 'T' },
      [{ role: 'user', content: 'hi' }],
      { fetch: async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message }] }) }), timeoutMs: 2000 });
    const reasoned = await asking({ content: '', reasoning_content: 'the tape is thin, no buy' });
    assert.strictEqual(reasoned.ok, true, 'a reasoning model is not a failure');
    assert.match(reasoned.text, /the tape is thin/);
    const empty = await asking({ content: '' });
    assert.strictEqual(empty.ok, false);
    assert.match(empty.error, /returned no text/, 'and a truly empty answer names the cause');
  }

  console.log('AI council tests passed');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
