// Renders the promo images with the Electron that is already installed. No build tooling, no network.
// Usage: npx electron scripts/render-promo.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const SHOTS = [
  { file: 'banner.html', out: 'banner.png', width: 1400, height: 740 },
  { file: 'social.html', out: 'social-card.png', width: 1200, height: 630 },
  { file: 'square.html', out: 'square.png', width: 1200, height: 1200 },
];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1400, height: 1200, show: false, frame: false,
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });
  for (const shot of SHOTS) {
    const source = path.join(__dirname, '..', 'promo', shot.file);
    if (!fs.existsSync(source)) continue;
    try {
      win.setContentSize(shot.width, shot.height);
      await win.loadFile(source);
      await wait(1000);
      const image = await win.webContents.capturePage({ x: 0, y: 0, width: shot.width, height: shot.height });
      const target = path.join(__dirname, '..', 'promo', shot.out);
      fs.writeFileSync(target, image.toPNG());
      console.log('wrote', path.relative(process.cwd(), target), `${shot.width}x${shot.height}`);
    } catch (e) {
      console.error('failed', shot.file, e.message);
    }
  }
  win.destroy();
  app.quit();
});
