// Auto-classify models that have entered the top 50 but are missing from
// data/model-classification.json. Deterministic — no LLM involved:
//
//   weights:  the live OpenRouter catalog's hugging_face_id field.
//             Set -> "open" (weights are on Hugging Face). Absent -> "closed".
//             openrouter/* stealth models and models absent from the catalog
//             entirely -> "unknown" and flagged for review.
//   origin:   org-level lookup in data/org-origins.json (derived from the
//             reviewed baseline). Unknown orgs -> "Unknown" and flagged.
//
// Existing entries are NEVER modified — to correct a model (e.g., a stealth
// reveal or a weight release after launch), edit model-classification.json
// directly; this script only appends. Auto entries carry confidence "auto".
//
// Usage: node scripts/classify.mjs

import { readFileSync, writeFileSync, readdirSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalize } from './lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'data');

const rankingFiles = readdirSync(dataDir).filter((f) => /^rankings-\d{4}\.json$/.test(f));
const bases = new Set(
  rankingFiles
    .flatMap((f) => JSON.parse(readFileSync(join(dataDir, f), 'utf8')).data)
    .filter((r) => r.model_permaslug !== 'other')
    .map((r) => normalize(r.model_permaslug)),
);

const clsPath = join(dataDir, 'model-classification.json');
const classification = JSON.parse(readFileSync(clsPath, 'utf8'));
const known = new Set(classification.models.map((m) => m.base));
const missing = [...bases].filter((b) => !known.has(b)).sort();

const orgMap = JSON.parse(readFileSync(join(dataDir, 'org-origins.json'), 'utf8'));

// Live catalog: openness ground truth for currently listed models.
const res = await fetch('https://openrouter.ai/api/v1/models');
if (!res.ok) throw new Error(`catalog fetch failed: ${res.status}`);
const catalog = (await res.json()).data;
const catalogByBase = new Map();
for (const m of catalog) {
  for (const key of new Set([normalize(m.id), m.canonical_slug ? normalize(m.canonical_slug) : null])) {
    if (key) catalogByBase.set(key, m);
  }
}

const today = new Date().toISOString().slice(0, 10);

// Re-check auto entries: a model that launched API-only may publish weights
// later (hugging_face_id appears in the catalog after release). Only
// confidence "auto" entries are revisited — manual edits are never touched.
const upgraded = [];
for (const m of classification.models) {
  if (m.confidence !== 'auto' || m.weights === 'open') continue;
  const cat = catalogByBase.get(m.base);
  if (cat && cat.hugging_face_id) {
    m.weights = 'open';
    m.note = `auto-classified ${today}: weights released post-launch (hugging_face_id ${cat.hugging_face_id})`;
    upgraded.push(m);
  }
}

if (missing.length === 0 && upgraded.length === 0) {
  console.log(`All ${bases.size} ranked models classified — nothing to do.`);
  process.exit(0);
}

const added = [];
const review = [];

for (const base of missing) {
  const org = base.split('/')[0];
  const cat = catalogByBase.get(base);
  const orgInfo = orgMap[org];

  let weights, weightsRule;
  if (org === 'openrouter') {
    weights = 'unknown';
    weightsRule = 'stealth model — attribute manually once publicly revealed';
  } else if (!cat) {
    weights = 'unknown';
    weightsRule = 'not in live catalog (delisted?) — review manually';
  } else if (cat.hugging_face_id) {
    weights = 'open';
    weightsRule = `hugging_face_id ${cat.hugging_face_id}`;
  } else {
    weights = 'closed';
    weightsRule = 'no hugging_face_id in catalog';
  }

  const origin = org === 'openrouter' ? 'Unknown' : orgInfo ? orgInfo.origin : 'Unknown';
  const country = org === 'openrouter' ? 'Unknown' : orgInfo ? orgInfo.origin_country : 'Unknown';
  const developer =
    (cat && cat.name && cat.name.includes(':') ? cat.name.split(':')[0].trim() : null) ||
    (orgInfo ? orgInfo.developer : org);

  const flags = [];
  if (weights === 'unknown') flags.push('weights unresolved');
  if (!orgInfo && org !== 'openrouter') flags.push(`org "${org}" not in org-origins.json`);
  if (orgInfo && orgInfo.mixed) flags.push(`org "${org}" has mixed-origin history — verify`);

  const entry = {
    base,
    developer,
    origin,
    origin_country: country,
    weights,
    confidence: 'auto',
    note: `auto-classified ${today}: ${weightsRule}${flags.length ? ' | REVIEW: ' + flags.join('; ') : ''}`,
  };
  classification.models.push(entry);
  added.push(entry);
  if (flags.length) review.push(entry);
}

classification.generated = today;
classification.models.sort((a, b) => a.base.localeCompare(b.base));
writeFileSync(clsPath, JSON.stringify(classification, null, 1));

const line = (e) => `- \`${e.base}\` -> ${e.weights}, ${e.origin} (${e.note.replace(/^auto-classified [\d-]+: /, '')})`;
if (added.length) {
  console.log(`Auto-classified ${added.length} new model(s):`);
  for (const e of added) console.log(line(e));
}
if (upgraded.length) {
  console.log(`Upgraded ${upgraded.length} auto entr${upgraded.length === 1 ? 'y' : 'ies'} to open (weights released post-launch):`);
  for (const e of upgraded) console.log(line(e));
}
if (review.length) console.log(`\n${review.length} entr${review.length === 1 ? 'y needs' : 'ies need'} manual review.`);

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### Model classification\n\n` +
      (added.length ? `Auto-classified **${added.length}** new model(s):\n\n${added.map(line).join('\n')}\n\n` : '') +
      (upgraded.length ? `Upgraded **${upgraded.length}** to open (weights released post-launch):\n\n${upgraded.map(line).join('\n')}\n\n` : '') +
      (review.length ? `⚠️ **${review.length} need manual review** — edit \`data/model-classification.json\`.\n` : ''),
  );
}
