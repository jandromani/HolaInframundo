# GearWatch V2 architecture

## 1. Goal

GearWatch is not a news summarizer and not an LLM stock picker. It is a causal sensor network designed to detect **upstream movement before the consensus headline**, then wait for the first market confirmation.

```text
BUTTERFLY / LEAD
      ↓
PHYSICAL OR ECONOMIC CONFIRMATION
      ↓
DETERMINISTIC CAUSAL SCORE
      ↓
FIRST MARKET VOTE
      ↓
ALPHA CLICK
      ↓
LAGGING FUNDAMENTALS / CONSENSUS
      ↓
SATURATED
```

The first euro and the last euro intentionally belong to somebody else.

## 2. Probabilistic vs deterministic responsibilities

### Probabilistic layer

The LLM may:

- select which supplied candidate articles materially support a mechanism
- extract a fact from a supplied candidate
- summarize evidence
- classify direction
- identify a contradiction
- red-team a strong preliminary mechanism using web search

The LLM may **not**:

- set mechanism state
- calculate market confirmation
- create an Alpha Click
- set source quality
- change thresholds
- convert missing data into evidence
- decide historical reliability

### Deterministic layer

Code owns:

- exact search queries
- cadence
- deduplication
- source grades
- freshness
- LEAD / CONFIRM / LAG weights
- causal score
- state transitions
- market score
- crowding score
- Alpha Click gates
- forward-return resolution
- correlation memory
- rate-limit budgets
- fail-closed behavior

## 3. Deterministic retrieval

`config/queries.v2.json` is the sensor registry. Every mechanism has explicit versioned queries grouped by phase.

### LEAD

Signals likely to appear before a mainstream story:

- insurance premia
- RFQs / tenders
- permits
- supplier hiring
- purchase orders
- route deviations
- utility deposits
- capacity expansions
- maintenance extensions
- customs/origin changes
- procurement architecture changes

### CONFIRM

The variable that should move if the causal thesis is real:

- physical inventories
- freight/TCE
- crack spreads
- actual pipeline flow
- signed contract quantities
- yields / FX
- equipment orders
- actual exports

### LAG

Evidence useful for validation but frequently too late for entry:

- quarterly earnings
- guidance
- widespread mainstream coverage
- analyst upgrades
- completed profit realization

Normal retrieval uses exact queries against open deterministic sources (currently GDELT and Google News RSS). The exact query, engine result count, timestamp and candidate URL are persisted. The LLM therefore sees a bounded candidate set instead of deciding what to search for.

## 4. Extraction

`scripts/extract.mjs` sends only deterministic candidates to `openai/gpt-oss-120b:free` using strict JSON schema and temperature 0.

A returned claim is rejected unless its `candidate_id` exists in the supplied candidate set. Source quality is calculated by code from the source domain; the LLM cannot promote a weak source to an official source.

## 5. Red-team verifier

`scripts/verify.mjs` is deliberately scarce. Only the strongest preliminary mechanisms can invoke it.

Hard default limits:

- max 4 verifier searches per run
- max 12 verifier searches per day
- one retry for HTTP 429
- no infinite retry loops

The verifier uses OpenRouter web search with Parallel Turbo by default. It exists to find **independent confirmation or contradiction**, not to generate bullish prose.

## 6. Deterministic causal score

`scripts/score.v2.mjs` scores unique signals rather than article count, preventing ten rewrites of the same story from masquerading as ten confirmations.

Approximate phase weights:

```text
unique LEAD signal       +11
unique CONFIRM signal    +17
unique LAG signal         +4
source quality           +0..3
freshness                +0..3
2 independent domains    +7
3 independent domains    +4
LEAD + CONFIRM            +8
multiple LEAD signals     +4
contradiction            -12 each (bounded)
```

No CONFIRM evidence caps the causal score below an ACTIVE transition.

## 7. States

```text
UNKNOWN      no usable evidence
DORMANT      causal < 25
WATCH        causal >= 25
ARMING       causal >= 45
ACTIVE       causal >= 65 + confirm + source gates
SATURATED    mechanism still strong but market/crowding/lag too mature
STALE        sensor has not refreshed inside tier-specific freshness window
INVALIDATED  explicit strong contradictory evidence
```

