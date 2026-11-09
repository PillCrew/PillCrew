const fs = require('fs');
const { replay } = require('../src/backtest');

try {
  const [input, settings] = process.argv.slice(2);
  if (!input) throw new Error('Usage: npm run backtest -- events.jsonl [settings.json]');
  const rows = fs.readFileSync(input, 'utf8').split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line));
  const options = settings ? JSON.parse(fs.readFileSync(settings, 'utf8')) : {};
  const result = Array.isArray(options) ? options.map((plan) => {
    const { history, ...summary } = replay(rows, plan);
    return summary;
  }) : replay(rows, options);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} catch (err) { console.error(err.message); process.exitCode = 1; }
