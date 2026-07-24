// Refresh raw rankings data from the OpenRouter Data API.
// Usage: OPENROUTER_API_KEY=sk-or-... node scripts/fetch-data.mjs
// Windows PowerShell: $env:OPENROUTER_API_KEY = "sk-or-..."; node scripts/fetch-data.mjs
//
// The rankings-daily endpoint returns the top 50 public models per day by
// total tokens plus one aggregated "other" row, from 2025-01-01 onward.
// Windows are capped at 366 days, so we fetch one file per calendar year.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const key = process.env.OPENROUTER_API_KEY;
if (!key) {
  console.error('OPENROUTER_API_KEY is not set.');
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(root, 'data'), { recursive: true });

const today = new Date().toISOString().slice(0, 10);
const startYear = 2025;
const endYear = Number(today.slice(0, 4));

for (let year = startYear; year <= endYear; year++) {
  const start = `${year}-01-01`;
  const end = year === endYear ? today : `${year}-12-31`;
  const url = `https://openrouter.ai/api/v1/datasets/rankings-daily?start_date=${start}&end_date=${end}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) {
    console.error(`GET ${url} -> ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  const body = await res.json();
  const file = join(root, 'data', `rankings-${year}.json`);
  writeFileSync(file, JSON.stringify(body));
  console.log(`wrote ${file} (${body.data.length} rows, ${start}..${end})`);
}

console.log('Done. Re-run `node scripts/build.mjs` to refresh the dashboard.');
console.log('Note: models new to the top 50 need a classification entry in data/model-classification.json.');
