// Wraps three.js (CommonJS build) as a classic script at renderer/vendor/three.js (sets window.THREE).
// Classic scripts load reliably from file:// inside Electron, unlike ES modules.
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '..', 'node_modules', 'three', 'build', 'three.cjs');
const dst = path.join(__dirname, '..', 'renderer', 'vendor', 'three.js');
if (!fs.existsSync(src)) { console.warn('[vendor] three not installed yet - 3D background will use the CSS fallback.'); process.exit(0); }
fs.mkdirSync(path.dirname(dst), { recursive: true });
const code = fs.readFileSync(src, 'utf8');
fs.writeFileSync(dst, '(function(){var module={exports:{}};var exports=module.exports;\n' + code + '\nwindow.THREE=module.exports;})();\n');
console.log('[vendor] three.js ready.');
