// Pilly chat window logic.
(function () {
  const messagesEl = document.getElementById("messages");
  const scrollDownBtn = document.getElementById("scrollDown");
  const form = document.getElementById("chatForm");
  const input = document.getElementById("input");
  const sendBtn = document.getElementById("sendBtn");
  const pill = document.getElementById("pillAvatar");
  const chips = document.getElementById("chips");

  const settingsEl = document.getElementById("settings");
  const tierRowsEl = document.getElementById("tierRows");
  const setTemp = document.getElementById("setTemp");
  const setTokens = document.getElementById("setTokens");
  const petTheme = document.getElementById("petTheme");
  const petSize = document.getElementById("petSize");
  const petBubbles = document.getElementById("petBubbles");
  const petBubbleSize = document.getElementById("petBubbleSize");
  const petWalkMode = document.getElementById("petWalkMode");
  const petStopFreq = document.getElementById("petStopFreq");
  const petQuestions = document.getElementById("petQuestions");
  const settingsStatus = document.getElementById("settingsStatus");

  const history = []; // [{ role, content }] for context (capped)

  const WELCOME_HTML = "Yo. I'm Pilly - the pill living in your taskbar. Tap the tray icon anytime. Paste a <em>Solana token address</em> (or a pump.fun link) and I'll pull its live data and give you a pro read. Try <em>🔥 trending</em>, <em>meme this</em>, <em>caption this</em> - or just talk.";

  // Free-text questions that should pull the live trending feed instead of a generic reply.
  const TRENDING_INTENT = /(trending|what'?s hot|hot right now|top (coins|tokens)|what (should|can|do) i (buy|check|pick|watch)|co (kupić|kupic|polecasz|poleci|poleć|słuchać|slychac|jest (gorące|gorace))|pick (a )?(coin|token|winner)|losuj|roast (the )?(list|trending)|daj (mi )?trend)/i;

  // Meme prompt prefixes (synced from pilly.js via IPC at startup).
  const MEME_PREFIX = {
    rewrite: "meme this: ",
    caption: "caption this: ",
    name: "give me an absurd name for this: ",
    react: "react to this: ",
    roast: "roast this lightly: ",
  };
  window.pilly.memePrompts().then((p) => {
    if (p) Object.assign(MEME_PREFIX, p);
  }).catch(() => {});

  // ---- helpers ----
  function isNearBottom() {
    return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 60;
  }

  // Only follow new messages when the user is already near the bottom, so
  // reading history is never interrupted by an incoming message.
  function scrollToBottom(force) {
    if (force || isNearBottom()) messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function addEl(className) {
    const m = document.createElement("div");
    m.className = className;
    messagesEl.appendChild(m);
    scrollToBottom(true); // coin/trending cards are Pilly's output - follow them
    persistChat();
    return m;
  }

  function addMsg(role, html) {
    const m = document.createElement("div");
    m.className = "msg " + role;
    const b = document.createElement("div");
    b.className = "bubble";
    b.innerHTML = html;
    m.appendChild(b);
    messagesEl.appendChild(m);
    // A new Pilly reply always brings the view to the latest message (the
    // scroll-down button still jumps you back when reading older history).
    if (role.indexOf("bot") === 0) scrollToBottom(true);
    else scrollToBottom();
    persistChat();
    return m;
  }

  function addTyping() {
    const m = document.createElement("div");
    m.className = "msg bot";
    const b = document.createElement("div");
    b.className = "bubble";
    b.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
    m.appendChild(b);
    messagesEl.appendChild(m);
    scrollToBottom();
    return m;
  }

  // Keep the conversation across minimize / restarts - the tray window can be
  // recreated by the OS, but the chat should never start empty.
  const CHAT_KEY = "pilly_chat_history_v1";
  function persistChat() {
    try {
      const msgs = Array.from(messagesEl.querySelectorAll(".msg")).map((m) => m.outerHTML);
      localStorage.setItem(CHAT_KEY, JSON.stringify(msgs));
    } catch (e) { /* ignore */ }
  }
  function restoreChat() {
    try {
      const raw = localStorage.getItem(CHAT_KEY);
      if (!raw) return false;
      const msgs = JSON.parse(raw);
      if (!Array.isArray(msgs) || !msgs.length) return false;
      messagesEl.innerHTML = msgs.join("");
      // Restored coin images get the same broken-image cleanup as fresh ones.
      messagesEl.querySelectorAll(".cc-img").forEach((img) =>
        img.addEventListener("error", () => img.remove(), { once: true })
      );
      scrollToBottom(true);
      return true;
    } catch (e) {
      return false;
    }
  }

  function clearChat() {
    messagesEl.querySelectorAll(".msg").forEach((m) => m.remove());
    history.length = 0;
    try { localStorage.removeItem(CHAT_KEY); } catch (e) { /* ignore */ }
    addMsg("bot", WELCOME_HTML);
    scrollDownBtn.hidden = true;
    input.focus();
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // Pet themes - shared with the chat avatar so Pilly looks the same in both.
  const PET_THEMES = {
    green: { c1: "#22c55e", c2: "#34d399", c3: "#6366f1", glow: "rgba(34,197,94,0.45)" },
    blue: { c1: "#3b82f6", c2: "#38bdf8", c3: "#8b5cf6", glow: "rgba(59,130,246,0.45)" },
    purple: { c1: "#8b5cf6", c2: "#a78bfa", c3: "#ec4899", glow: "rgba(139,92,246,0.45)" },
    pink: { c1: "#ec4899", c2: "#f472b6", c3: "#fbbf24", glow: "rgba(236,72,153,0.45)" },
    orange: { c1: "#f97316", c2: "#fbbf24", c3: "#ef4444", glow: "rgba(249,115,22,0.45)" },
  };
  function applyPetTheme(pet) {
    const t = (pet && PET_THEMES[pet.theme]) || PET_THEMES.green;
    const rs = document.documentElement.style;
    rs.setProperty("--c1", t.c1);
    rs.setProperty("--c2", t.c2);
    rs.setProperty("--c3", t.c3);
    rs.setProperty("--glow", t.glow);
  }

  function setThinking(on) {
    pill.classList.toggle("thinking", on);
    sendBtn.disabled = on;
  }

  const fmtUsd = (v) => {
    const n = Number(v);
    if (!isFinite(n) || n <= 0) return "-";
    if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
    if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
    if (n >= 1) return `$${n.toFixed(4)}`;
    const dec = Math.min(8, Math.max(2, Math.ceil(-Math.log10(n)) + 2));
    return `$${n.toFixed(dec)}`;
  };
  const fmtPct = (v) => (v == null || !isFinite(Number(v)) ? "" : `${v >= 0 ? "▲ +" : "▼ "}${Math.abs(v).toFixed(1)}%`);

  // Solana mint detection (bare address or pump.fun/jup link). Same leniency as
  // the web platform: any alphanumeric 32-44 char run counts as a candidate so
  // valid addresses that don't look base58-strict (all-lowercase, unusual
  // letters) still get tried - and fail gracefully if they aren't real coins.
  function detectMint(text) {
    const s = String(text || "");
    const link = s.match(/https?:\/\/[^\s]+?\/(?:coin|tokens?|token)\/([A-Za-z0-9]{32,44})/i);
    if (link) return link[1];
    const bare = s.match(/\b([A-Za-z0-9]{32,44})\b/);
    return bare ? bare[1] : null;
  }

  function addCoinCard(coin) {
    const card = addEl("msg bot");
    const up = coin.change24h == null || coin.change24h >= 0;
    const parts = [];
    if (coin.image) parts.push(`<img class="cc-img" src="${escapeHtml(coin.image)}" />`);
    parts.push(`<div class="cc-main"><strong>${escapeHtml(coin.name)}</strong>${coin.symbol ? ` <span class="cc-sym">${escapeHtml(coin.symbol)}</span>` : ""}</div>`);
    parts.push(`<div class="cc-price ${up ? "up" : "down"}">${coin.price != null ? fmtUsd(coin.price) : "-"}</div>`);
    card.innerHTML = `<div class="coin-card"><div class="cc-top">${parts.join("")}<div class="cc-side">${
      coin.mcap != null ? `<div class="cc-stat">mcap <b>${fmtUsd(coin.mcap)}</b></div>` : ""
    }${coin.change24h != null ? `<div class="cc-stat">24h <b class="${up ? "up" : "down"}">${fmtPct(coin.change24h)}</b></div>` : ""}</div></div><div class="cc-grid">${
      coin.volume24h != null ? `<div class="cc-stat">vol <b>${fmtUsd(coin.volume24h)}</b></div>` : ""
    }${coin.liquidityUsd != null ? `<div class="cc-stat">liq <b>${fmtUsd(coin.liquidityUsd)}</b></div>` : ""}${
      coin.age ? `<div class="cc-stat">age <b>${coin.age}</b></div>` : ""
    }${coin.buys24h != null && coin.sells24h != null ? `<div class="cc-stat">txns <b>${Number(coin.buys24h).toLocaleString()}B/${Number(coin.sells24h).toLocaleString()}S</b></div>` : ""}${
      coin.organicScore != null ? `<div class="cc-stat">organic <b>${coin.organicScore}/100</b></div>` : ""
    }</div></div>`;
    const img = card.querySelector(".cc-img");
    if (img) img.addEventListener("error", () => img.remove(), { once: true });
  }

  function addTrendingCard(list) {
    const card = addEl("msg bot");
    const rows = list.slice(0, 10).map((c, i) => {
      const up = c.change24h == null || c.change24h >= 0;
      return `<div class="tr-row"><span class="tr-rank">${i + 1}</span><span class="tr-name">${escapeHtml(c.name)}${c.symbol ? ` <em>${escapeHtml(c.symbol)}</em>` : ""}</span><span class="tr-price">${c.price != null ? fmtUsd(c.price) : "-"}</span><span class="tr-chg ${up ? "up" : "down"}">${fmtPct(c.change24h)}</span><span class="tr-mcap">${c.mcap != null ? fmtUsd(c.mcap) : "-"}${c.volume24h != null ? `<small>vol ${fmtUsd(c.volume24h)}</small>` : ""}</span></div>`;
    }).join("");
    card.innerHTML = `<div class="trend-card"><div class="tr-head">🔥 Trending on Solana</div><div class="tr-headrow"><span class="tr-rank">#</span><span class="tr-name">Coin</span><span class="tr-price">Price</span><span class="tr-chg">24h</span><span class="tr-mcap">Mkt Cap<small>vol</small></span></div>${rows}</div>`;
  }

  function addWalletCard(w) {
    const card = addEl("msg bot");
    const short = `${String(w.wallet || "").slice(0, 6)}…${String(w.wallet || "").slice(-4)}`;
    const chg = w.change24h != null
      ? ` · <b class="${w.change24h >= 0 ? "up" : "down"}">${fmtPct(w.change24h)}</b>`
      : "";
    const rows = (w.tokens || []).slice(0, 8).map((t, i) => {
      const up = t.change24h == null || t.change24h >= 0;
      return `<div class="tr-row"><span class="tr-rank">${i + 1}</span><span class="tr-name">${escapeHtml(t.name)}${t.symbol ? ` <em>${escapeHtml(t.symbol)}</em>` : ""}</span><span class="tr-price">${t.price != null ? fmtUsd(t.price) : "—"}</span><span class="tr-chg ${up ? "up" : "down"}">${t.change24h != null ? fmtPct(t.change24h) : ""}</span><span class="tr-vol">${t.usd != null ? fmtUsd(t.usd) : "no price"}</span></div>`;
    }).join("");
    const solRow = w.sol > 0
      ? `<div class="tr-row"><span class="tr-rank">◎</span><span class="tr-name">SOL</span><span class="tr-price">${w.sol.toFixed(4)}</span><span class="tr-chg"></span><span class="tr-vol">${w.solUsd > 0 ? fmtUsd(w.solUsd) : ""}</span></div>`
      : "";
    const note = (w.tokens || []).length
      ? `<div class="tr-note">est total <b>${fmtUsd(w.totalUsd)}</b></div>`
      : `<div class="tr-note">no tokens - just SOL (est ${fmtUsd(w.totalUsd)})</div>`;
    card.innerHTML = `<div class="trend-card"><div class="tr-head">💼 wallet ${escapeHtml(short)}${chg}</div>${solRow}${rows}${note}</div>`;
  }

  async function send(text, task) {
    const trimmed = (text || "").trim();
    if (!trimmed || sendBtn.disabled) return;
    addMsg("user", escapeHtml(trimmed));
    history.push({ role: "user", content: trimmed });

    // Asked about trending / what to buy? Pull the live feed instead of a generic joke.
    let coinContext = "";
    let effectiveTask = task || "";
    let aiText = trimmed;
    const mint = detectMint(trimmed);
    if (!task && !mint && TRENDING_INTENT.test(trimmed)) {
      await runTrending(trimmed);
      return;
    }
    // Free-text meme requests ("roast me", "caption this: X") get their task
    // detected client-side so the right Pilly brief is used.
    if (!effectiveTask && !mint) {
      const d = await window.pilly.detectTask(trimmed);
      if (d && d.task) {
        effectiveTask = d.task;
        const low = trimmed.toLowerCase();
        const idx = low.indexOf(d.prefix.toLowerCase());
        if (idx >= 0) {
          const rest = trimmed.slice(idx + d.prefix.length).replace(/^[\s:;,.!?\-–—()]+/, "").trim();
          if (rest) aiText = rest;
        }
      }
    }
    if (mint) {
      effectiveTask = "coin";
      const typing = addTyping();
      setThinking(true);
      try {
        const data = await window.pilly.coin(mint);
        typing.remove();
        if (data && data.coin) {
          addCoinCard(data.coin);
          coinContext = data.context;
        } else {
          // Not a token mint - it might be a wallet address. Check the
          // portfolio instead of giving up.
          const w = await window.pilly.wallet(mint);
          typing.remove();
          if (w && w.ok) {
            effectiveTask = "wallet";
            addWalletCard(w);
            coinContext = w.context;
          } else {
            addMsg("bot err", "Couldn't pull live data for that token - double-check the address.");
            return;
          }
        }
      } catch (e) {
        typing.remove();
        addMsg("bot err", "Pilly couldn't reach the market data APIs.");
        return;
      } finally {
        setThinking(false);
      }
    }

    const typing = addTyping();
    setThinking(true);
    try {
      const res = await window.pilly.chat({ text: aiText, task: effectiveTask, history, coinContext });
      typing.remove();
      if (res && res.reply) {
        addMsg("bot", escapeHtml(res.reply));
        history.push({ role: "assistant", content: res.reply });
      } else {
        addMsg("bot err", escapeHtml((res && res.error) || "Pilly went quiet - try again."));
      }
    } catch (e) {
      typing.remove();
      addMsg("bot err", "Pilly hit a wall - try again.");
    } finally {
      setThinking(false);
      if (history.length > 16) history.splice(0, history.length - 16);
    }
  }

  // Show the live trending feed and have Pilly give a data-driven rundown.
  async function runTrending(userText) {
    const typing = addTyping();
    setThinking(true);
    try {
      const data = await window.pilly.trending();
      typing.remove();
      if (data && data.list && data.list.length) {
        addTrendingCard(data.list);
      } else {
        addMsg("bot err", "Trending feed is unavailable right now.");
      }
      const res = await window.pilly.chat({
        text: userText || "give me the rundown",
        task: "trending",
        history,
        coinContext: data ? data.context : "",
      });
      if (res && res.reply) {
        addMsg("bot", escapeHtml(res.reply));
        history.push({ role: "assistant", content: res.reply });
      }
    } catch (e) {
      typing.remove();
      addMsg("bot err", "Pilly hit a wall - try again.");
    } finally {
      setThinking(false);
    }
  }

  async function showTrending() {
    if (sendBtn.disabled) return;
    addMsg("user", "🔥 what's hot on Solana right now?");
    await runTrending("give me the rundown");
  }

  // Roll a random trending coin, pull its full live snapshot and get Pilly's verdict.
  async function pickCoin() {
    if (sendBtn.disabled) return;
    addMsg("user", "🎲 pick me a coin to check");
    const typing = addTyping();
    setThinking(true);
    try {
      const data = await window.pilly.trending();
      if (!data || !data.list || !data.list.length) {
        typing.remove();
        addMsg("bot err", "Trending feed is unavailable right now.");
        return;
      }
      const pick = data.list[Math.floor(Math.random() * data.list.length)];
      const full = await window.pilly.coin(pick.mint);
      typing.remove();
      if (full && full.coin) addCoinCard(full.coin);
      else addCoinCard(pick);
      const res = await window.pilly.chat({
        text: `is ${pick.name} (${pick.symbol}) a buy? roast it and give me your call.`,
        task: "coin",
        history,
        coinContext: full && full.context ? full.context : data.context,
      });
      if (res && res.reply) {
        addMsg("bot", escapeHtml(res.reply));
        history.push({ role: "assistant", content: res.reply });
      }
    } catch (e) {
      typing.remove();
      addMsg("bot err", "Pilly hit a wall - try again.");
    } finally {
      setThinking(false);
    }
  }

  // ---- events ----
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    send(input.value);
    input.value = "";
  });

  chips.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    if (chip.dataset.action === "trending") { showTrending(); return; }
    if (chip.dataset.action === "pick") { pickCoin(); return; }
    // Prefill the prompt - the user types their text AFTER it and hits Enter.
    // (Sending immediately used to fire with empty content, so the AI had
    // nothing to rewrite.)
    const prefix = MEME_PREFIX[chip.dataset.task] || (chip.dataset.task + ": ");
    input.value = prefix;
    input.focus();
    input.setSelectionRange(prefix.length, prefix.length);
  });

  document.getElementById("minBtn").addEventListener("click", () => window.close());
  document.getElementById("quitBtn").addEventListener("click", () => {
    if (confirm("Close Pilly? This will close the app.")) window.pilly.quit();
  });
  document.getElementById("trendBtn").addEventListener("click", showTrending);
  document.getElementById("petBtn").addEventListener("click", async () => {
    const r = await window.pilly.petToggle();
    document.getElementById("petBtn").classList.toggle("active", !!r.active);
  });
  document.getElementById("clearBtn").addEventListener("click", clearChat);
  document.getElementById("gitBtn").addEventListener("click", () => window.pilly.github());

  messagesEl.addEventListener("scroll", () => {
    scrollDownBtn.hidden = isNearBottom();
  });
  scrollDownBtn.addEventListener("click", () => {
    scrollToBottom(true);
    scrollDownBtn.hidden = true;
  });

  window.pilly.onSuggest((type) => {
    // Tray "Meme mode": prefill the rewrite prompt so the user just types
    // their text and hits Enter.
    if (type === "meme") input.value = MEME_PREFIX.rewrite;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });

  // Pilly's proactive questions (every 3-5 min while the pet is on) land in
  // the chat too, so they're there when you open the window. The question is
  // ALSO pushed into the AI history as Pilly's own line - otherwise his reply
  // to your answer would have no idea he even asked something.
  window.pilly.onQuestion((text) => {
    addMsg("bot", "🤔 " + escapeHtml(text || ""));
    const q = String(text || "").trim();
    if (q) {
      history.push({ role: "assistant", content: "I asked you: " + q });
      if (history.length > 16) history.splice(0, history.length - 16);
    }
  });

  // Frameless windows on Windows can keep a stale page offset after a
  // hide+show (the header bar looks shifted down). Force a full reflow
  // whenever the window becomes visible again.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      document.body.style.display = "none";
      void document.body.offsetHeight; // force layout
      document.body.style.display = "";
    }
  });

  // ---- Settings panel ----
  const TIERS = ["tier1", "tier2", "tier3"];

  function buildTierRows(settings) {
    tierRowsEl.innerHTML = "";
    TIERS.forEach((_, i) => {
      const t = (settings.tiers && settings.tiers[i]) || { url: "", key: "", model: "", auth: "bearer" };
      const row = document.createElement("div");
      row.className = "tier";
      row.innerHTML = `
        <div class="tier-title">API ${i + 1}</div>
        <input class="t-url" placeholder="https://…/chat/completions" value="${escapeHtml(t.url || "")}" />
        <input class="t-key" type="password" placeholder="API key" value="${escapeHtml(t.key || "")}" />
        <input class="t-model" placeholder="model" value="${escapeHtml(t.model || "")}" />
        <div class="t-fetch-row">
          <button type="button" class="t-fetch">Find free models</button>
          <select class="t-select" hidden></select>
        </div>
      `;
      tierRowsEl.appendChild(row);

      const urlInput = row.querySelector(".t-url");
      const keyInput = row.querySelector(".t-key");
      const modelInput = row.querySelector(".t-model");
      const fetchBtn = row.querySelector(".t-fetch");
      const select = row.querySelector(".t-select");

      fetchBtn.addEventListener("click", async () => {
        const url = urlInput.value.trim();
        const key = keyInput.value.trim();
        if (!url) { setStatus("Enter an API URL first.", false); return; }
        fetchBtn.disabled = true;
        fetchBtn.textContent = "Searching…";
        const r = await window.pilly.settingsModels({ url, key, auth: "bearer" });
        fetchBtn.disabled = false;
        fetchBtn.textContent = "Find free models";
        if (!r.ok) { setStatus(r.error, false); return; }
        select.innerHTML = "";
        r.models.forEach((m) => {
          const o = document.createElement("option");
          o.value = m;
          o.textContent = r.free.includes(m) ? `${m}  (free)` : m;
          select.appendChild(o);
        });
        select.hidden = false;
        setStatus(
          r.free.length
            ? `${r.free.length} free of ${r.models.length} models - pick one`
            : `${r.models.length} models found - pick one`,
          true
        );
        select.focus();
      });

      select.addEventListener("change", () => {
        modelInput.value = select.value;
      });
    });
  }

  function readSettings() {
    const tiers = TIERS.map((_, i) => {
      const r = tierRowsEl.children[i];
      return {
        url: r.querySelector(".t-url").value.trim(),
        key: r.querySelector(".t-key").value.trim(),
        model: r.querySelector(".t-model").value.trim(),
        auth: "bearer",
      };
    });
    return {
      tiers,
      temperature: Number(setTemp.value) || 0.8,
      maxTokens: Number(setTokens.value) || 240,
      pet: {
        theme: petTheme.value,
        size: petSize.value,
        bubbles: petBubbles.checked,
        bubbleSize: petBubbleSize.value,
        walkMode: petWalkMode.value,
        stopFreq: petStopFreq.value,
        questions: petQuestions.checked,
      },
    };
  }

  function setStatus(msg, ok) {
    settingsStatus.textContent = msg;
    settingsStatus.className = "status " + (ok ? "ok" : "err");
  }

  async function openSettings() {
    const s = await window.pilly.settingsGet();
    setTemp.value = s.temperature != null ? s.temperature : 0.8;
    setTokens.value = s.maxTokens != null ? s.maxTokens : 240;
    const p = s.pet || {};
    petTheme.value = p.theme || "green";
    petSize.value = p.size || "md";
    petBubbleSize.value = p.bubbleSize || "md";
    petBubbles.checked = p.bubbles !== false;
    petWalkMode.value = p.walkMode || "taskbar";
    petStopFreq.value = p.stopFreq || "normal";
    petQuestions.checked = p.questions !== false;
    applyPetTheme(p);
    buildTierRows(s);
    settingsEl.classList.remove("hidden");
    setStatus("", false);
  }

  document.getElementById("gearBtn").addEventListener("click", openSettings);
  document.getElementById("settingsClose").addEventListener("click", () => settingsEl.classList.add("hidden"));

  // Live pet preview: apply pet options immediately while tweaking.
  [petTheme, petSize, petBubbles, petBubbleSize, petWalkMode, petStopFreq, petQuestions].forEach((el) => {
    el.addEventListener("change", () => {
      const pet = {
        theme: petTheme.value,
        size: petSize.value,
        bubbles: petBubbles.checked,
        bubbleSize: petBubbleSize.value,
        walkMode: petWalkMode.value,
        stopFreq: petStopFreq.value,
        questions: petQuestions.checked,
      };
      applyPetTheme(pet);
      window.pilly.petApply(pet);
    });
  });
  document.getElementById("saveBtn").addEventListener("click", async () => {
    const s = readSettings();
    const r = await window.pilly.settingsSave(s);
    applyPetTheme(s.pet);
    if (r.ok) setStatus("Saved ✓", true);
    else setStatus("Save failed: " + (r.error || ""), false);
  });
  document.getElementById("testBtn").addEventListener("click", async () => {
    setStatus("Testing…", false);
    const r = await window.pilly.settingsTest(readSettings());
    if (r.ok) setStatus(`Connected ✓ (API ${r.tier})`, true);
    else setStatus(r.error || "No tier answered.", false);
  });

  // Theme the chat avatar with the saved pet color on startup.
  window.pilly.settingsGet().then((s) => applyPetTheme(s && s.pet)).catch(() => {});

  // Show the app version in the settings footer.
  window.pilly.version().then((v) => {
    const el = document.getElementById("appVersion");
    if (el && v) el.textContent = v;
  }).catch(() => {});

  // Bring back the previous conversation (minimize/restart must not lose it).
  restoreChat();
})();

