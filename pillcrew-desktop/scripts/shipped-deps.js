#!/usr/bin/env node
// Prints the npm packages that are actually inside a packaged app, read straight
// from app.asar. `npm ls` describes the source tree; this describes the build
// that a user downloads, which is the one that matters for a dependency
// advisory. An asar header is JSON at a fixed offset, so no extra tooling is
// needed.
//
//   node scripts/shipped-deps.js [path/to/app.asar]
//
// With no argument it looks in the usual electron-builder output directories.

const fs = require('fs');
const path = require('path');

const CANDIDATES = [
  'dist/win-unpacked/resources/app.asar',
  'dist/mac/Pilly.app/Contents/Resources/app.asar',
  'dist/mac-universal/Pilly.app/Contents/Resources/app.asar',
  'dist/linux-unpacked/resources/app.asar',
];

const asarPath = process.argv[2] || CANDIDATES.map((p) => path.join(__dirname, '..', p)).find(fs.existsSync);
if (!asarPath || !fs.existsSync(asarPath)) {
  console.error('No app.asar found. Build first, or pass its path as an argument.');
  console.error('Looked in:\n  ' + CANDIDATES.join('\n  '));
  process.exit(1);
}

const buf = fs.readFileSync(asarPath);
const dataStart = 16 + buf.readUInt32LE(12);
const header = JSON.parse(buf.subarray(16, dataStart).toString());

const packages = [];
(function walk(node, dir) {
  for (const [name, entry] of Object.entries(node.files || {})) {
    const here = `${dir}/${name}`;
    if (entry.files) {
      walk(entry, here);
    } else if (name === 'package.json') {
      const at = dataStart + Number(entry.offset);
      // A package.json is small, but its exact length is not always in the
      // header, so read a generous window and cut back to the last brace.
      const text = buf.subarray(at, at + (Number(entry.size) || 8192)).toString();
      try {
        packages.push([here.replace(/\/package\.json$/, ''), JSON.parse(text.slice(0, text.lastIndexOf('}') + 1))]);
      } catch {
        // A file we cannot parse is not worth failing the whole listing for.
      }
    }
  }
})(header, '');

console.log(path.relative(process.cwd(), asarPath) + '\n');
for (const [dir, pkg] of packages.sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`${(pkg.name || '?') + '@' + (pkg.version || '?')}`.padEnd(34) + dir.replace(/^\/node_modules\//, ''));
}
console.log(`\n${packages.length} packages`);
