# GearWatch V6 — World → Money
Status: V6 product shell, deterministic projection, point-in-time replay, V5 retained.

## Product contract
The homepage answers four questions in under 30 seconds:
1. Which root shocks are developing?
2. What evidence supports them and what evidence could falsify them?
3. How could they propagate to specific companies?
4. Did the original causal thesis translate into company economics and market prices?

The public product has exactly three primary views: AHORA, TRANSMISIÓN, MIS TESIS.
The 26 existing V5 mechanisms are **inputs**, not 26 homepage cards.
The entire V5 experience is preserved at /legacy/v5.html.
The existing /portfolio.html is unchanged.

## Seven-layer contract
1. Retrieval: GDELT, Google News and upstream RSS, as currently implemented.
2. Evidence: LLM extraction, cross-mechanism guards, source/date validation and red-team verifier.
3. World State: events persist independently of document recency. Unknown direct measurements remain NOT_DIRECTLY_MEASURED.
4. Shock Assembly: six root groups aggregate 26 mechanisms and preserve falsifiers.
5. Company Economics: source company transmission models and financial calibration from data/transmission-layer.json and data/investment-layer.json. Exposure is not profit capture.
6. Market: equity proxy reaction and primary sensor coverage are explicitly differentiated.
7. Thesis & Outcome: browser-local personal theses and immutable pipeline checkpoints. No orders.

## Actual V6 sources
- data/current.json (V5 engine state)
- data/investment-layer.json (V5 strategy/company layer)
- data/market.json (unadjusted stock/futures snapshots and historical bars)
- data/pricing-sensors.json (source-specific measurements, status and quality)
- data/series.json (as-known causal time series)
- config/mechanisms.json (26 mechanisms)
- config/edges.v2.json (22 validated edges)
- config/shock-groups.v6.json (6 higher-level root shocks)

## Output files
- data/v6/world-current.json: persisted event archive and world variables; private account data excluded.
- data/v6/homepage.json: 1 root shock, 2 secondary IDs, falsifiers and company outlines.
- data/v6/companies.json: per-ticker transmission model and data-quality flags.
- data/v6/alerts.json: proposed **local-only** alerts and blind-sensor warnings; NOT pushed.
- data/v6/history/checkpoints.json: append-only run-level V6 research checkpoints.
- data/v6/history/hormuz-case.json: October 2–15 causal history, ex-post prices separately marked.

Projections are created by scripts/publish-v6.mjs. They must share a run_id with source investment/market outputs. A mismatched source run fails closed.

## Quality and provenance
Every event is linked to a source URL. Physical pressure and document freshness are **independent**; an empty news scan never proves the physical disruption disappeared.
- source publication time is not event time;
- retrieval time is not publication time;
- data source status NOT_CONFIGURED/ERROR is displayed prominently;
- measured physical state is not derived directly from causal scores;
- modeled company transmission and broker lists are not authenticated exposure/holdings;
- small market capitalization alone is not a cash-flow catalyst;
- internal scores are not probabilities, price targets or trading recommendations;
- historical closes are ex-post and not known by a preceding run.

When V6 data files do not yet exist or have inconsistent run_id, the browser falls back to labeled V5 causal proxies. It will never silently treat them as verified physical measurements.

## Architecture / "agents"
The system continues to use deterministic Node scripts for retrieval, source policies, scoring, event memory, company models, market confirmation and backtesting. LLM roles are bounded to discovery/extraction, source-bound verification and editorial briefs; no model may directly place orders or invent primary observations.
The new V6 modules are *not* a fleet of autonomous agents:
- lib/v6-core.mjs: deterministic world state, shock assembly, company universe and local alert proposal;
- scripts/publish-v6.mjs: source-integrity gates and serialized public projections;
- lib/v6-dashboard.mjs: browser presentation, source-bound evidence dossiers and browser-local positions.

## Personal positions and broker safety
GTE / PSHG are watchlist defaults. User-entered cash amounts and entry prices are stored in localStorage on that browser only, never in public repo files. No live brokerage writes or authenticated position imports are performed.
Existing broker universe is curated and availability is **not verified** when broker_verified is false.
The existing live-trading fail-closed and SGMOQ safeguards are unchanged.

## Operational cadence
- Existing full scan: cron minute 17 every six UTC hours; v6:publish runs at the end after V5 checks.
- Immediate first-publish workflow: on V6 merger to master, builds data/v6 and pushes it to master.
- CI for PR: npm run selftest, npm run uiux:audit and npm run v6:publish; validates six shocks, 26 variables, company coverage and consistent run IDs.

## Technical debt still outstanding (do not misrepresent as done)
- AISSTREAM is NOT_CONFIGURED and several primary adapters report ERROR in the last observed run.
- No verified provider push notifications; data/v6/alerts.json is a local alert proposal only.
- No server-side private thesis sync or authenticated brokerage P&L.
- Physical quantity measurements require source-specific binders; model scores never substitute for flow data.
- Company earnings sensitivity needs verified spot charter exposure, hedges, contracts and dated disclosures.
- Existing backtest samples are not proof of positive expected returns; independent forward calibration remains necessary.
- Historical Windows Lab snapshot store ends earlier than the latest V5 run; historical case replay uses separate contemporaneous series.
- Running a working CI check is not the same as an end-to-end browser/UI or live provider test.

## Validation gates
1. All 26 mechanisms grouped; all causal-edge IDs exist.
2. V5 UI and model regression tests retained.
3. News absence does not erase archived evidence.
4. Unsourced evidence never counts as measured physical truth.
5. V6 run IDs match the source snapshot; no stale cross-run blending.
6. Browser stores positions only locally and never sends orders.
7. Hormuz replay separates contemporaneous scores from retrospective market bars.