`ACTIVE` cannot be produced by one article.

## 8. Market as distributed intelligence

Market confirmation is calculated without an LLM using the positive-exposure company basket.

Inputs currently include:

- 1d return
- 5d return
- 20d return
- 60d volume z-score
- peer breadth
- fraction above SMA20
- fraction above SMA50
- context series such as S&P 500, Nasdaq, Euro Stoxx 50, Brent, WTI, dollar, yen and US 10Y proxy

The market does not prove causality. It is treated as a distributed vote that other participants are beginning to price the same mechanism.

## 9. Alpha Click

Default gate:

```text
causal score >= 60
>= 1 LEAD signal
>= 1 CONFIRM signal
>= 2 independent source domains
market score >= 20
market score <= 58
crowding < 62
LAG share <= 45%
not invalidated
historical reliability gate passes once enough samples exist
```

This intentionally rejects both:

- an unconfirmed early rumor
- a correct thesis whose trade is already crowded

## 10. Alpha Click performance memory

Every new Alpha Click stores:

- mechanism
- timestamp
- causal/market/crowding scores
- company basket
- entry prices
- benchmark price

Future runs automatically resolve:

- 1 trading-day approximation
- 5-day return
- 20-day return
- benchmark-relative return
- hit / miss

Nothing is retroactively deleted because it was wrong.

## 11. Correlation memory

`data/series.json` stores every mechanism score, state, market score and phase counts at each run.

`scripts/correlate.mjs` learns two types of history.

### Mechanism quality

For every mechanism:

- Alpha Click 1d / 5d / 20d sample count
- hit rate
- relative hit rate
- average return
- LEAD → CONFIRM conversion rate
- average number of runs until market confirmation

### Causal-edge quality

`config/edges.v2.json` contains hypotheses such as:

```text
DIESEL_CRISIS → PRODUCT_TANKER_TONMILES
ARSENAL_DEPLETION → ROCKET_MOTOR_SHORTAGE
ARSENAL_DEPLETION → ENERGETICS_SHORTAGE
AI_TIME_TO_POWER → BEHIND_METER_AI_POWER
JAPAN_CARRY_UNWIND → GLOBAL_REFINANCING_STRESS
```

The system then records whether the downstream mechanism actually moved inside the expected lag window and calculates empirical score correlations by lag. The configured graph is therefore a hypothesis; historical data gradually decides how much confidence it deserves.

## 12. Living Bible

The durable memory is JSON, not model memory.

Core files:

```text
data/current.json              current mechanism state
data/series.json               score/state time series
data/alpha-clicks.json          all historical Alpha Clicks
data/correlation-memory.json    learned reliability and propagation
data/market-history/            immutable market snapshots
data/retrieval/                 exact query traces and candidates
data/extraction/                model extraction traces
data/verification/              red-team traces
data/history-v2/                assembled causal runs
data/budget.json                daily call counters
```

Every autonomous run is committed to Git, giving the intelligence state an appendable audit trail.

## 13. Rate limits and circuit breakers

`config/policy.v2.json` currently limits:

- 26 extraction calls/run
- 140 LLM calls/day
- 4 web verifiers/run
- 12 web verifiers/day
- ~3.4 seconds between OpenRouter requests
- one bounded retry on rate limiting

If a provider fails, the system does not infer the opposite state. Previous state is preserved or the sensor becomes `STALE/UNKNOWN`.

## 14. Security

`OPENROUTER_API_KEY` exists only as a GitHub Actions secret. It is never sent to the browser, stored in JSON, committed to Git or printed intentionally.

The Vercel dashboard is read-only and consumes sanitized JSON from the repository.

## 15. Workflow

```text
GitHub Actions every 6h
  → market.mjs
  → retrieve.mjs
  → extract.mjs
  → verify.mjs
  → assemble.mjs
  → correlate.mjs
  → commit data/
  → Vercel dashboard reads latest state
```

This is the V2 boundary: a causal alpha radar with deterministic query generation, phase-aware evidence, market confirmation, historical self-criticism and complete traceability.
