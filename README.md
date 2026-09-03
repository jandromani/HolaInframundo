# GearWatch V2 — Causal Alpha Radar

GearWatch is a read-only market-intelligence system built around **mechanisms**, not headlines.

> `EVENT → LEAD → CONFIRM → MARKET VOTE → ALPHA CLICK → LAG → SATURATED`

The LLM is an evidence extractor. It cannot activate a mechanism or create an Alpha Click. Those decisions are deterministic code and are later judged by historical market performance.

## What V2 adds

- deterministic, versioned queries for every mechanism
- separate `LEAD / CONFIRM / LAG` sensors
- free upstream retrieval through GDELT + Google News RSS
- OpenRouter extraction using `openai/gpt-oss-120b:free`
- budgeted web-search verifier only for the strongest early mechanisms
- deterministic causal scoring and anti-alarmism gates
- independent market confirmation from price/volume/SMA data
- Alpha Click ledger with forward returns at 1d / 5d / 20d
- empirical correlation memory between causal mechanisms
- observed lead→confirm conversion and market-lag statistics
- full JSON traceability and Living Bible persistence
- read-only Vercel dashboard

## Pipeline

```text
versioned deterministic queries
        ↓
GDELT + Google News RSS
        ↓
candidate evidence + query trace
        ↓
gpt-oss-120b:free extraction
        ↓
deterministic causal score
        ↓
optional web red-team verifier
        ↓
market confirmation
        ↓
Alpha Click gate
        ↓
1d / 5d / 20d resolution
        ↓
correlation memory
```

## States

`UNKNOWN · DORMANT · WATCH · ARMING · ACTIVE · SATURATED · STALE · INVALIDATED`

`ACTIVE` requires independent confirming evidence. Missing data never becomes negative evidence. `SATURATED` means the causal thesis can still be true while the trade has become too crowded.

## Alpha Click philosophy

We intentionally give away the first euro and the last euro.

An Alpha Click sits between rumor and consensus. It needs upstream causal evidence plus the first distributed confirmation from the market, while crowding and lag evidence remain below configured limits.

## Runtime

GitHub Actions runs at minute 17 every six hours (`00:17 / 06:17 / 12:17 / 18:17 UTC`). Different mechanism tiers are sampled at different cadences inside that cycle.

Required GitHub Actions secret:

- `OPENROUTER_API_KEY`

The API key must **never** be committed, written to JSON, printed in logs or exposed to the browser.

The workflow defaults to:

- `OPENROUTER_MODEL=openai/gpt-oss-120b:free`

Normal scans do not pay for OpenRouter web search: deterministic retrieval happens first. Web search is reserved for a maximum of four red-team verifications per run and twelve per day.

## Important files

- `config/queries.v2.json` — exact LEAD / CONFIRM / LAG queries
- `config/policy.v2.json` — thresholds, budgets and circuit breakers
- `config/edges.v2.json` — causal graph hypotheses
- `scripts/retrieve.mjs` — deterministic retrieval
- `scripts/extract.mjs` — LLM fact extraction
- `scripts/verify.mjs` — budgeted web verification
- `scripts/score.v2.mjs` — deterministic state/Alpha scoring
- `scripts/assemble.mjs` — Living Bible + Alpha ledger
- `scripts/correlate.mjs` — empirical historical calibration
- `data/current.json` — current state
- `data/series.json` — mechanism time series
- `data/alpha-clicks.json` — signal ledger and forward performance
- `data/correlation-memory.json` — learned propagation statistics

The site contains no trade execution. It is an experimental causal-research system, not financial advice.
