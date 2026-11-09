'use strict';
/* PillCrew - renderer. All dynamic text is inserted with textContent (coin names come from the network and are untrusted). */
(() => {
  const api = window.api;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  }
  const NS = 'http://www.w3.org/2000/svg';
  function icon(name, cls) {
    const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'ic' + (cls ? ' ' + cls : ''));
    const u = document.createElementNS(NS, 'use'); u.setAttribute('href', '#i-' + name); svg.append(u); return svg;
  }
  const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
  // skip DOM rebuilds when the data did not change (keeps the UI smooth while the bot runs)
  const memo = new Map();
  const changed = (key, data) => { const j = JSON.stringify(data); if (memo.get(key) === j) return false; memo.set(key, j); return true; };
  // A number that could not be read is drawn as a dash, never as zero: a wallet balance that failed to load must not
  // look like an empty wallet, and an unknown profit must not look like break-even.
  const money = (n) => n != null && Number.isFinite(Number(n));
  const sol = (n, d = 3) => (money(n) ? Number(n).toFixed(d) : '–');
  const signed = (n, d = 3) => (money(n) ? (n >= 0 ? '+' : '') + Number(n).toFixed(d) : '–');
  const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour12: false });
  const fmtAge = (s) => {
    if (!Number.isFinite(s) || s < 0) return '–';
    if (s < 90) return Math.round(s) + 's';
    if (s < 5400) return Math.floor(s / 60) + 'm ' + Math.round(s % 60) + 's';
    if (s < 172800) return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
    return Math.floor(s / 86400) + 'd';
  };

  async function call(p) {
    const r = await p;
    if (!r || !r.ok) {
      const e = new Error((r && r.error) || 'Something went wrong.');
      e.code = (r && r.code) || null;
      e.data = (r && r.data) || null;
      throw e;
    }
    return r.data;
  }

  let toastTimer;
  function toast(msg, err) {
    const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : '');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), err ? 6000 : 3200);
  }

  // ───────── modal helper ─────────
  function modal(build) {
    return new Promise((resolve) => {
      const box = clear($('#modalBox')); const root = $('#modal');
      const close = (v) => { root.classList.add('hidden'); resolve(v); };
      build(box, close); root.classList.remove('hidden');
      const f = $('input, button.btn', box); if (f) f.focus();
    });
  }
  function askPassword(title, text, confirmLabel = 'Continue') {
    return modal((box, close) => {
      const pw = h('input', { type: 'password', placeholder: 'Wallet password', autocomplete: 'off' });
      const go = () => close(pw.value || null);
      pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      box.append(h('h2', {}, title), h('p', {}, text), pw,
        h('div', { class: 'modal-actions' }, h('button', { class: 'btn ghost', onclick: () => close(null) }, 'Cancel'), h('button', { class: 'btn', onclick: go }, confirmLabel)));
    });
  }
  function confirmBox(title, text, okLabel, danger) {
    return modal((box, close) => box.append(h('h2', {}, title), h('p', {}, text),
      h('div', { class: 'modal-actions' }, h('button', { class: 'btn ghost', onclick: () => close(false) }, 'Cancel'),
        h('button', { class: 'btn' + (danger ? ' danger' : ''), onclick: () => close(true) }, okLabel))));
  }

  // ───────── state ─────────
  let S = null;            // latest engine state
  let settings = null;
  let wallet = { exists: false, unlocked: false, address: null };
  let tab = 'dashboard';

  // ───────── navigation ─────────
  function showTab(name) {
    tab = name;
    $$('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    $$('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + name));
    if (name === 'feed' && S) { renderFeed.at = 0; renderFeed(S); }
    // The PillCrew tab asks the main process again every time it opens: the scorecard and the watchlist live in files, and a
    // stale copy of either is a wrong decision waiting to happen.
    if (name === 'crew') { Promise.resolve().then(() => { try { paintPicks(); paintWatch(); } catch (_) { /* ignore */ } }); }
    if (name === 'bump') {
      // The desk reads its numbers from the main process, so the panel asks again every time it opens - the same rule
      // the settings panel follows, and for the same reason: a stale copy of a budget is a wrong decision.
      api.bumpState().then((r) => { if (r && r.ok && tab === 'bump') paintBump(r.data); }).catch(() => {});
      api.getSettings().then((r) => {
        if (!r || !r.ok || tab !== 'bump') return;
        settings = r.data;
        // Never rebuild the form under somebody's caret.
        const active = document.activeElement;
        if (active && active.closest && active.closest('#bumpForm')) return;
        renderBumpForm();
      }).catch(() => {});
      refreshBumpEstimate();
    }
    if (name === 'wallet') renderWallet();
    if (name === 'settings') {
      // The panel shows numbers that came from the main process, so it asks for them again every time it opens.
      // A stale copy is how a "0.004 SOL per coin" line survived a change made anywhere else.
      api.getSettings().then((r) => {
        if (!r || !r.ok || tab !== 'settings') return;
        // Never overwrite a field somebody is already typing in.
        const active = document.activeElement;
        if (active && active.closest && active.closest('#settingsForm')) return;
        settings = r.data;
        renderSettings();
      }).catch(() => {});
      renderSettings();
      fillShareCode();
    }
  }  $('#nav').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) showTab(b.dataset.tab); });

  // ───────── engine state → UI ─────────
  function applyState(s) {
    S = s;
    window.dispatchEvent(new CustomEvent('bot-state', { detail: { running: s.running } }));
    const live = s.mode === 'live';
    $('#sideMode').textContent = live ? 'Real Money' : 'Practice Mode';
    $('#sideMode').classList.toggle('live', live);
    $$('#modeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.mode === s.mode));
    const dot = $('#conn .dot');
    dot.className = 'dot ' + (s.connected ? 'ok' : s.running ? 'warn' : '');
    const fi = s.feedInfo || {};
    const label = fi.label === 'pumpdev' ? 'PumpDev stream' : fi.label === 'pumpportal' ? 'PumpPortal (launches)' : fi.source === 'chain' ? `On-chain · ${fi.rate} ev/s` : '';
    $('#connText').textContent = s.connected ? (label || 'Live feed') : s.running ? 'Connecting…' : 'Offline';
    const cov = s.coverage || {};
    const perMin = s.stats && s.stats.launchesPerMin ? `${s.stats.launchesPerMin}/min` : '0/min';
    // RULE CHANGED 2026-11-05 (1.0.3: the tracked-coin figure fell as the working set was pruned): the card
    // above shows the coins SEEN this session (it only grows); the working map - trimmed as coins go quiet, refilled as new
    // ones appear - is named here, so a number that moves down is a number that says what it is.
    $('#sFeed').textContent = s.running
      ? `${cov.total || 0} live now · ${perMin} launches · ${cov.fresh || 0} fresh`
      : `${cov.total || 0} live now`;
    if (s.rpc) {
      const cur = s.rpc.nodes.find((n) => n.active);
      $('#rpcText').textContent = 'RPC: ' + (cur ? cur.host : 'auto') + (cur && cur.latencyMs != null ? ` · ${cur.latencyMs} ms` : '');
      $('#rpcInfo .dot').className = 'dot ' + (cur && cur.coolingDown ? 'warn' : 'ok');
    }
    const btn = $('#startBtn');
    $('span', btn).textContent = s.running ? 'Stop Bot' : 'Start Bot';
    $('use', btn).setAttribute('href', s.running ? '#i-stop' : '#i-play');
    btn.classList.toggle('stop', s.running);
    $('#heroSub').textContent = s.running
      ? (live ? 'Bot is trading with REAL money. Watch the log below.' : 'Bot is running in Practice Mode. No real money is used.')
      : 'Press Start and the bot hunts new Pump.fun coins for you. Practice Mode uses fake money.';
    const pauseNote = document.getElementById('pauseNote');
    if (pauseNote) {
      if (s.paused) {
        pauseNote.hidden = false;
        const text = document.getElementById('pauseText');
        const until = new Date(s.paused.until).toLocaleTimeString();
        if (text) text.textContent = `New entries paused until ${until} (${s.paused.reason}). Open positions still close normally.`;
        else pauseNote.textContent = `New entries paused until ${until} (${s.paused.reason}). Open positions still close normally.`;
      } else {
        pauseNote.hidden = true;
      }
    }

    $('#sBalance').textContent = sol(s.balance);
    // Real money: the honest figure is the wallet, not the sum of trades. It carries every fee and every rejected
    // order, which is exactly what was missing.
    const liveMode = s.mode === 'live';
    const hasDelta = liveMode && s.walletDeltaSol != null;
    const shown = hasDelta ? s.walletDeltaSol : s.stats.pnl;
    const pnl = $('#sPnl'); pnl.textContent = signed(shown); pnl.className = shown > 0 ? 'pos' : shown < 0 ? 'neg' : '';
    const sub = $('#sPnlSub');
    if (sub) {
      const fees = Number(s.stats.feeSpentSol || 0);
      const fails = Number(s.stats.orderFails || 0);
      const epx = s.stats.entryPx || {};
      const closed = Number(s.stats.wins || 0) + Number(s.stats.losses || 0);
      // RULE CHANGED 2026-11-05 (1.0.4: the Profit/Loss line read like a list of errors): the card printed the
      // desk's own bookkeeping - "entries priced at the pool 0, at the board 0, refused 33" - and read as a list of errors
      // counted against his money. Where a price came from is a diagnostic, so it moves to the tooltip; the line under the
      // number now says only what a trader reads: whose money, how many trades, what the fees were, and whether the chain
      // refused an order (that one is a real error and keeps its place).
      sub.textContent = liveMode
        ? `SOL · ${hasDelta ? 'since Start' : 'closed trades'}${closed ? ` · ${closed} trades` : ''}${fees ? ` · fees ${sol(fees, 4)}` : ''}${fails ? ` · ${fails} order${fails === 1 ? '' : 's'} refused by the chain` : ''}`
        : `SOL · practice${closed ? ` · ${closed} trades` : ' · no trades yet'}`;
      sub.title = `Entry prices: ${Number(epx.curve || 0)} from the pool's own tape, ${Number(epx.board || 0)} from a market row, ${Number(epx.refused || 0)} refused before an order went out.`;
    }
    const closed = s.stats.wins + s.stats.losses;
    $('#sWin').textContent = closed ? Math.round((s.stats.wins / closed) * 100) + '%' : '–';
    $('#sWinSub').textContent = closed ? `${s.stats.wins} wins · ${s.stats.losses} losses` : 'no trades yet';
    $('#sBpm').textContent = s.stats.buysPerMin;
    // RULE CHANGED 2026-11-05 (1.0.3: the tracked-coin figure fell as the working set was pruned): the card
    // showed the WORKING map, which the pruner trims and the sweep refills - correct behaviour that reads as a bug. The big
    // number is now the coins the desk has taken in this session (it only grows), and the working set is named under it.
    $('#sSeen').textContent = s.stats.seen || 0;
    $('#sLat').textContent = s.stats.lastLatencyMs == null ? '–' : s.stats.lastLatencyMs;
    $('#sSell').textContent = s.stats.lastSellMs == null ? '–' : s.stats.lastSellMs;
    renderReady(s);

    if (document.hidden) return;                       // nothing to paint while the window is hidden
    if (changed('curve', s.history.map((x) => x.pnlSol))) renderCurve(s);
    if (changed('picks', [s.running, s.feed.filter((t) => t.status !== 'skipped' && t.score > 0).sort((a, b) => b.score - a.score).slice(0, 4).map((t) => [t.mint, t.score, t.buyers])])) renderPicks(s);
    // Rebuilt only when the book itself changed; a price that moved is patched in place by paintPositions, so the
    // Sell buttons are never thrown away under the pointer.
    const rows = s.positions || [];
    if (changed('pos-set', rows.map((p) => p.mint).join(','))) renderPositions(s);
    else paintPositions(rows);
    if (changed('hist', s.history.slice(0, 8).map((x) => [x.ts, x.pnlSol, x.measured]))) renderHistory(s);
    if (changed('log', [s.logs.length, s.logs.length ? s.logs[s.logs.length - 1].ts : 0])) renderLog(s.logs);
    renderFeed(s);
    const wb = $('#walBal'); if (wb) wb.textContent = sol(s.walletBalance || 0, 4);
    if (tab === 'settings') renderRpcList();
  }

  // The percentage as the card shows it, in one place so the two drawing paths can never disagree: an unknown price
  // is a dash, never a zero, and a move of a hundredth of a point is "0.0%", never "-0.0%".
  function pctText(pct) {
    if (pct == null) return '—';
    const v = Number(pct);
    if (!Number.isFinite(v)) return '—';
    if (Math.abs(v) < 0.05) return '0.0%';
    return (v > 0 ? '+' : '') + v.toFixed(1) + '%';
  }
  const pctClass = (pct) => (pct == null || !Number.isFinite(Number(pct)) ? '' : Number(pct) >= 0 ? 'pos' : 'neg');
  function positionRow(p) {
    const pct = p.pnlPct == null ? null : Number(p.pnlPct);
    const cls = pctClass(pct);
    return h('div', { class: 'row', 'data-mint': p.mint },
      h('div', {}, h('b', {}, '$' + (p.symbol || '?')), h('small', { 'data-note': '' }, `${sol(p.solIn, 3)} SOL · ${fmtAge(p.heldSec)}${p.paper ? ' · practice' : ''}${p.pending ? ' · confirming…' : ''}${Number(p.pxAgeSec) >= 6 ? ` · no price ${fmtAge(p.pxAgeSec)}` : ''}`)),
      h('div', { class: cls, 'data-px': '' }, h('b', { class: cls }, pctText(pct))),
      h('button', { class: 'btn small ghost', disabled: p.status !== 'open', onclick: () => {
        call(api.botSell(p.mint)).then(() => toast(`Sold ${p.symbol}.`)).catch((e) => toast(e.message, true));
      } }, 'Sell'));
  }
  function renderPositions(s) {
    const box = $('#positions');
    const list = s.positions || [];
    const have = new Map([...box.querySelectorAll('[data-mint]')].map((el) => [el.dataset.mint, el]));
    const want = new Set(list.map((p) => p.mint));
    for (const [mint, el] of have) if (!want.has(mint)) el.remove();
    if (!list.length) {
      box.textContent = 'No open positions. The bot buys when a coin looks strong.';
      box.classList.add('empty');
      return;
    }
    if (box.classList.contains('empty')) { box.textContent = ''; box.classList.remove('empty'); }
    for (const p of list) {
      const existing = have.get(p.mint);
      if (existing && existing.isConnected) continue;
      box.append(positionRow(p));
    }
  }

  function paintPositions(list) {
    const box = $('#positions');
    if (!box || !Array.isArray(list) || !list.length) return;
    if (box.classList.contains('empty')) return renderPositions({ positions: list });
    const rows = new Map([...box.querySelectorAll('[data-mint]')].map((el) => [el.dataset.mint, el]));
    if (rows.size !== list.length || list.some((p) => !rows.has(p.mint))) return renderPositions({ positions: list });
    for (const p of list) {
      const row = rows.get(p.mint);
      const cell = row.querySelector('[data-px]');
      const note = row.querySelector('[data-note]');
      if (!cell) continue;
      const pct = p.pnlPct == null ? null : Number(p.pnlPct);
      const cls = pctClass(pct);
      const text = pctText(pct);
      const b = cell.firstElementChild;
      if (b && b.textContent !== text) b.textContent = text;
      if (cell.className !== cls) { cell.className = cls; if (b) b.className = cls; }
      if (note) {
        // A price nobody has refreshed is labelled as such, in words: a still percentage on a moving coin is the one
        // thing that made a trader sell a coin by hand while the card insisted it was up 71%.
        const stale = Number(p.pxAgeSec) >= 6 ? ` · no price ${fmtAge(p.pxAgeSec)}` : '';
        const line = `${sol(p.solIn, 3)} SOL · ${fmtAge(p.heldSec)}${p.paper ? ' · practice' : ''}${p.pending ? ' · confirming…' : ''}${p.closing ? ' · selling…' : ''}${stale}`;
        if (note.textContent !== line) note.textContent = line;
      }
      // The Sell button follows the position's own state: a row is never rebuilt to change that any more.
      const btn = row.querySelector('button');
      if (btn) { const off = p.status !== 'open'; if (btn.disabled !== off) btn.disabled = off; }
    }
  }
  function renderHistory(s) {
    const box = $('#history');
    // Rows are built before the box is touched: a panel that clears itself and then throws is a panel that reads
    // "no trades" while the trades are all still there, and that is what "recent trades disappeared" was.
    let rows;
    try {
      rows = (s.history || []).slice(0, 8).map((t) => {
        const pnl = Number(t.pnlSol) || 0;
        const pct = t.pnlPct == null ? null : Number(t.pnlPct);
        const cls = pnl >= 0 ? 'pos' : 'neg';
        // The peak is the honest footnote of a closed trade: "peaked at +41%" next to a fill at +8% says the exit was
        // early, and a row without it is a row that hides the most useful fact about the trade.
        const peak = t.peakPct == null ? '' : ` · peaked ${pctText(t.peakPct)}`;
        const held = t.heldSec == null ? '' : ` · held ${fmtAge(t.heldSec)}`;
        const timing = t.sellObservationMs == null ? '' : ` · sale status observed after ${t.sellObservationMs} ms`;
        const basis = t.paper ? ' · simulated' : t.measured ? ' · exit measured' : ' · estimated';
        return h('div', { class: 'row' },
          h('div', {}, h('b', {}, '$' + (t.symbol || '?')), h('small', {}, `${t.reason || 'Sold'} · ${fmtTime(t.ts)}${peak}${held}${basis}${timing}`)),
          h('div', { class: cls }, h('b', { class: cls }, signed(pnl, 4) + ' SOL'), h('small', { class: pctClass(pct) }, pctText(pct))));
      });
    } catch (e) {
      return;
    }
    clear(box);
    box.classList.toggle('empty', !rows.length);
    if (!rows.length) { box.textContent = 'Closed trades show up here.'; return; }
    for (const r of rows) box.append(r);
  }
  function renderLog(logs) {
    const box = $('#log'); const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 30;
    clear(box);
    for (const l of logs.slice(-60)) box.append(h('div', { class: l.level }, h('time', {}, fmtTime(l.ts)), l.msg));
    if (!logs.length) box.append(h('div', { class: 'warn' }, 'Nothing yet. Press Start to begin.'));
    if (atBottom) box.scrollTop = box.scrollHeight;
  }
  function renderFeed(s) {
    if (tab !== 'feed') return;
    // The table is a page of text a person reads, not a ticker. Rebuilding eighty rows every second was the most
    // expensive thing the renderer did; two seconds is invisible to the eye and costs a fraction of the layout work.
    const now = Date.now();
    if (now - (renderFeed.at || 0) < 1800) return;
    renderFeed.at = now;
    const body = clear($('#feedBody'));
    $('#feedEmpty').style.display = s.feed.length ? 'none' : '';
    const cov = s.coverage || {};
    const meta = $('#feedMeta');
    if (meta) {
      const parts = [
        `${s.feed.length} in view`,
        cov.launch ? `${cov.launch} new launches` : '',
        cov.trending ? `${cov.trending} trending` : '',
        cov.callout ? `${cov.callout} boosted` : '',
        cov['new'] ? `${cov['new']} fresh profiles` : '',
        cov.chain ? `${cov.chain} on-chain` : '',
        cov.priced ? `${cov.priced} priced` : '',
        cov.fresh ? `${cov.fresh} live` : '',
      ].filter(Boolean);
      meta.textContent = parts.join(' · ');
    }
    for (const t of s.feed.slice(0, 60)) {
      const link = MINT_RE.test(t.mint)
        ? h('button', { class: 'btn small ghost', onclick: () => call(api.openExternal('https://pump.fun/coin/' + t.mint)).catch((e) => toast(e.message, true)) }, 'View')
        : '';
      const chg = typeof t.change5m === 'number' ? h('span', { class: t.change5m >= 0 ? 'pos' : 'neg' }, (t.change5m >= 0 ? '+' : '') + t.change5m.toFixed(0) + '%') : h('span', { class: 'muted' }, '–');
      body.append(h('tr', { class: t.status === 'bought' ? 'bought' : '' },
        h('td', {}, h('b', {}, '$' + t.symbol), h('small', {}, t.name)),
        h('td', {}, h('span', { class: 'chip src' }, t.source || 'launch')),
        h('td', {}, fmtAge(t.age)),
        h('td', {}, sol(t.mc, 1) + ' SOL'),
        h('td', {}, chg),
        h('td', {}, t.buyers),
        h('td', { class: t.net >= 0 ? 'pos' : 'neg' }, signed(t.net, 2)),
        h('td', {}, h('span', { class: 'bar' }, h('i', { style: `width:${Math.max(0, Math.min(100, t.score))}%` })), t.score),
        h('td', {}, h('span', { class: 'chip ' + t.status }, t.status === 'bought' ? 'Bought' : t.status === 'skipped' ? 'Skipped' : 'Watching'), h('small', {}, t.reason)),
        h('td', {}, link)));
    }
  }

  // ───────── performance curve + top picks ─────────
  function renderCurve(s) {
    const box = clear($('#curve'));
    const trades = s.history.slice().reverse();
    $('#curveNote').textContent = trades.length ? `${trades.length} closed trade${trades.length > 1 ? 's' : ''}` : '';
    if (trades.length < 2) { box.append(h('div', { class: 'empty-note' }, 'Your profit curve appears after the first trades.')); return; }
    const pts = [0]; let acc = 0, peak = 0, drawdown = 0, gains = 0, losses = 0;
    for (const t of trades) {
      acc += t.pnlSol; pts.push(acc); peak = Math.max(peak, acc); drawdown = Math.max(drawdown, peak - acc);
      if (t.pnlSol > 0) gains += t.pnlSol; else losses -= t.pnlSol;
    }
    $('#curveNote').textContent = `${trades.length} recent exits · drawdown ${drawdown.toFixed(4)} SOL · PF ${losses > 0 ? (gains / losses).toFixed(2) : '—'}`;
    const W = 600, H = 190, pad = 14, lo = Math.min(0, ...pts), hi = Math.max(0, ...pts), span = (hi - lo) || 1;
    const x = (i) => pad + (i / (pts.length - 1)) * (W - pad * 2), y = (v) => H - pad - ((v - lo) / span) * (H - pad * 2);
    const line = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
    const good = acc >= 0, col = good ? '#35f08c' : '#ff5d6c';
    const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('preserveAspectRatio', 'none');
    const mk = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); svg.append(e); return e; };
    const defs = mk('defs', {}); const g = document.createElementNS(NS, 'linearGradient'); g.setAttribute('id', 'cg'); g.setAttribute('x1', '0'); g.setAttribute('y1', '0'); g.setAttribute('x2', '0'); g.setAttribute('y2', '1');
    for (const [o, a] of [['0', '.35'], ['1', '0']]) { const st = document.createElementNS(NS, 'stop'); st.setAttribute('offset', o); st.setAttribute('stop-color', col); st.setAttribute('stop-opacity', a); g.append(st); }
    defs.append(g);
    mk('line', { x1: pad, x2: W - pad, y1: y(0), y2: y(0), stroke: 'rgba(255,255,255,.14)', 'stroke-dasharray': '4 5' });
    mk('path', { d: `${line} L${x(pts.length - 1)} ${y(0)} L${x(0)} ${y(0)} Z`, fill: 'url(#cg)' });
    mk('path', { d: line, fill: 'none', stroke: col, 'stroke-width': 2.4, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke' });
    box.append(svg);
  }
  function renderPicks(s) {
    const box = clear($('#picks'));
    const top = s.feed.filter((t) => t.status !== 'skipped' && t.score > 0).sort((a, b) => b.score - a.score).slice(0, 4);
    box.classList.toggle('empty', !top.length);
    if (!top.length) { box.textContent = s.running ? 'Scanning… strong coins show up here.' : 'Start the bot to see the best-scoring coins live.'; return; }
    for (const t of top) box.append(h('div', { class: 'row pick' },
      h('div', {}, h('b', {}, '$' + t.symbol), h('small', {}, `${sol(t.mc, 1)} SOL cap · ${t.buyers} buyers`)),
      h('div', { class: 'score' }, t.score),
      h('div', { class: 'meter' }, h('i', { style: `width:${Math.min(100, t.score)}%` }))));
  }

  // ───────── readiness checklist ─────────
  function renderReady(s) {
    const box = $('#readyCard'); if (!box) return; clear(box);
    const funded = (s.walletBalance || 0) >= 0.05;
    const item = (done, text, tab) => h('span', { class: 'item' + (done ? ' done' : '') }, icon(done ? 'check' : 'circle'), tab && !done ? h('button', { onclick: () => showTab(tab) }, text) : text);
    box.append(h('b', {}, 'Ready check'),
      item(wallet.exists, 'Create your wallet', 'wallet'),
      item(wallet.exists && funded, 'Deposit a little SOL (0.05+)', 'wallet'),
      item(s.connected, 'Live feed connected'),
      item(s.mode === 'live', s.mode === 'live' ? 'Real Money on' : 'Practice Mode (switch to Real Money when ready)'));
  }

  // external links (only whitelisted https hosts are allowed by the main process)
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-link]'); if (!b) return;
    call(api.openExternal(b.dataset.link)).catch((err) => toast(err.message, true));
  });

  // ───────── start / stop / mode ─────────
  $('#startBtn').addEventListener('click', async () => {
    try {
      if (S && S.running) { await call(api.botStop()); return; }
      const r = await api.botStart();
      if (!r.ok) throw new Error(r.error);
    } catch (e) { toast(e.message, true); }
  });
  $('#sellAllBtn').addEventListener('click', () => call(api.botSellAll())
    .then((r) => toast(`Sold ${r && r.sold ? r.sold : 'every'} position${r && r.sold === 1 ? '' : 's'}.`))
    .catch((e) => toast(e.message, true)));
  // The pause after a cold streak (or after selling everything) used to be something to wait out. It is a decision, so
  // it is one press away from being undone - and the button is inside the note, where the reason is read.
  const resumeBtn = document.getElementById('resumeBtn');
  if (resumeBtn) resumeBtn.addEventListener('click', () => call(api.botResume())
    .then(() => toast('Looking for coins again.'))
    .catch((e) => toast(e.message, true)));

  $('#modeSeg').addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const mode = b.dataset.mode;
    if (S && S.mode === mode) return;
    try {
      if (mode === 'live') {
        if (!wallet.exists) { toast('Create your wallet first (Wallet tab).', true); showTab('wallet'); return; }
        if (!wallet.unlocked) {
          const pw = await askPassword('Unlock wallet', 'Enter your wallet password to use Real Money mode.', 'Unlock');
          if (!pw) return;
          wallet = await call(api.walletUnlock(pw));
        }
        const ok = await confirmBox('Switch to Real Money?', 'The bot will spend real SOL from your wallet. Meme coins are extremely risky and you can lose everything you deposit. Start with a very small amount.', 'I understand, switch', true);
        if (!ok) return;
      }
      settings = await call(api.setSettings({ mode }));
      toast(mode === 'live' ? 'Real Money mode on.' : 'Practice Mode on.');
    } catch (err) { toast(err.message, true); }
  });

  // ───────── wallet tab ─────────
  async function refreshWallet() { wallet = await call(api.walletStatus()); renderWallet(); }

  function renderWallet() {
    const root = clear($('#walletBody'));
    if (wallet.damaged) {
      // A wallet file that cannot be read is not a missing wallet: creating one here would overwrite a key that may
      // still be holding money, so the screen refuses to offer anything but the way out.
      root.append(h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, 'Wallet file problem'), h('span', { class: 'chip' }, 'Action needed')),
        h('p', { class: 'hint' }, wallet.damaged),
        h('p', { class: 'hint' }, 'The file is ' + 'wallet.json in this app\u2019s data folder. Copy it somewhere safe first, then restore a backup of it, or move it away and create a fresh wallet.'),
        h('div', { class: 'card-foot' }, h('button', { class: 'btn ghost', onclick: () => refreshWallet() }, 'Check again'))));
      return;
    }
    if (!wallet.exists) {
      const pw = h('input', { type: 'password', placeholder: 'Choose a password (min 8 characters)', autocomplete: 'new-password' });
      const pw2 = h('input', { type: 'password', placeholder: 'Repeat password', autocomplete: 'new-password' });
      root.append(h('div', { class: 'card' }, h('h2', {}, 'Create your wallet'),
        h('p', { class: 'hint' }, 'We create a brand-new Solana wallet on this computer. The password encrypts it. If you forget the password and have no backup of the private key, the funds are lost forever.'),
        h('div', { class: 'form-grid' }, h('label', { class: 'field' }, h('span', {}, 'Password'), pw), h('label', { class: 'field' }, h('span', {}, 'Confirm password'), pw2)),
        h('div', { class: 'card-foot' }, h('button', { class: 'btn', onclick: async () => {
          try {
            if (pw.value !== pw2.value) throw new Error('Passwords do not match.');
            wallet = await call(api.walletCreate(pw.value)); renderWallet(); toast('Wallet created. Back up your private key now!');
          } catch (e) { toast(e.message, true); }
        } }, 'Create wallet'))));
      const key = h('textarea', { rows: 3, placeholder: 'Paste private key (base58 or JSON array)', spellcheck: 'false' });
      const ipw = h('input', { type: 'password', placeholder: 'Choose a password for this app', autocomplete: 'new-password' });
      root.append(h('div', { class: 'card' }, h('h2', {}, 'Or import an existing wallet'),
        h('p', { class: 'hint' }, 'Better idea: create a fresh wallet here and only send the amount you want to trade with.'),
        key, h('div', { style: 'height:10px' }), ipw,
        h('div', { class: 'card-foot' }, h('button', { class: 'btn ghost', onclick: async () => {
          try { wallet = await call(api.walletImport(key.value, ipw.value)); key.value = ''; renderWallet(); toast('Wallet imported.'); } catch (e) { toast(e.message, true); }
        } }, 'Import wallet'))));
      return;
    }
    root.append(h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Balance'), h('span', { class: 'chip ' + (wallet.unlocked ? 'bought' : '') }, wallet.unlocked ? 'Unlocked' : 'Locked')),
      h('div', { class: 'big-bal' }, h('span', { id: 'walBal' }, sol(S && S.walletBalance, 4)), h('em', {}, 'SOL'))));
    if (S && S.mode === 'live' && S.reserveSol > 0 && S.walletBalance >= 0.0009) {
      root.append(h('div', { class: 'card' },
        h('h2', {}, 'Fees held back'),
        h('p', { class: 'hint' }, `${sol(S.reserveSol, 4)} SOL is never spent on coins: it pays the network fee and tip for every position the bot holds, so it can always sell everything it bought. ${sol(Math.max(0, S.freeSol || 0), 4)} SOL is free to trade with.`)));
    }
    if (S && S.walletBalance != null && S.walletBalance < 0.0009 && (S.positions || []).length > 0) {
      root.append(h('div', { class: 'card warn-card' },
        h('h2', {}, 'Send SOL before the bot can trade'),
        h('p', { class: 'hint' }, `The network keeps 0.00089 SOL in every wallet and refuses any transaction that would go under it. This wallet holds ${sol(S.walletBalance, 6)} SOL, so buys, sells and fees are all refused — by every route, including Jupiter. Send at least 0.005 SOL to the address below and the bot closes its open positions by itself.`)));
    }
    root.append(h('div', { class: 'card' }, h('h2', {}, 'Deposit SOL'),
      h('p', { class: 'hint' }, 'Send SOL from any exchange or wallet (Coinbase, Phantom…) to this address. Only send SOL on the Solana network. A small amount is plenty to start.'),
      h('div', { class: 'addr' }, wallet.address),
      h('div', { class: 'actions' }, h('button', { class: 'btn ghost', onclick: () => { navigator.clipboard.writeText(wallet.address).then(() => toast('Address copied.'), () => toast('Copy failed - select the address manually.', true)); } }, 'Copy address'),
        h('button', { class: 'btn ghost', onclick: () => call(api.openExternal('https://solscan.io/account/' + wallet.address)).catch((e) => toast(e.message, true)) }, 'View on Solscan'))));

    root.append(recoverCard());
    root.append(walletMaintenance());
    const to = h('input', { type: 'text', placeholder: 'Destination Solana address', spellcheck: 'false' });
    const amt = h('input', { type: 'number', min: '0', step: '0.001', placeholder: 'Amount in SOL' });
    root.append(h('div', { class: 'card' }, h('h2', {}, 'Withdraw'),
      h('p', { class: 'hint' }, `Send SOL back to your own wallet or exchange. Network fee is about 0.000005 SOL, and ${sol((S && S.reserveSol) || 0.002, 4)} SOL always stays behind to pay the exit fees of anything the bot still holds.`),
      h('div', { class: 'form-grid' }, h('label', { class: 'field wide' }, h('span', {}, 'To'), to), h('label', { class: 'field' }, h('span', {}, 'Amount (SOL)'), amt)),
      h('div', { class: 'card-foot' }, h('button', { class: 'btn', onclick: async () => {
        try {
          if (!wallet.unlocked) throw new Error('Unlock your wallet first.');
          const pw = await askPassword('Confirm withdrawal', `Send ${amt.value || '?'} SOL to ${to.value.slice(0, 6)}…${to.value.slice(-4)}?`, 'Send');
          if (!pw) return;
          const r = await call(api.walletWithdraw(to.value, amt.value, pw));
          toast(r.pending ? 'Sent - waiting for confirmation.' : 'Withdrawal confirmed.'); to.value = ''; amt.value = '';
        } catch (e) { toast(e.message, true); }
      } }, 'Withdraw'))));

    root.append(h('div', { class: 'card warn' }, h('h2', {}, 'Security'),
      h('p', { class: 'hint' }, 'Your private key controls all funds in this wallet. Anyone who sees it can take your SOL. Never share it or paste it into websites.'),
      h('div', { class: 'actions' },
        wallet.unlocked
          ? h('button', { class: 'btn ghost', onclick: async () => { try { wallet = await call(api.walletLock()); renderWallet(); } catch (e) { toast(e.message, true); } } }, 'Lock wallet')
          : h('button', { class: 'btn', onclick: async () => {
            const pw = await askPassword('Unlock wallet', 'Enter your password.', 'Unlock'); if (!pw) return;
            try { wallet = await call(api.walletUnlock(pw)); renderWallet(); } catch (e) { toast(e.message, true); }
          } }, 'Unlock wallet'),
        h('button', { class: 'btn danger', onclick: revealKey }, 'Show private key'))));
  }

  // Replacing or removing the wallet is the one action here that can strand money on chain, so it lives in its own
  // card, asks for the password, and refuses while the bot is running or a position is open.
  function walletMaintenance() {
    const fresh = async () => {
      const exportFirst = await confirmBox(
        'Back up the current key first?',
        'A new wallet replaces the key on this computer. Any SOL still on the old address needs that private key to move, so copy it out before you replace it.',
        'Show my key',
      );
      if (exportFirst) {
        await revealKey();
        const go = await confirmBox('Replace the wallet now?', 'The old key is removed from this computer. This cannot be undone.', 'Replace it', true);
        if (!go) return;
      } else {
        const go = await confirmBox('Replace the wallet without a backup?', 'The old key is removed and there is no copy. Any SOL on the old address is lost for good.', 'Replace it', true);
        if (!go) return;
      }
      const pw = await askPassword('Password for the new wallet', 'The new key is encrypted with a password you choose now. At least 8 characters.', 'Create wallet');
      if (!pw) return;
      try {
        wallet = await call(api.walletCreate(pw, true));
        renderWallet();
        toast('New wallet created. Copy the address and back up the new key.');
      } catch (e) { toast(e.message, true); }
    };

    const remove = async () => {
      const go = await confirmBox('Remove this wallet?', 'The key file is deleted from this computer. Without a backup of the private key, any SOL on this address is gone for good.', 'Remove it', true);
      if (!go) return;
      const pw = await askPassword('Confirm it is your wallet', 'Enter the current password. It is only used to prove the wallet is yours.', 'Remove wallet');
      if (!pw) return;
      try {
        // Only proof of ownership is needed here, so the key is never sent to the window.
        await call(api.walletVerify(pw));
        wallet = await call(api.walletReset());
        renderWallet();
        toast('Wallet removed from this computer.');
      } catch (e) { toast(e.message, true); }
    };

    return h('div', { class: 'card' },
      h('h2', {}, 'This wallet'),
      h('p', { class: 'hint' }, 'Starting over is normal while you learn. A new wallet is a new address, so send SOL to it again. Removing the wallet deletes the key file only, the chain keeps whatever is on the address.'),
      h('div', { class: 'actions' },
        h('button', { class: 'btn ghost', onclick: fresh }, 'Create a new wallet'),
        h('button', { class: 'btn danger', onclick: remove }, 'Remove this wallet')));
  }

  async function revealKey() {
    const pw = await askPassword('Show private key', 'Make sure nobody is looking at your screen. Enter your password to reveal the key.', 'Reveal');
    if (!pw) return;
    let key;
    try { key = await call(api.walletExport(pw)); } catch (e) { toast(e.message, true); return; }
    await modal((box, close) => {
      let timer;
      const done = () => { clearTimeout(timer); key = null; close(); };
      timer = setTimeout(done, 45000);
      box.append(h('h2', {}, 'Your private key'),
        h('p', {}, 'Save it somewhere safe and offline (password manager or paper). You can import it into Phantom or Solflare. This window closes by itself in 45 seconds.'),
        h('div', { class: 'secret' }, key),
        h('div', { class: 'modal-actions' },
          h('button', { class: 'btn ghost', onclick: () => navigator.clipboard.writeText(key).then(() => toast('Key copied. Clear your clipboard after saving it.'), () => toast('Copy failed.', true)) }, 'Copy'),
          h('button', { class: 'btn', onclick: done }, 'Done')));
    });
  }


  // ───────── quick setup (auto-saves) ─────────
  async function autoSave(patch, msg) {
    try {
      settings = await call(api.setSettings(patch));
      // Every control on the settings tab is a view of one object. Re-render both halves after a change, so the
      // advanced form can never hold an older ticket than the chips above it and then save it back.
      if (tab === 'settings') renderSettings();
      else renderQuick();
      if (msg) toast(msg);
    } catch (e) { toast(e.message, true); if (tab === 'settings') renderSettings(); else renderQuick(); }
  }
  const AMOUNTS = [0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1];
  const TOGGLES = [
    ['recordMarket', 'Record market observations', 'Saves prices and entry signals locally for replay. Recordings contain mint addresses and no private keys. Each file is capped at 50 MB.'],
    ['adaptiveExits', 'Order-flow exits (experimental)', 'Exit after sustained sell pressure or a fresh same-pool liquidity reading falls by half. Off by default; test in Practice first.'],
    ['marketScan', 'Market scan', 'Watches trending, boosted, newest and brand-new coins across the whole Pump.fun market.'],
    ['wideDiscovery', 'Every coin source', 'Also hunts the DexScreener search board and GeckoTerminal’s newest and trending pools, where most coins that no launch list carries turn up. Turn it off to watch the launch feeds only.'],
    ['smartFees', 'Smart fees', 'Pays the lowest fee and slippage that still lands.'],
    ['trendMode', 'Trending coins', 'Also buys coins that are already pumping.'],
    ['autoReclaim', 'Auto-recover SOL', 'Closes empty token accounts after every sell, so the ~0.002 SOL of rent behind each coin comes back to the wallet.'],
    ['recoverDust', 'Recover dust too', 'A leftover too small for any market is burned so its account can be closed and its rent returned. Only when the leftover is worth less than half that rent.'],
    ['allowGraduated', 'Graduated coins', 'Also trade coins that finished their curve and moved to PumpSwap. Off by default: the market is different and the route is less reliable.'],
    ['useJito', 'Jito bundle', 'Offers every signed trade to Jito\'s block engine as well, with a tip that is paid only if the bundle lands. A better chance of landing in a crowded slot, at the cost of a small tip on the trades that do land. Your normal route is never given up for it.'],
    ['deepEntry', 'Extra entry filters', 'Requires a minimum number of holders before a coin can be bought, and shows the holder bar and the market cap band in the panel below. Off means only the normal rules apply.'],
    ['simpleMode', 'Simple settings', 'Shows only the basic numbers - the market cap band, buyer floor and ceiling, amount, slots, slippage, target, stop and hold time - and turns every advanced rule off. One switch back and the full desk returns.'],
  ];
  function estimatedFees(settings) {
    const side = Number(settings.priorityFeeSol) + networkExtras(settings);
    return roundTripFeePct(settings.buyAmountSol, side, side);
  }

  function renderQuick() {
    if (!settings) return;
    $$('#profiles .profile').forEach((p) => p.classList.toggle('active', p.dataset.profile === settings.profile));
    const chips = clear($('#amountChips'));
    for (const v of AMOUNTS) chips.append(h('button', { class: 'chip-btn' + (Math.abs(settings.buyAmountSol - v) < 1e-9 ? ' active' : ''), onclick: () => autoSave({ buyAmountSol: v }) }, v + ' SOL'));
    const custom = $('#amountCustom');
    if (custom && document.activeElement !== custom) {
      custom.value = AMOUNTS.some((v) => Math.abs(v - settings.buyAmountSol) < 1e-9) ? '' : String(settings.buyAmountSol);
    }
    // Money that rounds to 0.00 reads as "free" and it is not: keep three decimals below a tenth of a SOL.
    const inPlay = settings.buyAmountSol * settings.maxPositions;
    const inPlayText = inPlay < 0.1 ? inPlay.toFixed(3) : inPlay.toFixed(2);
    // The tips are fixed and the ticket is not, so at a small size they are most of the round trip. Saying "about 3%"
    // next to a 0.001 SOL ticket was the opposite of the truth: it is over 40%, and no strategy can beat that.
    const trip = estimatedFees(settings);
    $('#amountHint').textContent = `Each coin costs about ${settings.buyAmountSol} SOL, and a round trip costs about ${trip.toFixed(0)}% of it (standard curve, builder and network fees before price impact). With up to ${settings.maxPositions} coins at once, the bot can have ${inPlayText} SOL in play, plus about 0.002 SOL of rent per coin that comes back when it sells.`;
    const box = clear($('#toggles'));
    // In the simple mode the rest of the desk is off, so the rest of the switches are off the screen with it.
    const shown = settings.simpleMode ? TOGGLES.filter(([k]) => k === 'simpleMode') : TOGGLES;
    for (const [k, title, desc] of shown) {
      const input = h('input', { type: 'checkbox', checked: !!settings[k], onchange: async (e) => {
        await autoSave({ [k]: e.target.checked });
        // The settings form changes shape with these two switches, so it is re-rendered with them.
        if (k === 'deepEntry' || k === 'simpleMode') renderSettings();
      } });
      box.append(h('label', { class: 'tgl' }, input, h('span', { class: 'sw' }), h('div', {}, h('b', {}, title), h('small', {}, desc))));
    }
    if (settings.simpleMode) box.append(h('p', { class: 'hint', style: 'margin:10px 0 0' }, 'Every other rule is off while the simple settings are on. Switch them off to see the full desk.'));
    for (const [id, key] of [['#incKey', 'incineratorKey'], ['#pdKey', 'pumpdevKey'], ['#jupKey', 'jupiterKey']]) {
      const el = $(id);
      if (!el) continue;
      el.value = '';
      if (!el.dataset.ph) el.dataset.ph = el.placeholder;
      el.placeholder = settings[key] ? 'Key saved. Paste a new one to replace it.' : el.dataset.ph;
    }
  }
  for (const [btn, input, key, label] of [
    ['#incSave', '#incKey', 'incineratorKey', 'Sol Incinerator'],
    ['#pdSave', '#pdKey', 'pumpdevKey', 'PumpDev'],
    ['#jupSave', '#jupKey', 'jupiterKey', 'Jupiter'],
  ]) {
    $(btn).addEventListener('click', async () => {
      const v = $(input).value.trim();
      if (!v && !settings[key]) { toast('Paste your ' + label + ' key first.', true); return; }
      try {
        settings = await call(api.setSettings({ [key]: v }));
        $('#keyMsg').textContent = v ? label + ' key saved.' : label + ' key removed.';
        setTimeout(() => { $('#keyMsg').textContent = ''; }, 3000); renderQuick();
      } catch (e) { toast(e.message, true); }
    });
  }

  // ───────── recover SOL (wallet tab) ─────────
  function recoverCard() {
    const body = h('div', { class: 'list' });
    const short = (m) => m.slice(0, 4) + '…' + m.slice(-4);
    const card = h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Coins and rent'), h('span', { class: 'muted' }, settings && settings.autoReclaim ? 'Auto-recover is on' : 'Auto-recover is off')),
      h('p', { class: 'hint' }, 'Selling every coin closes the whole desk in one press and then gives back the rent locked in empty token accounts. Nothing is burned.'),
      h('div', { class: 'actions', style: 'margin:0 0 12px' },
        h('button', { class: 'btn', onclick: sellAll }, icon('send'), 'Sell every coin and recover the rent'),
        h('button', { class: 'btn ghost', onclick: scan }, icon('radar'), 'Scan wallet')), body);
    async function sellAll(e) {
      if (!wallet.unlocked) { toast('Unlock your wallet first.', true); return; }
      const btn = e && e.currentTarget;
      if (!await confirmBox('Sell every coin?', 'Every coin the wallet holds is sold at the market price and the empty accounts are closed to get the rent back. This cannot be undone.', 'Sell everything')) return;
      if (btn) { btn.disabled = true; btn.textContent = 'Selling…'; }
      try {
        const r = await call(api.sellEverything());
        const moved = r.solBefore != null && r.solAfter != null ? r.solAfter - r.solBefore : null;
        toast(`Sold ${r.sold} of ${r.tokens} coin${r.tokens === 1 ? '' : 's'}, closed ${r.closed} account${r.closed === 1 ? '' : 's'}${moved != null ? `, wallet ${moved >= 0 ? '+' : ''}${sol(moved, 5)} SOL` : ''}.`, r.failed.length > 0);
        for (const f of r.failed.slice(0, 2)) toast(f, true);
      } catch (err) { toast(err.message, true); }
      if (btn) { btn.disabled = false; btn.textContent = 'Sell every coin and recover the rent'; }
      scan();
    }
    async function scan() {
      clear(body).append(h('p', { class: 'hint' }, 'Scanning…'));
      try {
        const r = await call(api.scanWallet());
        clear(body);
        body.append(h('div', { class: 'rec-row' },
          h('div', {}, h('b', {}, `${r.emptyCount} empty account${r.emptyCount === 1 ? '' : 's'}`), h('small', {}, `${sol(r.emptyRentSol, 5)} SOL can be recovered, free`)),
          h('button', { class: 'btn small', disabled: !r.emptyCount, onclick: async (e) => {
            if (!wallet.unlocked) { toast('Unlock your wallet first.', true); return; }
            e.target.disabled = true;
            try { const res = await call(api.closeEmpty()); toast(res.closed ? `Recovered ${sol(res.sol, 5)} SOL from ${res.closed} account${res.closed > 1 ? 's' : ''}.` : 'Nothing to close.'); if (res.errors && res.errors.length) toast(res.errors[0], true); scan(); } catch (err) { toast(err.message, true); e.target.disabled = false; }
          } }, 'Recover SOL')));
        if (settings && settings.incineratorKey && r.emptyCount) {
          body.append(h('div', { class: 'rec-row' }, h('div', {}, h('b', {}, 'Clean up with Sol Incinerator'), h('small', {}, 'Uses the API (2% fee on recovered rent)')),
            h('button', { class: 'btn small ghost', onclick: async (e) => { e.target.disabled = true; try { const x = await call(api.incineratorCloseAll()); toast(`Sol Incinerator: ${x.confirmed} of ${x.transactions} confirmed${x.sol ? `, ${sol(x.sol, 5)} SOL back in the wallet` : ''}.`, x.confirmed < x.transactions); scan(); } catch (err) { toast(err.message, true); e.target.disabled = false; } } }, 'Run cleanup')));
        }
        for (const d of r.dust.slice(0, 20)) {
          body.append(h('div', { class: 'rec-row' }, h('div', {}, h('b', {}, short(d.mint)), h('small', {}, `Holding ${d.uiAmount} · rent ${sol(d.rentSol, 5)} SOL`)),
            h('div', { class: 'row-actions' },
              h('button', { class: 'btn small', onclick: async (e) => {
                if (!wallet.unlocked) { toast('Unlock your wallet first.', true); return; }
                e.target.disabled = true;
                try { const x = await call(api.sellHolding(d.mint)); toast(x.left === '0' ? 'Sold the whole balance and the account is closed.' : 'Sold, but some tokens are still there.'); scan(); } catch (err) { toast(err.message, true); e.target.disabled = false; }
              } }, 'Sell'),
              h('button', { class: 'btn small ghost', onclick: async () => {
                if (!settings || !settings.incineratorKey) { toast('Burning needs a Sol Incinerator key (Settings > Integrations).', true); showTab('settings'); return; }
                if (!wallet.unlocked) { toast('Unlock your wallet first.', true); return; }
                if (!await confirmBox('Burn this token?', `The whole balance of ${short(d.mint)} is destroyed for good and its account is closed to recover the rent.`, 'Burn it', true)) return;
                try { const x = await call(api.incineratorBurn(d.mint)); toast(`Burned. Recovered about ${sol(x.sol, 5)} SOL.`); scan(); } catch (err) { toast(err.message, true); }
              } }, 'Burn'))));
        }
        if (r.frozen.length) body.append(h('p', { class: 'hint' }, `${r.frozen.length} frozen token account${r.frozen.length > 1 ? 's' : ''} found. Only the token's creator can unfreeze those, so they cannot be closed or burned by you.`));
        if (!r.emptyCount && !r.dust.length && !r.frozen.length) body.append(h('p', { class: 'hint' }, 'Your wallet is clean. Nothing to recover.'));
      } catch (e) { clear(body); toast(e.message, true); }
    }
    return card;
  }

  // ───────── settings tab ─────────
  const FIELDS = [
    ['paperLatencyMs', 'Practice fill delay (ms)', 50, 'Stress assumption. Zero disables the delay; try 250–1000 ms when comparing plans.'],
    ['paperBaseSlippagePct', 'Practice baseline slippage (%)', 0.1, 'Adverse slippage per side, before estimated price impact.'],
    ['paperUnknownImpactPct', 'Practice impact when depth is unknown (%)', 0.5, 'Extra slippage when the quote-side liquidity cannot be estimated.'],
    ['paperFailurePct', 'Practice order failure rate (%)', 1, 'Repeat with several rates. A failed order leaves an existing position open.'],
    ['paperSeed', 'Practice random seed', 1, 'Use the same seed when comparing failure scenarios. Applied after restart.'],
    ['minScore', 'Minimum score to buy (0-100)', 1, 'What the bot has to see before it spends. Higher means fewer, stronger entries.'],
    ['minBuyers', 'Buyers needed in the window', 1, 'Distinct wallets in a twenty second window. A coin found by the market scan is counted over five minutes and needs DOUBLE this number, because that window carries far more trades - at 50 that is 100 buys in five minutes.'],
    ['minNetFlowSol', 'The coin needs net buying of (SOL)', 0.1, 'Buys minus sells on the coin’s own tape, in the last few seconds. This is about the coin, not your ticket: 1 means other people bought a whole SOL more than they sold.'],
    ['minLiqUsd', 'Skip if the pool holds less than ($)', 100, 'A thin pool cannot absorb an exit. Zero turns the check off.'],
    ['watchSec', 'Watch a new coin for (seconds)', 1, 'How long a launch is watched before it may be bought.'],
    ['entryWindowSec', 'A launch counts as trending after (seconds)', 5, 'Past this age a coin is judged as an established mover.'],
    ['buyAmountSol', 'Buy amount per coin (SOL)', 0.001, 'Your ticket. The tip is a fixed cost, so a bigger ticket pays a smaller share of it.'],
    ['maxPositions', 'Max coins held at once', 1, 'Each one needs its own exit fee, which is kept aside and never spent.'],
    ['maxBuysPerMin', 'Max buys per minute', 1, 'Safety cap on trading speed. Type any number you want.'],
    ['takeProfitPct', 'Take profit (%)', 1, 'Sell when the gain reaches this, after fees.'],
    ['stopLossPct', 'Stop loss (%)', 1, 'Sell when the loss reaches this. Confirmed by a second price reading, so one bad quote cannot trigger it.'],
    ['maxHoldSec', 'Max hold time (seconds)', 5, 'Sell if nothing happens by then. Turns dead tickets back into SOL.'],
    ['slippagePct', 'Slippage ceiling (%)', 1, 'Smart fees stays tighter than this when it can.'],
    ['priorityFeeSol', 'Priority fee ceiling (SOL)', 0.0001, 'Smart fees pays less when the network is quiet.'],
    ['sessionLossLimitSol', 'Daily loss limit (SOL)', 0.01, 'New entries stop when reached. Open positions still close.'],
    ['maxDevBuySol', 'Skip if creator bought over (SOL)', 0.5, 'Avoids coins where the creator holds a huge bag.'],
    ['maxDevHoldPct', 'Skip if creator holds over (%, 0 is off)', 1, 'Read from the token audit. A creator holding a third of the supply can end the coin alone.'],
    ['maxTraderSharePct', 'Skip if one wallet is over (%)', 5, 'Avoids fake volume from a single wallet.'],
    ['maxChange5mPct', 'Skip if already up (%) in 5 min, 0 is off', 5, 'Refuses a coin that has already run: buying it is buying somebody else\'s exit.'],
    ['minChange5mPct', 'Only buy if up at least (%) in 5 min, 0 is off', 1, 'The floor of the same band: a launch that has not moved yet is where a move starts. A coin only 2% up with real demand is early; a coin 60% up is late.'],
    ['minTokenAgeSec', 'Do not buy a coin younger than (seconds, 0 is off)', 1, 'A launch this young has no tape to judge - the buyers are the dev and his friends. Zero buys the first print.'],
    ['maxTokenAgeSec', 'Do not buy a coin older than (seconds, 0 is off)', 5, 'The whole-life version of the five minute ceiling: past this the move has happened and a small ticket is buying somebody else\'s exit.'],
    ['maxRoundTripPct', 'Refuse a ticket whose round trip costs more than (%)', 1, 'Fees both ways as a share of your ticket. Below this the tips eat the trade - at 0.001 SOL they are 40% of it. 5 is the floor, 20 is the shipped plan.'],
    ['tp1Pct', 'First take profit at (%, 0 is off)', 1, 'The first bite. Sells part of the position early and lets the rest run.'],
    ['tp1SellPct', 'How much to sell at that first target (%)', 5, 'A share of the position, for example 60. The remainder follows the target and the trailing stop.'],
    ['triggerHoldMs', 'A signal must hold for (ms) before it sells', 50, 'The safeguard: a take profit or a stop has to be seen again after this long, on a fresh price, before the bot acts. 400 is a blink; 0 acts on the first reading.'],
    ['trailArmPct', 'Trailing stop arms at (%)', 1, 'Once a coin is up this much, a give-back from the peak closes it.'],
    ['trailGivePct', 'Trailing stop gives back (%)', 0.5, 'How far the price may fall from its peak before the bot sells.'],
    ['breakEvenPct', 'Break even after a peak of (%, 0 is off)', 1, 'Once a coin has been up this much, the bot will not let it turn into a loss.'],
    ['maxLossStreak', 'Pause after losses in a row', 1, 'A cold streak means the market changed. The bot rests instead of bleeding.'],
    ['pauseMinutes', 'Pause length (minutes)', 1, 'New entries wait this long. Open positions still close normally.'],
    ['jitoTipSol', 'Jito tip per trade (SOL)', 0.00001, 'Only used when the Jito bundle is on. Paid only when the bundle lands - a bundle that loses the auction costs nothing.'],
  ];
  // Shown inside the extra filters panel: the holder bar and the market cap band the panel exists for.
  const DEEP_FIELDS = [
    ['minHolders', 'Minimum holders to buy (0 is off)', 1, 'A coin with fewer holders than this is skipped. Read from the live market at the moment of buying; a coin whose holder count cannot be read is skipped too.'],
    ['minMcSol', 'Lowest market cap to buy (SOL)', 5, 'The bottom of the band. Small caps move fastest and die fastest.'],
    ['maxMcSol', 'Highest market cap to buy (SOL)', 10, 'The top of the band. Coins found by the market scan get four times this.'],
  ];
  // The basic numbers the simple mode shows, and the only rules it leaves on.
  const SIMPLE_FIELDS = [
    ['minMcSol', 'Buy from market cap (SOL)', 5, 'The bottom of the band. Below it the coin is too small.'],
    ['maxMcSol', 'Buy up to market cap (SOL)', 10, 'The top of the band. Coins found by the market scan get four times this.'],
    ['minBuyers', 'Minimum buyers', 1, 'Distinct wallets in the window. Below this the coin is not bought.'],
    ['maxBuyers', 'Maximum buyers (0 is off)', 1, 'Past this the crowd is already in, so the coin is not bought. Zero turns the ceiling off.'],
    ['buyAmountSol', 'Buy amount per coin (SOL)', 0.001, 'Your ticket.'],
    ['maxPositions', 'Max coins held at once', 1, 'How many coins may be open at the same time.'],
    ['slippagePct', 'Slippage (%)', 1, 'How far the price may move while the order is in flight.'],
    ['takeProfitPct', 'Take profit (%)', 1, 'Sell when the gain reaches this, after fees.'],
    ['stopLossPct', 'Stop loss (%)', 1, 'Sell when the loss reaches this.'],
    ['maxHoldSec', 'Max hold time (seconds)', 5, 'Sell if nothing happens by then.'],
    // RULE ADDED 2026-11-05: these three decide in the SIMPLE plan as well - the age clocks gate both modes and the fee
    // gate is on every buy - so hiding them here left the shipped plan with three numbers nobody could change.
    ['minTokenAgeSec', 'Do not buy a coin younger than (seconds, 0 is off)', 1, 'A launch this young has no tape to judge. Zero buys the first print.'],
    ['maxTokenAgeSec', 'Do not buy a coin older than (seconds, 0 is off)', 5, 'The whole-life version of the five minute ceiling. Zero turns it off.'],
    ['maxRoundTripPct', 'Refuse a ticket whose round trip costs more than (%)', 1, 'Fees both ways as a share of your ticket. 5 is the floor, 20 is the shipped plan.'],
  ];
  function renderSettings() {
    if (!settings) return;
    $('#autopilotBtn span').textContent = settings.mode === 'paper' ? 'Best Profit · Apply the Practice settings' : 'Best Profit · Apply live settings';
    $$('#profiles .profile').forEach((p) => p.classList.toggle('active', p.dataset.profile === settings.profile));
    const form = clear($('#settingsForm'));
    // Simple mode: only the basic numbers are shown, and the advanced ones stop deciding. The hidden values stay in
    // the store untouched, so switching back restores the full desk exactly as it was.
    if (settings.simpleMode) {
      form.append(h('div', { class: 'simple-note' }, 'Simple settings are on: only these numbers decide. Switch it off in the quick setup to see the whole desk again.'));
      for (const [k, label, step, hint] of SIMPLE_FIELDS) {
        form.append(h('label', { class: 'field' }, h('span', {}, label), h('input', { type: 'number', step, min: '0', 'data-key': k, value: String(settings[k] ?? '') }), hint ? h('span', {}, hint) : null));
      }
    } else {
      for (const [k, label, step, hint] of FIELDS) {
        form.append(h('label', { class: 'field' }, h('span', {}, label), h('input', { type: 'number', step, min: '0', 'data-key': k, value: String(settings[k] ?? '') }), hint ? h('span', {}, hint) : null));
      }
    }
    form.append(h('label', { class: 'field' }, h('span', {}, 'Data feed'), h('select', { 'data-key': 'feedSource' },
      ...[
        ['auto', 'Automatic (best available)'],
        ['geyser', 'Geyser stream (fastest, needs an endpoint)'],
        ['pumpdev', 'PumpDev (trades + launches)'],
        ['chain', 'Blockchain only (needs good RPC)'],
        ['pumpportal', 'PumpPortal (launches only)'],
      ].map(([v, l]) => h('option', { value: v, selected: settings.feedSource === v }, l))), h('span', {}, 'Automatic uses a Geyser endpoint when you set one, then your own socket or node (the full Pump.fun program, no per-coin limit), then PumpDev with a key. PumpPortal provides launch discovery if the chain feed fails.')));
    // Copy trading: follow a wallet's BUYS. Its own row, because the value is a list of addresses, not a number.
    form.append(h('label', { class: 'field', style: 'grid-column: 1 / -1' }, h('span', {}, 'Copy these wallets (optional)'),
      h('textarea', { rows: '2', 'data-key': 'copyWallets', spellcheck: 'false', placeholder: 'One or more Solana addresses, separated by spaces or new lines' }, String(settings.copyWallets || '')),
      h('span', {}, 'When one of these wallets buys a coin this desk is watching, the coin is entered at once instead of waiting for the score and buyer bars. Slots, pace, fees, the session limit and the pool price still apply, and their sells are not mirrored - the exit ladder here is your own.')));
    if (!settings.simpleMode) {
      const deep = h('div', { id: 'deepPanel', class: 'deep-panel', hidden: !settings.deepEntry },
        h('div', { class: 'deep-head' }, h('b', {}, 'Extra entry filters'), h('small', {}, 'holders and the market cap band')));
      for (const [k, label, step, hint] of DEEP_FIELDS) {
        deep.append(h('label', { class: 'field' }, h('span', {}, label), h('input', { type: 'number', step, min: '0', 'data-key': k, value: String(settings[k] ?? '') }), hint ? h('span', {}, hint) : null));
      }
      form.append(deep);
    }
    $('#rpcUrl').value = settings.rpcUrl || '';
    $('#rpcBackupUrl').value = settings.rpcBackupUrl || '';
    $('#rpcWsUrl').value = settings.rpcWsUrl || '';
    $('#geyserUrl').value = settings.geyserUrl || '';
    $('#geyserToken').value = settings.geyserToken || '';
    const rt = estimatedFees(settings);
    const plan = settings.simpleMode
      ? [`everything at +${settings.takeProfitPct}%`, `a stop at -${settings.stopLossPct}%`, 'half of any run past +20% is kept', `and nothing is held longer than ${settings.maxHoldSec} s`].join(', ')
      : [
      settings.tp1Pct > 0 ? `${settings.tp1SellPct}% goes out at +${settings.tp1Pct}%` : '',
      `the rest at +${settings.takeProfitPct}%`,
      `a stop at -${settings.stopLossPct}%`,
      settings.trailArmPct > 0 ? `a trail that follows a +${settings.trailArmPct}% peak and gives back ${settings.trailGivePct}%` : '',
      settings.breakEvenPct > 0 ? `no position that reached +${settings.breakEvenPct}% may close at a loss` : '',
      `and nothing is held longer than ${settings.maxHoldSec} s`,
    ].filter(Boolean).join(', ');
    $('#costNote').textContent = `Estimated round-trip fees: ~${rt.toFixed(1)}% before price impact. Exits: ${plan}.`;
    renderQuick();
    renderRpcList();
    // The share code is a view of these numbers, so it is rewritten whenever they are.
    fillShareCode();
  }
  function renderRpcList() {
    const box = clear($('#rpcList'));
    if (!S || !S.rpc) return;
    for (const n of S.rpc.nodes) box.append(h('span', { class: n.active ? 'active' : '' }, h('i', { class: 'dot ' + (n.coolingDown ? 'warn' : 'ok') }), n.host + (n.active ? ' (active)' : n.coolingDown ? ' (resting)' : '')));
  }
  $('#profiles').addEventListener('click', async (e) => {
    const b = e.target.closest('.profile'); if (!b) return;
    try { settings = await call(api.setProfile(b.dataset.profile)); renderSettings(); toast('Style applied: ' + b.dataset.profile); } catch (err) { toast(err.message, true); }
  });
  $('#saveSettings').addEventListener('click', async () => {
    const patch = {};
    for (const el of $$('#settingsForm [data-key]')) {
      const k = el.dataset.key;
      if (el.type === 'checkbox') patch[k] = el.checked;
      else if (el.tagName === 'SELECT') patch[k] = el.value;
      // RULE ADDED 2026-11-06 (1.0.7): the copy roster is text (addresses), not a number - without this branch the form
      // would turn "7xKX...abc" into NaN and refuse to save with "Invalid number in: copyWallets".
      else if (el.tagName === 'TEXTAREA' || el.type === 'text') patch[k] = String(el.value || '').trim();
      else { const v = Number(el.value); if (!Number.isFinite(v) || v < 0) { toast('Invalid number in: ' + k, true); return; } patch[k] = v; }
    }
    if (patch.buyAmountSol <= 0) { toast('Buy amount must be above 0.', true); return; }
    patch.rpcUrl = $('#rpcUrl').value.trim();
    patch.rpcBackupUrl = $('#rpcBackupUrl').value.trim();
    patch.rpcWsUrl = $('#rpcWsUrl').value.trim();
    patch.geyserUrl = $('#geyserUrl').value.trim();
    patch.geyserToken = $('#geyserToken').value.trim();
    try {
      settings = await call(api.setSettings(patch));
      $('#saveMsg').textContent = 'Saved';
      setTimeout(() => { $('#saveMsg').textContent = ''; }, 2500);
      renderSettings();
    } catch (e) { toast(e.message, true); }
  });
  // ── the connection doctor ──
  // RULE ADDED 2026-11-06 (1.0.9): a socket that answers 401 without its key used to fall back to public nodes in
  // silence, and the feed was nineteen seconds behind. One press now opens every configured address and says what it
  // answered, so a dead endpoint is found on the settings screen instead of a week of trades later.
  $('#diagBtn').addEventListener('click', async () => {
    const out = $('#diagOut');
    const btn = $('#diagBtn');
    btn.disabled = true;
    out.hidden = false;
    out.textContent = 'Checking…';
    try {
      const r = await call(api.diagCheck());
      const rows = (r && r.rows) || [];
      const notes = (r && r.notes) || [];
      clear(out);
      for (const row of rows) {
        out.append(h('div', { class: 'diag-row ' + (row.ok ? 'ok' : 'bad') },
          h('b', {}, (row.ok ? '✓ ' : '✕ ') + row.label),
          h('span', {}, row.ok ? `${row.ms} ms · ${row.detail}` : row.detail)));
      }
      for (const note of notes) out.append(h('div', { class: 'diag-note' }, note));
    } catch (e) {
      out.textContent = 'The check could not run: ' + e.message;
    } finally {
      btn.disabled = false;
    }
  });
  // ───────── share a settings code ─────────
  async function fillShareCode() {
    try {
      const r = await call(api.shareSettings());
      const code = $('#shareCode');
      if (code) code.value = r.code;
      return r;
    } catch (e) { toast(e.message, true); return null; }
  }
  $('#copyShare').addEventListener('click', async () => {
    const r = await fillShareCode();
    if (!r) return;
    try {
      await navigator.clipboard.writeText(r.code);
      $('#shareMsg').textContent = 'Code copied.';
    } catch (_) {
      $('#shareMsg').textContent = 'Select the code and copy it by hand.';
    }
    setTimeout(() => { $('#shareMsg').textContent = ''; }, 3000);
  });
  $('#postShare').addEventListener('click', async () => {
    const r = await fillShareCode();
    if (!r) return;
    // Short on purpose: the whole post has to fit in 280 characters, and the code already carries the plan - the
    // description line pushed it over the limit (320) as well as being the thing that made X see a link.
    const text = `PillCrew settings - paste into Settings:\n${r.code}`;
    call(api.openExternal('https://twitter.com/intent/tweet?text=' + encodeURIComponent(text))).catch((e) => toast(e.message, true));
  });
  $('#applyShare').addEventListener('click', async () => {
    const code = String($('#shareInput').value || '').trim();
    if (!code) { toast('Paste a code first.', true); return; }
    try {
      if (S && S.running) throw new Error('Stop the bot first, then apply a code.');
      settings = await call(api.applySharedSettings(code));
      $('#shareApplyMsg').textContent = 'Applied. The numbers are below, and yours to change.';
      setTimeout(() => { $('#shareApplyMsg').textContent = ''; }, 5000);
      renderSettings();
      toast('Settings applied from the code.');
    } catch (e) { toast(e.message, true); }
  });

  $('#resetPractice').addEventListener('click', async () => {
    if (await confirmBox('Reset Practice Mode?', 'Your fake balance goes back to 5 SOL and practice stats are cleared.', 'Reset')) { await call(api.resetPractice()); toast('Practice account reset.'); }
  });
  $('#resetPaperStats').addEventListener('click', async () => {
    if (await confirmBox('Clear practice statistics?', 'Profit and loss, win rate and closed practice trades are cleared. Your 5 SOL practice balance stays where it is and open positions keep running.', 'Clear it', true)) {
      await call(api.resetStats('paper'));
      toast('Practice statistics cleared.');
    }
  });
  $('#resetLiveStats').addEventListener('click', async () => {
    if (await confirmBox('Clear real money statistics?', 'The session profit and loss, the win rate and the closed real trades are cleared. Nothing on chain is touched and open positions keep running.', 'Clear it', true)) {
      await call(api.resetStats('live'));
      toast('Real money statistics cleared.');
    }
  });
  // RULE CHANGED 2026-11-05 (1.0.4): the press applies the preset and stops there. Practice mode no longer starts a run
  // from a settings button, and the message says so.
  $('#autopilotBtn').addEventListener('click', async () => {
    try {
      const btn = $('#autopilotBtn');
      btn.disabled = true;
      settings = await call(api.autopilot());
      renderSettings();
      $('#autopilotMsg').textContent = 'Preset applied. Press Start Bot when you are ready.';
      toast($('#autopilotMsg').textContent);
    } catch (e) {
      toast(e.message, true);
    } finally {
      $('#autopilotBtn').disabled = false;
    }
  });

  // A free amount, so 0.15 or 0.75 SOL is one click, not a settings hunt.
  $('#amountCustomSave').addEventListener('click', async () => {
    const raw = String($('#amountCustom').value || '').replace(',', '.').trim();
    const v = Number(raw);
    if (!Number.isFinite(v) || v < 0.001 || v > 1) { toast('Enter an amount between 0.001 and 1 SOL.', true); return; }
    await autoSave({ buyAmountSol: Math.round(v * 1000) / 1000 }, `Ticket set to ${Math.round(v * 1000) / 1000} SOL per coin.`);
  });
  $('#amountCustom').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#amountCustomSave').click(); });

  // ───────── bump desk ─────────
  let BS = null;               // the desk's own last state
  let bumpSaveTimer = null;

  const BUMP_FIELDS = [
    ['bumpBudgetSol', 'Budget for the whole run (SOL)', 0.01, 'Spread evenly over the wallets. Whatever is not spent comes back with "Withdraw everything".'],
    ['bumpWallets', 'Wallets in the pool', 1, 'How many wallets take turns. Each one trades on its own address, so the tape reads as several people.'],
    ['bumpMinSol', 'Smallest bump (SOL)', 0.0005, 'The bottom of the band each amount is drawn from.'],
    ['bumpMaxSol', 'Largest bump (SOL)', 0.0005, 'The top of the band. Amounts are drawn to the lamport, so no two transactions carry the same number.'],
    ['bumpPerMinute', 'Bumps per minute', 1, 'The pace. Gaps are jittered, because a wall of transactions exactly on the beat is the one thing a bot cannot hide.'],
    ['bumpHoldMinSec', 'Shortest hold (seconds)', 1, 'The least time a round waits before its sell.'],
    ['bumpHoldMaxSec', 'Longest hold (seconds)', 1, 'The most. Each round waits a random time in between - counted from the LAST buy of the round, because the round is sold as one bag.'],
    ['bumpMinutes', 'Run for (minutes, 0 = until you stop)', 1, 'Paused time is added back, so a pause never eats the run.'],
    ['bumpSlippagePct', 'Slippage ceiling (%)', 0.5, '1% is the floor every route accepts and the cheapest setting there is. On a fast coin that is also why a sell can fail.'],
    ['bumpPriorityFeeSol', 'Tip per transaction (SOL)', 0.000001, 'The cheapest tip that still lands. A big tip on a 0.01 SOL bump is how a volume run costs more than the volume it buys.'],
    ['bumpJitoTipSol', 'Jito tip per bump (SOL)', 0.000001, 'Paid by the wallet that trades, in its own transaction, only when the bundle lands. Jito needs at least 1000 lamports (0.000001 SOL) and lands more reliably with 10000.'],
  ];
  const BUMP_TOGGLES = [
    ['bumpSimulate', 'Dry run', 'Counts the bumps and the cost, sends nothing. The honest way to see what a run would do.'],
    ['bumpSellBack', 'Sell the bags back on Stop', 'A run that stops with wallets full of the token has not finished.'],
    ['bumpUseJito', 'Use Jito', 'Sends each bump (one wallet\'s trade plus its tip) as a bundle, so it lands on a busy block. This is not several wallets in one block: the wallets still trade one at a time. It costs the tip above per bump and makes the run buy fewer bumps for the same money.'],
  ];

  function renderBumpForm() {
    if (!settings) return;
    // ── the sliders: the three numbers that decide everything else ──
    const sliders = clear($('#bumpSliders'));
    const slider = (key, label, min, max, step, help) => {
      const num = h('input', { type: 'number', min, max, step, 'data-key': key, value: String(settings[key] ?? '') });
      const range = h('input', { type: 'range', min, max, step, 'data-slide': key, value: String(settings[key] ?? min) });
      const sync = (v) => { num.value = String(v); range.value = String(v); };
      range.addEventListener('input', () => { sync(range.value); saveBump({ [key]: Number(range.value) }); });
      return h('label', { class: 'field' }, h('span', {}, label), h('div', { class: 'slider-row' }, range, num), h('span', {}, help));
    };
    sliders.append(
      slider('bumpBudgetSol', 'How much SOL you are putting in', 0.005, 1, 0.005, 'Everything: the trades, the fees and the rent. Whatever is left comes back with "Withdraw everything".'),
      slider('bumpMinutes', 'How long it should run (minutes)', 5, 720, 5, 'Paused time is added back, so a pause never eats the run.'),
      slider('bumpPerMinute', 'Bumps per minute', 0.5, 120, 0.5, 'The pace. A pool of wallets is a ceiling: with two wallets and a long hold band it cannot go faster than the holds allow, and the panel says so.'),
    );
    sliders.append(h('label', { class: 'field' }, h('span', {}, 'Wallets (the pool size)'),
      h('input', { type: 'number', min: '2', max: '40', step: 1, 'data-key': 'bumpWallets', value: String(settings.bumpWallets ?? 6) }),
      h('span', {}, 'Exactly this many. If the budget cannot park the rent for them all (0.00204 SOL each), the plan above says so and names the pool the money can carry - it never uses fewer behind your back.')));
    // RULE ADDED 2026-11-08 (1.1.2): a ROUND is N buys and then ONE sell of the whole bag, and then the wallet starts again.
    // The slider is the N, the checkbox makes every round draw its own count between one and that N, and the sell is always
    // the whole bag - there is no "sell part of it" setting, because a tape that sells bits looks like a bot.
    sliders.append(h('label', { class: 'field' }, h('span', {}, 'Buys in one round (the sell is always the whole bag)'),
      h('div', { class: 'slider-row' },
        h('input', { type: 'range', min: '1', max: '10', step: '1', 'data-slide': 'bumpBuysPerRound', value: String(settings.bumpBuysPerRound ?? 1), oninput: (ev) => { $('#bumpBuysOut').textContent = ev.target.value; saveBump({ bumpBuysPerRound: Number(ev.target.value) }); } }),
        h('b', { id: 'bumpBuysOut' }, String(settings.bumpBuysPerRound ?? 1))),
      h('span', {}, 'One buy and one sell is the default. Three buys and one sell is a 75% buy tape; the desk spreads the buys over the pace and holds the bag until the last one is in.')));
    sliders.append(h('label', { class: 'field check', title: 'Every round draws its own length between one and the number above, so no two rounds are alike.' },
      h('input', { type: 'checkbox', 'data-key': 'bumpBuysRandom', checked: settings.bumpBuysRandom === true }),
      h('span', {}, 'Random count every round (1 up to that number)')));
    sliders.append(h('label', { class: 'field check', title: 'The ticket is worked out from the budget, the length and the pace - the only order in which a small budget is not a slow accident.' },
      h('input', { type: 'checkbox', 'data-key': 'bumpAutoAmount', checked: settings.bumpAutoAmount !== false }),
      h('span', {}, 'Work the ticket out from the budget')));

    // ── the advanced numbers: everything else is still yours ──
    const form = clear($('#bumpForm'));
    const derived = settings.bumpAutoAmount !== false;
    for (const [k, label, step, help] of BUMP_FIELDS) {
      const locked = derived && (k === 'bumpMinSol' || k === 'bumpMaxSol');
      form.append(h('label', { class: 'field' }, h('span', {}, label + (locked ? ' (worked out)' : '')),
        h('input', { type: 'number', step, min: '0', 'data-key': k, value: String(settings[k] ?? ''), disabled: locked }),
        h('span', {}, locked ? 'From the budget above. Switch "Work the ticket out" off to set it by hand.' : help)));
    }
    // No "wallets per bundle" field: a bundle is one wallet's trade plus its tip, which is what the code sends. The old
    // field implied several wallets share a block, which nothing here does and the desk must not claim.
    const toggles = h('div', { class: 'toggles', style: 'grid-column: 1 / -1' });
    for (const [k, label, help] of BUMP_TOGGLES) {
      toggles.append(h('label', { class: 'field check', title: help },
        h('input', { type: 'checkbox', 'data-key': k, checked: Boolean(settings[k]) }), h('span', {}, label)));
    }
    form.append(toggles);
    $('#bumpMint').value = settings.bumpMint || '';
  }

  /** The plan line: what the three sliders actually buy, and what to do when they do not add up. */
  function paintPlan(e) {
    const box = clear($('#bumpPlan'));
    if (!e) return;
    box.className = 'plan' + (e.fits ? '' : ' bad');
    const hrs = e.bumps && e.slippagePct != null ? null : null;
    const len = settings && settings.bumpMinutes >= 60
      ? `${Math.round((settings.bumpMinutes / 60) * 10) / 10} h`
      : `${settings ? settings.bumpMinutes : '?'} min`;
    box.append(h('p', { class: 'plan-line' },
      `${e.wallets} wallets · `,
      h('b', {}, `${sol(e.avgAmountSol, 6)} SOL`), ' a bump · ',
      h('b', {}, String(e.bumps || '—')), ` bumps over ${len} · fees `,
      h('b', {}, `${sol(e.runFeesSol, 4)} SOL`), ' · volume ',
      h('b', {}, `${e.runVolumeSol.toFixed(2)} SOL`),
      ` · ${sol(e.walletRentSol, 4)} SOL of rent parked and returned`));
    // The round is the shape of the tape, so it is named: N buys, then the whole bag sold, then again.
    if (e.buysPerRound) {
      box.append(h('p', { class: 'plan-note' },
        `${e.buysPerRound} buy${e.buysPerRound === 1 ? '' : 's'} then one sell of the whole bag ` +
        `(${e.buySharePct}% of the transactions are buys${settings && settings.bumpBuysRandom ? ', and every round draws its own count' : ''}).`));
    }
    if (e.poolNote) box.append(h('p', { class: 'plan-note' }, e.poolNote));
    if (!e.fits && e.planNote) {
      box.append(h('p', { class: 'plan-note' }, e.planNote));
      box.append(h('div', { class: 'actions' }, h('button', { class: 'btn small', onclick: async () => {
        try {
          const fit = await call(api.bumpFit());
          if (!fit.fits) { toast(fit.note, true); return; }
          settings = await call(api.setSettings(fit.patch));
          renderBumpForm();
          refreshBumpEstimate();
          toast(fit.note);
        } catch (err) { toast(err.message, true); }
      } }, 'Fit it to my budget')));
    } else if (e.note) {
      box.append(h('p', { class: 'plan-note' }, e.note));
    }
  }

  /** One place where a changed number becomes a saved setting; a slider must not write on every keystroke. */
  function saveBump(patch, note) {
    settings = { ...settings, ...patch };
    clearTimeout(bumpSaveTimer);
    bumpSaveTimer = setTimeout(async () => {
      try {
        await call(api.setSettings(patch));
        if (note) toast(note);
        refreshBumpEstimate();
      } catch (e) { toast(e.message, true); }
    }, 350);
  }

  /**
   * RULE ADDED 2026-11-11 (1.1.5): the pool-size box and the number box beside every slider live in #bumpSliders, and
   * NOTHING saved them - only the range next to each one did. So the owner typed 3, the setting stayed at 2, "Create
   * wallets" made two addresses and the plan went on saying "2 wallets". Typing in a box now moves its range with it and
   * saves on the way out (change), never mid-keystroke: a half-typed "0." is not a budget.
   */
  $('#bumpSliders').addEventListener('input', (e) => {
    const el = e.target.closest('[data-key]');
    if (!el || el.type === 'checkbox') return;
    const twin = $('#bumpSliders [data-slide="' + el.dataset.key + '"]');
    if (twin && Number.isFinite(Number(el.value))) twin.value = String(Number(el.value));
  });
  $('#bumpSliders').addEventListener('change', (e) => {
    const el = e.target.closest('[data-key]');
    if (!el || el.type === 'checkbox') return;
    const key = el.dataset.key;
    const v = Number(el.value);
    if (!Number.isFinite(v)) return;
    if (settings && settings[key] === v) return;
    saveBump({ [key]: v });
  });

  $('#bumpForm').addEventListener('input', (e) => {
    const el = e.target.closest('[data-key]');
    if (!el) return;
    const key = el.dataset.key;
    const patch = el.type === 'checkbox' ? { [key]: el.checked } : { [key]: Number(el.value) };
    if (el.type !== 'checkbox' && !Number.isFinite(patch[key])) return;
    // A value that did not change is not written. It costs nothing, and it means a stray input event cannot rewrite a
    // setting with the number already in it - including flipping a checkbox nobody touched.
    if (settings && settings[key] === patch[key]) return;
    saveBump(patch);
  });
  $('#bumpMint').addEventListener('change', () => {
    const mint = $('#bumpMint').value.trim();
    saveBump({ bumpMint: mint }, mint ? 'Token saved.' : 'Token cleared.');
  });

  async function refreshBumpEstimate() {
    try {
      const r = await api.bumpEstimate();
      if (!r || !r.ok) return;
      paintEstimate(r.data);
    } catch (_) { /* the panel keeps the last figure */ }
  }

  function paintEstimate(e) {
    const box = clear($('#bumpEstimate'));
    if (!e) return;
    paintPlan(e);
    const row = (label, value, note) => h('div', { class: 'rec-row' }, h('div', {}, h('b', {}, label), note ? h('small', {}, note) : null), h('b', { class: 'val' }, value));
    box.append(
      row('One bump, all in', `${sol(e.perBumpFeesSol, 6)} SOL`, `${sol(e.avgAmountSol, 4)} SOL average, of which the curve and the door take ${sol(e.perBumpCurveSol, 6)}`),
      row('Bundled into the price', `${e.runVolumeSol.toFixed(2)} SOL`, `${e.bumps || '—'} bumps of volume over the configured run`),
      row('Fees for the whole run', `${sol(e.runFeesSol, 4)} SOL`, `at ${e.slippagePct}% slippage across ${e.wallets} wallets`),
      row('Rent to park', `${sol(e.walletRentSol, 4)} SOL`, 'one token account per wallet; it comes back when the account is closed'),
      row('Budget', `${sol(e.budgetSol, 3)} SOL`, `${sol(e.perWalletSol, 4)} SOL per wallet`),
    );
    if (e.note) box.append(h('div', { class: 'hint' }, e.note));
  }

  function paintBump(st) {
    BS = st;
    const pill = $('#bumpPill');
    if (pill) {
      pill.textContent = st.simulate ? 'Dry run' : st.running ? (st.paused ? 'Paused' : 'Running') : st.unlocked ? 'Ready' : st.addresses.length ? 'Locked' : 'Idle';
      pill.className = 'pill' + (st.running && !st.paused ? ' live' : '');
    }
    const note = $('#bumpWalletNote');
    if (note) {
      const pool = st.pool || {};
      const poolGap = pool.asked && pool.have != null && pool.have < pool.asked
        ? ` - you asked for ${pool.asked}: press Create wallets to add ${pool.asked - pool.have} more`
        : '';
      note.textContent = st.addresses.length
        ? `${st.addresses.length} wallet${st.addresses.length === 1 ? '' : 's'}${poolGap} · ${st.unlocked ? 'unlocked' : 'locked'}`
          + (st.buysPerRound ? ` · ${st.buysPerRound} buy${st.buysPerRound === 1 ? '' : 's'} per round${st.buysRandom ? ', random' : ''}` : '')
          + (st.idleSol ? ` · ${sol(st.idleSol, 4)} SOL idle outside the plan` : '')
        : 'no wallets yet';
    }
    // RULE ADDED 2026-11-11 (1.1.5): the Jito switch says what it is doing. A bundle is a first try at a better slot and
    // the trade goes out the normal way when it does not land, so "it never used Jito" can no longer be a guess.
    const jitoLine = $('#bumpJito');
    if (jitoLine) {
      const j = st.jito || {};
      jitoLine.textContent = !j.on
        ? 'Jito: off - every trade goes out through the RPC route.'
        : j.broken
          ? `Jito: stood down for this run after ${j.misses} trades in a row whose bundle did not land - every trade still goes out through the RPC route.`
          : `Jito: on, ${sol(j.tipSol, 6)} SOL tip a bump. Each trade is offered as a bundle first and sent the normal way if it does not land, so the tip is only ever paid by a bundle that lands${j.bundles ? ` (${j.bundles} offered this run)` : ''}.`;
      jitoLine.classList.toggle('warn', Boolean(j.on && j.broken));
    }
    // The one address: shown, copyable, and with its balance, because that is where the money goes in and comes back.
    const vault = st.vault || {};
    const vaultField = $('#bumpVaultAddr');
    if (vaultField) vaultField.value = vault.address || '';
    const vaultNote = $('#bumpVaultNote');
    if (vaultNote) vaultNote.textContent = vault.address
      ? `${vault.balanceSol == null ? '—' : sol(vault.balanceSol, 4)} SOL in it`
      : 'created with the wallets';
    const list = clear($('#bumpWallets'));
    if (!st.addresses.length) {
      list.append(h('div', { class: 'hint' }, 'Create a pool of wallets first: each one jumps in on its own, so the trades come from different addresses.'));
    } else {
      for (const w of st.wallets) {
        const spentPct = w.budgetSol > 0 ? Math.min(100, Math.round((w.spentSol / w.budgetSol) * 100)) : 0;
        // The round is the unit of work now: how many buys are in, out of the count this round drew.
        const round = w.roundBuys ? `${w.roundBuys}/${w.roundTarget} buys` : 'new round';
        list.append(h('div', { class: 'rec-row' },
          h('div', {},
            h('b', {}, w.short),
            h('small', {}, `${w.balanceSol == null ? '—' : sol(w.balanceSol, 4)} SOL · ${sol(w.spentSol, 4)} of volume${w.bumps ? ` · ${w.bumps} bump${w.bumps === 1 ? '' : 's'}` : ''} · ${round}${w.stuck ? ' · parked' : ''}`)),
          h('div', { class: 'row-actions' },
            w.active === false ? h('span', { class: 'pill' }, 'idle - outside the plan') : null,
            w.holdingSol ? h('span', { class: 'pill live' }, `bag ${sol(w.holdingSol, 4)}`) : null,
            w.sellsIn != null ? h('span', { class: 'pill' }, `sells in ${w.sellsIn}s`) : null,
            w.active === false ? null : h('span', { class: 'pill' }, `${spentPct}%`),
            // RULE ADDED 2026-11-09 (1.1.2): every wallet can be rescued on its own - sell whatever it holds and take back the
            // rent of its empty token accounts - so a jam is one press away from being cleared without touching the pool.
            h('button', { class: 'btn small', title: 'Sell whatever this wallet holds and take back the rent of its empty token accounts', onclick: async () => {
              try {
                const r = await call(api.bumpRescue(w.address));
                const held = r.sold ? 'bag sold' : r.unknown ? 'the chain could not be asked what it holds, so nothing was sold' : (r.attempted ? 'the bag is still there, nothing was sold' : 'nothing held');
                toast(`Rescued ${r.short}: ${held}${r.topUpSol ? `, ${sol(r.topUpSol, 4)} SOL put back for its fee` : ''}${r.closed ? `, ${r.closed} account(s) closed, ${sol(r.rentSol, 4)} SOL back` : ''}${r.unparked ? ', wallet unparked' : ''}${r.errors.length ? ` - ${r.errors.join('; ')}` : ''}`, r.errors.length > 0);
              } catch (err) { toast(err.message, true); }
            } }, 'Rescue'))));
      }
    }
    const stats = clear($('#bumpStats'));
    const s = st.stats;
    const tile = (label, value, sub) => h('div', { class: 'card stat' }, h('label', {}, label), h('b', {}, value), h('small', {}, sub));
    stats.append(
      tile('Bumps', String(s.bumps), `${s.buys} buys · ${s.sells} sells`),
      tile('Buy share', s.buySharePct == null ? '—' : `${s.buySharePct}%`, 'of the transactions sent'),
      tile('Pace', s.rate ? `${s.rate}/min` : '—', st.estimate ? `${st.estimate.bumps || 0} in the plan` : ''),
      tile('Volume pushed', `${s.volumeSol.toFixed(3)} SOL`, 'both sides counted'),
      tile('Money moved', `${s.spentSol.toFixed(4)} SOL`, `${st.inPlaySol.toFixed(4)} SOL still in bags`),
      tile('Fees paid', `${s.feesSol.toFixed(4)} SOL`, s.errors ? `${s.errors} refused` : 'nothing refused'),
    );
    const last = $('#bumpLast');
    if (last) last.textContent = st.waiting || st.lastLine || '';
    if (last) last.classList.toggle('warn', Boolean(st.waiting));
    const startBtn = $('#bumpStartBtn span');
    if (startBtn) startBtn.textContent = st.running ? 'Running' : st.simulate ? 'Start the dry run' : 'Start bumping';
    $('#bumpStartBtn').disabled = st.running;
    $('#bumpPauseBtn').textContent = st.paused ? 'Resume' : 'Pause';
    $('#bumpPauseBtn').disabled = !st.running;
    $('#bumpStopBtn').disabled = !st.running;
  }

  const bumpRun = async (fn, okMsg) => {
    try {
      const out = await fn();
      if (okMsg) toast(typeof okMsg === 'function' ? okMsg(out) : okMsg);
      const r = await api.bumpState();
      if (r && r.ok) paintBump(r.data);
      refreshBumpEstimate();
      return out;
    } catch (e) { toast(e.message, true); return null; }
  };

  $('#bumpCreateBtn').addEventListener('click', async () => {
    // RULE CHANGED 2026-11-11 (1.1.5): the count is the number IN THE BOX, not the one last saved. Typing 3 and pressing
    // this button used to make as many wallets as the old setting said (the owner: "wpisałem 3 ... zrobiło 2 adresy"), and
    // the plan went on saying 2 because the setting was never written. Now the box is read, saved, and only then used.
    const box = $('#bumpSliders [data-key="bumpWallets"]');
    const typed = Number(box ? box.value : settings && settings.bumpWallets);
    const count = Math.max(2, Math.min(40, Math.round(Number.isFinite(typed) && typed > 0 ? typed : 6)));
    if (!settings || settings.bumpWallets !== count) {
      settings = { ...settings, bumpWallets: count };
      try { settings = await call(api.setSettings({ bumpWallets: count })); } catch (e) { toast(e.message, true); return; }
    }
    const pw = await askPassword('Create the bump wallets', `${count} new wallets are generated on this computer, plus the desk address you top up, all sealed with your wallet password. This is a real key pair per wallet - the tokens they buy stay theirs, and "Withdraw everything" is how the SOL comes home.`, 'Create');
    if (!pw) return;
    // The answer says what really happened: a pool that already holds more addresses keeps them (nothing is ever deleted
    // by this button), so "created 0 of 3" must not be dressed up as "wallets created".
    await bumpRun(() => call(api.bumpCreate(count, pw)), (out) => {
      const have = out && out.addresses ? out.addresses.length : count;
      const made = out ? out.created || 0 : 0;
      return made
        ? `${made} wallet${made === 1 ? '' : 's'} created - the pool holds ${have}. Send SOL to the desk address, then press Fund the pool.`
        : `Nothing new to create: the pool already holds ${have} address${have === 1 ? '' : 'es'}, which covers the ${count} you asked for. Send SOL to the desk address, then press Fund the pool.`;
    });
  });
  $('#bumpCopyVaultBtn').addEventListener('click', async () => {
    const addr = $('#bumpVaultAddr').value;
    if (!addr) { toast('The desk address is created with the wallets.', true); return; }
    try { await navigator.clipboard.writeText(addr); toast('Desk address copied.'); } catch (_) { $('#bumpVaultAddr').select(); toast('Select and copy the address above.'); }
  });
  $('#bumpTopUpBtn').addEventListener('click', async () => {
    const budget = Number(settings && settings.bumpBudgetSol) || 0.02;
    const yes = await confirmBox('Top up the desk address?', `${sol(budget, 3)} SOL moves from your wallet into the desk address, which then splits it across the wallets.`, 'Move it');
    if (!yes) return;
    await bumpRun(() => call(api.bumpDeposit(budget)), (o) => `${sol(o.sol, 4)} SOL moved to the desk address. Now press Fund the pool.`);
  });
  $('#bumpUnlockBtn').addEventListener('click', async () => {
    const pw = await askPassword('Unlock the bump wallets', 'Their keys are sealed with your wallet password. They are only ever held in memory while this window is open.', 'Unlock');
    if (!pw) return;
    await bumpRun(() => call(api.bumpUnlock(pw)), 'Bump wallets unlocked.');
  });
  $('#bumpLockBtn').addEventListener('click', () => bumpRun(() => call(api.bumpLock()), 'Bump wallets locked.'));
  /** What the delete press actually recovered, built only from what the chain confirmed. */
  const deleteLine = (r) => {
    const parts = [];
    if (r && r.sold) parts.push(`${r.sold} bag${r.sold === 1 ? '' : 's'} sold`);
    if (r && r.closed) parts.push(`${r.closed} token account${r.closed === 1 ? '' : 's'} closed (${sol(r.rentSol, 4)} SOL of rent back)`);
    if (r && r.returnedSol) parts.push(`${sol(r.returnedSol, 4)} SOL brought home`);
    return parts.length ? `Bump wallet keys deleted: ${parts.join(', ')}.` : 'Bump wallet keys deleted.';
  };

  $('#bumpForgetBtn').addEventListener('click', async () => {
    // RULE CHANGED 2026-11-10 (1.1.4): deleting now DOES the recovery instead of refusing until the operator has done it by
    // hand - every bag sold, every token account's rent back, every lamport home, then the keys. The second confirmation only
    // appears when something genuinely cannot be moved, and it names exactly what is being left on chain.
    const yes = await confirmBox('Delete the bump wallet keys?', 'Before the keys go, the desk sells whatever the wallets still hold, closes their empty token accounts so the rent comes back, and sends every lamport home to your wallet. Only then are the keys removed.', 'Delete the keys', true);
    if (!yes) return;
    // RULE ADDED 2026-11-11 (1.1.5): the password. This is the one press in the app that nothing can undo, and a desk that
    // was left unlocked must not be enough to do it.
    const pw = await askPassword('Delete the bump wallet keys', 'Your wallet password unlocks the keys so the desk can sell what is left, take the rent back and send the SOL home. It is the same password the wallets were created with.', 'Delete the keys');
    if (!pw) return;
    try {
      const out = await call(api.bumpForget(false, pw));
      toast(deleteLine(out.recovered), false);
    } catch (e) {
      if (e.code !== 'DELETE_NEEDS_FORCE') { toast(e.message, true); return; }
      const yes2 = await confirmBox('Nothing could be moved - delete anyway?', e.message, 'Delete the keys anyway', true);
      if (!yes2) return;
      try {
        const out = await call(api.bumpForget(true, pw));
        toast(deleteLine(out.recovered) + ' What could not be moved stays on chain, reachable only with the keys you just deleted.', true);
      } catch (e2) { toast(e2.message, true); }
    }
    const r = await api.bumpState();
    if (r && r.ok) paintBump(r.data);
    refreshBumpEstimate();
  });
  $('#bumpFundBtn').addEventListener('click', async () => {
    const budget = Number(settings && settings.bumpBudgetSol) || 0;
    const yes = await confirmBox('Fund the pool?', `${sol(budget, 3)} SOL ends up split across the bump wallets. If the desk address is short, the difference comes out of your wallet in the same press. You can take it all back with "Withdraw everything".`, 'Fund it');
    if (!yes) return;
    await bumpRun(() => call(api.bumpFund()), (o) => (o && o.alreadyFunded ? 'The pool is already funded.' : `Split ${sol(o.sol, 4)} SOL across ${o.funded} wallets.`));
  });
  $('#bumpStartBtn').addEventListener('click', () => bumpRun(() => call(api.bumpStart()), 'Bump desk started.'));
  $('#bumpPauseBtn').addEventListener('click', () => bumpRun(() => call(BS && BS.paused ? api.bumpResume() : api.bumpPause()), (o) => (BS && BS.paused ? 'Running again.' : 'Paused.')));
  $('#bumpStopBtn').addEventListener('click', async () => {
    const yes = await confirmBox('Stop the bump desk?', 'Every bag still open is sold back first, so the SOL returns to the bump wallets (and "Withdraw everything" brings it home).', 'Stop');
    if (!yes) return;
    await bumpRun(() => call(api.bumpStop(true)), (o) => `Stopped after ${o.bumps} bumps${o.soldBack ? `, ${o.soldBack} bag${o.soldBack === 1 ? '' : 's'} sold back` : ''}.`);
  });
  $('#bumpSweepBtn').addEventListener('click', async () => {
    const yes = await confirmBox('Withdraw everything?', 'Any bag still open is sold, the emptied token accounts are closed so their rent comes back, and every lamport left in the bump wallets is sent to your main wallet.', 'Withdraw');
    if (!yes) return;
    // The toast repeats only what the chain confirmed: what came out of the pool, what reached the wallet, and the
    // rent-free floor a Solana wallet cannot be emptied below (it stays in the desk address and the next run spends it).
    await bumpRun(() => call(api.bumpSweep(true)), (o) => {
      const parts = [`${sol(o.returnedSol, 4)} SOL came back from the pool`];
      if (o.toWalletSol) parts.push(`${sol(o.toWalletSol, 5)} SOL is in your wallet`);
      if (o.closed) parts.push(`${o.closed} empty token account${o.closed === 1 ? '' : 's'} closed`);
      if (o.dustSol) parts.push(`${sol(o.dustSol, 5)} SOL stays in the desk address (a wallet cannot be emptied below its rent-free floor - it is still yours)`);
      const stuck = (o.stuck || []).length;
      return parts.join(' · ') + '.' + (stuck ? ` ${stuck} transfer${stuck === 1 ? '' : 's'} did not go through - the log has the reason.` : '');
    });
  });
  api.onBump((st) => { if (st) paintBump(st); });

  // ───────── onboarding ─────────
  const TOUR = [
    ['Welcome to PillCrew', 'This app watches every new coin on Pump.fun for you, picks the strong ones and trades automatically. No experience needed.'],
    ['Practice first', 'You start in Practice Mode with fake SOL. Press Start on the Dashboard and watch how the bot behaves. Nothing real is at risk.'],
    ['Your own wallet', 'In the Wallet tab you create a wallet that lives only on this computer. Deposit a little SOL and back up your private key.'],
    ['Know the risk', 'Meme coins are very risky and most lose value. Only trade with money you can afford to lose, and begin with the Safe style.'],
  ];
  function tour() {
    let i = 0;
    return modal((box, close) => {
      const draw = () => {
        clear(box);
        box.append(h('div', { class: 'steps' }, TOUR.map((_, n) => h('i', { class: n <= i ? 'on' : '' }))), h('h2', {}, TOUR[i][0]), h('p', {}, TOUR[i][1]),
          h('div', { class: 'modal-actions' },
            i > 0 ? h('button', { class: 'btn ghost', onclick: () => { i--; draw(); } }, 'Back') : h('button', { class: 'btn ghost', onclick: () => close() }, 'Skip'),
            h('button', { class: 'btn', onclick: () => { if (i < TOUR.length - 1) { i++; draw(); } else close(); } }, i < TOUR.length - 1 ? 'Next' : 'Get started')));
      };
      draw();
    });
  }
  $('#replayTour').addEventListener('click', () => tour());

  // ───────── THE COUNCIL: the chat panel (1.2.0) ─────────
  // Ported from PillyDesktop at the owner's request ("czat na górze ... po co nam dwa programy"). Everything here is text:
  // the keys travel IN to the endpoint the operator named, an answer travels back, and neither ever reaches a wallet.
  const CHAT = { log: [], tiers: [], busy: false };
  const TIER_ROWS = (list) => (Array.isArray(list) && list.length ? list : [
    { label: 'DeepSeek', url: 'https://api.deepseek.com/chat/completions', key: '', model: 'deepseek-chat', on: true },
    { label: 'OpenRouter (free)', url: 'https://openrouter.ai/api/v1/chat/completions', key: '', model: 'nvidia/nemotron-3.5-lightning:free', on: true },
    { label: 'your own endpoint', url: '', key: '', model: '', on: false },
  ]);

  function chatRender() {
    const log = clear($('#chatLog'));
    if (!CHAT.log.length) {
      log.append(h('div', { class: 'hint' }, 'Ask anything about a coin, a number, or your plan. The answer comes from the models you set up, on your own key.'));
    }
    for (const m of CHAT.log) {
      // The per-model list is only worth drawing when there is more than one voice, or when a voice disagreed: with a single
      // model the read and the only answer are the same sentence twice, which is what "the chat repeats itself" looked like.
      const others = Array.isArray(m.answers) ? m.answers : [];
      const worthListing = others.length > 1 || (others.length === 1 && !others[0].ok);
      log.append(h('div', { class: `chat-msg ${m.role}` },
        h('div', { class: 'chat-who' }, m.role === 'user' ? 'you' : m.who || 'council'),
        h('div', { class: 'chat-text' }, m.text),
        worthListing ? h('div', { class: 'chat-answers' }, others.map((a) => h('div', { class: 'chat-answer ' + (a.ok ? 'ok' : 'bad') },
          h('b', {}, a.label), h('span', {}, a.ok ? String(a.text).slice(0, 400) : `no answer (${a.error || 'refused'})`)))) : null));
    }
    log.scrollTop = log.scrollHeight;
    const note = $('#chatTierNote');
    if (note) {
      const usable = CHAT.tiers.filter((t) => t.on && t.url && t.key && t.model).length;
      note.textContent = usable ? `${usable} endpoint${usable === 1 ? '' : 's'} ready` : 'no endpoint set yet - paste a key on the right';
      note.classList.toggle('warn', !usable);
    }
  }

  function chatTiersRender() {
    const box = clear($('#chatTiers'));
    CHAT.tiers.forEach((t, i) => {
      const row = h('div', { class: 'rec-row chat-tier' },
        h('div', {},
          h('b', {}, t.label || `endpoint ${i + 1}`),
          h('small', {}, t.url ? `${t.model || 'no model'} · ${t.key ? 'key set' : 'no key'}` : 'no endpoint address')),
        h('div', { class: 'row-actions' },
          h('button', { class: 'btn small ghost', title: 'Ask this endpoint one tiny question', onclick: async (ev) => {
            const b = ev.currentTarget;
            b.disabled = true;
            b.textContent = '…';
            try {
              const r = await call(api.aiTest(t));
              toast(r.ok ? `${t.label}: answered in ${r.ms} ms` : `${t.label}: ${r.error || 'no answer'}`, !r.ok);
            } catch (e) { toast(e.message, true); }
            b.disabled = false;
            b.textContent = 'Test';
          } }, 'Test'),
          h('button', { class: 'btn small ghost', title: 'Remove this endpoint', onclick: () => { CHAT.tiers.splice(i, 1); chatSaveTiers(); } }, 'Remove')));
      const field = (label, key, type, placeholder, el) => h('label', { class: 'field' }, h('span', {}, label),
        el || h('input', { type, value: String(t[key] || ''), placeholder, spellcheck: 'false', onchange: (ev) => { t[key] = ev.target.value; chatSaveTiers(); } }));
      // The model box is built by hand so the "find free models" button can fill it in without re-rendering the whole panel -
      // re-rendering threw the freshly filled dropdown away, which is exactly why the list came up empty.
      const modelInput = h('input', { type: 'text', value: String(t.model || ''), placeholder: 'deepseek-chat', spellcheck: 'false', onchange: (ev) => { t.model = ev.target.value; chatSaveTiers(); } });
      const modelSelect = h('select', { style: 'margin-top:6px', onchange: (ev) => {
        if (!ev.target.value) return;
        t.model = ev.target.value;
        modelInput.value = ev.target.value;
        chatSaveTiers();
      } });
      modelSelect.hidden = true;
      const findBtn = h('button', { class: 'btn small ghost find-models', title: 'Ask the provider what it offers and pick its best free model', onclick: async (ev) => {
        const b = ev.currentTarget;
        const was = b.textContent;
        b.disabled = true;
        b.textContent = 'Asking the provider…';
        try {
          const r = await call(api.aiModels(t));
          if (!r || !r.ok) {
            toast(r && r.error ? r.error : 'the provider did not answer', true);
          } else {
            const opts = document.createDocumentFragment();
            for (const m of r.models) opts.append(h('option', { value: m.id }, `${m.id}${m.free ? '  (free)' : ''}`));
            modelSelect.textContent = '';
            modelSelect.append(opts);
            modelSelect.hidden = false;
            if (r.best) {
              t.model = r.best;
              modelInput.value = r.best;
              modelSelect.value = r.best;
              chatSaveTiers();
            }
            toast(r.best
              ? `Picked "${r.best}" — ${r.free.length} free of ${r.models.length} models.`
              : `${r.models.length} models, and none of them free.`);
            // The list stays on the panel: choosing another model is one click, and it saves itself.
          }
        } catch (e) { toast(e.message, true); }
        b.disabled = false;
        b.textContent = was;
      } }, 'Find free models');
      box.append(row,
        h('div', { class: 'grid two' },
          field('Name', 'label', 'text', 'DeepSeek'),
          field('Model', 'model', 'text', 'deepseek-chat', modelInput)),
        field('Endpoint', 'url', 'text', 'https://api.deepseek.com/chat/completions'),
        field('Key (stored on this computer only)', 'key', 'password', 'sk-…'),
        h('label', { class: 'field check' }, h('input', { type: 'checkbox', checked: t.on !== false, onchange: (ev) => { t.on = ev.target.checked; chatSaveTiers(); } }), h('span', {}, 'Ask this one')),
        h('div', { class: 'actions', style: 'margin-top:6px' }, findBtn),
        modelSelect);
    });
  }

  async function chatSaveTiers() {
    try {
      settings = await call(api.setSettings({ aiTiers: CHAT.tiers }));
      chatRender();
    } catch (e) { toast(e.message, true); }
  }

  async function chatAsk() {
    const box = $('#chatInput');
    const text = String(box.value || '').trim();
    if (!text || CHAT.busy) return;
    const usable = CHAT.tiers.filter((t) => t.on && t.url && t.key && t.model).length;
    if (!usable) { toast('Paste a key for at least one endpoint first.', true); return; }
    CHAT.busy = true;
    const btn = $('#chatSend');
    btn.disabled = true;
    box.value = '';
    // A chip's task travels with the turn; the numbers it needs are fetched from the main process, never sent up by the page.
    const task = CHAT.task || '';
    CHAT.task = null;
    chatChipsPaint();
    CHAT.log.push({ role: 'user', text });
    chatRender();
    try {
      // Only the conversation goes out, and only the last turn is needed: the system prompt lives in the main process so a
      // pasted coin name can never rewrite the instructions.
      const r = await call(api.aiAsk([{ role: 'user', content: text }], { task }));
      const said = r.verdict === 'ok' ? r.reason
        : r.verdict === 'veto' ? `VETO: ${r.reason}`
          : r.verdict === 'no-keys' ? r.reason
            : `No model answered. ${(r.answers || []).map((a) => `${a.label}: ${a.error || 'nothing'}`).join('; ')}`;
      CHAT.log.push({ role: 'assistant', who: r.by ? `${r.by} (${r.verdict})` : `council (${r.verdict})`, text: said, answers: r.answers });
    } catch (e) {
      CHAT.log.push({ role: 'assistant', who: 'error', text: e.message });
    }
    CHAT.busy = false;
    btn.disabled = false;
    chatRender();
  }

  // ───────── THE CHAT'S QUICK ACTIONS (1.2.0), ported from Pilly Desktop ─────────
  // A chip either sets the job for the next question ("meme this", "size this") or asks one straight away with the numbers the
  // main process hands over. Nothing on this page decides what a number is: the question and the data both come from there.
  function chatChipsPaint() {
    for (const b of $$('#chatChips .chip')) {
      b.classList.toggle('on', Boolean(CHAT.task) && b.dataset.task === CHAT.task);
    }
  }
  async function chatChip(kind, task) {
    if (CHAT.busy) { toast('One question at a time — the council is still answering.', true); return; }
    if (task) {
      CHAT.task = CHAT.task === task ? null : task;
      chatChipsPaint();
      const box = $('#chatInput');
      if (CHAT.task && box) {
        box.focus();
        toast(`“${task}” is armed: type the text and press Ask.`);
      }
      return;
    }
    CHAT.busy = true;
    if ($('#chatSend')) $('#chatSend').disabled = true;
    // The question and the numbers both come from the main process: the page only says which chip was pressed.
    const spec = await call(api.aiContext(kind)).catch(() => null);
    const question = (spec && spec.question) || `Tell me about this: ${kind}.`;
    CHAT.log.push({ role: 'user', text: question });
    chatRender();
    try {
      const r = await call(api.aiAsk([{ role: 'user', content: question }], { task: '', context: (spec && spec.context) || '' }));
      const said = r.verdict === 'ok' ? r.reason : r.verdict === 'veto' ? `VETO: ${r.reason}` : r.verdict === 'no-keys' ? r.reason : `No model answered. ${(r.answers || []).map((a) => `${a.label}: ${a.error || 'nothing'}`).join('; ')}`;
      CHAT.log.push({ role: 'assistant', who: r.by ? `${r.by} (${r.verdict})` : `council (${r.verdict})`, text: said, answers: r.answers });
    } catch (e) {
      CHAT.log.push({ role: 'assistant', who: 'error', text: e.message });
    }
    CHAT.busy = false;
    if ($('#chatSend')) $('#chatSend').disabled = false;
    chatRender();
  }
  for (const b of $$('#chatChips .chip')) {
    b.addEventListener('click', () => {
      if (b.dataset.task) chatChip(b.dataset.action || b.dataset.task, b.dataset.task);
      else chatChip(b.dataset.action, null);
    });
  }

  // The look: five bubble styles and three text sizes, applied to the log the moment they are saved.
  function chatLookApply() {
    const log = $('#chatLog');
    if (!log || !settings) return;
    log.classList.remove('bs-sharp', 'bs-rounded', 'bs-glass', 'bs-neon', 'bs-minimal', 'fs-sm', 'fs-lg');
    log.classList.add(`bs-${settings.aiBubble || 'sharp'}`);
    if (settings.aiFont === 'sm') log.classList.add('fs-sm');
    if (settings.aiFont === 'lg') log.classList.add('fs-lg');
    const bub = $('#chatBubbleStyle');
    const font = $('#chatFontSize');
    const lang = $('#chatLanguage');
    const top = $('#chatOnTop');
    if (bub) bub.value = settings.aiBubble || 'sharp';
    if (font) font.value = settings.aiFont || 'normal';
    if (lang) lang.value = settings.aiLanguage || 'auto';
    if (top) top.checked = Boolean(settings.aiOnTop);
  }
  // The look is visible the moment it is changed, not only after saving. Built without the selector helper so nothing here can
  // shadow it: this file has one `$` and a helper called before it exists throws at load.
  const relookNow = () => {
    const logEl = document.getElementById('chatLog');
    if (!logEl) return;
    const bubEl = document.getElementById('chatBubbleStyle');
    const fontEl = document.getElementById('chatFontSize');
    logEl.classList.remove('bs-sharp', 'bs-rounded', 'bs-glass', 'bs-neon', 'bs-minimal', 'fs-sm', 'fs-lg');
    logEl.classList.add('bs-' + ((bubEl && bubEl.value) || 'sharp'));
    if (fontEl && fontEl.value === 'sm') logEl.classList.add('fs-sm');
    if (fontEl && fontEl.value === 'lg') logEl.classList.add('fs-lg');
  };
  const bubSel = document.getElementById('chatBubbleStyle');
  const fontSel = document.getElementById('chatFontSize');
  if (bubSel) bubSel.addEventListener('change', relookNow);
  if (fontSel) fontSel.addEventListener('change', relookNow);

  $('#chatSaveLook')?.addEventListener('click', async () => {
    try {
      settings = await call(api.setSettings({
        aiBubble: $('#chatBubbleStyle')?.value || 'sharp',
        aiFont: $('#chatFontSize')?.value || 'normal',
        aiLanguage: $('#chatLanguage')?.value || 'auto',
        aiOnTop: Boolean($('#chatOnTop')?.checked),
      }));
      chatLookApply();
      toast('The chat’s look is saved.');
    } catch (e) { toast(e.message, true); }
  });

  $('#winResetBtn')?.addEventListener('click', async () => {
    try { await call(api.windowReset()); toast('The window is back in the middle of the screen.'); } catch (e) { toast(e.message, true); }
  });

  $('#chatSend').addEventListener('click', chatAsk);
  $('#chatInput').addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); chatAsk(); } });
  $('#chatClear').addEventListener('click', () => { CHAT.log = []; chatRender(); });
  $('#chatAddTier').addEventListener('click', () => {
    if (CHAT.tiers.length >= 6) { toast('Six endpoints is the ceiling.', true); return; }
    CHAT.tiers.push({ label: 'my endpoint', url: '', key: '', model: '', on: true });
    chatTiersRender();
  });
  $('#chatSaveSystem').addEventListener('click', async () => {
    try {
      settings = await call(api.setSettings({ aiSystem: $('#chatSystem').value }));
      toast('The instructions are saved.');
    } catch (e) { toast(e.message, true); }
  });
  function chatBoot() {
    CHAT.tiers = TIER_ROWS(settings && settings.aiTiers).map((t) => ({ ...t }));
    chatTiersRender();
    const sys = $('#chatSystem');
    if (sys) sys.value = String((settings && settings.aiSystem) || '');
    chatLookApply();
    chatChipsPaint();
    chatRender();
  }

  // ───────── PILLY ON SCREEN (1.2.0): the full mascot configuration ─────────
  // Every field saves through one channel (`pet:apply`), which also applies it to the window that is already walking — a size
  // change resizes him, a speed change is felt in the next tick. The toggle is the only thing that is not a setting of his
  // behaviour; it puts him on the desktop or takes him off it.
  const PET_FIELDS = () => $$('#petCard [data-pet]');
  function fillPetForm(pet) {
    for (const el of PET_FIELDS()) {
      const key = el.dataset.pet;
      if (!(key in pet)) continue;
      if (el.type === 'checkbox') el.checked = pet[key] !== false;
      else el.value = String(pet[key] == null ? '' : pet[key]);
    }
  }
  function readPetForm() {
    const patch = {};
    for (const el of PET_FIELDS()) {
      const key = el.dataset.pet;
      if (el.type === 'checkbox') patch[key] = el.checked;
      else if (el.type === 'number') patch[key] = Number(el.value);
      else patch[key] = el.value;
    }
    return patch;
  }
  async function paintPet() {
    const note = $('#petNote');
    const btn = $('#petToggleBtn span');
    try {
      const s = await call(api.petState());
      const on = Boolean(s && s.on);
      if (note) note.textContent = on ? 'on screen' : 'off';
      if (btn) btn.textContent = on ? 'Put Pilly away' : 'Put Pilly on screen';
      if (s && s.pet) fillPetForm(s.pet);
    } catch (_) { /* the note keeps its last value */ }
  }
  $('#petToggleBtn').addEventListener('click', async () => {
    try {
      const r = await call(api.petToggle());
      toast(r && r.on ? 'Pilly is on your desktop. Drag him wherever you want him to stay.' : 'Pilly is off the screen.');
      paintPet();
    } catch (e) { toast(e.message, true); }
  });
  $('#petSaveBtn').addEventListener('click', async () => {
    try {
      const r = await call(api.petApply(readPetForm()));
      toast('Pilly’s settings are saved.');
      if (r && r.pet) fillPetForm(r.pet);
    } catch (e) { toast(e.message, true); }
  });

  // ───────── THE WATCHLIST AND HIS SCORECARD (1.2.0) ─────────
  // Two lists in the PillCrew tab. Both re-read on every state tick, so a win that settles while the window is open appears
  // without pressing anything.
  async function paintPicks() {
    try {
      const r = await call(api.picksStats());
      const s = (r && r.stats) || { total: 0, wins: 0, losses: 0, winRate: null, open: 0 };
      const set = (id, v) => { const el = $('#' + id); if (el) el.textContent = String(v); };
      set('picksTotal', s.total);
      set('picksWins', s.wins);
      set('picksLosses', s.losses);
      set('picksRate', s.winRate == null ? '—' : `${s.winRate}%`);
      const note = $('#picksNote');
      if (note) note.textContent = s.total === 0 ? 'no picks yet' : `${s.open} open · best ${s.best ? `${s.best.symbol || '—'} ${pctText(s.best.pct)}` : '—'}`;
      const box = $('#picksList');
      if (box) {
        box.textContent = '';
        for (const p of (r && r.picks) || []) {
          const row = document.createElement('div');
          row.className = 'rec';
          const sym = document.createElement('span'); sym.className = 'sym'; sym.textContent = p.symbol || `${String(p.mint).slice(0, 4)}…`;
          const src = document.createElement('span'); src.className = 'grow'; src.textContent = `${p.source} · ${new Date(p.ts).toLocaleTimeString()}`;
          const num = document.createElement('span');
          num.className = `num ${p.result === 'win' ? 'win' : p.result === 'loss' ? 'loss' : ''}`;
          num.textContent = p.result === null ? 'open' : `${pctText(p.pct)} ${p.result}`;
          row.append(sym, src, num);
          box.append(row);
        }
      }
    } catch (_) { /* a scorecard that cannot be read is not a crash */ }
  }

  async function paintWatch() {
    try {
      const r = await call(api.watchList());
      const items = Array.isArray(r) ? r : [];
      const note = $('#watchNote');
      if (note) note.textContent = items.length ? `${items.length} watched` : 'nothing watched';
      const box = $('#watchList');
      if (!box) return;
      box.textContent = '';
      for (const it of items) {
        const row = document.createElement('div');
        row.className = 'rec';
        const sym = document.createElement('span'); sym.className = 'sym'; sym.textContent = it.symbol || `${String(it.mint).slice(0, 4)}…`;
        const mint = document.createElement('span'); mint.className = 'grow'; mint.textContent = it.mint;
        const bar = document.createElement('span'); bar.className = 'num'; bar.textContent = it.alertPct ? `±${it.alertPct}% / 5m` : 'no alert';
        const del = document.createElement('button'); del.className = 'mini'; del.textContent = 'Remove';
        del.addEventListener('click', async () => {
          try { await call(api.watchRemove(it.mint)); paintWatch(); } catch (e) { toast(e.message, true); }
        });
        row.append(sym, mint, bar, del);
        box.append(row);
      }
    } catch (_) { /* ignore */ }
  }

  $('#watchAddBtn')?.addEventListener('click', async () => {
    const mint = ($('#watchMint')?.value || '').trim();
    const alert = Number($('#watchPct')?.value);
    if (!mint) return toast('Paste a token address first.', true);
    try {
      await call(api.watchAdd(mint, '', ''));
      if (Number.isFinite(alert) && alert > 0) await call(api.watchAlert(mint, alert));
      if ($('#watchMint')) $('#watchMint').value = '';
      toast('Watching it. Pilly will shout when the 5-minute move passes your bar.');
      paintWatch();
    } catch (e) { toast(e.message, true); }
  });


  api.onState(applyState);
  // Pilly's bubble is clickable when it carries an alert: a tap brings the window forward on the Chat tab.
  if (api.onTab) api.onTab((name) => { if (name) showTab(name); });
  // The two PillCrew lists are cheap and file-backed: they are re-read when the tab opens (see `showTab`) and after every
  // state tick while it is open, so a pick that settles shows up on its own.
  const paintCrew = () => { if (tab === 'crew') { paintPicks(); paintWatch(); } };
  api.onState(() => paintCrew());
  // to paint, so it is skipped exactly like the rest of the panels.
  if (api.onPositions) api.onPositions((list) => { if (!document.hidden) paintPositions(list); });
  api.onLog(() => {});
  (async () => {
    try {
      settings = await call(api.getSettings());
      wallet = await call(api.walletStatus());
      if (!settings.onboarded) { await tour(); settings = await call(api.setSettings({ onboarded: true })); }
    } catch (e) {
      toast(e.message, true);
    } finally {
      // The button is disabled in the markup so a click during the first second cannot be swallowed while the
      // settings are still loading. It comes alive once the app knows what it is doing.
      const btn = $('#startBtn');
      btn.disabled = false;
      btn.removeAttribute('title');
      if (tab === 'settings') renderSettings();
      chatBoot();
      paintPet();
    }
  })();
})();
