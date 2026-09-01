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
  const petBubbleText = document.getElementById("petBubbleText");
  const petBubbleStyle = document.getElementById("petBubbleStyle");
  const petSoundVol = document.getElementById("petSoundVol");
  const petWalkMode = document.getElementById("petWalkMode");
  const petStopFreq = document.getElementById("petStopFreq");
  const petQuestions = document.getElementById("petQuestions");
  const petSounds = document.getElementById("petSounds");
  const petHotAlerts = document.getElementById("petHotAlerts");
  const petHotPct = document.getElementById("petHotPct");
  const petAlertSound = document.getElementById("petAlertSound");
  const petDailyBrief = document.getElementById("petDailyBrief");
  const petPillyPick = document.getElementById("petPillyPick");
  const petSniper = document.getElementById("petSniper");
  const petWhaleAlerts = document.getElementById("petWhaleAlerts");
  const petPortfolioMood = document.getElementById("petPortfolioMood");
  const petName = document.getElementById("petName");
  const petMood = document.getElementById("petMood");
  const settingsStatus = document.getElementById("settingsStatus");
  const chatBubble = document.getElementById("chatBubble");
  const chatOnTop = document.getElementById("chatOnTop");
  const chatFontSize = document.getElementById("chatFontSize");

  const watchlistEl = document.getElementById("watchlist");
  const watchRowsEl = document.getElementById("watchRows");
  const watchStatusEl = document.getElementById("watchStatus");
  const watchlistBtn = document.getElementById("watchBtn");

  const scorecardEl = document.getElementById("scorecard");
  const scStatsEl = document.getElementById("scStats");
  const scRowsEl = document.getElementById("scRows");
  const scStatusEl = document.getElementById("scStatus");

  const whaleEl = document.getElementById("whales");
  const whaleAddrEl = document.getElementById("whaleAddr");
  const whaleStatusEl = document.getElementById("whaleStatus");
  const whaleRowsEl = document.getElementById("whaleRows");

  const history = []; // [{ role, content }] for context (capped)

  // v1.1.0: gentle whole-window fade on open.
  document.body.classList.add("app-open");

  const WELCOME_HTML = "Yo. I'm Pilly - the pill living in your taskbar. Tap the tray icon anytime. Paste a <em>Solana token address</em> (or a pump.fun link) and I'll pull its live data and give you a pro read. Try <em>🔥 trending</em>, <em>meme this</em>, <em>caption this</em> - or just talk.";

  // Pro icon set (inline SVG, stroke style, currentColor).
  const ICONS = {
    bookmark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    external: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
    radar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19.07 4.93A10 10 0 0 0 6.99 3.34"/><path d="M4 6h.01"/><path d="M2.29 9.62a10 10 0 1 0 12.09 12.09"/><path d="M2.2 14.57a10 10 0 0 0 7.23 7.23"/><path d="M10.71 6.71a4 4 0 1 0 6.58 6.58"/><circle cx="12" cy="12" r="10"/></svg>',
  };

  // Chat bubble styles selectable in settings (body class bs-*).
  const BUBBLE_STYLES = ["sharp", "rounded", "glass", "neon", "minimal"];

  // ---- PnL tracking (entry prices per mint) ----
  let pnlEntries = {}; // mint -> entry price
  async function loadPnl() {
    try {
      const all = await window.pilly.pnlAll().catch(() => ({}));
      pnlEntries = all && typeof all === "object" ? all : {};
    } catch (e) {
      pnlEntries = {};
    }
    return pnlEntries;
  }
  function pnlOf(mint, price) {
    const entry = pnlEntries[mint];
    const c = Number(price);
    const e = Number(entry);
    if (!entry || !isFinite(c) || !isFinite(e) || c <= 0 || e <= 0) return null;
    return { entry: e, pct: ((c - e) / e) * 100 };
  }
  const fmtPnl = (pct) => `${pct >= 0 ? "▲ +" : "▼ "}${pct.toFixed(1)}%`;

  // Free-text questions that should pull the live trending feed instead of a generic reply.
  const TRENDING_INTENT = /(trending|what'?s hot|hot right now|top (coins|tokens)|what (should|can|do) i (buy|check|pick|watch)|pick (a )?(coin|token|winner)|roast (the )?(list|trending))/i;

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
    // Pro chat: hover timestamp + one-click copy (actions survive restore
    // thanks to event delegation on #messages).
    const t = document.createElement("span");
    t.className = "msg-time";
    t.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    m.appendChild(t);
    const cp = document.createElement("button");
    cp.type = "button";
    cp.className = "msg-copy";
    cp.title = "Copy message";
    cp.innerHTML = ICONS.copy;
    m.appendChild(cp);
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
  // v2: coin-card action buttons moved to event delegation (data-act). Old v1
  // cards have no data-act, so their buttons would be dead - v2 never restores
  // that legacy markup.
  const CHAT_KEY = "pilly_chat_history_v2";
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
      // Sanity check: never restore a chat whose coin cards are missing the
      // new data-act buttons (their actions would be dead). Old v1 cards used
      // emoji inside .cc-watch buttons (👛 ⚡ ↻ 📋) - new ones use SVG icons.
      const joined = msgs.join("");
      if (/cc-watch[^>]*>[^<]*[👛⚡↻📋]/.test(joined)) {
        try { localStorage.removeItem(CHAT_KEY); } catch (e) { /* ignore */ }
        return false;
      }
      messagesEl.innerHTML = joined;
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

  // ---- Chat avatar mood badge (Stage 4): a quick emoji reaction pops over
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
  // Stage 6: avatar interactions - pupils follow the mouse, click = boop,
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

  const cardSparks = new Map(); // mint -> {points, dir}
  const cardCoins = new Map(); // mint -> last coin object (for PnL re-render)

  function pnlChipHtml(mint, price) {
    const p = pnlOf(mint, price);
    if (!p) return "";
    return `<div class="cc-stat pnl ${p.pct >= 0 ? "up" : "down"}">PnL <b class="${p.pct >= 0 ? "up" : "down"}">${fmtPnl(p.pct)}</b></div>`;
  }

  // Tiny 24h sparkline (SVG polyline) for the coin card.
  function sparkSvg(points, dir) {
    if (!points || points.length < 2) return "";
    const W = 120, H = 26;
    const min = Math.min(...points), max = Math.max(...points);
    const span = max - min || 1;
    const xs = points.map((_, i) => (i / (points.length - 1)) * W);
    const ys = points.map((v) => H - 2 - ((v - min) / span) * (H - 4));
    const d = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
    const color = dir === "up" ? "#22c55e" : "#ef4444";
    const fill = `M0,${H} ` + xs.map((x, i) => `L${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ") + ` L${W},${H} Z`;
    return `<svg class="cc-spark-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" width="100%" height="26"><path d="${fill}" fill="${color}" opacity="0.12"/><path d="${d}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  }

  function drawSpark(cardEl, spark) {
    const slot = cardEl && cardEl.querySelector(".cc-spark");
    if (!slot || !spark || !spark.points || spark.points.length < 2) return;
    slot.innerHTML = sparkSvg(spark.points, spark.dir);
  }

  function addCoinCard(coin, opts) {
    const card = addEl("msg bot");
    const read = (opts && opts.read) || "";
    const up = coin.change24h == null || coin.change24h >= 0;
    const parts = [];
    if (coin.image) parts.push(`<img class="cc-img" src="${escapeHtml(coin.image)}" />`);
    parts.push(`<div class="cc-main"><strong>${escapeHtml(coin.name)}</strong>${coin.symbol ? ` <span class="cc-sym">${escapeHtml(coin.symbol)}</span>` : ""}</div>`);
    parts.push(`<div class="cc-price ${up ? "up" : "down"}">${coin.price != null ? fmtUsd(coin.price) : "-"}</div>`);
    card.innerHTML = `<div class="coin-card"><div class="cc-top">${parts.join("")}<div class="cc-side">${pnlChipHtml(coin.mint, coin.price)}${
      coin.mcap != null ? `<div class="cc-stat">mcap <b>${fmtUsd(coin.mcap)}</b></div>` : ""
    }${coin.change24h != null ? `<div class="cc-stat">24h <b class="${up ? "up" : "down"}">${fmtPct(coin.change24h)}</b></div>` : ""}</div></div><div class="cc-spark"></div><div class="cc-grid">${
      coin.volume24h != null ? `<div class="cc-stat">vol <b>${fmtUsd(coin.volume24h)}</b></div>` : ""
    }${coin.liquidityUsd != null ? `<div class="cc-stat">liq <b>${fmtUsd(coin.liquidityUsd)}</b></div>` : ""}${
      coin.age ? `<div class="cc-stat">age <b>${coin.age}</b></div>` : ""
    }${coin.buys24h != null && coin.sells24h != null ? `<div class="cc-stat">txns <b>${Number(coin.buys24h).toLocaleString()}B/${Number(coin.sells24h).toLocaleString()}S</b></div>` : ""}${
      coin.organicScore != null ? `<div class="cc-stat">organic <b>${coin.organicScore}/100</b></div>` : ""
    }${coin.rug ? `<div class="cc-stat rug rg-${String(coin.rug.grade).toLowerCase()}">rug <b>${coin.rug.grade} ${coin.rug.score}</b></div>` : ""}</div></div>`;
    const img = card.querySelector(".cc-img");
    if (img) img.addEventListener("error", () => img.remove(), { once: true });
    const mint = coin.mint;
    if (mint) {
      cardCoins.set(mint, coin);
      const cached = cardSparks.get(mint);
      if (cached) drawSpark(card, cached);
      else {
        window.pilly.spark(mint).then((s) => {
          if (s && s.points && s.points.length >= 2) {
            cardSparks.set(mint, s);
            drawSpark(card, s);
          }
        }).catch(() => {});
      }
    }
    // Pro action buttons: watch / read / open-on-dex / refresh / copy.
    // Wired through event delegation on #messages so they work after restore.
    const foot = document.createElement("div");
    foot.className = "cc-foot";
    foot.innerHTML =
      `<button type="button" class="cc-watch" data-act="watch" data-mint="${escapeHtml(mint)}" data-sym="${escapeHtml(coin.symbol || "")}" data-name="${escapeHtml(coin.name || "")}" data-price="${coin.price != null ? escapeHtml(coin.price) : ""}" title="Watch / set alert">${ICONS.bookmark}<span class="cw-label">watch</span></button>` +
      `<button type="button" class="cc-watch icon-only" data-act="read" data-mint="${escapeHtml(mint)}" data-read="${escapeHtml(read)}" title="Instant no-AI read">${ICONS.eye}</button>` +
      `<button type="button" class="cc-watch icon-only" data-act="dex" data-mint="${escapeHtml(mint)}" data-pair="${escapeHtml(coin.pair || "")}" title="Open on DexScreener">${ICONS.external}</button>` +
      `<button type="button" class="cc-watch icon-only" data-act="refresh" data-mint="${escapeHtml(mint)}" title="Refresh live data">${ICONS.refresh}</button>` +
      `<button type="button" class="cc-watch icon-only" data-act="copy" data-mint="${escapeHtml(mint)}" title="Copy mint">${ICONS.copy}</button>`;
    card.appendChild(foot);
    refreshWatchLabel(foot);
  }

  async function refreshWatchLabel(foot) {
    const btn = foot && foot.querySelector('[data-act="watch"]');
    if (!btn) return;
    try {
      const items = await window.pilly.watchList().catch(() => []);
      const on = Array.isArray(items) && items.some((i) => i.mint === btn.dataset.mint);
      const label = btn.querySelector(".cw-label");
      if (label) label.textContent = on ? "watching" : "watch";
      btn.classList.toggle("active", on);
    } catch (e) { /* ignore */ }
  }

  // Re-render just the coin-card body (used by ↻ refresh / live tick).
  function renderCardBody(cardEl, coin) {
    const bodyEl = cardEl && cardEl.querySelector(".coin-card");
    if (!bodyEl) return;
    const up = coin.change24h == null || coin.change24h >= 0;
    const parts = [];
    if (coin.image) parts.push(`<img class="cc-img" src="${escapeHtml(coin.image)}" />`);
    parts.push(`<div class="cc-main"><strong>${escapeHtml(coin.name)}</strong>${coin.symbol ? ` <span class="cc-sym">${escapeHtml(coin.symbol)}</span>` : ""}</div>`);
    parts.push(`<div class="cc-price ${up ? "up" : "down"}">${coin.price != null ? fmtUsd(coin.price) : "-"}</div>`);
    bodyEl.innerHTML = `<div class="cc-top">${parts.join("")}<div class="cc-side">${pnlChipHtml(coin.mint, coin.price)}${
      coin.mcap != null ? `<div class="cc-stat">mcap <b>${fmtUsd(coin.mcap)}</b></div>` : ""
    }${coin.change24h != null ? `<div class="cc-stat">24h <b class="${up ? "up" : "down"}">${fmtPct(coin.change24h)}</b></div>` : ""}</div></div><div class="cc-spark"></div><div class="cc-grid">${
      coin.volume24h != null ? `<div class="cc-stat">vol <b>${fmtUsd(coin.volume24h)}</b></div>` : ""
    }${coin.liquidityUsd != null ? `<div class="cc-stat">liq <b>${fmtUsd(coin.liquidityUsd)}</b></div>` : ""}${
      coin.age ? `<div class="cc-stat">age <b>${coin.age}</b></div>` : ""
    }${coin.buys24h != null && coin.sells24h != null ? `<div class="cc-stat">txns <b>${Number(coin.buys24h).toLocaleString()}B/${Number(coin.sells24h).toLocaleString()}S</b></div>` : ""}${
      coin.organicScore != null ? `<div class="cc-stat">organic <b>${coin.organicScore}/100</b></div>` : ""
    }${coin.rug ? `<div class="cc-stat rug rg-${String(coin.rug.grade).toLowerCase()}">rug <b>${coin.rug.grade} ${coin.rug.score}</b></div>` : ""}</div>`;
    const img = bodyEl.querySelector(".cc-img");
    if (img) img.addEventListener("error", () => img.remove(), { once: true });
    drawSpark(cardEl, cardSparks.get(coin.mint) || null);
  }

  // Delegated click handling on the chat: coin-card actions (watch/read/
  // refresh/copy) and per-message copy buttons. Works for fresh and restored
  // messages alike.
  messagesEl.addEventListener("click", async (e) => {
    const cc = e.target.closest(".cc-watch");
    if (cc) {
      const act = cc.dataset.act;
      const mint = cc.dataset.mint;
      if (!mint) return;
      const foot = cc.closest(".cc-foot");
      const cardEl = cc.closest(".msg");
      if (act === "watch") {
        try {
          const items = await window.pilly.watchList().catch(() => []);
          const on = Array.isArray(items) && items.some((i) => i.mint === mint);
          if (on) {
            await window.pilly.watchRemove(mint).catch(() => {});
          } else {
            await window.pilly.watchAdd({ mint, symbol: cc.dataset.sym, name: cc.dataset.name }).catch(() => {});
            // Auto-capture the entry price at watch time (PnL tracking).
            const price = Number(cc.dataset.price);
            if (isFinite(price) && price > 0 && !pnlEntries[mint]) {
              const saved = await window.pilly.pnlSet(mint, price).catch(() => null);
              if (saved) pnlEntries[mint] = saved;
            }
            // Refresh the card's PnL chip with the new entry.
            const coin = cardCoins.get(mint);
            if (coin) renderCardBody(cardEl, coin);
          }
          refreshWatchLabel(foot);
          renderWatchlist();
        } catch (err) { /* ignore */ }
        return;
      }
      if (act === "dex") {
        window.pilly.openExternal("https://dexscreener.com/solana/" + (cc.dataset.pair || mint)).catch(() => {});
        return;
      }
      if (act === "read") {
        const read = cc.dataset.read || "";
        if (read) addMsg("bot", `${escapeHtml(read)}<span class="fb-tag">⚡ local read</span>`);
        else addMsg("bot err", "No local read for this one.");
        return;
      }
      if (act === "refresh") {
        cc.disabled = true;
        cc.innerHTML = ICONS.check;
        try {
          const fresh = await window.pilly.coin(mint);
          if (fresh && fresh.coin) {
            const rb = foot && foot.querySelector('[data-act="read"]');
            if (rb) rb.dataset.read = fresh.read || "";
            const wb = foot && foot.querySelector('[data-act="watch"]');
            if (wb) wb.dataset.price = fresh.coin.price != null ? fresh.coin.price : "";
            cardCoins.set(mint, fresh.coin);
            renderCardBody(cardEl, fresh.coin);
            cc.innerHTML = ICONS.check;
            setTimeout(() => { cc.innerHTML = ICONS.refresh; }, 1100);
          } else {
            cc.innerHTML = ICONS.refresh;
            addMsg("bot err", "Refresh came up empty - try again in a few seconds.");
          }
        } catch (err) {
          cc.innerHTML = ICONS.refresh;
          addMsg("bot err", "Refresh failed - try again.");
        } finally {
          cc.disabled = false;
        }
        return;
      }
      if (act === "copy") {
        try {
          await navigator.clipboard.writeText(mint);
          cc.innerHTML = ICONS.check;
          setTimeout(() => { cc.innerHTML = ICONS.copy; }, 1100);
        } catch (err) {
          addMsg("bot err", "Couldn't copy - clipboard blocked.");
        }
        return;
      }
      return;
    }
    const cp = e.target.closest(".msg-copy");
    if (cp) {
      const bubble = cp.closest(".msg") && cp.closest(".msg").querySelector(".bubble");
      if (bubble) {
        try {
          await navigator.clipboard.writeText(bubble.innerText);
          cp.innerHTML = ICONS.check;
          setTimeout(() => { cp.innerHTML = ICONS.copy; }, 1100);
        } catch (err) { /* ignore */ }
      }
    }
  });

  // Wallet-card entry-price edits (PnL per token) - delegated like the rest.
  messagesEl.addEventListener("change", (e) => {
    const t = e.target;
    if (!t.classList || !t.classList.contains("wr-entry")) return;
    const row = t.closest("[data-mint]");
    const mint = row && row.dataset.mint;
    if (!mint) return;
    const cardEl = t.closest(".msg");
    const v = Number(t.value);
    const rerender = () => {
      const r = cardEl && walletRenders.get(cardEl);
      if (r) r();
      refreshPnlOnCards();
    };
    if (isFinite(v) && v > 0) {
      window.pilly.pnlSet(mint, v).then((saved) => {
        if (saved) pnlEntries[mint] = saved;
        rerender();
      });
    } else {
      window.pilly.pnlRemove(mint).then(() => {
        delete pnlEntries[mint];
        rerender();
      });
    }
  });

  function addTrendingCard(list) {
    const card = addEl("msg bot");
    const rows = list.slice(0, 10).map((c, i) => {
      const up = c.change24h == null || c.change24h >= 0;
      return `<div class="tr-row"><span class="tr-rank">${i + 1}</span><span class="tr-name">${escapeHtml(c.name)}${c.symbol ? ` <em>${escapeHtml(c.symbol)}</em>` : ""}</span><span class="tr-price">${c.price != null ? fmtUsd(c.price) : "-"}</span><span class="tr-chg ${up ? "up" : "down"}">${fmtPct(c.change24h)}</span><span class="tr-mcap">${c.mcap != null ? fmtUsd(c.mcap) : "-"}${c.volume24h != null ? `<small>vol ${fmtUsd(c.volume24h)}</small>` : ""}</span></div>`;
    }).join("");
    card.innerHTML = `<div class="trend-card"><div class="tr-head">🔥 Trending on Solana</div><div class="tr-headrow"><span class="tr-rank">#</span><span class="tr-name">Coin</span><span class="tr-price">Price</span><span class="tr-chg">24h</span><span class="tr-mcap">Mkt Cap<small>vol</small></span></div>${rows}</div>`;
  }

  const walletRenders = new WeakMap(); // cardEl -> re-render fn (keeps entry edits live)
  function walletCardHtml(w) {
    const short = `${String(w.wallet || "").slice(0, 6)}…${String(w.wallet || "").slice(-4)}`;
    const chg = w.change24h != null
      ? ` · <b class="${w.change24h >= 0 ? "up" : "down"}">${fmtPct(w.change24h)}</b>`
      : "";
    const rows = (w.tokens || []).slice(0, 8).map((t, i) => {
      const up = t.change24h == null || t.change24h >= 0;
      const pnl = pnlOf(t.mint, t.price);
      return `<div class="wr-row" data-mint="${escapeHtml(t.mint)}"><span class="tr-rank">${i + 1}</span><span class="tr-name">${escapeHtml(t.name)}${t.symbol ? ` <em>${escapeHtml(t.symbol)}</em>` : ""}</span><span class="tr-price">${t.price != null ? fmtUsd(t.price) : "-"}</span><span class="wr-pnl ${pnl ? (pnl.pct >= 0 ? "up" : "down") : ""}">${pnl ? fmtPnl(pnl.pct) : "-"}</span><input class="wr-entry" type="number" step="any" min="0" placeholder="entry" value="${pnl ? pnl.entry : ""}" title="Entry price (PnL)" /><span class="tr-vol">${t.usd != null ? fmtUsd(t.usd) : "no price"}</span></div>`;
    }).join("");
    const solRow = w.sol > 0
      ? `<div class="tr-row"><span class="tr-rank">◎</span><span class="tr-name">SOL</span><span class="tr-price">${w.sol.toFixed(4)}</span><span class="tr-chg"></span><span class="tr-vol">${w.solUsd > 0 ? fmtUsd(w.solUsd) : ""}</span></div>`
      : "";
    const note = (w.tokens || []).length
      ? `<div class="tr-note">est total <b>${fmtUsd(w.totalUsd)}</b> · type an entry price per token for PnL</div>`
      : `<div class="tr-note">no tokens - just SOL (est ${fmtUsd(w.totalUsd)})</div>`;
    return `<div class="trend-card"><div class="tr-head">💼 wallet ${escapeHtml(short)}${chg}</div>${solRow}${rows}${note}</div>`;
  }

  function addWalletCard(w) {
    const card = addEl("msg bot");
    const render = () => { card.innerHTML = walletCardHtml(w); };
    render();
    walletRenders.set(card, render);
  }

  async function send(text, task) {
    const trimmed = (text || "").trim();
    if (!trimmed || sendBtn.disabled) return;
    addMsg("user", escapeHtml(trimmed));
    history.push({ role: "user", content: trimmed });
    // Stage 3: let the pet know the mood of what the user just said.
    const mood = guessMood(trimmed);
    if (mood !== "flat") {
      window.pilly.petMood({ kind: mood });
      setAvatarMood(mood);
    }

    // Asked about trending / what to buy? Pull the live feed instead of a generic joke.
    let coinContext = "";
    let coinRead = "";
    let effectiveTask = task || "";
    let aiText = trimmed;
    const mint = detectMint(trimmed);
    if (!task && !mint && TRENDING_INTENT.test(trimmed)) {
      await runTrending(trimmed);
      return;
    }
    // "watchlist" / "alerts" intent opens the watchlist panel.
    if (!task && !mint && WATCH_INTENT.test(trimmed)) {
      openWatchlist();
      return;
    }
    // "score" intent opens the scorecard panel.
    if (!task && !mint && SCORE_INTENT.test(trimmed)) {
      openScorecard();
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
          addCoinCard(data.coin, { read: data.read || "", context: data.context || "" });
          coinContext = data.context;
          coinRead = data.read || "";
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
            addMsg("bot err", `Couldn't pull live data for <b>${escapeHtml(String(mint).slice(0, 10))}…</b> - the market APIs are throttled or it's not a known token. Try again in a few seconds or double-check the address.`);
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
      const res = await window.pilly.chat({ text: aiText, task: effectiveTask, history, coinContext, coinRead });
      typing.remove();
      if (res && res.reply) {
        const body = res.fallback
          ? `${escapeHtml(res.reply)}<span class="fb-tag">⚡ local read - AI missed the tape</span>`
          : escapeHtml(res.reply);
        addMsg("bot", body);
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
    if (chip.dataset.action === "watchlist") { openWatchlist(); return; }
    if (chip.dataset.action === "pick") { pickCoin(); return; }
    if (chip.dataset.action === "radar") { openRadar(); return; }
    if (chip.dataset.action === "calc") { openCalc(); return; }
    if (chip.dataset.action === "scorecard") { openScorecard(); return; }
    if (chip.dataset.action === "whales") { openWhales(); return; }
    // Prefill the prompt - the user types their text AFTER it and hits Enter.
    // (Sending immediately used to fire with empty content, so the AI had
    // nothing to rewrite.)
    const prefix = MEME_PREFIX[chip.dataset.task] || (chip.dataset.task + ": ");
    input.value = prefix;
    input.focus();
    input.setSelectionRange(prefix.length, prefix.length);
  });

  // ---- Collapsible chips row (buttons above the chat) ----
  const chipsToggle = document.getElementById("chipsToggle");
  const CHIPS_KEY = "pilly_chips_collapsed";
  function setChipsCollapsed(collapsed) {
    chips.classList.toggle("collapsed", collapsed);
    if (chipsToggle) chipsToggle.classList.toggle("collapsed", collapsed);
    try { localStorage.setItem(CHIPS_KEY, collapsed ? "1" : "0"); } catch (e) { /* ignore */ }
  }
  if (chipsToggle) {
    chipsToggle.addEventListener("click", () => {
      setChipsCollapsed(!chips.classList.contains("collapsed"));
    });
    // Restore the user's choice.
    let saved = false;
    try { saved = localStorage.getItem(CHIPS_KEY) === "1"; } catch (e) { /* ignore */ }
    if (saved) setChipsCollapsed(true);
  }

  // ---- Bubble style (settings → body.bs-*) ----
  function applyBubbleStyle(chat) {
    const s = chat && BUBBLE_STYLES.indexOf(chat.bubble) >= 0 ? chat.bubble : "sharp";
    document.body.classList.remove(...BUBBLE_STYLES.map((x) => "bs-" + x));
    document.body.classList.add("bs-" + s);
  }

  // ---- Chat message size (settings → body.fs-*) ----
  function applyChatFontSize(size) {
    const s = ["sm", "normal", "lg"].indexOf(size) >= 0 ? size : "normal";
    document.body.classList.remove("fs-sm", "fs-normal", "fs-lg");
    document.body.classList.add("fs-" + s);
  }

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

  // Hot-coin / Pilly's pick bubbles open the chat PRE-LOADED with that coin:
  // feed the mint straight into the normal send flow (coin card + AI read).
  let lastLoadedMint = "";
  window.pilly.onLoadCoin((coin) => {
    const mint = coin && coin.mint;
    if (!mint || sendBtn.disabled) return;
    if (mint === lastLoadedMint) {
      addMsg("bot", escapeHtml(coin.symbol ? `already on ${coin.symbol} - ask me anything.` : "already loaded - ask me anything."));
      return;
    }
    lastLoadedMint = mint;
    send(mint);
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

  // ---- Watchlist panel (v1.0.5) ----
  function setPanel(el, open) {
    if (!el) return;
    el.classList.toggle("hidden", !open);
    if (open) {
      settingsEl && settingsEl.classList.add("hidden");
      // Only one overlay panel at a time.
      [watchlistEl, radarEl, calcEl, scorecardEl, whaleEl].forEach((p) => {
        if (p && p !== el) p.classList.add("hidden");
      });
      if (radarEl && radarEl !== el) stopRadarTimer();
    }
  }

  async function renderWatchlist() {
    if (!watchRowsEl) return;
    try {
      const { items, prices } = await window.pilly.watchPrices();
      const list = Array.isArray(items) ? items : [];
      if (!list.length) {
        watchRowsEl.innerHTML = `<p class="hint">Nothing watched yet. Paste a coin, hit "👛 watch" on its card - or type <b>watch &lt;mint&gt;</b>.</p>`;
        if (watchStatusEl) watchStatusEl.textContent = "";
        return;
      }
      const rowsHtml = list
        .map((it) => {
          const p = prices && prices[it.mint];
          const chg = p && p.change24h;
          const up = chg == null || chg >= 0;
          const alertVal = it.alertPct != null ? it.alertPct : "";
          const pnl = pnlOf(it.mint, p && p.price);
          const entry = pnl ? pnl.entry : (pnlEntries[it.mint] || "");
          return `<div class="wl-row" data-mint="${escapeHtml(it.mint)}">
            <div class="wl-main">
              <strong>${escapeHtml(it.symbol || it.name || "coin")}</strong>
              <small>${escapeHtml(it.name || "")}</small>
            </div>
            <div class="wl-price ${up ? "up" : "down"}">${p && p.price != null ? fmtUsd(p.price) : "…"}<small class="wl-pnl ${pnl ? (pnl.pct >= 0 ? "up" : "down") : ""}">${pnl ? fmtPnl(pnl.pct) : "no entry"}</small></div>
            <div class="wl-chg ${up ? "up" : "down"}">${chg != null ? fmtPct(chg) : "-"}</div>
            <input class="wl-entry" type="number" step="any" min="0" placeholder="entry" value="${escapeHtml(entry)}" title="Entry price (PnL)" />
            <input class="wl-alert" type="number" min="1" step="1" placeholder="±%" value="${escapeHtml(alertVal)}" title="24h alert %" />
            <button class="wl-remove" title="Remove">✕</button>
          </div>`;
        })
        .join("");

      // Portfolio PnL summary - rolled up from every tracked token with an entry price.
      let statsHtml = "";
      const entered = [];
      for (const it of list) {
        const price = prices && prices[it.mint] ? prices[it.mint].price : null;
        const pnl = pnlOf(it.mint, price);
        if (pnl) entered.push({ sym: it.symbol || it.name || "coin", pct: pnl.pct });
      }
      if (entered.length) {
        const avg = entered.reduce((a, x) => a + x.pct, 0) / entered.length;
        const best = entered.reduce((a, x) => (x.pct > a.pct ? x : a), entered[0]);
        const worst = entered.reduce((a, x) => (x.pct < a.pct ? x : a), entered[0]);
        statsHtml = `<div class="wl-stats">
          <div class="wl-stat"><small>Avg</small><b class="${avg >= 0 ? "up" : "down"}">${fmtPnl(avg)}</b></div>
          <div class="wl-stat"><small>Best</small><b class="up">${escapeHtml(best.sym)} ${fmtPnl(best.pct)}</b></div>
          <div class="wl-stat"><small>Worst</small><b class="down">${escapeHtml(worst.sym)} ${fmtPnl(worst.pct)}</b></div>
          <div class="wl-stat"><small>Entries</small><b>${entered.length}/${list.length}</b></div>
        </div>`;
      }
      watchRowsEl.innerHTML = statsHtml + rowsHtml;
      if (watchStatusEl) watchStatusEl.textContent = `${list.length} watched · refreshed ${new Date().toLocaleTimeString()}`;
      // wire row actions
      watchRowsEl.querySelectorAll(".wl-row").forEach((row) => {
        const mint = row.dataset.mint;
        const alertInput = row.querySelector(".wl-alert");
        alertInput.addEventListener("change", () => {
          window.pilly.watchAlert(mint, alertInput.value).then(() => renderWatchlist());
        });
        alertInput.addEventListener("keydown", (e) => {
          if (e.key === "Enter") alertInput.blur();
        });
        const entryInput = row.querySelector(".wl-entry");
        entryInput.addEventListener("change", () => {
          const v = Number(entryInput.value);
          if (!isFinite(v) || v <= 0) {
            window.pilly.pnlRemove(mint).then(() => {
              delete pnlEntries[mint];
              renderWatchlist();
              refreshPnlOnCards();
            });
            return;
          }
          window.pilly.pnlSet(mint, v).then((saved) => {
            if (saved) pnlEntries[mint] = saved;
            renderWatchlist();
            refreshPnlOnCards();
          });
        });
        entryInput.addEventListener("keydown", (e) => {
          if (e.key === "Enter") entryInput.blur();
        });
        row.querySelector(".wl-remove").addEventListener("click", async () => {
          await window.pilly.watchRemove(mint);
          renderWatchlist();
          refreshWatchButtons();
        });
      });
    } catch (e) {
      if (watchRowsEl) watchRowsEl.innerHTML = `<p class="hint">Couldn't load the watchlist.</p>`;
    }
  }

  // Re-render PnL chips on all coin cards after an entry change.
  function refreshPnlOnCards() {
    document.querySelectorAll(".msg .coin-card").forEach((cc) => {
      const cardEl = cc.closest(".msg");
      const wb = cardEl && cardEl.querySelector('[data-act="watch"]');
      const mint = wb && wb.dataset.mint;
      const coin = mint && cardCoins.get(mint);
      if (coin) renderCardBody(cardEl, coin);
    });
  }

  // Update every "watch" button on already-rendered coin cards.
  async function refreshWatchButtons() {
    try {
      document.querySelectorAll(".cc-foot").forEach((foot) => refreshWatchLabel(foot));
    } catch (e) { /* ignore */ }
  }

  function openWatchlist() {
    setPanel(watchlistEl, true);
    renderWatchlist();
  }
  function closeWatchlist() {
    setPanel(watchlistEl, false);
  }

  watchlistBtn && watchlistBtn.addEventListener("click", openWatchlist);
  document.getElementById("watchlistClose") && document.getElementById("watchlistClose").addEventListener("click", closeWatchlist);
  document.getElementById("watchRefreshBtn") && document.getElementById("watchRefreshBtn").addEventListener("click", () => {
    if (watchStatusEl) watchStatusEl.textContent = "refreshing…";
    renderWatchlist();
  });

  // Alert fired in the main process → surface it in the chat.
  window.pilly.onWatchAlert((m) => {
    if (m && m.symbol) {
      addMsg("bot", `🔔 <b>${escapeHtml(m.symbol)}</b> moved <b class="${m.chg >= 0 ? "up" : "down"}">${m.chg >= 0 ? "+" : ""}${Number(m.chg).toFixed(1)}%</b> (24h) - your watchlist alert!`);
    }
  });
  window.pilly.onWatchRefresh(() => {
    if (watchlistEl && !watchlistEl.classList.contains("hidden")) renderWatchlist();
  });

  // "watchlist" / "alerts" intent in the input opens the watchlist panel, which
  // holds the per-coin price-alert controls.
  const WATCH_INTENT = /\b(watchlist|watch ?list|alert|alerts)\b/i;
  // "score" / "scorecard" intent opens Pilly's scorecard panel.
  const SCORE_INTENT = /\b(scorecard|my score|show my score|score)\b/i;

  // ---- Radar panel (fresh launches) ----
  const radarEl = document.getElementById("radar");
  const radarRowsEl = document.getElementById("radarRows");
  const radarStatusEl = document.getElementById("radarStatus");
  let radarTimer = null;
  let lastRadarMints = new Set();

  function ageShort(ms) {
    if (ms == null || !isFinite(ms)) return "";
    const m = Math.max(0, Math.floor((Date.now() - ms) / 60000));
    return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`;
  }

  let radarBusy = false;
  async function renderRadar() {
    if (!radarRowsEl || radarBusy) return;
    radarBusy = true;
    try {
      const data = await window.pilly.radar();
      const list = Array.isArray(data && data.list) ? data.list : [];
      if (!list.length) {
        radarRowsEl.innerHTML = `<p class="hint">No fresh launches right now - give it a minute.</p>`;
        if (radarStatusEl) radarStatusEl.textContent = "";
        return;
      }
      const seen = new Set(lastRadarMints);
      lastRadarMints = new Set(list.map((c) => c.mint));
      radarRowsEl.innerHTML = list
        .map((c) => {
          const isNew = !seen.size || !seen.has(c.mint);
          const up = c.change24h == null || c.change24h >= 0;
          const age = ageShort(c.createdAt);
          return `<div class="wl-row radar-row" data-mint="${escapeHtml(c.mint)}">
            <div class="wl-main"><strong>${escapeHtml(c.name)}${c.symbol ? ` <em>${escapeHtml(c.symbol)}</em>` : ""}${isNew ? ` <span class="rad-new">NEW</span>` : ""}</strong><small>${c.price != null ? fmtUsd(c.price) : "- price"}</small></div>
            <div class="wl-chg ${up ? "up" : "down"}">${c.change24h != null ? fmtPct(c.change24h) : ""}</div>
            <div class="wl-mcap">${c.mcap != null ? fmtUsd(c.mcap) : "-"}${age ? `<small>${age}</small>` : ""}</div>
            <span class="rad-go">⚡</span>
          </div>`;
        })
        .join("");
      if (radarStatusEl) radarStatusEl.textContent = `${list.length} fresh · updated ${new Date().toLocaleTimeString()}`;
      radarRowsEl.querySelectorAll(".radar-row").forEach((row) => {
        row.addEventListener("click", async () => {
          const mint = row.dataset.mint;
          const typing = addTyping();
          setThinking(true);
          try {
            const full = await window.pilly.coin(mint);
            typing.remove();
            if (full && full.coin) {
              addCoinCard(full.coin, { read: full.read || "", context: full.context || "" });
              setPanel(radarEl, false);
              stopRadarTimer();
            } else {
              addMsg("bot err", "Couldn't pull live data for that one - try again.");
            }
          } catch (e) {
            typing.remove();
            addMsg("bot err", "Pilly hit a wall - try again.");
          } finally {
            setThinking(false);
          }
        });
      });
    } catch (e) {
      if (radarRowsEl) radarRowsEl.innerHTML = `<p class="hint">Radar unavailable - check connection.</p>`;
    } finally {
      radarBusy = false;
    }
  }

  function stopRadarTimer() {
    if (radarTimer) { clearInterval(radarTimer); radarTimer = null; }
  }
  function openRadar() {
    setPanel(radarEl, true);
    renderRadar();
    stopRadarTimer();
    radarTimer = setInterval(renderRadar, 60000);
  }
  function closeRadar() {
    setPanel(radarEl, false);
    stopRadarTimer();
  }
  document.getElementById("radarClose") && document.getElementById("radarClose").addEventListener("click", closeRadar);
  document.getElementById("radarRefreshBtn") && document.getElementById("radarRefreshBtn").addEventListener("click", () => {
    if (radarStatusEl) radarStatusEl.textContent = "refreshing…";
    renderRadar();
  });

  // ---- Position calculator ----
  const calcEl = document.getElementById("calc");
  const calcSol = document.getElementById("calcSol");
  const calcPrice = document.getElementById("calcPrice");
  const calcRisk = document.getElementById("calcRisk");
  const calcStop = document.getElementById("calcStop");
  const calcOut = document.getElementById("calcOut");
  const calcRiskOut = document.getElementById("calcRiskOut");

  function fmtNum(v) {
    if (!isFinite(v)) return "-";
    if (v >= 1e6) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
    if (v >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
    if (v >= 1) return v.toFixed(4);
    const dec = Math.min(8, Math.max(2, Math.ceil(-Math.log10(v)) + 2));
    return v.toFixed(dec);
  }

  async function recalcCalc() {
    if (!calcOut) return;
    const sol = Number(calcSol.value);
    const price = Number(calcPrice.value);
    let solUsd = null;
    try { solUsd = await window.pilly.solPrice(); } catch (e) { /* ignore */ }
    const solPriceUsd = solUsd && solUsd.price ? Number(solUsd.price) : null;
    if (!isFinite(sol) || sol <= 0) {
      calcOut.innerHTML = `<p class="hint">Enter SOL to spend.</p>`;
    } else {
      const value = solPriceUsd ? sol * solPriceUsd : null;
      const tokens = isFinite(price) && price > 0 ? sol * (value || 1) / price : null;
      calcOut.innerHTML = `<div class="calc-line">${fmtNum(sol)} SOL${solPriceUsd ? ` ≈ <b>${fmtUsd(value)}</b>` : ""}</div>${tokens != null ? `<div class="calc-line">→ <b>${fmtNum(tokens)} tokens</b> @ ${fmtUsd(price)}</div>` : `<div class="calc-line hint">add coin price to get tokens</div>`}`;
    }
    const risk = Number(calcRisk.value);
    const stop = Number(calcStop.value);
    if (isFinite(risk) && risk > 0 && isFinite(stop) && stop > 0) {
      const positionUsd = risk / (stop / 100);
      const tokensRisk = isFinite(price) && price > 0 ? positionUsd / price : null;
      calcRiskOut.innerHTML = `<div class="calc-line">Risk $${risk.toFixed(0)} @ ${stop}% stop → position <b>${fmtUsd(positionUsd)}</b></div>${tokensRisk != null ? `<div class="calc-line">→ <b>${fmtNum(tokensRisk)} tokens</b> @ ${fmtUsd(price)}</div>` : ""}`;
    } else {
      calcRiskOut.innerHTML = `<p class="hint">Enter risk $ and stop % for risk sizing.</p>`;
    }
  }

  function openCalc() {
    setPanel(calcEl, true);
    // Auto-fill price from the most recent coin card.
    if (!calcPrice.value) {
      const last = Array.from(cardCoins.values()).pop();
      if (last && last.price) calcPrice.value = last.price;
    }
    recalcCalc();
  }
  function closeCalc() {
    setPanel(calcEl, false);
  }
  document.getElementById("calcClose") && document.getElementById("calcClose").addEventListener("click", closeCalc);
  document.getElementById("calcRefreshBtn") && document.getElementById("calcRefreshBtn").addEventListener("click", recalcCalc);
  [calcSol, calcPrice, calcRisk, calcStop].forEach((el) => {
    if (el) el.addEventListener("input", recalcCalc);
  });

  // ---- Pilly's scorecard (track record) ----
  function scPct(p) {
    const n = Number(p);
    if (!isFinite(n)) return "-";
    return (n >= 0 ? "+" : "") + n.toFixed(1) + "%";
  }

  function buildScorecardText(d) {
    const picks = Array.isArray(d && d.picks) ? d.picks : [];
    const st = (d && d.stats) || {};
    const lines = [];
    lines.push("🏆 Pilly's Scorecard");
    lines.push(`Picks: ${st.total || 0} · Wins: ${st.wins || 0} · Losses: ${st.losses || 0} · Win rate: ${st.winRate != null ? st.winRate + "%" : "-"}`);
    if (st.avgPct != null) lines.push(`Avg move: ${scPct(st.avgPct)}`);
    if (st.best && st.best.symbol) lines.push(`Best: ${st.best.symbol} ${scPct(st.best.pct)}`);
    for (const p of picks) {
      const res = p.result === "win" ? "+" + (p.pct || 0).toFixed(1) + "%" : p.result === "loss" ? (p.pct || 0).toFixed(1) + "%" : "open";
      lines.push(`${p.source === "hot" ? "🔥" : p.source === "sniper" ? "🔫" : p.source === "whale" ? "🐋" : "🎯"} ${p.symbol || p.name || "coin"}: ${res}`);
    }
    lines.push("made by Pilly - free AI memecoin agent (PillCrew)");
    return lines.join("\n");
  }

  async function renderScorecard() {
    if (!scRowsEl) return;
    try {
      const d = await window.pilly.picks();
      const picks = Array.isArray(d && d.picks) ? d.picks : [];
      const st = (d && d.stats) || {};
      const g = (d && d.general) || {};
      const winRate = st.winRate != null ? st.winRate + "%" : "-";
      const avg = st.avgPct != null ? scPct(st.avgPct) : "-";
      if (scStatsEl) {
        const winPct = st.winRate != null ? Math.max(0, Math.min(100, st.winRate)) : 0;
        scStatsEl.innerHTML = `<div class="sc-grid">
          <div class="sc-cell"><b>${st.total != null ? st.total : 0}</b><span>picks</span></div>
          <div class="sc-cell up"><b>${st.wins != null ? st.wins : 0}</b><span>wins</span></div>
          <div class="sc-cell down"><b>${st.losses != null ? st.losses : 0}</b><span>losses</span></div>
          <div class="sc-cell"><b>${winRate}</b><span>win rate</span></div>
          <div class="sc-cell"><b>${avg}</b><span>avg move</span></div>
          <div class="sc-cell"><b>${g.coins != null ? g.coins : 0}</b><span>coins read</span></div>
        </div>
        <div class="sc-winbar"><i style="width:${winPct}%"></i></div>`;
      }
      if (!picks.length) {
        scRowsEl.innerHTML = `<p class="hint">No picks recorded yet. Hot-radar flags and Pilly's picks will show up here with their outcome - receipts, on chain.</p>`;
      } else {
        scRowsEl.innerHTML = picks.map((p) => {
          const res = p.result === "win" ? `<b class="up">+${(p.pct || 0).toFixed(1)}%</b>`
            : p.result === "loss" ? `<b class="down">${(p.pct || 0).toFixed(1)}%</b>`
            : `<span class="sc-open">open</span>`;
          const when = new Date(p.ts).toLocaleDateString();
          return `<div class="wl-row sc-row">
            <div class="wl-main"><strong>${escapeHtml(p.symbol || p.name || "coin")} ${p.source === "hot" ? "🔥" : p.source === "sniper" ? "🔫" : p.source === "whale" ? "🐋" : "🎯"}</strong><small>${when} · ${p.price != null ? fmtUsd(p.price) : "-"} at call</small></div>
            <div class="sc-res">${res}</div>
          </div>`;
        }).join("");
      }
      if (scStatusEl) scStatusEl.textContent = `updated ${new Date().toLocaleTimeString()}`;
    } catch (e) {
      if (scRowsEl) scRowsEl.innerHTML = `<p class="hint">Scorecard unavailable - check connection.</p>`;
    }
  }

  function openScorecard() {
    setPanel(scorecardEl, true);
    renderScorecard();
  }
  function closeScorecard() {
    setPanel(scorecardEl, false);
  }
  document.getElementById("scorecardClose") && document.getElementById("scorecardClose").addEventListener("click", closeScorecard);
  document.getElementById("scCopyBtn") && document.getElementById("scCopyBtn").addEventListener("click", async () => {
    try {
      const d = await window.pilly.picks();
      const r = await window.pilly.copyText(buildScorecardText(d));
      if (scStatusEl) scStatusEl.textContent = (r && r.ok) ? "copied ✓ - paste it anywhere" : "copy failed";
    } catch (e) {
      if (scStatusEl) scStatusEl.textContent = "copy failed";
    }
  });

  // ---- Whale follow panel ----
  function setWhaleStatus(msg, ok) {
    if (whaleStatusEl) {
      whaleStatusEl.textContent = msg;
      whaleStatusEl.className = "status " + (ok ? "ok" : "err");
    }
  }

  async function renderWhales() {
    if (!whaleRowsEl) return;
    try {
      const whales = await window.pilly.whalesList();
      const list = Array.isArray(whales) ? whales : [];
      if (!list.length) {
        whaleRowsEl.innerHTML = `<p class="hint">No whales followed yet. Paste a smart-money wallet above - Pilly will ping you the moment it opens a new position.</p>`;
      } else {
        whaleRowsEl.innerHTML = list.map((w) => {
          const last = w.lastSeen ? new Date(w.lastSeen).toLocaleTimeString() : "-";
          return `<div class="wl-row sc-row" data-addr="${escapeHtml(w.address)}">
            <div class="wl-main"><strong>${escapeHtml(w.label || w.address)}</strong><small>${escapeHtml(w.address.slice(0, 6))}…${escapeHtml(w.address.slice(-4))} · ${(w.mints || []).length} holdings · seen ${last}</small></div>
            <button class="wl-remove" title="Unfollow">✕</button>
          </div>`;
        }).join("");
      }
      whaleRowsEl.querySelectorAll(".wl-remove").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const addr = btn.closest(".sc-row").dataset.addr;
          await window.pilly.whaleRemove(addr);
          setWhaleStatus("unfollowed", true);
          renderWhales();
        });
      });
    } catch (e) {
      if (whaleRowsEl) whaleRowsEl.innerHTML = `<p class="hint">Whale list unavailable.</p>`;
    }
  }

  function openWhales() {
    setPanel(whaleEl, true);
    renderWhales();
  }
  function closeWhales() {
    setPanel(whaleEl, false);
  }
  document.getElementById("whalesClose") && document.getElementById("whalesClose").addEventListener("click", closeWhales);
  document.getElementById("whaleAddBtn") && document.getElementById("whaleAddBtn").addEventListener("click", async () => {
    const addr = whaleAddrEl && whaleAddrEl.value.trim();
    if (!addr) { setWhaleStatus("paste a wallet address first", false); return; }
    const r = await window.pilly.whaleAdd(addr, "");
    setWhaleStatus(r && r.ok ? "followed ✓ - Pilly is watching" : (r && r.error) || "failed", !!r && !!r.ok);
    if (r && r.ok && whaleAddrEl) whaleAddrEl.value = "";
    renderWhales();
  });
  document.getElementById("whaleCheckBtn") && document.getElementById("whaleCheckBtn").addEventListener("click", async () => {
    setWhaleStatus("checking wallets…", false);
    await window.pilly.whaleCheck();
    setWhaleStatus("checked ✓", true);
    renderWhales();
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
      temperature: isFinite(Number(setTemp.value)) ? Number(setTemp.value) : 0.8,
      maxTokens: isFinite(Number(setTokens.value)) ? Number(setTokens.value) : 240,
      pet: {
        name: petName.value.trim() || "Pilly",
        mood: petMood.value,
        theme: petTheme.value,
        size: petSize.value,
        bubbles: petBubbles.checked,
        bubbleSize: petBubbleSize.value,
        bubbleText: petBubbleText.value,
        bubbleStyle: petBubbleStyle.value,
        soundVol: isFinite(Number(petSoundVol.value)) ? Number(petSoundVol.value) : 60,
        walkMode: petWalkMode.value,
        stopFreq: petStopFreq.value,
        questions: petQuestions.checked,
        sounds: petSounds.checked,
        // v1.1.0 proactive features - MUST be included here or Save() would
        // silently reset all five toggles back to their defaults.
        hotAlerts: petHotAlerts.checked,
        hotPct: Number(petHotPct.value) || 10,
        alertSound: petAlertSound.checked,
        dailyBrief: petDailyBrief.checked,
        pillyPick: petPillyPick.checked,
        sniper: petSniper.checked,
        whaleAlerts: petWhaleAlerts.checked,
        portfolioMood: petPortfolioMood.checked,
      },
      chat: {
        bubble: chatBubble.value,
        alwaysOnTop: chatOnTop ? chatOnTop.checked : true,
        fontSize: chatFontSize ? chatFontSize.value : "normal",
      },
    };
  }

  function setStatus(msg, ok) {
    settingsStatus.textContent = msg;
    settingsStatus.className = "status " + (ok ? "ok" : "err");
  }

  async function openSettings() {
    // Settings is a full-screen overlay - close any open panel + stop its
    // timers (radar kept polling a hidden panel while settings was on top).
    [watchlistEl, radarEl, calcEl, scorecardEl, whaleEl].forEach((p) => p && p.classList.add("hidden"));
    stopRadarTimer();
    const s = await window.pilly.settingsGet();
    setTemp.value = s.temperature != null ? s.temperature : 0.8;
    setTokens.value = s.maxTokens != null ? s.maxTokens : 240;
    const p = s.pet || {};
    petTheme.value = p.theme || "green";
    petSize.value = p.size || "md";
    petBubbleSize.value = p.bubbleSize || "md";
    petBubbleText.value = p.bubbleText || "md";
    petBubbleStyle.value = p.bubbleStyle || "default";
    petSoundVol.value = p.soundVol != null ? p.soundVol : 60;
    petBubbles.checked = p.bubbles !== false;
    petWalkMode.value = p.walkMode || "taskbar";
    petStopFreq.value = p.stopFreq || "normal";
    petQuestions.checked = p.questions !== false;
    petSounds.checked = p.sounds !== false;
    petHotAlerts.checked = p.hotAlerts !== false;
    petHotPct.value = String(p.hotPct != null ? p.hotPct : 10);
    petAlertSound.checked = p.alertSound !== false;
    petDailyBrief.checked = p.dailyBrief !== false;
    petPillyPick.checked = p.pillyPick !== false;
    petSniper.checked = p.sniper !== false;
    petWhaleAlerts.checked = p.whaleAlerts !== false;
    petPortfolioMood.checked = p.portfolioMood !== false;
    petName.value = p.name || "Pilly";
    petMood.value = p.mood || "neutral";
    applyPetTheme(p);
    const c = s.chat || {};
    chatBubble.value = BUBBLE_STYLES.indexOf(c.bubble) >= 0 ? c.bubble : "sharp";
    applyBubbleStyle(c);
    if (chatOnTop) chatOnTop.checked = c.alwaysOnTop !== false;
    if (chatFontSize) chatFontSize.value = c.fontSize || "normal";
    applyChatFontSize(c.fontSize || "normal");
    buildTierRows(s);
    settingsEl.classList.remove("hidden");
    setStatus("", false);
  }

  document.getElementById("gearBtn").addEventListener("click", openSettings);
  document.getElementById("settingsClose").addEventListener("click", () => settingsEl.classList.add("hidden"));

  // Live pet preview: apply pet options immediately while tweaking.
  [petTheme, petSize, petBubbles, petBubbleSize, petBubbleText, petBubbleStyle, petSoundVol, petWalkMode, petStopFreq, petQuestions, petSounds, petName, petMood, petHotAlerts, petHotPct, petAlertSound, petDailyBrief, petPillyPick, petSniper, petWhaleAlerts, petPortfolioMood].forEach((el) => {
    el.addEventListener("change", () => {
      const pet = {
        name: petName.value.trim() || "Pilly",
        mood: petMood.value,
        theme: petTheme.value,
        size: petSize.value,
        bubbles: petBubbles.checked,
        bubbleSize: petBubbleSize.value,
        bubbleText: petBubbleText.value,
        bubbleStyle: petBubbleStyle.value,
        soundVol: isFinite(Number(petSoundVol.value)) ? Number(petSoundVol.value) : 60,
        walkMode: petWalkMode.value,
        stopFreq: petStopFreq.value,
        questions: petQuestions.checked,
        sounds: petSounds.checked,
        hotAlerts: petHotAlerts.checked,
        hotPct: Number(petHotPct.value) || 10,
        alertSound: petAlertSound.checked,
        dailyBrief: petDailyBrief.checked,
        pillyPick: petPillyPick.checked,
        sniper: petSniper.checked,
        whaleAlerts: petWhaleAlerts.checked,
        portfolioMood: petPortfolioMood.checked,
      };
      applyPetTheme(pet);
      window.pilly.petApply(pet);
    });
  });
  // Chat bubble style applies instantly (no save needed to preview).
  if (chatBubble) chatBubble.addEventListener("change", () => applyBubbleStyle({ bubble: chatBubble.value }));
  // Always-on-top applies instantly (persisted with Save).
  if (chatOnTop) chatOnTop.addEventListener("change", () => window.pilly.setAlwaysOnTop(chatOnTop.checked).catch(() => {}));
  // Chat message size applies instantly too.
  if (chatFontSize) chatFontSize.addEventListener("change", () => applyChatFontSize(chatFontSize.value));
  // Window position is remembered automatically; this buttons snaps it back.
  const winResetBtn = document.getElementById("winResetBtn");
  if (winResetBtn) winResetBtn.addEventListener("click", async () => {
    winResetBtn.disabled = true;
    const t = winResetBtn.textContent;
    winResetBtn.textContent = "↩️ Resetting…";
    try {
      await window.pilly.resetWindow();
      setStatus("Window position reset ✓ - reopens above the tray.", true);
    } catch (e) {
      setStatus("Couldn't reset window position.", false);
    } finally {
      winResetBtn.disabled = false;
      winResetBtn.textContent = t;
    }
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

  // Theme the chat avatar with the saved pet color + bubble style on startup.
  window.pilly.settingsGet().then((s) => {
    applyPetTheme(s && s.pet);
    applyBubbleStyle(s && s.chat);
    applyChatFontSize((s && s.chat && s.chat.fontSize) || "normal");
  }).catch(() => {});

  // Show the app version in the settings footer.
  window.pilly.version().then((v) => {
    const el = document.getElementById("appVersion");
    if (el && v) el.textContent = v;
  }).catch(() => {});

  // ---- Auto-update UI (v1.1.0) ----
  const updVersionEl = document.getElementById("updVersion");
  const updStatusEl = document.getElementById("updStatus");
  const updCheckBtn = document.getElementById("updCheckBtn");
  const updInstallBtn = document.getElementById("updInstallBtn");
  const UPD_BADGE = { idle: "", checking: "…", available: "ok", downloading: "…", ready: "ok", latest: "ok", error: "err" };
  function renderUpdateStatus(s) {
    if (updVersionEl && s) updVersionEl.textContent = s.version || "—";
    if (updStatusEl && s) {
      updStatusEl.textContent = s.message || s.state || "—";
      updStatusEl.className = "status" + (UPD_BADGE[s.state] ? " " + UPD_BADGE[s.state] : "");
    }
    if (updInstallBtn) updInstallBtn.hidden = !(s && s.state === "ready");
  }
  if (updCheckBtn) updCheckBtn.addEventListener("click", async () => {
    updCheckBtn.disabled = true;
    try {
      const r = await window.pilly.updateCheck();
      renderUpdateStatus(r && r.state);
    } catch (e) { /* ignore */ }
    setTimeout(() => { if (updCheckBtn) updCheckBtn.disabled = false; }, 1500);
  });
  if (updInstallBtn) updInstallBtn.addEventListener("click", async () => {
    try { await window.pilly.updateInstall(); } catch (e) { /* ignore */ }
  });
  if (window.pilly.onUpdateStatus) window.pilly.onUpdateStatus(renderUpdateStatus);
  window.pilly.updateState && window.pilly.updateState().then((s) => renderUpdateStatus(s)).catch(() => {});

  // Bring back the previous conversation (minimize/restart must not lose it).
  restoreChat();
  startFaceAnim();

  // ---- Live coin-card auto-refresh (15s, visible cards only) ----
  let cardTickBusy = false;
  function isCardVisible(cardEl) {
    const rect = cardEl.getBoundingClientRect();
    const mr = messagesEl.getBoundingClientRect();
    return rect.bottom > mr.top && rect.top < mr.bottom;
  }
  async function tickCards() {
    if (cardTickBusy) return;
    cardTickBusy = true;
    try {
      const cards = Array.from(messagesEl.querySelectorAll(".msg")).filter((m) => m.querySelector(".coin-card"));
      const visible = cards.filter(isCardVisible).slice(0, 6);
      await Promise.all(visible.map(async (cardEl) => {
        const wb = cardEl.querySelector('[data-act="watch"]');
        const mint = wb && wb.dataset.mint;
        if (!mint) return;
        try {
          const fresh = await window.pilly.coin(mint, true); // silent: no stat/pet spam
          if (!fresh || !fresh.coin) return;
          const old = cardCoins.get(mint);
          const changed = !old || old.price !== fresh.coin.price || old.change24h !== fresh.coin.change24h;
          cardCoins.set(mint, fresh.coin);
          const rb = cardEl.querySelector('[data-act="read"]');
          if (rb) rb.dataset.read = fresh.read || "";
          const wbtn = cardEl.querySelector('[data-act="watch"]');
          if (wbtn) wbtn.dataset.price = fresh.coin.price != null ? fresh.coin.price : "";
          if (changed) {
            renderCardBody(cardEl, fresh.coin);
            // Restored cards have no cached sparkline - fetch it once.
            if (!cardSparks.has(mint)) {
              window.pilly.spark(mint).then((s) => {
                if (s && s.points && s.points.length >= 2) { cardSparks.set(mint, s); drawSpark(cardEl, s); }
              }).catch(() => {});
            }
          }
        } catch (e) { /* keep old data */ }
      }));
    } finally {
      cardTickBusy = false;
    }
  }
  setInterval(tickCards, 15000);
  loadPnl();
})();

