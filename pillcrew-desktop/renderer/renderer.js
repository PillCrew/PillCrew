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
  const petSounds = document.getElementById("petSounds");
  const petName = document.getElementById("petName");
  const petMood = document.getElementById("petMood");
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
  let defaultFaceMood = "";
  function applyName(name) {
    const n = String(name || "").trim();
    if (!n) return;
    const el = document.querySelector(".bar-id strong");
    if (el) el.textContent = n;
    document.title = n + " · Pilly";
  }
  function applyPetTheme(pet) {
    const t = (pet && PET_THEMES[pet.theme]) || PET_THEMES.green;
    const rs = document.documentElement.style;
    rs.setProperty("--c1", t.c1);
    rs.setProperty("--c2", t.c2);
    rs.setProperty("--c3", t.c3);
    rs.setProperty("--glow", t.glow);
    defaultFaceMood = pet && pet.mood === "happy" ? "happy" : pet && pet.mood === "sad" ? "sad" : "";
    applyName(pet && pet.name);
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

  // ---- Chat avatar mood badge (Etap 4): a quick emoji reaction pops over
  // the avatar when the market or the conversation turns strongly up/down.
  let avatarMoodTimer = null;
  const AVATAR_MOODS = { happy: "🎉", sad: "😢" };
  function setAvatarBadge(emoji) {
    const el = document.getElementById("pillMood");
    if (!el || !emoji) return;
    el.textContent = emoji;
    el.classList.remove("show");
    void el.offsetWidth; // restart the animation
    el.classList.add("show");
    if (avatarMoodTimer) clearTimeout(avatarMoodTimer);
    avatarMoodTimer = setTimeout(() => el.classList.remove("show"), 2400);
  }
  function setAvatarMood(kind) {
    const emoji = AVATAR_MOODS[kind];
    faceMood = kind === "happy" ? "happy" : kind === "sad" ? "sad" : "";
    if (faceMood) faceMoodUntil = performance.now() + 2400;
    if (emoji) setAvatarBadge(emoji);
  }

  // ---- Chat avatar face: mirrors the taskbar pet's look (canvas) ----
  const faceCanvas = document.getElementById("pillFace");
  const faceCtx = faceCanvas ? faceCanvas.getContext("2d") : null;
  let faceMood = "";
  let faceMoodUntil = 0;
  let faceBlink = performance.now() + 1800 + Math.random() * 2500;
  let faceBlinkUntil = 0;
  let faceAnim = null;
  // Etap 6: avatar interactions - pupils follow the mouse, click = boop,
  // hold = petting.
  let facePupil = { x: 0, y: 0 };
  let boopUntil = 0, petting = false, pettingTimer = null;
  document.addEventListener("mousemove", (e) => {
    const r = faceCanvas ? faceCanvas.getBoundingClientRect() : null;
    if (!r) return;
    facePupil.x = Math.max(-1.6, Math.min(1.6, ((e.clientX - (r.left + r.width / 2)) / (r.width / 2)) * 1.6));
    facePupil.y = Math.max(-1.4, Math.min(1.4, ((e.clientY - (r.top + r.height / 2)) / (r.height / 2)) * 1.4));
  });
  const avatarEl = document.getElementById("pillAvatar");
  if (avatarEl) {
    avatarEl.addEventListener("mousedown", (e) => {
      e.preventDefault();
      if (pettingTimer) clearTimeout(pettingTimer);
      pettingTimer = setTimeout(() => {
        petting = true;
        setAvatarBadge("😌");
      }, 450);
    });
    const endPetting = () => {
      if (pettingTimer) { clearTimeout(pettingTimer); pettingTimer = null; }
      petting = false;
    };
    avatarEl.addEventListener("mouseup", endPetting);
    avatarEl.addEventListener("mouseleave", endPetting);
    avatarEl.addEventListener("click", (e) => {
      e.preventDefault();
      boopUntil = performance.now() + 500;
    });
  }
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function drawFaceEye(ctx, ex, ey, open, happy, lid, px, py) {
    if (open) {
      rr(ctx, ex - 3.5, ey - 4, 7, 8, 3.5);
      ctx.fillStyle = "#0b0f0d";
      ctx.fill();
      const pr = happy ? 1.9 : 1.3;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(ex + (px || 0), ey + (py || 0), pr, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.beginPath();
      ctx.arc(ex - 2 + (px || 0), ey - 2.4 + (py || 0), 0.9, 0, Math.PI * 2);
      ctx.fill();
      if (lid) {
        ctx.fillStyle = "#0b0f0d";
        rr(ctx, ex - 3.5, ey - 4, 7, lid * 8, 1);
        ctx.fill();
      }
    } else {
      ctx.strokeStyle = "#0b0f0d";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(ex - 3.5, ey);
      ctx.lineTo(ex + 3.5, ey);
      ctx.stroke();
    }
  }
  function drawFace(now) {
    if (!faceCtx || !faceCanvas) return;
    const W = faceCanvas.width, H = faceCanvas.height;
    faceCtx.clearRect(0, 0, W, H);
    const rs = getComputedStyle(document.documentElement);
    const c1 = rs.getPropertyValue("--c1").trim() || "#22c55e";
    const c2 = rs.getPropertyValue("--c2").trim() || "#34d399";
    const c3 = rs.getPropertyValue("--c3").trim() || "#6366f1";
    const t = now / 1000;
    // gentle breathing bob + squash (boop / petting)
    const bob = Math.abs(Math.sin(t * 2.1)) * 1.4;
    let squish = 1, rot = 0;
    if (now < boopUntil) {
      const p = (boopUntil - now) / 500;
      squish = 1 + 0.16 * p;
      rot = Math.sin(now / 55) * 0.08 * p;
    } else if (petting) {
      squish = 1 + 0.07 * Math.sin(t * 11);
    }
    const pw = 46 / squish, ph = 20 * squish;
    const px = (W - pw) / 2, cy = H / 2 + bob, py = cy - ph / 2;
    faceCtx.save();
    faceCtx.translate(W / 2, cy);
    faceCtx.rotate(rot);
    faceCtx.translate(-W / 2, -cy);
    const grad = faceCtx.createLinearGradient(0, py, 0, py + ph);
    grad.addColorStop(0, c1);
    grad.addColorStop(0.55, c2);
    grad.addColorStop(1, c3);
    rr(faceCtx, px, py, pw, ph, ph / 2);
    faceCtx.fillStyle = grad;
    faceCtx.fill();
    rr(faceCtx, px, py, pw, ph, ph / 2);
    faceCtx.strokeStyle = "rgba(0,0,0,0.16)";
    faceCtx.lineWidth = 1;
    faceCtx.stroke();
    faceCtx.globalAlpha = 0.22;
    faceCtx.fillStyle = "#fff";
    rr(faceCtx, px + 5, py + 2, pw - 10, ph * 0.24, ph * 0.12);
    faceCtx.fill();
    faceCtx.globalAlpha = 1;
    const mood = now < faceMoodUntil ? faceMood : defaultFaceMood;
    const eyesOpen = !(now < faceBlinkUntil);
    const eyeY = py + ph * 0.55;
    const lid = now < faceMoodUntil && faceMood === "sad" ? 0.6 : 0;
    const ppx = petting ? 0 : facePupil.x, ppy = petting ? 0 : facePupil.y;
    drawFaceEye(faceCtx, px + pw * 0.28, eyeY, eyesOpen, mood === "happy", lid, ppx, ppy);
    drawFaceEye(faceCtx, px + pw * 0.72, eyeY, eyesOpen, mood === "happy", lid, ppx, ppy);
    const mx = W / 2, my = py + ph * 0.82;
    faceCtx.strokeStyle = "#0b0f0d";
    faceCtx.lineWidth = 1.6;
    faceCtx.lineCap = "round";
    faceCtx.beginPath();
    if (mood === "happy") {
      faceCtx.moveTo(mx - 4.5, my - 1);
      faceCtx.quadraticCurveTo(mx, my + 2.6, mx + 4.5, my - 1);
    } else if (mood === "sad") {
      faceCtx.moveTo(mx - 4.5, my + 1);
      faceCtx.quadraticCurveTo(mx, my - 2.8, mx + 4.5, my + 1);
    } else {
      faceCtx.moveTo(mx - 4, my);
      faceCtx.quadraticCurveTo(mx, my + 1.6, mx + 4, my);
    }
    faceCtx.stroke();
    faceCtx.restore();
  }
  function startFaceAnim() {
    if (faceAnim || !faceCtx) return;
    const loop = (now) => {
      if (now > faceBlink) {
        faceBlinkUntil = now + 160;
        faceBlink = now + 1800 + Math.random() * 2600;
      }
      drawFace(now);
      requestAnimationFrame(loop);
    };
    faceAnim = requestAnimationFrame(loop);
  }

  // Tiny sentiment guess for the pet: counts bullish/bearish words & emojis
  // so Pilly reacts to the mood of the conversation (no AI round-trip).
  function guessMood(text) {
    const s = String(text || "").toLowerCase();
    const pos = ["moon", "green", "gain", "gains", "win", "profit", "pump", "lambo", "alpha", "diamond", "bull", "buy", "bought", "love", "sick", "wen", "yolo"];
    const neg = ["rug", "dump", "red", "loss", "lose", "rekt", "rip", "sad", "shit", "liq", "liquidated", "scam", "dead", "pain", "cope", "f"];
    const emojis = { "🚀": 2, "😂": 1, "🎉": 1, "🔥": 1, "😍": 1, "😢": -1, "💀": -1, "😭": -1 };
    let score = 0;
    for (const w of pos) if (new RegExp("\\b" + w + "\\b").test(s)) score += 1;
    for (const w of neg) if (new RegExp("\\b" + w + "\\b").test(s)) score -= 1;
    for (const [e, v] of Object.entries(emojis)) if (s.includes(e)) score += v;
    if (score >= 2) return "happy";
    if (score <= -2) return "sad";
    return "flat";
  }

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
    // Etap 3: let the pet know the mood of what the user just said.
    const mood = guessMood(trimmed);
    if (mood !== "flat") {
      window.pilly.petMood({ kind: mood });
      setAvatarMood(mood);
    }

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
          if (data.coin.change24h != null) {
            setAvatarMood(data.coin.change24h >= 0.5 ? "happy" : data.coin.change24h <= -0.5 ? "sad" : null);
          }
        } else {
          // Not a token mint - it might be a wallet address. Check the
          // portfolio instead of giving up.
          const w = await window.pilly.wallet(mint);
          typing.remove();
          if (w && w.ok) {
            effectiveTask = "wallet";
            addWalletCard(w);
            coinContext = w.context;
            if (w.change24h != null) {
              setAvatarMood(w.change24h >= 0.5 ? "happy" : w.change24h <= -0.5 ? "sad" : null);
            }
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
        const chgs = data.list.map((c) => c.change24h).filter((c) => c != null && isFinite(c));
        if (chgs.length) {
          const avg = chgs.reduce((s, c) => s + c, 0) / chgs.length;
          setAvatarMood(avg >= 0.5 ? "happy" : avg <= -0.5 ? "sad" : null);
        }
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
        name: petName.value.trim() || "Pilly",
        mood: petMood.value,
        theme: petTheme.value,
        size: petSize.value,
        bubbles: petBubbles.checked,
        bubbleSize: petBubbleSize.value,
        walkMode: petWalkMode.value,
        stopFreq: petStopFreq.value,
        questions: petQuestions.checked,
        sounds: petSounds.checked,
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
    petSounds.checked = p.sounds !== false;
    petName.value = p.name || "Pilly";
    petMood.value = p.mood || "neutral";
    applyPetTheme(p);
    buildTierRows(s);
    settingsEl.classList.remove("hidden");
    setStatus("", false);
  }

  document.getElementById("gearBtn").addEventListener("click", openSettings);
  document.getElementById("settingsClose").addEventListener("click", () => settingsEl.classList.add("hidden"));

  // Live pet preview: apply pet options immediately while tweaking.
  [petTheme, petSize, petBubbles, petBubbleSize, petWalkMode, petStopFreq, petQuestions, petSounds, petName, petMood].forEach((el) => {
    el.addEventListener("change", () => {
      const pet = {
        name: petName.value.trim() || "Pilly",
        mood: petMood.value,
        theme: petTheme.value,
        size: petSize.value,
        bubbles: petBubbles.checked,
        bubbleSize: petBubbleSize.value,
        walkMode: petWalkMode.value,
        stopFreq: petStopFreq.value,
        questions: petQuestions.checked,
        sounds: petSounds.checked,
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
  startFaceAnim();
})();

