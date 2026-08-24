// Generates Pilly's tray icons (a tiny green pill, 3 bobbing frames) as real
// PNG files, so Electron can use them in the Windows system tray. Pure Node
// (zlib) - no image libraries. Run: node scripts/gen-icon.js  (auto-runs on
// install).
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

const SIZE = 32;
const OUT_DIR = path.join(__dirname, "..", "assets");

// ---- PNG encoder (RGBA, no deps) ----
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  const stride = 1 + width * 4;
  const raw = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter: none
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// ---- Pill geometry ----
function insideCapsule(x, y, cx, cy, hw, hh, r) {
  const dx = Math.abs(x - cx);
  const dy = Math.abs(y - cy);
  if (dx <= hw - r && dy <= hh) return true;
  if (dy <= hh - r && dx <= hw) return true;
  const cx2 = hw - r;
  const cy2 = hh - r;
  if (Math.hypot(dx - cx2, dy - cy2) <= r) return true;
  if (Math.hypot(dx + cx2, dy - cy2) <= r) return true;
  if (Math.hypot(dx - cx2, dy + cy2) <= r) return true;
  if (Math.hypot(dx + cx2, dy + cy2) <= r) return true;
  return false;
}

// Frame with smooth edges via supersampling (n x n per pixel).
function drawFrameSmooth(frameOffset, size, scale, ss) {
  const cx = size / 2;
  const cy = size / 2 + frameOffset * scale;
  const hw = 8 * scale;
  const hh = 4 * scale;
  const r = 4 * scale;
  const buf = Buffer.alloc(size * size * 4);
  const s2 = ss * ss;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hit = 0;
      let eyes = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const px = x + (sx + 0.5) / ss;
          const py = y + (sy + 0.5) / ss;
          if (insideCapsule(px, py, cx, cy, hw, hh, r)) {
            hit++;
            if (hasEye(px, py, cx, cy - scale, scale)) eyes++;
          }
        }
      }
      const i = (y * size + x) * 4;
      if (hit > 0) {
        const a = Math.round((hit / s2) * 255);
        const t = (y - cy + hh) / (2 * hh);
        let cr = Math.round(34 + t * 20);
        let cg = Math.round(197 - t * 18);
        let cb = Math.round(94 + t * 30);
        if (eyes > hit / 2) { cr = 255; cg = 255; cb = 255; }
        buf[i] = cr; buf[i + 1] = cg; buf[i + 2] = cb; buf[i + 3] = a;
      }
    }
  }
  return buf;
}

// Eyes at the big scale.
function hasEye(x, y, cx, eyeCy, scale) {
  const x0 = cx - 2 * scale, x1 = cx - scale;
  const x2 = cx + scale, x3 = cx + 2 * scale;
  return ((x >= x0 && x <= x1) || (x >= x2 && x <= x3)) && (y >= eyeCy && y <= eyeCy + scale);
}

// Frames: base (0), up (-1), down (+1) -> bobbing animation.
function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const offsets = [0, -1, 1];
  for (let i = 0; i < offsets.length; i++) {
    const rgba = drawFrameSmooth(offsets[i], SIZE, 1, 4);
    const png = encodePNG(SIZE, SIZE, rgba);
    fs.writeFileSync(path.join(OUT_DIR, `pilly-${i}.png`), png);
    console.log(`wrote assets/pilly-${i}.png`);
  }
  // A 256px version for the window/installer icon (smooth supersampled).
  const big = drawFrameSmooth(0, 256, 8, 4);
  fs.writeFileSync(path.join(OUT_DIR, "pilly.png"), encodePNG(256, 256, big));
  console.log("wrote assets/pilly.png (256px)");
}

main();
