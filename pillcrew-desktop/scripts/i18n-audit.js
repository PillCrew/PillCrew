// Audit i18n key usage vs definitions (dev tool, not shipped).
const fs = require("fs");
const base = __dirname.replace(/scripts$/, "") + "renderer/";
const rj = fs.readFileSync(base + "renderer.js", "utf8");
const used = new Set();
for (const m of rj.matchAll(/\bt\(\s*["']([A-Za-z0-9_]+)["']/g)) used.add(m[1]);
const ij = fs.readFileSync(base + "i18n.js", "utf8");
const enStart = ij.indexOf("var EN = {") + "var EN = {".length;
const zhStart = ij.indexOf("var ZH = {") + "var ZH = {".length;
const i18nStart = ij.indexOf("var I18N = {");
const enSec = ij.slice(enStart, zhStart);
const zhSec = ij.slice(zhStart, i18nStart);
const defined = new Set();
const dupList = [];
for (const [name, sec] of [["EN", enSec], ["ZH", zhSec]]) {
  const c = {};
  for (const m of sec.matchAll(/^    ([A-Za-z0-9_]+):/gm)) {
    defined.add(m[1]);
    c[m[1]] = (c[m[1]] || 0) + 1;
  }
  const d = Object.keys(c).filter((k) => c[k] > 1).sort();
  if (d.length) dupList.push(`${name} dups: ${d.join(", ")}`);
}
const html = fs.readFileSync(base + "index.html", "utf8");
for (const m of html.matchAll(/data-i18n(?:-html|-ph|-title)?=["']([A-Za-z0-9_]+)["']/g)) used.add(m[1]);
const missing = [...used].filter((k) => !defined.has(k)).sort();
console.log("MISSING:", missing.join(", ") || "(none)");
if (dupList.length) console.log(dupList.join("\n"));
else console.log("DUPLICATE KEYS: (none)");
