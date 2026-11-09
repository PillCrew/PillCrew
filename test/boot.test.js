// THE APP HAS TO BOOT WHOLE. Every panel of PillCrew is wired in `main.js`, and a helper that is called before it exists (or
// that sits inside `createWindow` while the save path calls it) throws a `ReferenceError` in the main process - where no
// renderer test can see it. That is exactly how "always on top" broke: the toast read `applyWindowPrefs is not defined`, the
// chat's look was never stored, and everything after that line in the ready handler was skipped. So this boots the real
// application on a scratch profile, waits for the window, and refuses any startup error.
//   node test/boot.test.js
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 9389;
const electron = require('electron');
const profile = mkdtempSync(path.join(os.tmpdir(), 'pillcrew-boot-'));

// A window needs a screen. A Linux runner without one has no X server and Electron cannot open a window there at all, so this
// case is reported as skipped instead of failing a build for a machine that has no display - the test runs on every desktop.
if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
  console.log('Boot test skipped: this Linux machine has no display, so no window can be opened here');
  process.exit(0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const child = spawn(electron, ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`], {
    cwd: path.join(__dirname, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PILLCREW_TEST: '1' },
  });
  let output = '';
  child.stdout.on('data', (c) => { output += c.toString(); });
  child.stderr.on('data', (c) => { output += c.toString(); });

  let target = null;
  const until = Date.now() + 45000;
  while (Date.now() < until) {
    await sleep(500);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => /index\.html/.test(t.url));
      if (target) break;
    } catch (_) { /* the port is not up yet */ }
  }
  // The ready handler runs after the window is created: give it the moment it needs so a throw there is seen.
  await sleep(4000);
  const alive = child.exitCode === null;
  if (!alive) { /* reported below */ }
  child.kill('SIGTERM');
  await sleep(800);
  try { child.kill('SIGKILL'); } catch (_) { /* already gone */ }
  rmSync(profile, { recursive: true, force: true });

  const failed = [];
  if (!target) failed.push('the window never opened');
  if (!alive) failed.push('the application exited during boot');
  const bad = output.split('\n').filter((line) => /is not defined|is not a function|Uncaught |UnhandledPromiseRejection|TypeError: /i.test(line));
  if (bad.length) failed.push(`startup errors:\n  ${bad.slice(0, 6).join('\n  ')}`);
  if (failed.length) {
    console.error('Boot test FAILED:\n- ' + failed.join('\n- '));
    console.error('--- output ---\n' + output.slice(-2000));
    process.exit(1);
  }
  console.log('Boot test passed (window opened, no startup errors, profile cleaned up)');
}

main().catch((err) => { console.error('Boot test FAILED: ' + err.message); process.exit(1); });
