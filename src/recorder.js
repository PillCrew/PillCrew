const fs = require('fs');
const path = require('path');

class SessionRecorder {
  constructor(dir, { maxBytes = 50 * 1024 * 1024 } = {}) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, `market-${Date.now()}-${require('crypto').randomUUID()}.jsonl`);
    this.stream = fs.createWriteStream(this.file, { flags: 'ax' });
    this.maxBytes = maxBytes;
    this.bytes = 0;
    this.dropped = 0;
    this.blocked = false;
    this.error = null;
    this.closed = false;
    this.stream.on('drain', () => { this.blocked = false; });
    this.stream.on('error', (err) => { this.error = err.message; this.closed = true; });
  }
  record({ ts, mint, mcSol, liquiditySol, signal }) {
    if (this.closed || this.blocked || this.error || this.bytes >= this.maxBytes) { this.dropped++; return false; }
    if (!Number.isFinite(ts) || typeof mint !== 'string' || !Number.isFinite(mcSol) || mcSol < 0) return false;
    const row = { ts, mint, mcSol };
    if (Number.isFinite(liquiditySol) && liquiditySol >= 0) row.liquiditySol = liquiditySol;
    if (signal === true) row.signal = true;
    const line = JSON.stringify(row) + '\n';
    const bytes = Buffer.byteLength(line);
    if (this.bytes + bytes > this.maxBytes) { this.dropped++; return false; }
    this.bytes += bytes;
    this.blocked = !this.stream.write(line);
    return true;
  }
  close() {
    if (this.closed) return Promise.resolve();
    this.closed = true;
    return new Promise((resolve) => {
      this.stream.once('error', resolve);
      this.stream.end(resolve);
    });
  }
  status() { return { file: this.file, bytes: this.bytes, dropped: this.dropped, error: this.error }; }
}

module.exports = { SessionRecorder };
