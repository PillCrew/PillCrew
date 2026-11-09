/**
 * THE COUNCIL: the analyst chat, on the operator's own keys.
 *
 * Ported from PillyDesktop (owner, 2026-11-01: "każdy może swoje api deepseeka wpisać lub z openroutera darmowe api") and
 * given the sniper's shape. A "tier" is only a URL, a key and a model name - no provider lives in this code - so the same
 * panel serves DeepSeek, OpenRouter, a local Ollama or any OpenAI-compatible endpoint.
 *
 * Why several models: the worst answer decides. Every usable tier is asked IN PARALLEL, and one `VETO` from any of them
 * refuses the coin. That is what a council is worth - unanimity - and it is also why a tier that fails is never allowed to
 * look like agreement: an unanswered tier is `ok: false`, and a council with no answer at all says `silent`, never `ok`.
 *
 * Nothing here spends money, touches a wallet or invents a number: it asks a text model a question and reports what came
 * back. The keys stay on this machine - they are not in a settings code (`src/share.js` carries a fixed list of numbers),
 * not in the log, and never echoed by the panel (see `maskKey`).
 */
const MAX_TIERS = 6;
const MAX_MESSAGES = 24;
const MAX_TEXT = 4000;
const DEFAULT_TIMEOUT_MS = 15000;
const MAX_TOKENS = 700;

// What the panel offers before anybody has typed a key. DeepSeek first (measured by the owner: it answers), then the free
// OpenRouter lane, then one empty row for an endpoint of the operator's own.
const DEFAULT_TIERS = [
  { label: 'DeepSeek', url: 'https://api.deepseek.com/chat/completions', key: '', model: 'deepseek-chat', on: true },
  { label: 'OpenRouter (free)', url: 'https://openrouter.ai/api/v1/chat/completions', key: '', model: 'nvidia/nemotron-3.5-lightning:free', on: true },
  { label: 'your own endpoint', url: '', key: '', model: '', on: false },
];

const clean = (v, max = 200) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);

/** One tier, clamped to what a request can actually use. An entry with no URL or no key is kept (the panel shows it) but never asked. */
function normaliseTier(raw = {}) {
  const url = clean(raw.url, 300);
  return {
    label: clean(raw.label, 40) || 'model',
    // Only an http(s) endpoint is allowed: a `file:` or `data:` URL here would turn the chat into a local file reader.
    url: /^https?:\/\//i.test(url) ? url : '',
    key: String(raw.key == null ? '' : raw.key).trim().slice(0, 300),
    model: clean(raw.model, 120),
    on: raw.on !== false,
  };
}

function normaliseTiers(list) {
  const arr = Array.isArray(list) ? list.slice(0, MAX_TIERS) : [];
  const out = arr.map(normaliseTier);
  return out.length ? out : DEFAULT_TIERS.map(normaliseTier);
}

/** The tiers that can be asked right now: switched on, with a URL, a key and a model. */
function usableTiers(tiers) {
  return normaliseTiers(tiers).filter((t) => t.on && t.url && t.key && t.model);
}

/**
 * The models an endpoint offers, and which of them are free. Ported from Pilly Desktop's "find free models": the operator pastes
 * a key and the app asks the provider what it has, instead of shipping a model name that the provider retires next month (that is
 * exactly how the OpenRouter row came to answer 404 and 403 forever).
 */
function modelsUrl(url) {
  const base = String(url || '').trim().replace(/\/+$/, '');
  if (!base) return '';
  const m = base.match(/^(.+?)\/chat\/completions$/i);
  return (m ? m[1] : base) + '/models';
}

