// Pilly chat window logic.
(function () {
  const messagesEl = document.getElementById("messages");
  const form = document.getElementById("chatForm");
  const input = document.getElementById("input");
  const sendBtn = document.getElementById("sendBtn");
  const pill = document.getElementById("pillAvatar");
  const chips = document.getElementById("chips");

  const settingsEl = document.getElementById("settings");
  const tierRowsEl = document.getElementById("tierRows");
  const setTemp = document.getElementById("setTemp");
  const setTokens = document.getElementById("setTokens");
  const setSite = document.getElementById("setSite");
  const settingsStatus = document.getElementById("settingsStatus");

  const history = []; // [{ role, content }] for context (capped)

  // ---- helpers ----
  function addEl(className) {
    const m = document.createElement("div");
    m.className = className;
    messagesEl.appendChild(m);
    messagesEl.scrollTop = messagesEl.scrollHeight;
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
    messagesEl.scrollTop = messagesEl.scrollHeight;
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
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return m;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
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

  // Solana mint detection (bare address or pump.fun/jup link).
  function detectMint(text) {
    const s = String(text || "");
    const link = s.match(/https?:\/\/[^\s]+?\/(?:coin|tokens?|token)\/([1-9A-HJ-NP-Za-km-z]{32,44})/i);
    if (link) return link[1];
    const bare = s.match(/\b([1-9A-HJ-NP-Za-km-z]{32,44})\b/);
    if (bare) {
      const m = bare[1];
      if (m.endsWith("pump") || m === "So11111111111111111111111111111111111111112") return m;
      if (/[a-z]/.test(m) && /[A-Z]/.test(m)) return m;
    }
    return null;
  }

  function addCoinCard(coin) {
    const card = addEl("msg bot");
    const up = coin.change24h == null || coin.change24h >= 0;
    const parts = [];
    if (coin.image) parts.push(`<img class="cc-img" src="${escapeHtml(coin.image)}" onerror="this.remove()" />`);
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
  }

  function addTrendingCard(list) {
    const card = addEl("msg bot");
    const rows = list.slice(0, 5).map((c, i) => {
      const up = c.change24h == null || c.change24h >= 0;
      return `<div class="tr-row"><span class="tr-rank">${i + 1}</span><span class="tr-name">${escapeHtml(c.name)}${c.symbol ? ` <em>${escapeHtml(c.symbol)}</em>` : ""}</span><span class="tr-price">${c.price != null ? fmtUsd(c.price) : "-"}</span><span class="tr-chg ${up ? "up" : "down"}">${fmtPct(c.change24h)}</span><span class="tr-vol">${c.volume24h != null ? fmtUsd(c.volume24h) : ""}</span></div>`;
    }).join("");
    card.innerHTML = `<div class="trend-card"><div class="tr-head">🔥 Trending on Solana</div>${rows}</div>`;
  }

  async function send(text, task) {
    const trimmed = (text || "").trim();
    if (!trimmed || sendBtn.disabled) return;
    addMsg("user", escapeHtml(trimmed));
    history.push({ role: "user", content: trimmed });

    // Detect a pasted Solana token -> pull live data + pro read.
    let coinContext = "";
    let effectiveTask = task || "";
    const mint = detectMint(trimmed);
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
          addMsg("bot err", "Couldn't pull live data for that token - double-check the address.");
        }
      } catch (e) {
        typing.remove();
        addMsg("bot err", "Pilly couldn't reach the market data APIs.");
      } finally {
        setThinking(false);
      }
    }

    const typing = addTyping();
    setThinking(true);
    try {
      const res = await window.pilly.chat({ text: trimmed, task: effectiveTask, history, coinContext });
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

  async function showTrending() {
    if (sendBtn.disabled) return;
    addMsg("user", "🔥 what's hot on Solana right now?");
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
      const res = await window.pilly.chat({ text: "give me the rundown", task: "trending", history, coinContext: data ? data.context : "" });
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
    input.value = "";
    input.focus();
    send(chip.dataset.task + ": ", chip.dataset.task);
  });

  document.getElementById("minBtn").addEventListener("click", () => window.close());
  document.getElementById("quitBtn").addEventListener("click", () => {
    if (confirm("Quit Pilly? The pill will leave your taskbar.")) window.close();
  });
  document.getElementById("trendBtn").addEventListener("click", showTrending);

  window.pilly.onSuggest(() => input.focus());

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
      useSiteFallback: setSite.checked,
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
    setSite.checked = s.useSiteFallback !== false;
    buildTierRows(s);
    settingsEl.classList.remove("hidden");
    setStatus("", false);
  }

  document.getElementById("gearBtn").addEventListener("click", openSettings);
  document.getElementById("settingsClose").addEventListener("click", () => settingsEl.classList.add("hidden"));
  document.getElementById("saveBtn").addEventListener("click", async () => {
    const r = await window.pilly.settingsSave(readSettings());
    if (r.ok) setStatus("Saved ✓", true);
    else setStatus("Save failed: " + (r.error || ""), false);
  });
  document.getElementById("testBtn").addEventListener("click", async () => {
    setStatus("Testing…", false);
    const r = await window.pilly.settingsTest(readSettings());
    if (r.ok) setStatus(`Connected ✓ (API ${r.tier})`, true);
    else setStatus(r.error || "No tier answered.", false);
  });
})();

