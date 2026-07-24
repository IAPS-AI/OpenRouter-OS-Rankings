// Build step: joins data/rankings-*.json with data/model-classification.json,
// aggregates per-day per-base-model token totals, and injects the compact
// dataset into index.html between the <script id="dashboard-data"> tags.
// Usage: node scripts/build.mjs

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalize } from './lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'data');

const rankingFiles = readdirSync(dataDir).filter((f) => /^rankings-\d{4}\.json$/.test(f)).sort();
if (rankingFiles.length === 0) throw new Error('no data/rankings-*.json files — run scripts/fetch-data.mjs first');
const rows = rankingFiles.flatMap((f) => JSON.parse(readFileSync(join(dataDir, f), 'utf8')).data);

const classification = JSON.parse(readFileSync(join(dataDir, 'model-classification.json'), 'utf8'));
const classByBase = new Map(classification.models.map((m) => [m.base, m]));

// Aggregate: date -> (base -> tokens), plus the per-day "other" bucket.
const byDate = new Map();
const otherByDate = new Map();
for (const r of rows) {
  const tokens = Number(r.total_tokens);
  if (r.model_permaslug === 'other') {
    otherByDate.set(r.date, (otherByDate.get(r.date) || 0) + tokens);
    continue;
  }
  const base = normalize(r.model_permaslug);
  if (!byDate.has(r.date)) byDate.set(r.date, new Map());
  const day = byDate.get(r.date);
  day.set(base, (day.get(base) || 0) + tokens);
}

const dates = [...byDate.keys()].sort();

// Model table: only bases that actually occur, indexed for compactness.
const originCode = { US: 'US', China: 'CN', Other: 'OT', Unknown: 'UN' };
const bases = [...new Set([...byDate.values()].flatMap((d) => [...d.keys()]))].sort();
const unclassified = [];
const models = bases.map((base) => {
  const c = classByBase.get(base);
  if (!c) unclassified.push(base);
  return {
    s: base,
    d: c ? c.developer : 'Unclassified',
    w: c ? c.weights[0] : 'u', // o | c | u
    o: c ? originCode[c.origin] : 'UN', // US | CN | OT | UN
    n: c ? c.origin_country : 'Unknown',
    ...(c && c.finetune_of ? { f: c.finetune_of } : {}),
  };
});
if (unclassified.length) console.warn(`WARNING: ${unclassified.length} bases missing classification:`, unclassified.join(', '));

const idx = new Map(bases.map((b, i) => [b, i]));
const days = dates.map((date) =>
  [...byDate.get(date).entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([base, tokens]) => [idx.get(base), tokens]),
);
const other = dates.map((date) => otherByDate.get(date) || 0);

const payload = {
  generated: classification.generated,
  source: 'https://openrouter.ai/api/v1/datasets/rankings-daily',
  dates,
  models,
  days,
  other,
};

const htmlPath = join(root, 'index.html');
const html = readFileSync(htmlPath, 'utf8');
const tag = /(<script id="dashboard-data" type="application\/json">)[\s\S]*?(<\/script>)/;
if (!tag.test(html)) throw new Error('dashboard-data script tag not found in index.html');
const json = JSON.stringify(payload);
// String.replace treats $-sequences in the replacement specially; use a
// callback so JSON content is inserted verbatim.
const next = html.replace(tag, (_, open, close) => `${open}\n${json}\n${close}`);
if (next === html) { console.log('Dataset unchanged — index.html left as is.'); process.exit(0); }
writeFileSync(htmlPath, next);
console.log(`Injected ${dates.length} days x ${models.length} models (${(json.length / 1024).toFixed(0)} KB) into index.html`);
