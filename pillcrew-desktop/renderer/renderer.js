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
  const chatLanguage = document.getElementById("chatLanguage");

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

  const WELCOME_HTML = () => t("welcomeHtml");

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

  // ---- i18n ----
  const t = (k, v) => window.I18N.t(k, v);

  // When the language flips, re-render everything that was built dynamically.
  window.addEventListener("pilly:i18n", () => {
    applyMemeLang();
    if (watchlistEl && !watchlistEl.classList.contains("hidden")) renderWatchlist();
    if (radarEl && !radarEl.classList.contains("hidden")) renderRadar();
    if (calcEl && !calcEl.classList.contains("hidden")) recalcCalc();
    if (scorecardEl && !scorecardEl.classList.contains("hidden")) renderScorecard();
    if (whaleEl && !whaleEl.classList.contains("hidden")) renderWhales();
    if (trendingCardEl && trendingCardEl.isConnected && lastTrending) {
      trendingCardEl.innerHTML = trendingCardHtml(lastTrending.list, lastTrending.staleAt);
    }
    walletCardEls.forEach((el) => {
      const r = el && el.isConnected && walletRenders.get(el);
      if (r) r();
    });
    document.querySelectorAll(".msg .coin-card").forEach((cc) => {
      const cardEl = cc.closest(".msg");
      const wb = cardEl && cardEl.querySelector('[data-act="watch"]');
      const mint = wb && wb.dataset.mint;
      const coin = mint && cardCoins.get(mint);
      if (coin) renderCardBody(cardEl, coin);
    });
    document.querySelectorAll(".cc-foot").forEach((foot) => refreshWatchLabel(foot));
  });

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

  // "remind me in 10 minutes to check SOL" -> set a one-shot reminder.
  const REMINDER_INTENT = /(^|\s)(remind me|set a reminder|reminder|nag me|ping me)(\s|$)/i;

  // Focus / pomodoro chat commands (v1.1.1).
  const FOCUS_START_INTENT = /(^|\s)start\s+(a\s+)?(focus|pomodoro)\b/i;
  const FOCUS_ALONE_INTENT = /^(focus|pomodoro|pomodoro timer|start focus timer)$/i;
  const FOCUS_STOP_INTENT = /(stop|end|cancel)\s+(the\s+)?(focus|pomodoro)\b/i;
  const FOCUS_STATUS_INTENT = /(focus|pomodoro)\s+(status|state|left|remaining)\b/i;
  const FOCUS_PAUSE_INTENT = /(pause|hold)\s+(the\s+)?(focus|pomodoro|timer)\b/i;
  const FOCUS_RESUME_INTENT = /(resume|continue|unpause)\s+(the\s+)?(focus|pomodoro|timer)\b/i;
  const ACTIVITY_YESTERDAY_INTENT = /(yesterday|wczoraj)/i;
  const ACTIVITY_TODAY_INTENT = /(how\s+(was\s+)?(my|the|your)\s+day|my\s+day|today|activity|stats|jak\s+(mi\s+)?posz[lł]o|podsumowan|podsumuj|dzisiaj|dzi[sś])/i;
  const STREAK_INTENT = /(streak|in\s+a\s+row|z\s+rz[ęe]du|seria)/i;

  // Meme prompt prefixes (synced from pilly.js via IPC at startup).
  const MEME_PREFIX = {
    rewrite: "meme this: ",
    caption: "caption this: ",
    name: "give me an absurd name for this: ",
    react: "react to this: ",
    roast: "roast this lightly: ",
  };
  const MEME_PREFIX_ZH = {
    rewrite: "给这个币写个梗：",
    caption: "给这个币配个文案：",
    name: "给这个币起个离谱的名字：",
    react: "对这个币的反应：",
    roast: "轻轻吐槽一下这个币：",
  };
  // The main process may ship its own prefixes; remember them so a language
  // switch can layer the zh set on top without losing them.
  let MEME_BASE = Object.assign({}, MEME_PREFIX);
  function applyMemeLang() {
    Object.assign(MEME_PREFIX, MEME_BASE);
    if (window.I18N.effective() === "zh") Object.assign(MEME_PREFIX, MEME_PREFIX_ZH);
  }
  window.pilly.memePrompts().then((p) => {
    if (p) {
      Object.assign(MEME_PREFIX, p);
      MEME_BASE = Object.assign({}, p);
    }
    applyMemeLang();
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
    const timeEl = document.createElement("span");
    timeEl.className = "msg-time";
    timeEl.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    m.appendChild(timeEl);
    const cp = document.createElement("button");
    cp.type = "button";
    cp.className = "msg-copy";
    cp.title = t("copyMsg");
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
    cardCoins.clear();
    cardSparks.clear();
    try { localStorage.removeItem(CHAT_KEY); } catch (e) { /* ignore */ }
    addMsg("bot", WELCOME_HTML());
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
    plush: { c1: "#33b3bd", c2: "#0f8389", c3: "#0a5d62", glow: "rgba(51,179,189,0.5)" },
    ball: { c1: "#73c3c0", c2: "#217174", c3: "#085960", glow: "rgba(115,195,192,0.5)" },
  };
  let activePetTheme = "ball";
  let defaultFaceMood = "";
  function applyName(name) {
    const n = String(name || "").trim();
    if (!n) return;
    const el = document.querySelector(".bar-id strong");
    if (el) el.textContent = n;
    document.title = n + " · Pilly";
  }
  function applyPetTheme(pet) {
    activePetTheme = pet && PET_THEMES[pet.theme] ? pet.theme : "ball";
    const t = PET_THEMES[activePetTheme];
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
  const AVATAR_MOODS = { happy: "🎉", sad: "😢", love: "💗" };
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
    faceMood = kind === "happy" || kind === "love" ? kind : kind === "sad" ? "sad" : "";
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
  let faceBlinkStart = 0; // eased lid (v1.1.2)
  let faceBlinkAgainAt = 0; // double-blink follow-up (v1.1.2)
  let faceAnim = null;
  const faceBornAt = performance.now(); // greeting pop-in (v1.1.2)
  let faceDart = { x: 0, y: 0 }, faceDartUntil = 0, faceDartNext = performance.now() + 4000 + Math.random() * 4000;
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
  // 0 = wide open, 1 = fully shut; a sine keeps the lid moving smoothly.
  function faceBlinkAmount(now) {
    if (!faceBlinkStart || now >= faceBlinkUntil) return 0;
    const p = (now - faceBlinkStart) / Math.max(1, faceBlinkUntil - faceBlinkStart);
    if (p <= 0 || p >= 1) return 0;
    return Math.sin(p * Math.PI);
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
  function drawFaceEyePlush(ctx, ex, ey, open, happy, lid, px, py) {
    // Logo-style rounded-square plush eyes with two catchlights.
    if (open) {
      const w = 6.6, h = 7.4;
      rr(ctx, ex - w / 2, ey - h / 2, w, h, 3.2);
      ctx.fillStyle = "#0b0f0d";
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(ex - 1.4 + (px || 0) * 0.6, ey - 1.8 + (py || 0) * 0.6, 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.beginPath();
      ctx.arc(ex + 1.5 + (px || 0) * 0.6, ey + 1.8 + (py || 0) * 0.6, 0.9, 0, Math.PI * 2);
      ctx.fill();
      if (lid) {
        const lidC = getComputedStyle(document.documentElement).getPropertyValue("--c2").trim() || "#0f8389";
        ctx.fillStyle = lidC;
        rr(ctx, ex - w / 2, ey - h / 2, w, Math.max(1, lid * h), 3.2);
        ctx.fill();
      }
    } else {
      ctx.strokeStyle = "#0b0f0d";
      ctx.lineWidth = 1.6;
      ctx.setLineDash([2.2, 2]);
      ctx.beginPath();
      ctx.moveTo(ex - 3.2, ey);
      ctx.lineTo(ex + 3.2, ey);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  function drawFaceEyeBall(ctx, ex, ey, open, happy, lid, px, py) {
    // v1.1.5: the mascot's big embroidered eye in the chat avatar.
    if (open) {
      const w = 7.6, h = 8.6;
      ctx.fillStyle = "#0d1b16";
      ctx.beginPath();
      ctx.ellipse(ex, ey, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      const pr = happy ? 2.1 : 1.8;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(ex + (px || 0) * 0.7, ey + (py || 0) * 0.7, pr, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.beginPath();
      ctx.arc(ex - 1.9, ey - 3.4, 1.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.beginPath();
      ctx.arc(ex + 1.9, ey + 3, 0.8, 0, Math.PI * 2);
      ctx.fill();
      if (lid) {
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(ex, ey, w / 2, h / 2, 0, 0, Math.PI * 2);
        ctx.clip();
        const lidC = getComputedStyle(document.documentElement).getPropertyValue("--c2").trim() || "#0f8389";
        ctx.fillStyle = lidC;
        ctx.fillRect(ex - w / 2 - 1, ey - h / 2 - 1, w + 2, lid * h + 1);
        ctx.restore();
      }
    } else {
      ctx.strokeStyle = "#0b0f0d";
      ctx.lineWidth = 1.6;
      ctx.setLineDash([2, 1.8]);
      ctx.beginPath();
      ctx.moveTo(ex - 3.6, ey);
      ctx.lineTo(ex + 3.6, ey);
      ctx.stroke();
      ctx.setLineDash([]);
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
    const isPlush = activePetTheme === "plush";
    const isBall = activePetTheme === "ball";
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
    // v1.1.2: greeting pop-in (mirrors the taskbar pet's birth spring).
    let pop = 1;
    if (now - faceBornAt < 640) {
      const p = (now - faceBornAt) / 640;
      const ease = 1 - Math.pow(1 - p, 3);
      pop = 0.72 + 0.28 * ease + 0.1 * Math.sin(p * Math.PI) * (1 - p);
    }
    const pw = 46 / squish * pop, ph = 20 * squish * pop;
    const px = (W - pw) / 2, cy = H / 2 + bob, py = cy - ph / 2;
    const ballR = 17 * pop;
    faceCtx.save();
    faceCtx.translate(W / 2, cy);
    faceCtx.rotate(rot);
    faceCtx.translate(-W / 2, -cy);
    if (isBall) {
      // v1.1.5: the mascot ball in the chat header - round, crocheted, big eyes.
      const grd = faceCtx.createRadialGradient(W / 2 - 5.5, cy - 7, 2, W / 2, cy, ballR + 1.5);
      grd.addColorStop(0, c1);
      grd.addColorStop(0.55, c2);
      grd.addColorStop(1, c3);
      faceCtx.beginPath();
      faceCtx.arc(W / 2, cy, ballR, 0, Math.PI * 2);
      faceCtx.fillStyle = grd;
      faceCtx.fill();
      faceCtx.strokeStyle = "rgba(0,0,0,0.16)";
      faceCtx.lineWidth = 1;
      faceCtx.stroke();
      faceCtx.save();
      faceCtx.beginPath();
      faceCtx.arc(W / 2, cy, ballR, 0, Math.PI * 2);
      faceCtx.clip();
      faceCtx.strokeStyle = "rgba(5, 72, 78, 0.25)";
      faceCtx.lineWidth = 0.8;
      faceCtx.lineCap = "round";
      for (let ring = 0; ring < 4; ring++) {
        const r = 5 + ring * 3.2;
        faceCtx.beginPath();
        faceCtx.arc(W / 2, cy, r, 0, Math.PI * 2);
        faceCtx.stroke();
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
          const x0 = W / 2 + Math.cos(a) * r, y0 = cy + Math.sin(a) * r;
          const x1 = W / 2 + Math.cos(a + 0.1) * (r - 1.2), y1 = cy + Math.sin(a + 0.1) * (r - 1.2);
          faceCtx.beginPath();
          faceCtx.moveTo(x0, y0);
          faceCtx.lineTo(x1, y1);
          faceCtx.stroke();
        }
      }
      faceCtx.restore();
      const gl = faceCtx.createRadialGradient(W / 2 - 6, cy - 8, 1, W / 2 - 6, cy - 8, 8.5);
      gl.addColorStop(0, "rgba(255,255,255,0.3)");
      gl.addColorStop(1, "rgba(255,255,255,0)");
      faceCtx.fillStyle = gl;
      faceCtx.beginPath();
      faceCtx.arc(W / 2 - 6, cy - 8, 8.5, 0, Math.PI * 2);
      faceCtx.fill();
    } else {
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
    }
    if (isPlush && !isBall) {
      // Crochet stitches instead of the glossy sheen + a stitched seam.
      faceCtx.save();
      rr(faceCtx, px + 3.5, py + 2.5, pw - 7, ph - 5, (ph - 5) / 2);
      faceCtx.clip();
      faceCtx.strokeStyle = c3;
      faceCtx.globalAlpha = 0.55;
      faceCtx.lineWidth = 1;
      faceCtx.lineCap = "round";
      for (let row = 0; row < 3; row++) {
        const ry = py + 5.5 + row * ((ph - 12) / 2);
        for (let sx = px + 6.5 + (row % 2) * 4.5; sx < px + pw - 5.5; sx += 9) {
          faceCtx.beginPath();
          faceCtx.moveTo(sx, ry);
          faceCtx.lineTo(sx + 2.2, ry + 2.6);
          faceCtx.lineTo(sx + 4.4, ry);
          faceCtx.stroke();
        }
      }
      faceCtx.globalAlpha = 1;
      faceCtx.restore();
      faceCtx.strokeStyle = c3;
      faceCtx.setLineDash([3, 3]);
      faceCtx.lineWidth = 1.4;
      rr(faceCtx, px + 2.5, py + 2.5, pw - 5, ph - 5, (ph - 5) / 2);
      faceCtx.stroke();
      faceCtx.setLineDash([]);
    } else if (!isBall) {
      faceCtx.globalAlpha = 0.22;
      faceCtx.fillStyle = "#fff";
      rr(faceCtx, px + 5, py + 2, pw - 10, ph * 0.24, ph * 0.12);
      faceCtx.fill();
      faceCtx.globalAlpha = 1;
    }
    const mood = now < faceMoodUntil ? faceMood : defaultFaceMood;
    const eyesOpen = true;
    const eyeY = isBall ? cy - 4 : py + ph * 0.55;
    const eyeLX = isBall ? W / 2 - 11 : px + pw * 0.28;
    const eyeRX = isBall ? W / 2 + 11 : px + pw * 0.72;
    const droop = now < faceMoodUntil && faceMood === "sad" ? 0.6 : 0;
    const lid = Math.max(droop, faceBlinkAmount(now));
    // v1.1.2: pupils glance around on their own every so often.
    const ppx = petting ? 0 : (now < faceDartUntil ? faceDart.x : facePupil.x);
    const ppy = petting ? 0 : (now < faceDartUntil ? faceDart.y : facePupil.y);
    const happyEyes = mood === "happy" || mood === "love";
    if (isBall) {
      drawFaceEyeBall(faceCtx, eyeLX, eyeY, eyesOpen, happyEyes, lid, ppx, ppy);
      drawFaceEyeBall(faceCtx, eyeRX, eyeY, eyesOpen, happyEyes, lid, ppx, ppy);
    } else if (isPlush) {
      drawFaceEyePlush(faceCtx, eyeLX, eyeY, eyesOpen, happyEyes, lid, ppx, ppy);
      drawFaceEyePlush(faceCtx, eyeRX, eyeY, eyesOpen, happyEyes, lid, ppx, ppy);
    } else {
      drawFaceEye(faceCtx, eyeLX, eyeY, eyesOpen, happyEyes, lid, ppx, ppy);
      drawFaceEye(faceCtx, eyeRX, eyeY, eyesOpen, happyEyes, lid, ppx, ppy);
    }
    const mx = W / 2, my = isBall ? cy + 1.5 : py + ph * 0.82;
    faceCtx.strokeStyle = "#0b0f0d";
    faceCtx.lineWidth = isPlush ? 1.4 : 1.6;
    faceCtx.lineCap = "round";
    if (isPlush || isBall) faceCtx.setLineDash([2.2, 2.2]);
    faceCtx.beginPath();
    if (mood === "happy" || mood === "love") {
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
    faceCtx.setLineDash([]);
    faceCtx.restore();
  }
  function startFaceAnim() {
    if (faceAnim || !faceCtx) return;
    const loop = (now) => {
      if (now > faceBlink) {
        const slow = Math.random() < 0.2;
        faceBlinkStart = now;
        faceBlinkUntil = now + (slow ? 300 : 180);
        faceBlink = now + 1800 + Math.random() * 2600;
        // v1.1.2: occasional quick double-blink.
        faceBlinkAgainAt = Math.random() < 0.22 ? faceBlinkUntil + 180 : 0;
      } else if (faceBlinkAgainAt && now > faceBlinkAgainAt) {
        faceBlinkAgainAt = 0;
        faceBlinkStart = now;
        faceBlinkUntil = now + 130;
      }
      // v1.1.2: idle pupil dart - the avatar glances around by itself.
      if (now > faceDartNext) {
        faceDart.x = (Math.random() - 0.5) * 2.6;
        faceDart.y = (Math.random() - 0.5) * 1.6;
        faceDartUntil = now + 320;
        faceDartNext = now + 3400 + Math.random() * 4200;
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
    // Heart emojis / "love you" -> the pet gets heart-eyes, not just a smile.
    if (/💗|❤|💖|💕|😍/.test(text || "") || /\b(ilu|ily|love you|luv u|lysm)\b/.test(s)) return "love";
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
  let lastTrending = null; // { list, staleAt } - rebuilt in place on language change
  let trendingCardEl = null;
  const walletCardEls = []; // wallet cards re-rendered on language change
  // Both maps are keyed by mint and would otherwise grow for the whole session, so
  // they are capped. cardCoins also has to stay ordered by recency: re-opening a
  // coin has to move it to the back, because the calculator reads the last entry as
  // "the coin I was just looking at".
  const CARD_CACHE_MAX = 60;
  function trimCardCaches() {
    for (const m of [cardCoins, cardSparks]) {
      while (m.size > CARD_CACHE_MAX) m.delete(m.keys().next().value);
    }
  }
  function rememberCoin(coin) {
    const mint = coin && coin.mint;
    if (!mint) return;
    cardCoins.delete(mint);
    cardCoins.set(mint, coin);
    trimCardCaches();
  }
  function rememberSpark(mint, spark) {
    if (!mint) return;
    cardSparks.delete(mint);
    cardSparks.set(mint, spark);
    trimCardCaches();
  }

  function pnlChipHtml(mint, price) {
    const p = pnlOf(mint, price);
    if (!p) return "";
    return `<div class="cc-stat pnl ${p.pct >= 0 ? "up" : "down"}">${t("pnl")} <b class="${p.pct >= 0 ? "up" : "down"}">${fmtPnl(p.pct)}</b></div>`;
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

  // The coin-card markup lives in exactly one place: a fresh card and the ↻
  // refresh / live-tick re-render both build it from here, so a field added or
  // fixed once shows up in both (this used to be two hand-mirrored copies that had
  // already drifted). Every API-supplied string goes through escapeHtml - including
  // the ones that only reach a class name.
  function coinCardInnerHtml(coin) {
    const up = coin.change24h == null || coin.change24h >= 0;
    const parts = [];
    if (coin.image) parts.push(`<img class="cc-img" src="${escapeHtml(coin.image)}" />`);
    parts.push(`<div class="cc-main"><strong>${escapeHtml(coin.name)}</strong>${coin.symbol ? ` <span class="cc-sym">${escapeHtml(coin.symbol)}</span>` : ""}</div>`);
    parts.push(`<div class="cc-price ${up ? "up" : "down"}">${coin.price != null ? fmtUsd(coin.price) : "-"}</div>`);
    const grade = coin.rug ? String(coin.rug.grade).toLowerCase().replace(/[^a-z0-9]/g, "") : "";
    return `<div class="cc-top">${parts.join("")}<div class="cc-side">${pnlChipHtml(coin.mint, coin.price)}${
      coin.mcap != null ? `<div class="cc-stat">${t("mcap")} <b>${fmtUsd(coin.mcap)}</b></div>` : ""
    }${coin.change24h != null ? `<div class="cc-stat">${t("c24h")} <b class="${up ? "up" : "down"}">${fmtPct(coin.change24h)}</b></div>` : ""}</div></div><div class="cc-spark"></div><div class="cc-grid">${
      coin.volume24h != null ? `<div class="cc-stat">${t("vol")} <b>${fmtUsd(coin.volume24h)}</b></div>` : ""
    }${coin.liquidityUsd != null ? `<div class="cc-stat">${t("liq")} <b>${fmtUsd(coin.liquidityUsd)}</b></div>` : ""}${
      coin.age ? `<div class="cc-stat">${t("age")} <b>${escapeHtml(coin.age)}</b></div>` : ""
    }${coin.buys24h != null && coin.sells24h != null ? `<div class="cc-stat">${t("txns")} <b>${Number(coin.buys24h).toLocaleString()}B/${Number(coin.sells24h).toLocaleString()}S</b></div>` : ""}${
      coin.organicScore != null ? `<div class="cc-stat">${t("organic")} <b>${escapeHtml(coin.organicScore)}/100</b></div>` : ""
    }${coin.rug ? `<div class="cc-stat rug rg-${grade}">${t("rug")} <b>${escapeHtml(coin.rug.grade)} ${escapeHtml(coin.rug.score)}</b></div>` : ""}</div>`;
  }

  // A card whose avatar URL dies (expired CDN link, a host that refuses the
  // renderer) retries once through the site resolver, then through the main
  // process, before giving up - so the badge stays an actual coin logo instead
  // of a broken-image glyph. The resolver digs logos out server-side; the main
  // process fetch is not subject to the CORP/ORB rules that make the browser
  // drop coin-CDN loads, and paints a data URL instead.
  function wireCoinImage(img, coin) {
    if (!img) return;
    const mint = coin && coin.mint ? coin.mint : null;
    const original = img.src || null;
    const resolver = mint ? `https://pillcrew.fun/api/img?mint=${encodeURIComponent(mint)}` : null;
    const proxied = [];
    if (original) proxied.push(original);
    if (resolver && resolver !== original) proxied.push(resolver);
    let stage = 0; // 0 = the original load just failed, 1 = resolver tried directly
    img.addEventListener("error", async () => {
      if (img.dataset.imgDone === "1") return;
      if (stage === 0 && resolver) {
        stage = 1;
        img.src = resolver;
        return;
      }
      // Direct loads are exhausted: hand the URLs to the main-process fetcher.
      while (proxied.length) {
        const url = proxied.shift();
        try {
          const r = await window.pilly.img(url);
          if (r && r.ok && r.src) {
            img.dataset.imgDone = "1";
            img.src = r.src;
            return;
          }
        } catch (e) { /* try the next source */ }
      }
      img.dataset.imgDone = "1";
      img.remove();
    });
  }

  function addCoinCard(coin, opts) {
    const card = addEl("msg bot");
    const read = (opts && opts.read) || "";
    card.innerHTML = `<div class="coin-card">${coinCardInnerHtml(coin)}</div>`;
    wireCoinImage(card.querySelector(".cc-img"), coin);
    const mint = coin.mint;
    if (mint) {
      rememberCoin(coin);
      const cached = cardSparks.get(mint);
      if (cached) drawSpark(card, cached);
      else {
        window.pilly.spark(mint).then((s) => {
          if (s && s.points && s.points.length >= 2) {
            rememberSpark(mint, s);
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
      `<button type="button" class="cc-watch" data-act="watch" data-mint="${escapeHtml(mint)}" data-sym="${escapeHtml(coin.symbol || "")}" data-name="${escapeHtml(coin.name || "")}" data-price="${coin.price != null ? escapeHtml(coin.price) : ""}" title="${t("watchBtnTitle")}">${ICONS.bookmark}<span class="cw-label">${t("watch")}</span></button>` +
      `<button type="button" class="cc-watch icon-only" data-act="read" data-mint="${escapeHtml(mint)}" data-read="${escapeHtml(read)}" title="${t("readInstant")}">${ICONS.eye}</button>` +
      `<button type="button" class="cc-watch icon-only" data-act="dex" data-mint="${escapeHtml(mint)}" data-pair="${escapeHtml(coin.pair || "")}" title="${t("openDex")}">${ICONS.external}</button>` +
      `<button type="button" class="cc-watch icon-only" data-act="refresh" data-mint="${escapeHtml(mint)}" title="${t("refreshLive")}">${ICONS.refresh}</button>` +
      `<button type="button" class="cc-watch icon-only" data-act="copy" data-mint="${escapeHtml(mint)}" title="${t("copyMint")}">${ICONS.copy}</button>`;
    card.appendChild(foot);
    refreshWatchLabel(foot);
    // addEl() persisted the chat while the card was still an empty div, so the
    // stored snapshot was a blank bubble - a restart then restored a card with
    // nothing in it. Persist again now that the content and the buttons are in.
    persistChat();
  }

  async function refreshWatchLabel(foot) {
    const btn = foot && foot.querySelector('[data-act="watch"]');
    if (!btn) return;
    try {
      const items = await window.pilly.watchList().catch(() => []);
      const on = Array.isArray(items) && items.some((i) => i.mint === btn.dataset.mint);
      const label = btn.querySelector(".cw-label");
      if (label) label.textContent = on ? t("watching") : t("watch");
      btn.classList.toggle("active", on);
    } catch (e) { /* ignore */ }
  }

  // Re-render just the coin-card body (used by ↻ refresh / live tick).
  function renderCardBody(cardEl, coin) {
    const bodyEl = cardEl && cardEl.querySelector(".coin-card");
    if (!bodyEl) return;
    bodyEl.innerHTML = coinCardInnerHtml(coin);
    wireCoinImage(bodyEl.querySelector(".cc-img"), coin);
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
        if (read) addMsg("bot", `${escapeHtml(read)}<span class="fb-tag">${t("fbLocal")}</span>`);
        else addMsg("bot err", t("noLocalRead"));
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
            rememberCoin(fresh.coin);
            renderCardBody(cardEl, fresh.coin);
            cc.innerHTML = ICONS.check;
            setTimeout(() => { cc.innerHTML = ICONS.refresh; }, 1100);
          } else {
            cc.innerHTML = ICONS.refresh;
            addMsg("bot err", t("refreshEmpty"));
          }
        } catch (err) {
          cc.innerHTML = ICONS.refresh;
          addMsg("bot err", t("refreshFailed"));
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
          addMsg("bot err", t("copyBlocked"));
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

  function trendStaleNote(staleAt) {
    return staleAt ? t("trendStale", { t: new Date(staleAt).toLocaleTimeString() }) : "";
  }
  function trendingCardHtml(list, staleAt) {
    const rows = list.slice(0, 10).map((c, i) => {
      const up = c.change24h == null || c.change24h >= 0;
      return `<div class="tr-row"><span class="tr-rank">${i + 1}</span><span class="tr-name">${escapeHtml(c.name)}${c.symbol ? ` <em>${escapeHtml(c.symbol)}</em>` : ""}</span><span class="tr-price">${c.price != null ? fmtUsd(c.price) : "-"}</span><span class="tr-chg ${up ? "up" : "down"}">${fmtPct(c.change24h)}</span><span class="tr-mcap">${c.mcap != null ? fmtUsd(c.mcap) : "-"}${c.volume24h != null ? `<small>${t("vol")} ${fmtUsd(c.volume24h)}</small>` : ""}</span></div>`;
    }).join("");
    const note = trendStaleNote(staleAt);
    const foot = note ? `<div class="tr-note">${escapeHtml(note)}</div>` : "";
    return `<div class="trend-card"><div class="tr-head">${t("trendingHead")}</div><div class="tr-headrow"><span class="tr-rank">#</span><span class="tr-name">${t("trCoin")}</span><span class="tr-price">${t("trPrice")}</span><span class="tr-chg">${t("c24h")}</span><span class="tr-mcap">${t("trMcap")}<small>${t("trVol")}</small></span></div>${rows}${foot}</div>`;
  }
  function addTrendingCard(list, staleAt) {
    const card = addEl("msg bot");
    card.innerHTML = trendingCardHtml(list, staleAt);
    lastTrending = { list, staleAt: staleAt || null };
    trendingCardEl = card;
    persistChat(); // addEl() stored this card empty - re-store it once it has rows
  }

  const walletRenders = new WeakMap(); // cardEl -> re-render fn (keeps entry edits live)
  function walletCardHtml(w) {
    const short = `${String(w.wallet || "").slice(0, 6)}…${String(w.wallet || "").slice(-4)}`;
    const chg = w.change24h != null
      ? ` · <b class="${w.change24h >= 0 ? "up" : "down"}">${fmtPct(w.change24h)}</b>`
      : "";
    const rows = (w.tokens || []).slice(0, 8).map((tok, i) => {
      const up = tok.change24h == null || tok.change24h >= 0;
      const pnl = pnlOf(tok.mint, tok.price);
      return `<div class="wr-row" data-mint="${escapeHtml(tok.mint)}"><span class="tr-rank">${i + 1}</span><span class="tr-name">${escapeHtml(tok.name)}${tok.symbol ? ` <em>${escapeHtml(tok.symbol)}</em>` : ""}</span><span class="tr-price">${tok.price != null ? fmtUsd(tok.price) : "-"}</span><span class="wr-pnl ${pnl ? (pnl.pct >= 0 ? "up" : "down") : ""}">${pnl ? fmtPnl(pnl.pct) : "-"}</span><input class="wr-entry" type="number" step="any" min="0" placeholder="${t("entryPh")}" value="${pnl ? pnl.entry : ""}" title="${t("entryTitle")}" /><span class="tr-vol">${tok.usd != null ? fmtUsd(tok.usd) : t("noPrice")}</span></div>`;
    }).join("");
    const solRow = w.sol > 0
      ? `<div class="tr-row"><span class="tr-rank">◎</span><span class="tr-name">SOL</span><span class="tr-price">${w.sol.toFixed(4)}</span><span class="tr-chg"></span><span class="tr-vol">${w.solUsd > 0 ? fmtUsd(w.solUsd) : ""}</span></div>`
      : "";
    const note = (w.tokens || []).length
      ? `<div class="tr-note">${t("estTotal")} <b>${fmtUsd(w.totalUsd)}</b> · ${t("pnlEntryHint")}</div>`
      : `<div class="tr-note">${t("noTokens", { v: fmtUsd(w.totalUsd) })}</div>`;
    return `<div class="trend-card"><div class="tr-head">${t("wallet")} ${escapeHtml(short)}${chg}</div>${solRow}${rows}${note}</div>`;
  }

  function addWalletCard(w) {
    const card = addEl("msg bot");
    const render = () => { card.innerHTML = walletCardHtml(w); };
    render();
    walletRenders.set(card, render);
    walletCardEls.push(card);
    persistChat(); // addEl() stored this card empty - re-store it once it has rows
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

    // "remind me in 10 min to ..." sets a one-shot reminder (no AI round-trip).
    if (!task && REMINDER_INTENT.test(trimmed)) {
      const rem = await window.pilly.reminder(trimmed);
      if (rem && rem.ok) {
        addMsg("bot", t("reminderGot", { msg: escapeHtml(rem.reminder.message) }));
        history.push({ role: "assistant", content: `Reminder set: ${rem.reminder.message}` });
      } else {
        addMsg("bot err", escapeHtml((rem && rem.message) || t("reminderFail")));
      }
      return;
    }

    // "start focus" / "pomodoro" -> kick off a focus session (no AI round-trip).
    if (!task && FOCUS_STOP_INTENT.test(trimmed)) {
      await window.pilly.focusStop();
      addMsg("bot", t("focusOff"));
      return;
    }
    if (!task && FOCUS_STATUS_INTENT.test(trimmed)) {
      const s = await window.pilly.focusStatus();
      if (s && s.phase !== "idle") {
        const mm = Math.ceil(s.remainingMs / 60000);
        const label = s.phase === "focus" ? t("focusWord") : t("breakWord");
        addMsg("bot", s.paused
          ? t("focusPaused", { label, mm })
          : t("focusProgress", { label, mm }));
      } else {
        addMsg("bot", t("focusNone"));
      }
      return;
    }
    if (!task && FOCUS_PAUSE_INTENT.test(trimmed)) {
      const s = await window.pilly.focusPause();
      if (s && s.paused) addMsg("bot", t("focusPauseDone"));
      else addMsg("bot", t("nothingToPause"));
      return;
    }
    if (!task && FOCUS_RESUME_INTENT.test(trimmed)) {
      const s = await window.pilly.focusResume();
      if (s && s.phase !== "idle" && !s.paused) addMsg("bot", t("focusResumed"));
      else if (s && s.phase === "idle") addMsg("bot", t("nothingToResume"));
      return;
    }
    if (!task && (FOCUS_START_INTENT.test(trimmed) || FOCUS_ALONE_INTENT.test(trimmed))) {
      // "start focus 50" / "pomodoro 25/5" -> one-off custom session length.
      let minutes = null;
      let breakMinutes = null;
      const slash = trimmed.match(/(\d{1,3})\s*\/\s*(\d{1,3})/);
      if (slash) {
        minutes = parseInt(slash[1], 10);
        breakMinutes = parseInt(slash[2], 10);
      } else {
        const single = trimmed.match(/(\d{1,3})/);
        if (single) minutes = parseInt(single[1], 10);
      }
      const s = await window.pilly.focusStart(minutes, breakMinutes);
      if (s && s.phase === "focus") {
        addMsg("bot", t("focusStarted", { m: s.plannedMin }));
      } else if (s && (s.phase === "break" || s.phase === "long_break")) {
        const mm = Math.ceil(s.remainingMs / 60000);
        addMsg("bot", t("alreadyOnPhase", { phase: s.phase.replace("_", " "), mm }));
      }
      return;
    }

    // "how was my day" / "jak mi poszło" -> activity diary summary (no AI round-trip).
    if (!task && ACTIVITY_YESTERDAY_INTENT.test(trimmed)) {
      const y = await window.pilly.activityYesterday();
      if (y && y.total > 0) {
        addMsg("bot", t("actYesterday", { a: y.active, p: y.pct, t: y.total }));
      } else {
        addMsg("bot", t("actYesterdayNone"));
      }
      return;
    }
    if (!task && ACTIVITY_TODAY_INTENT.test(trimmed)) {
      const act = await window.pilly.activityToday();
      if (act && act.total > 0) {
        addMsg("bot", t("actToday", { a: act.active, p: act.pct, t: act.total }));
      } else {
        addMsg("bot", t("actTodayNone"));
      }
      return;
    }
    if (!task && STREAK_INTENT.test(trimmed)) {
      const s = await window.pilly.activityStreak();
      if (s > 0) addMsg("bot", t("streak", { d: s }));
      else addMsg("bot", t("streakNone"));
      return;
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
            addMsg("bot err", t("coinPullFail", { m: escapeHtml(String(mint).slice(0, 10)) }));
            return;
          }
        }
      } catch (e) {
        typing.remove();
        addMsg("bot err", t("coinReachFail"));
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
          ? `${escapeHtml(res.reply)}<span class="fb-tag">${t("fbTagAI")}</span>`
          : escapeHtml(res.reply);
        addMsg("bot", body);
        history.push({ role: "assistant", content: res.reply });
      } else {
        addMsg("bot err", escapeHtml((res && res.error) || t("wentQuiet")));
      }
    } catch (e) {
      typing.remove();
      addMsg("bot err", t("hitWall"));
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
        // A stale list is served when the feed blips, and it has to say so - a
        // read of the market that is silently out of date is a trap, not a favour.
        addTrendingCard(data.list, data.stale ? (data.staleAt || Date.now()) : null);
        const chgs = data.list.map((c) => c.change24h).filter((c) => c != null && isFinite(c));
        if (chgs.length) {
          const avg = chgs.reduce((s, c) => s + c, 0) / chgs.length;
          setAvatarMood(avg >= 0.5 ? "happy" : avg <= -0.5 ? "sad" : null);
        }
      } else if (data && data.rateLimited) {
        addMsg("bot err", t("trendThrottled"));
        return;
      } else {
        addMsg("bot err", t("trendUnavailable"));
        // Nothing to read from, so there is nothing to ask the model: a rundown
        // written from memory would be invented coins with invented numbers.
        return;
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
      addMsg("bot err", t("hitWall"));
    } finally {
      setThinking(false);
    }
  }

  async function showTrending() {
    if (sendBtn.disabled) return;
    addMsg("user", t("trendAsk"));
    await runTrending("give me the rundown");
  }

  // Roll a random trending coin, pull its full live snapshot and get Pilly's verdict.
  async function pickCoin() {
    if (sendBtn.disabled) return;
    addMsg("user", t("pickAsk"));
    const typing = addTyping();
    setThinking(true);
    try {
      const data = await window.pilly.trending();
      if (!data || !data.list || !data.list.length) {
        typing.remove();
        addMsg("bot err", data && data.rateLimited
          ? t("trendThrottled")
          : t("pickEmpty"));
        return;
      }
      const pick = data.list[Math.floor(Math.random() * data.list.length)];
      const full = await window.pilly.coin(pick.mint);
      typing.remove();
      if (full && full.coin) addCoinCard(full.coin);
      else addCoinCard(pick);
      const res = await window.pilly.chat({
        text: t("pickPrompt", { name: pick.name, sym: pick.symbol }),
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
      addMsg("bot err", t("hitWall"));
    } finally {
      setThinking(false);
    }
  }

  // 💊 PillCrew home-token chip: pull OUR token's live card + a proud read.
  async function showHomeCoin() {
    if (sendBtn.disabled) return;
    const home = await window.pilly.homeToken().catch(() => null);
    if (home && home.mint) {
      send(home.mint);
    } else {
      addMsg("bot err", t("homeFail"));
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
    if (chip.dataset.action === "homecoin") { showHomeCoin(); return; }
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

  // v1.1.2: hide through main instead of window.close(). A renderer close tears
  // the window down on Windows without emitting the window's "close" event, so
  // nothing recorded that the user wanted him hidden and the survival net rebuilt
  // and re-showed the chat (he "opened again by himself" a moment after hiding).
  document.getElementById("minBtn").addEventListener("click", () => {
    window.pilly.hideChat().catch(() => { /* the window is going away regardless */ });
  });
  document.getElementById("quitBtn").addEventListener("click", () => {
    if (confirm(t("quitConfirm"))) window.pilly.quit();
  });
  document.getElementById("trendBtn").addEventListener("click", showTrending);
  document.getElementById("petBtn").addEventListener("click", async () => {
    const r = await window.pilly.petToggle();
    document.getElementById("petBtn").classList.toggle("active", !!r.active);
  });
  // v1.1.2: the tray can switch the pet on/off too, so the button follows along
  // instead of showing the opposite of what is actually on the taskbar.
  window.pilly.onPetActive((on) => {
    document.getElementById("petBtn").classList.toggle("active", !!on);
  });

  // v1.1.2: a reminder that fires while Pilly is off (or his bubbles are off) is
  // pushed here instead of into a pet bubble. Before this listener existed the
  // text only ever reached the OS notification, and a desktop in Do Not Disturb
  // swallowed it whole - the reminder was simply gone when you came back.
  window.pilly.onReminderFired((r) => {
    const text = String((r && (r.message || r.text)) || "").trim();
    if (!text) return;
    addMsg("bot", t("reminderFired", { msg: escapeHtml(text) }));
    // Also Pilly's own line in the AI history, so answering "done" right after
    // makes sense to him (same trick as his proactive questions below).
    history.push({ role: "assistant", content: "I reminded you: " + text });
    if (history.length > 16) history.splice(0, history.length - 16);
  });

  // v1.1.2: focus sessions started from the tray say so in the chat. The app
  // only sets `announce` on a deliberate click - the 60s status tick pushes a
  // bare payload, so it never writes a line here.
  window.pilly.onFocusStatus((s) => {
    if (s && s.announce) addMsg("bot", escapeHtml(String(s.announce)));
  });  document.getElementById("clearBtn").addEventListener("click", clearChat);

  document.getElementById("gitBtn").addEventListener("click", () => window.pilly.github());

  messagesEl.addEventListener("scroll", () => {
    scrollDownBtn.hidden = isNearBottom();
  });
  scrollDownBtn.addEventListener("click", () => {
    scrollToBottom(true);
    scrollDownBtn.hidden = true;
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
      addMsg("bot", escapeHtml(coin.symbol ? t("alreadyOnCoin", { sym: coin.symbol }) : t("alreadyLoadedNoSym")));
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
        watchRowsEl.innerHTML = t("watchEmpty");
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
              <strong>${escapeHtml(it.symbol || it.name || t("coin"))}</strong>
              <small>${escapeHtml(it.name || "")}</small>
            </div>
            <div class="wl-price ${up ? "up" : "down"}">${p && p.price != null ? fmtUsd(p.price) : "…"}<small class="wl-pnl ${pnl ? (pnl.pct >= 0 ? "up" : "down") : ""}">${pnl ? fmtPnl(pnl.pct) : t("noEntry")}</small></div>
            <div class="wl-chg ${up ? "up" : "down"}">${chg != null ? fmtPct(chg) : "-"}</div>
            <input class="wl-entry" type="number" step="any" min="0" placeholder="${t("entryPh")}" value="${escapeHtml(entry)}" title="${t("entryTitle")}" />
            <input class="wl-alert" type="number" min="1" step="1" placeholder="±%" value="${escapeHtml(alertVal)}" title="${t("alertPctTitle")}" />
            <button class="wl-remove" title="${t("remove")}">✕</button>
          </div>`;
        })
        .join("");

      // Portfolio PnL summary - rolled up from every tracked token with an entry price.
      let statsHtml = "";
      const entered = [];
      for (const it of list) {
        const price = prices && prices[it.mint] ? prices[it.mint].price : null;
        const pnl = pnlOf(it.mint, price);
        if (pnl) entered.push({ sym: it.symbol || it.name || t("coin"), pct: pnl.pct });
      }
      if (entered.length) {
        const avg = entered.reduce((a, x) => a + x.pct, 0) / entered.length;
        const best = entered.reduce((a, x) => (x.pct > a.pct ? x : a), entered[0]);
        const worst = entered.reduce((a, x) => (x.pct < a.pct ? x : a), entered[0]);
        statsHtml = `<div class="wl-stats">
          <div class="wl-stat"><small>${t("wlAvg")}</small><b class="${avg >= 0 ? "up" : "down"}">${fmtPnl(avg)}</b></div>
          <div class="wl-stat"><small>${t("wlBest")}</small><b class="up">${escapeHtml(best.sym)} ${fmtPnl(best.pct)}</b></div>
          <div class="wl-stat"><small>${t("wlWorst")}</small><b class="down">${escapeHtml(worst.sym)} ${fmtPnl(worst.pct)}</b></div>
          <div class="wl-stat"><small>${t("wlEntries")}</small><b>${entered.length}/${list.length}</b></div>
        </div>`;
      }
      watchRowsEl.innerHTML = statsHtml + rowsHtml;
      if (watchStatusEl) watchStatusEl.textContent = t("watchedStatus", { n: list.length, t: new Date().toLocaleTimeString() });
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
      if (watchRowsEl) watchRowsEl.innerHTML = `<p class="hint">${t("watchLoadFail")}</p>`;
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
    if (watchStatusEl) watchStatusEl.textContent = t("refreshing");
    renderWatchlist();
  });

  // Alert fired in the main process → surface it in the chat.
  window.pilly.onWatchAlert((m) => {
    if (m && m.symbol) {
      addMsg("bot", t("watchAlert", { s: escapeHtml(m.symbol), cls: m.chg >= 0 ? "up" : "down", p: (m.chg >= 0 ? "+" : "") + Number(m.chg).toFixed(1) }));
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
  const radarHintEl = document.getElementById("radarHint");
  let radarTimer = null;
  let lastRadarMints = new Set();

  function ageShort(ms) {
    if (ms == null || !isFinite(ms)) return "";
    const m = Math.max(0, Math.floor((Date.now() - ms) / 60000));
    return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`;
  }

  let radarBusy = false;
  // The launch floor comes from main.js (COINS.MIN_FRESH_MCAP) so the number in the
  // UI cannot drift away from the number the filter uses.
  function floorLabel(v) {
    const n = Number(v);
    return isFinite(n) && n > 0 ? `$${Math.round(n / 1000)}K` : "the floor";
  }
  async function renderRadar() {
    if (!radarRowsEl || radarBusy) return;
    radarBusy = true;
    try {
      const data = await window.pilly.radar();
      const list = Array.isArray(data && data.list) ? data.list : [];
      const hidden = Number(data && data.hidden) || 0;
      const floor = floorLabel(data && data.floor);
      if (radarHintEl)
        radarHintEl.textContent = t("radarHint", { f: floor });
      if (!list.length) {
        // An empty radar is normal: pump.fun coins start near $2.8K, so most
        // launches sit under the floor. Say so - silence would read as a bug.
        radarRowsEl.innerHTML = `<p class="hint">Nothing above ${floor} yet${
          hidden ? ` - this batch's ${hidden} smaller launch${hidden === 1 ? "" : "es"} filtered out` : ""
        }. Fresh coins start low and cross the floor once real money shows up.</p>`;
        if (radarStatusEl) radarStatusEl.textContent = t("radarStatus0", { f: floor });
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
            <div class="wl-main"><strong>${escapeHtml(c.name)}${c.symbol ? ` <em>${escapeHtml(c.symbol)}</em>` : ""}${isNew ? ` <span class="rad-new">${t("newBadge")}</span>` : ""}</strong><small>${c.price != null ? fmtUsd(c.price) : t("noPrice")}</small></div>
            <div class="wl-chg ${up ? "up" : "down"}">${c.change24h != null ? fmtPct(c.change24h) : ""}</div>
            <div class="wl-mcap">${c.mcap != null ? fmtUsd(c.mcap) : "-"}${age ? `<small>${age}</small>` : ""}</div>
            <span class="rad-go">⚡</span>
          </div>`;
        })
        .join("");
      if (radarStatusEl)
        radarStatusEl.textContent = t("radarStatus", { n: list.length, floor, t: new Date().toLocaleTimeString() });
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
              addMsg("bot err", t("radarNoData"));
            }
          } catch (e) {
            typing.remove();
            addMsg("bot err", t("hitWall"));
          } finally {
            setThinking(false);
          }
        });
      });
    } catch (e) {
      if (radarRowsEl) radarRowsEl.innerHTML = `<p class="hint">${t("radarErr")}</p>`;
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
    if (radarStatusEl) radarStatusEl.textContent = t("refreshing");
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
    const solPriceUsd = solUsd && isFinite(Number(solUsd.price)) && Number(solUsd.price) > 0
      ? Number(solUsd.price)
      : null;
    if (!isFinite(sol) || sol <= 0) {
      calcOut.innerHTML = `<p class="hint">${t("calcEnterSol")}</p>`;
    } else {
      const value = solPriceUsd ? sol * solPriceUsd : null;
      // A token count is only honest when both prices are real: falling back to a
      // fake SOL price of 1 silently invented a number (and would have said "1 SOL
      // = $1"). No SOL price -> no token estimate, just a hint.
      const haveCoinPrice = isFinite(price) && price > 0;
      const tokens = haveCoinPrice && value != null ? value / price : null;
      const hint = haveCoinPrice
        ? t("calcNoSolPrice")
        : t("calcAddPrice");
      calcOut.innerHTML = `<div class="calc-line">${fmtNum(sol)} SOL${solPriceUsd ? ` ≈ <b>${fmtUsd(value)}</b>` : ""}</div>${tokens != null ? `<div class="calc-line">→ <b>${fmtNum(tokens)} ${t("calcTokens")}</b> @ ${fmtUsd(price)}</div>` : `<div class="calc-line hint">${hint}</div>`}`;
    }
    const risk = Number(calcRisk.value);
    const stop = Number(calcStop.value);
    if (isFinite(risk) && risk > 0 && isFinite(stop) && stop > 0) {
      const positionUsd = risk / (stop / 100);
      const tokensRisk = isFinite(price) && price > 0 ? positionUsd / price : null;
      calcRiskOut.innerHTML = `<div class="calc-line">${t("calcRiskLine", { r: risk.toFixed(0), s: stop, p: fmtUsd(positionUsd) })}</div>${tokensRisk != null ? `<div class="calc-line">→ <b>${fmtNum(tokensRisk)} ${t("calcTokens")}</b> @ ${fmtUsd(price)}</div>` : ""}`;
    } else {
      calcRiskOut.innerHTML = `<p class="hint">${t("calcRiskHint")}</p>`;
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
    lines.push(t("scoreHead"));
    lines.push(t("scoreLine", { t: st.total || 0, w: st.wins || 0, l: st.losses || 0, r: st.winRate != null ? st.winRate + "%" : "-" }));
    if (st.avgPct != null) lines.push(t("avgMove", { v: scPct(st.avgPct) }));
    if (st.best && st.best.symbol) lines.push(t("bestPick", { s: st.best.symbol, v: scPct(st.best.pct) }));
    for (const p of picks) {
      const res = p.result === "win" ? "+" + (p.pct || 0).toFixed(1) + "%" : p.result === "loss" ? (p.pct || 0).toFixed(1) + "%" : t("openPick");
      lines.push(`${p.source === "hot" ? "🔥" : p.source === "sniper" ? "🔫" : p.source === "whale" ? "🐋" : "🎯"} ${p.symbol || p.name || t("coin")}: ${res}`);
    }
    lines.push(t("madeBy"));
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
          <div class="sc-cell"><b>${st.total != null ? st.total : 0}</b><span>${t("scPicks")}</span></div>
          <div class="sc-cell up"><b>${st.wins != null ? st.wins : 0}</b><span>${t("scWins")}</span></div>
          <div class="sc-cell down"><b>${st.losses != null ? st.losses : 0}</b><span>${t("scLosses")}</span></div>
          <div class="sc-cell"><b>${winRate}</b><span>${t("scWinRate")}</span></div>
          <div class="sc-cell"><b>${avg}</b><span>${t("scAvgMove")}</span></div>
          <div class="sc-cell"><b>${g.coins != null ? g.coins : 0}</b><span>${t("scCoinsRead")}</span></div>
        </div>
        <div class="sc-winbar"><i style="width:${winPct}%"></i></div>`;
      }
      if (!picks.length) {
        scRowsEl.innerHTML = t("scoreEmpty");
      } else {
        scRowsEl.innerHTML = picks.map((p) => {
          const res = p.result === "win" ? `<b class="up">+${(p.pct || 0).toFixed(1)}%</b>`
            : p.result === "loss" ? `<b class="down">${(p.pct || 0).toFixed(1)}%</b>`
            : `<span class="sc-open">${t("openPick")}</span>`;
          const when = new Date(p.ts).toLocaleDateString();
          return `<div class="wl-row sc-row">
            <div class="wl-main"><strong>${escapeHtml(p.symbol || p.name || t("coin"))} ${p.source === "hot" ? "🔥" : p.source === "sniper" ? "🔫" : p.source === "whale" ? "🐋" : "🎯"}</strong><small>${when} · ${p.price != null ? fmtUsd(p.price) : "-"} ${t("scoreAtCall")}</small></div>
            <div class="sc-res">${res}</div>
          </div>`;
        }).join("");
      }
      if (scStatusEl) scStatusEl.textContent = t("scoreUpdated", { t: new Date().toLocaleTimeString() });
    } catch (e) {
      if (scRowsEl) scRowsEl.innerHTML = `<p class="hint">${t("scoreUnavailable")}</p>`;
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
      if (scStatusEl) scStatusEl.textContent = (r && r.ok) ? t("copied") : t("copyFailed");
    } catch (e) {
      if (scStatusEl) scStatusEl.textContent = t("copyFailed");
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
        whaleRowsEl.innerHTML = `<p class="hint">${t("whaleEmpty")}</p>`;
      } else {
        whaleRowsEl.innerHTML = list.map((w) => {
          const last = w.lastSeen ? new Date(w.lastSeen).toLocaleTimeString() : "-";
          return `<div class="wl-row sc-row" data-addr="${escapeHtml(w.address)}">
            <div class="wl-main"><strong>${escapeHtml(w.label || w.address)}</strong><small>${escapeHtml(w.address.slice(0, 6))}…${escapeHtml(w.address.slice(-4))} · ${(w.mints || []).length} ${t("holdings")} · ${t("seenAt")} ${last}</small></div>
            <button class="wl-remove" title="${t("unfollow")}">✕</button>
          </div>`;
        }).join("");
      }
      whaleRowsEl.querySelectorAll(".wl-remove").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const addr = btn.closest(".sc-row").dataset.addr;
          await window.pilly.whaleRemove(addr);
          setWhaleStatus(t("unfollowed"), true);
          renderWhales();
        });
      });
    } catch (e) {
      if (whaleRowsEl) whaleRowsEl.innerHTML = `<p class="hint">${t("whaleUnavailable")}</p>`;
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
    if (!addr) { setWhaleStatus(t("pasteWallet"), false); return; }
    const r = await window.pilly.whaleAdd(addr, "");
    setWhaleStatus(r && r.ok ? t("followed") : (r && r.error) || t("failed"), !!r && !!r.ok);
    if (r && r.ok && whaleAddrEl) whaleAddrEl.value = "";
    renderWhales();
  });
  document.getElementById("whaleCheckBtn") && document.getElementById("whaleCheckBtn").addEventListener("click", async () => {
    setWhaleStatus(t("checking"), false);
    await window.pilly.whaleCheck();
    setWhaleStatus(t("checked"), true);
    renderWhales();
  });

  // ---- Settings panel ----
  const TIERS = ["tier1", "tier2", "tier3"];

  // v1.1.2: the tier inputs only exist after the overlay has been built once.
  // readSettings() runs on Save and Test, so it must never invent empty tiers -
  // an empty key there would wipe API keys the user already saved. Remember the
  // last known values and fall back to them instead of throwing.
  let knownTiers = null;

  function buildTierRows(settings) {
    knownTiers = TIERS.map((_, i) => {
      const tier = (settings.tiers && settings.tiers[i]) || { url: "", key: "", model: "", auth: "bearer" };
      return { url: tier.url || "", key: tier.key || "", model: tier.model || "", auth: "bearer" };
    });
    tierRowsEl.innerHTML = "";
    TIERS.forEach((_, i) => {
      const tier = knownTiers[i];
      const row = document.createElement("div");
      row.className = "tier";
      row.innerHTML = `
        <div class="tier-title">API ${i + 1}</div>
        <input class="t-url" placeholder="https://…/chat/completions" value="${escapeHtml(tier.url || "")}" />
        <input class="t-key" type="password" placeholder="${t("apiKey")}" value="${escapeHtml(tier.key || "")}" />
        <input class="t-model" placeholder="${t("model")}" value="${escapeHtml(tier.model || "")}" />
        <div class="t-fetch-row">
          <button type="button" class="t-fetch">${t("findFreeModels")}</button>
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
        if (!url) { setStatus(t("apiUrlFirst"), false); return; }
        fetchBtn.disabled = true;
        fetchBtn.textContent = t("searching");
        const r = await window.pilly.settingsModels({ url, key, auth: "bearer" });
        fetchBtn.disabled = false;
        fetchBtn.textContent = t("findFreeModels");
        if (!r.ok) { setStatus(r.error, false); return; }
        select.innerHTML = "";
        r.models.forEach((m) => {
          const o = document.createElement("option");
          o.value = m;
          o.textContent = r.free.includes(m) ? `${m}  (${t("freeWord")})` : m;
          select.appendChild(o);
        });
        select.hidden = false;
        setStatus(
          r.free.length
            ? t("freeOf", { f: r.free.length, n: r.models.length })
            : t("modelsFound", { n: r.models.length }),
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
      // No row yet (Save/Test before the overlay rendered): keep what is saved.
      if (!r) return (knownTiers && knownTiers[i]) || { url: "", key: "", model: "", auth: "bearer" };
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
        // v1.0.5 proactive features - MUST be included here or Save() would
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
        language: chatLanguage ? chatLanguage.value : "auto",
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
    petTheme.value = p.theme || "ball";
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
    if (chatLanguage) chatLanguage.value = ["auto", "en", "zh"].includes(c.language) ? c.language : "auto";
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
  // Language applies instantly to the whole window and is persisted with Save.
  if (chatLanguage) chatLanguage.addEventListener("change", async () => {
    const lang = ["auto", "en", "zh"].includes(chatLanguage.value) ? chatLanguage.value : "auto";
    chatLanguage.value = lang;
    window.I18N.setLang(lang);
    try {
      const s = readSettings();
      const r = await window.pilly.settingsSave(s);
      if (r && r.ok) knownTiers = s.tiers;
    } catch (e) { /* the in-window switch already happened */ }
  });
  // Window position is remembered automatically; this buttons snaps it back.
  const winResetBtn = document.getElementById("winResetBtn");
  if (winResetBtn) winResetBtn.addEventListener("click", async () => {
    winResetBtn.disabled = true;
    const prev = winResetBtn.textContent;
    winResetBtn.textContent = t("resetting");
    try {
      await window.pilly.resetWindow();
      setStatus(t("winResetOk"), true);
    } catch (e) {
      setStatus(t("winResetFail"), false);
    } finally {
      winResetBtn.disabled = false;
      winResetBtn.textContent = prev;
    }
  });
  document.getElementById("saveBtn").addEventListener("click", async () => {
    const s = readSettings();
    const r = await window.pilly.settingsSave(s);
    // Keep the fallback snapshot in step with what was just persisted, so a Save
    // that runs without the rows on screen re-posts the same values.
    if (r.ok) knownTiers = s.tiers;
    applyPetTheme(s.pet);
    if (r.ok) setStatus(t("saved"), true);
    else setStatus(t("saveFailed", { e: r.error || "" }), false);
  });
  document.getElementById("testBtn").addEventListener("click", async () => {
    setStatus(t("testing"), false);
    const r = await window.pilly.settingsTest(readSettings());
    if (r.ok) setStatus(t("connected", { t: r.tier }), true);
    else setStatus(r.error || t("noTierAnswered"), false);
  });

  // Theme the chat avatar with the saved pet color + bubble style on startup.
  window.pilly.settingsGet().then((s) => {
    const savedLang = s && s.chat && ["auto", "en", "zh"].includes(s.chat.language) ? s.chat.language : "auto";
    if (savedLang !== "auto") window.I18N.setLang(savedLang);
    if (chatLanguage) chatLanguage.value = savedLang;
    applyPetTheme(s && s.pet);
    applyBubbleStyle(s && s.chat);
    applyChatFontSize((s && s.chat && s.chat.fontSize) || "normal");
    // v1.1.2: the pet's run state survives a restart, so light the button up if
    // the main process already restored him.
    document.getElementById("petBtn").classList.toggle("active", !!(s && s.pet && s.pet.on));
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
          rememberCoin(fresh.coin);
          const rb = cardEl.querySelector('[data-act="read"]');
          if (rb) rb.dataset.read = fresh.read || "";
          const wbtn = cardEl.querySelector('[data-act="watch"]');
          if (wbtn) wbtn.dataset.price = fresh.coin.price != null ? fresh.coin.price : "";
          if (changed) {
            renderCardBody(cardEl, fresh.coin);
            // Restored cards have no cached sparkline - fetch it once.
            if (!cardSparks.has(mint)) {
              window.pilly.spark(mint).then((s) => {
                if (s && s.points && s.points.length >= 2) { rememberSpark(mint, s); drawSpark(cardEl, s); }
              }).catch(() => {});
            }
          }
        } catch (e) { /* keep old data */ }
      }));
    } finally {
      cardTickBusy = false;
    }
  }
  // v1.1.2: the main process cannot read the OS "reduce motion" switch on every
  // platform, so the renderers report it - and the pet window may not even exist
  // when the app starts. Reported on load and whenever the user flips the
  // switch, so the tray icon calms down without a restart.
  function reportMotionPref() {
    try {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      const send = () => {
        if (window.pilly.setUiPrefs) window.pilly.setUiPrefs({ reduceMotion: mq.matches });
      };
      send();
      if (mq.addEventListener) mq.addEventListener("change", send);
    } catch (e) { /* no matchMedia on this runtime - keep the default */ }
  }
  reportMotionPref();
  setInterval(tickCards, 15000);
  loadPnl();
})();

