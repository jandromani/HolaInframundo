# GearWatch — Market Causal Memory Engine

Read-only market intelligence dashboard built around causal mechanisms rather than headlines.

## Principle

`EVENT -> PHYSICAL CONSTRAINT -> MEASURABLE VARIABLE -> CASH-FLOW IMPACT -> MARKET CONFIRMATION -> ALPHA CLICK`

The LLM is an evidence collector, not the trading decision-maker. State transitions, scoring, deduplication and market-confirmation gates are deterministic code.

## Autonomous loop

- GitHub Actions schedules scans.
- OpenRouter free inference extracts current evidence with web grounding.
- Evidence is normalized into JSON.
- Deterministic scoring updates mechanism state.
- The market-confirmation layer validates or rejects the causal thesis.
- Every run, event, prediction and state change is persisted for auditability.
- The Vercel dashboard is read-only and consumes the current JSON state.

## Core states

`DORMANT -> WATCH -> ARMING -> ACTIVE -> SATURATED`, plus `UNKNOWN` and `INVALIDATED`.

## Alpha Click

An Alpha Click is deliberately later than the first rumor and earlier than consensus saturation. It requires strong causal evidence plus early market confirmation. We intentionally give away the first euro and the last euro.

## Configuration

Required GitHub Actions secret:

- `OPENROUTER_API_KEY`

Optional:

- `OPENROUTER_MODEL` — defaults to `openai/gpt-oss-20b:free`

See `docs/ARCHITECTURE.md` for scoring, cadence, traceability and cost controls.
