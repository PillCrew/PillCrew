// Generates Pilly's tray icons (3 bobbing frames) and the app icons from the
// official PillCrew brand mark, so the taskbar, the installer and the menu bar
// all show the same mascot the site shows. Pure Node (zlib) - no image
// libraries, no build tools. Run: node scripts/gen-icon.js  (auto-runs on
// install).
//
// v1.1.6: this used to draw a green capsule procedurally. The mascot is now the
// brand mark itself, and its art is the single source of truth - change the
// mark and every icon follows.
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

const OUT_DIR = path.join(__dirname, "..", "assets");
const SOURCE = path.join(OUT_DIR, "brand-mark.png");

const TRAY_SIZE = 32;
// The mark's fringe touches the edge of its canvas, so the tray frames leave a
// pixel of margin for the bob to move into instead of clipping the bumps.
const TRAY_INSET = 1;

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


// ---- PNG decode (8-bit RGBA, non-interlaced - what the brand export is) ----
function decodePNG(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let i = 8;
  let width = 0, height = 0;
  const idat = [];
  while (i + 8 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString("ascii", i + 4, i + 8);
    const data = buf.subarray(i + 8, i + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const depth = data[8], colorType = data[9], interlace = data[12];
      if (depth !== 8 || colorType !== 6 || interlace !== 0) {
        throw new Error(`unsupported PNG (depth ${depth}, colour type ${colorType}, interlace ${interlace}); export the mark as 8-bit RGBA`);
      }
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    i += 12 + len;
  }
  if (!width || !height) throw new Error("PNG has no IHDR");
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = width * bpp;
  const out = Buffer.alloc(width * height * bpp);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const cur = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = cur[x];
      if (filter === 1) v = (v + a) & 255;
      else if (filter === 2) v = (v + b) & 255;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
      cur[x] = v;
    }
    cur.copy(out, y * stride);
    prev = cur;
  }
  return { width, height, data: out };
}

// ---- Area-average resize ----
// Weights are exact overlaps, so any target size works (the mark is 1024px and
// the tray wants 30). Colours are averaged premultiplied by alpha, otherwise a
// transparent edge bleeds a dark halo into the fringe.
function spans(srcLen, dstLen) {
  const ratio = srcLen / dstLen;
  const out = [];
  for (let d = 0; d < dstLen; d++) {
    const s0 = d * ratio, s1 = (d + 1) * ratio;
    const list = [];
    for (let i = Math.floor(s0); i < Math.ceil(s1); i++) {
      const lo = Math.max(s0, i), hi = Math.min(s1, i + 1);
      if (hi > lo) list.push([i, (hi - lo) / ratio]);
    }
    out.push(list);
  }
  return out;
}

function resize(img, dstW, dstH) {
  const sw = img.width, sh = img.height, data = img.data;
  const xs = spans(sw, dstW);
  const ys = spans(sh, dstH);
  // horizontal pass: sw x sh -> dstW x sh
  const mid = Buffer.alloc(dstW * sh * 4);
  for (let y = 0; y < sh; y++) {
    const srcRow = y * sw * 4;
    const dstRow = y * dstW * 4;
    for (let d = 0; d < dstW; d++) {
      let a = 0, r = 0, g = 0, b = 0;
      for (const pair of xs[d]) {
        const o = srcRow + pair[0] * 4;
        const w = pair[1];
        const al = data[o + 3] / 255;
        a += data[o + 3] * w;
        r += data[o] * al * w;
        g += data[o + 1] * al * w;
        b += data[o + 2] * al * w;
      }
      const o = dstRow + d * 4;
      const alpha = a / 255;
      mid[o + 3] = Math.round(a);
      if (alpha > 0.001) {
        mid[o] = Math.min(255, Math.round(r / alpha));
        mid[o + 1] = Math.min(255, Math.round(g / alpha));
        mid[o + 2] = Math.min(255, Math.round(b / alpha));
      }
    }
  }
  // vertical pass: dstW x sh -> dstW x dstH
  const out = Buffer.alloc(dstW * dstH * 4);
  for (let y = 0; y < dstH; y++) {
    for (let d = 0; d < dstW; d++) {
      let a = 0, r = 0, g = 0, b = 0;
      for (const pair of ys[y]) {
        const o = (pair[0] * dstW + d) * 4;
        const w = pair[1];
        const al = mid[o + 3] / 255;
        a += mid[o + 3] * w;
        r += mid[o] * al * w;
        g += mid[o + 1] * al * w;
        b += mid[o + 2] * al * w;
      }
      const o = (y * dstW + d) * 4;
      const alpha = a / 255;
      out[o + 3] = Math.round(a);
      if (alpha > 0.001) {
        out[o] = Math.min(255, Math.round(r / alpha));
        out[o + 1] = Math.min(255, Math.round(g / alpha));
        out[o + 2] = Math.min(255, Math.round(b / alpha));
      }
    }
  }
  return { width: dstW, height: dstH, data: out };
}

// Paints a (smaller) image onto a transparent canvas at an integer offset.
function place(img, canvasSize, x0, y0) {
  const out = Buffer.alloc(canvasSize * canvasSize * 4);
  for (let y = 0; y < img.height; y++) {
    const ty = y + y0;
    if (ty < 0 || ty >= canvasSize) continue;
    for (let x = 0; x < img.width; x++) {
      const tx = x + x0;
      if (tx < 0 || tx >= canvasSize) continue;
      const s = (y * img.width + x) * 4;
      const d = (ty * canvasSize + tx) * 4;
      out[d] = img.data[s];
      out[d + 1] = img.data[s + 1];
      out[d + 2] = img.data[s + 2];
      out[d + 3] = img.data[s + 3];
    }
  }
  return out;
}

// Frames: base (0), up (-1), down (+1) -> bobbing animation.
function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (!fs.existsSync(SOURCE)) {
    // Never fail an install over a cosmetic asset: the icons already in the
    // repo came from the same mark, so they are still the right face.
    console.warn(`[pilly] no ${path.basename(SOURCE)} - keeping the icons already in assets/`);
    return;
  }
  const mark = decodePNG(fs.readFileSync(SOURCE));

  const inner = resize(mark, TRAY_SIZE - TRAY_INSET * 2, TRAY_SIZE - TRAY_INSET * 2);
  const offsets = [0, -1, 1];
  for (let i = 0; i < offsets.length; i++) {
    const rgba = place(inner, TRAY_SIZE, TRAY_INSET, TRAY_INSET + offsets[i]);
    fs.writeFileSync(path.join(OUT_DIR, `pilly-${i}.png`), encodePNG(TRAY_SIZE, TRAY_SIZE, rgba));
    console.log(`wrote assets/pilly-${i}.png (${TRAY_SIZE}px)`);
  }

  // App icons: 256px (Windows installer/window), 512px (Linux) and 1024px
  // (macOS). The 1024 is the mark re-encoded, so a re-export with different
  // PNG settings still lands as the exact file the builders expect.
  const large = [
    { file: "pilly.png", size: 256 },
    { file: "pilly-512.png", size: 512 },
    { file: "pilly-1024.png", size: 1024 },
  ];
  for (const item of large) {
    const size = item.size;
    const img = size === mark.width && size === mark.height ? mark : resize(mark, size, size);
    fs.writeFileSync(path.join(OUT_DIR, item.file), encodePNG(size, size, img.data));
    console.log(`wrote assets/${item.file} (${size}px)`);
  }
}

main();
