# OpenRouter Open vs. Closed Rankings

A single-file dashboard tracking the daily market share of open-weight vs. closed models
in OpenRouter's top-50 token-usage rankings (January 2025 onward), with filters for U.S.-
and Chinese-developed models and a by-origin view.

Open `index.html` in a browser — no server or build tooling required at view time.

## Data

| File | Contents |
|---|---|
| `data/rankings-<year>.json` | Raw responses from OpenRouter's `rankings-daily` dataset: top 50 public models per day by total tokens (prompt + completion), plus one aggregated `other` row per day |
| `data/model-classification.json` | Per-model classification: developer, origin country (US / China / Other), and weights status (open / closed / unknown) |
| `data/org-origins.json` | Org prefix → origin/developer lookup used to auto-classify new models |
| `index.html` | The dashboard, with the compact joined dataset embedded by the build step |

## Automated refresh (GitHub Actions)

`.github/workflows/refresh.yml` runs daily at 06:30 UTC (and on manual dispatch):
fetch → auto-classify new models → rebuild `index.html` → commit if changed.

One-time setup after pushing to GitHub:

1. Add a repository secret named `OPENROUTER_API_KEY` (Settings → Secrets and
   variables → Actions). Any valid OpenRouter key works.
2. Optionally enable GitHub Pages (Settings → Pages → deploy from branch
   `main`, root) to serve the dashboard at a public URL.

### How new models are classified

`scripts/classify.mjs` appends entries for any model that enters the top 50
without touching existing ones — no LLM or manual step in the loop:

- **Weights**: from the live OpenRouter catalog — `hugging_face_id` set → open,
  absent → closed. `openrouter/*` stealth models and models already delisted
  from the catalog → unknown, flagged for review.
- **Origin**: org-prefix lookup in `data/org-origins.json` (a new `qwen/*` model
  is China, a new `anthropic/*` model is U.S.). Unseen orgs → Unknown, flagged.

Flagged entries appear in the Actions job summary with `REVIEW` markers in
their `note` field. To correct any entry (a stealth reveal, a post-launch
weight release, a new org), edit `data/model-classification.json` and/or add
the org to `data/org-origins.json` — the classifier never overwrites manual
edits. Auto entries carry `"confidence": "auto"`.

## Manual refresh

```powershell
$env:OPENROUTER_API_KEY = "sk-or-..."   # any valid OpenRouter key
node scripts/fetch-data.mjs              # re-downloads data/rankings-*.json
node scripts/classify.mjs                # classifies any new top-50 entrants
node scripts/build.mjs                   # re-embeds the dataset into index.html
```

## Classification method

- **Weights**: "open" if the model's weights are publicly downloadable as of the generated
  date (any license), assessed via the OpenRouter catalog's `hugging_face_id`,
  [Epoch AI's benchmarked-models dataset](https://epoch.ai/data/benchmarked_models.csv),
  and targeted web checks. Openness is applied retroactively (e.g., Grok-2 counts as open
  across its history; weights released August 2025).
- **Origin**: country of the developing organization. Community finetunes inherit the base
  model developer's country; OpenRouter's cloaked stealth models (`openrouter/*`) are
  attributed per public reveals, or marked unknown if never revealed.
- Permaslug snapshots (`-YYYYMMDD`) and `:free`/`:beta`-style variants are merged into
  their base model. Shares are computed within the daily top 50, which covered ~93% of all
  OpenRouter tokens as of July 2026.
