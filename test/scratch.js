// One scratch root per suite run, removed when the suite exits.
//
// RULE ADDED 2026-11-06 (1.1.1): a test harness that leaves its scratch behind had put 787 directories in this machine's
// temp folder. Two defences, because one is not enough: the root is removed on exit, and every suite sweeps roots an
// earlier run left behind (a killed process, or an Electron profile still locked at the moment of exit).
const fs = require('fs');
const os = require('os');
const path = require('path');

const STALE_MS = 30000;

function sweep() {
  let names = [];
  try { names = fs.readdirSync(os.tmpdir()); } catch (_) { return; }
  for (const name of names) {
    if (!/^pcs-run-/.test(name)) continue;
    const p = path.join(os.tmpdir(), name);
    try {
      if (Date.now() - fs.statSync(p).mtimeMs > STALE_MS) fs.rmSync(p, { recursive: true, force: true });
    } catch (_) { /* still in use by another run, or already gone */ }
  }
}

sweep();
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pcs-run-'));
process.on('exit', () => {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) { /* best effort, swept by the next run */ }
});

module.exports = { root, sweep };
