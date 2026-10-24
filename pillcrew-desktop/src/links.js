// src/links.js - every place PillCrew lives, in one list.
//
// v1.1.6: the tray menu knew the GitHub URL, the chat window knew nothing, and
// the site was not linked at all. One list means a link is fixed once - and the
// renderer can only ask for an id, never for a URL, so a stray string can not
// open something that is not PillCrew's own.
const LINKS = [
  { id: "site",   en: "pillcrew.fun",    zh: "pillcrew.fun", url: "https://pillcrew.fun" },
  { id: "docs",   en: "Docs",            zh: "文档",          url: "https://pillcrew.fun/docs" },
  { id: "buy",    en: "Buy $PILLY",      zh: "购买 $PILLY",   url: "https://pillcrew.fun/buy" },
  { id: "game",   en: "Play the game",   zh: "玩游戏",        url: "https://game.pillcrew.fun" },
  { id: "x",      en: "X",               zh: "X",            url: "https://x.com/PillCrewSol" },
  { id: "github", en: "GitHub",          zh: "GitHub",       url: "https://github.com/PillCrew/PillCrew" },
];

const IDS = LINKS.map((l) => l.id);

// The list as a surface shows it: a label in the reader's language and the id
// that identifies it. Surfaces never need the URL itself.
function list(lang) {
  return LINKS.map((l) => ({ id: l.id, label: lang === "zh" ? l.zh : l.en }));
}

function byId(id) {
  const key = String(id || "");
  return LINKS.find((l) => l.id === key) || null;
}

// null for anything that is not on the list - the caller must treat that as
// "nothing to open", never as "open it anyway".
function url(id) {
  const link = byId(id);
  return link ? link.url : null;
}

module.exports = { LINKS, IDS, list, byId, url };