async function fetchModels(tier = {}, opts = {}) {
  const doFetch = opts.fetch || globalThis.fetch;
  const url = modelsUrl(tier.url);
  if (!/^https?:\/\//i.test(tier.url || '')) return { ok: false, error: 'the endpoint address must start with http:// or https://', models: [], free: [] };
  if (typeof doFetch !== 'function') return { ok: false, error: 'no fetch available', models: [], free: [] };
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 15000;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const headers = { accept: 'application/json' };
    if (tier.key) headers.authorization = `Bearer ${tier.key}`;
    const res = await doFetch(url, { headers, signal: controller ? controller.signal : undefined });
    if (!res || !res.ok) {
      let detail = '';
      try { detail = String((await res.text()) || '').replace(/\s+/g, ' ').slice(0, 160); } catch (_) { /* ignore */ }
      return { ok: false, error: `the model list answered HTTP ${res ? res.status : '?'}${detail ? ': ' + detail : ''}`, models: [], free: [] };
    }
    const body = typeof res.json === 'function' ? await res.json() : null;
    const arr = Array.isArray(body) ? body : (body && Array.isArray(body.data) ? body.data : []);
    const seen = new Set();
    const free = [];
    const paid = [];
    for (const item of arr) {
      const id = typeof item === 'string' ? item : item && (item.id || item.name);
      if (!id || typeof id !== 'string') continue;
      const norm = id.trim();
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);
      // Not a chat model: an embedding, an image or an audio endpoint would answer an empty body, which is how a good-looking
      // "free model" turns into "an empty answer".
      if (/embed|whisper|tts|dall-e|stable-diffusion|moderation/i.test(norm)) continue;
      const pricing = (item && item.pricing) || {};
      const isFree = /:free$/i.test(norm) || String(pricing.prompt) === '0' || String(pricing.prompt) === '0.0';
      const ctx = Number(item && (item.context_length || (item.top_provider && item.top_provider.context_length))) || 0;
      (isFree ? free : paid).push({ id: norm, free: isFree, context: ctx });
    }
    const models = [...free, ...paid];
    if (!models.length) return { ok: false, error: 'that endpoint listed no chat models', models: [], free: [] };
    return { ok: true, models, free: free.map((m) => m.id) };
  } catch (e) {
    const aborted = controller && controller.signal && controller.signal.aborted;
    return { ok: false, error: aborted ? `the model list did not answer in ${Math.round(timeoutMs / 1000)} s` : String((e && e.message) || e).slice(0, 160), models: [], free: [] };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * The best free chat model in a list: the largest context window wins, because a bigger window is the one quality signal every
 * provider reports honestly. Ties are broken alphabetically so the same key always lands on the same model.
 */
function bestFreeModel(models) {
  const list = (Array.isArray(models) ? models : []).filter((m) => m && (m.free || /:free$/i.test(m.id || '')));
  if (!list.length) return null;
  return list.reduce((best, m) => {
    const better = Number(m.context) > Number(best.context) || (Number(m.context) === Number(best.context) && String(m.id) < String(best.id));
    return better ? m : best;
  }, list[0]).id;
}


function maskKey(key) {
  const k = String(key || '');
  if (!k) return '';
  if (k.length <= 8) return '…';
  return `${k.slice(0, 3)}…${k.slice(-3)}`;
}

function buildMessages(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const out = [];
  for (const m of list.slice(-MAX_MESSAGES)) {
    const role = m && (m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user');
    const content = clean(m && m.content, MAX_TEXT);
    if (content) out.push({ role, content });
  }
  return out;
}

async function askOne(tier, messages, opts = {}) {
  const doFetch = opts.fetch || (typeof fetch === 'function' ? fetch : null);
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : DEFAULT_TIMEOUT_MS;
  if (!doFetch) return { label: tier.label, ok: false, error: 'this runtime has no fetch' };
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => { if (controller) controller.abort(); }, timeoutMs);
  const began = Date.now();
  try {
    const res = await doFetch(tier.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${tier.key}`,
        // OpenRouter asks for a referer/title pair; sending it to every endpoint is harmless and keeps one shape here.
        'http-referer': 'https://pillcrew.fun/app',
        'x-title': 'PillCrew',
      },
      body: JSON.stringify({
        model: tier.model,
        messages,
        max_tokens: Math.round(Number(opts.maxTokens) > 0 ? Math.min(Number(opts.maxTokens), MAX_TOKENS) : 300),
        temperature: Number.isFinite(Number(opts.temperature)) ? Math.min(Math.max(Number(opts.temperature), 0), 2) : 0.2,
      }),
      signal: controller ? controller.signal : undefined,
    });
    const ms = Date.now() - began;
    if (!res || !res.ok) {
      // A refusal is not a veto: the model never spoke, so it cannot be counted as agreement either. The provider's own words
      // travel with the status, because "HTTP 404" alone cannot be acted on — OpenRouter's 404 names the model it does not have,
      // and that is the whole answer.
      let detail = '';
      try {
        const raw = typeof res.text === 'function' ? await res.text() : '';
        const trimmed = String(raw || '').slice(0, 600);
        const parsed = (() => { try { return JSON.parse(trimmed); } catch (_) { return null; } })();
        detail = String((parsed && parsed.error && (parsed.error.message || parsed.error)) || (parsed && parsed.message) || trimmed || '')
          .replace(/\s+/g, ' ').trim().slice(0, 180);
      } catch (_) { /* a body we cannot read is not a reason to lose the status */ }
      const status = res ? res.status : 0;
      const hint = status === 404 ? ' — the provider does not have that model; paste one from its own model list' : '';
      return { label: tier.label, ok: false, status, error: `HTTP ${status || '?'}${detail ? ': ' + detail : ''}${hint}`, ms };
    }
    const body = typeof res.json === 'function' ? await res.json().catch(() => null) : null;
    // A reasoning model can leave `content` empty and put its answer in `reasoning_content`, which is not a failure.
    const msg = (body && body.choices && body.choices[0] && body.choices[0].message) || {};
    const text = String(msg.content || msg.reasoning_content || msg.reasoning || '').trim().slice(0, MAX_TEXT);
    if (!text) return { label: tier.label, ok: false, status: res.status, error: 'the model returned no text — a reasoning model may need a bigger max_tokens, or pick another model', ms };
    return { label: tier.label, ok: true, text, ms };
  } catch (e) {
    const aborted = controller && controller.signal && controller.signal.aborted;
    return { label: tier.label, ok: false, error: aborted ? `no answer in ${Math.round(timeoutMs / 1000)} s` : String((e && e.message) || e).slice(0, 120), ms: Date.now() - began };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * THE WORST ANSWER DECIDES. A `VETO` from any model that answered is a veto; otherwise the first real answer is the read.
 * `silent` means nothing answered - which is never the same as "no objections".
 */
function decide(answers) {
  const list = Array.isArray(answers) ? answers : [];
  const veto = list.find((a) => a.ok && /^veto\b/i.test(a.text || ''));
  if (veto) {
    return { verdict: 'veto', reason: String(veto.text).replace(/^veto:?/i, '').trim().slice(0, 300), by: veto.label, answers: list };
  }
  const ok = list.find((a) => a.ok && a.text);
  if (ok) return { verdict: 'ok', reason: String(ok.text).slice(0, MAX_TEXT), by: ok.label, answers: list };
  return { verdict: 'silent', reason: 'no model answered', answers: list };
}

/**
 * Ask every usable tier at once and return the council's verdict.
 * `verdict`: `ok` | `veto` | `silent` | `no-keys`.
 */
async function ask({ messages, tiers, maxTokens, temperature, timeoutMs, fetch: doFetch } = {}) {
  const list = usableTiers(tiers);
  const clean_ = buildMessages(messages);
  if (!list.length) {
    return { verdict: 'no-keys', reason: 'no AI key is set - open the Chat tab and paste your DeepSeek or OpenRouter key', answers: [], tiers: 0 };
  }
  if (!clean_.length) return { verdict: 'silent', reason: 'there was nothing to ask', answers: [], tiers: list.length };
  const answers = await Promise.all(list.map((t) => askOne(t, clean_, { maxTokens, temperature, timeoutMs, fetch: doFetch })));
  return { ...decide(answers), tiers: list.length };
}

/** The "Test" button: one tiny question, and how long it took. Never throws, never echoes the key. */
async function testTier(tier, opts = {}) {
  const t = normaliseTier(tier);
  if (!t.url) return { ok: false, error: 'the endpoint address must start with http:// or https://' };
  if (!t.key) return { ok: false, error: 'paste the key for this endpoint' };
  if (!t.model) return { ok: false, error: 'name the model (for example deepseek-chat)' };
  const began = Date.now();
  const one = await askOne(t, [{ role: 'user', content: 'Reply with the single word: ready' }], { ...opts, maxTokens: 16, temperature: 0 });
  return { ok: Boolean(one.ok), text: one.text || '', error: one.error, ms: Date.now() - began, label: t.label };
}

module.exports = {
  modelsUrl, fetchModels, bestFreeModel, ask, testTier, decide, askOne, normaliseTiers, normaliseTier, usableTiers, maskKey, buildMessages, DEFAULT_TIERS, MAX_TIERS };
