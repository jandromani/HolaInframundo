# GearWatch V4.4 — Pricing Sensor Quality Hardening

V4.4 focuses on preventing false confidence rather than adding more sources.

## Changes

- Kalshi markets are now domain-gated and sports/parlays are rejected before scoring.
- EIA distillate telemetry can recover from the public WPSR `table6.csv` without an API key.
- UKMTO recovers from the current public homepage when incident/warning routes drift.
- MOF JGB recovers through the current 2026 JGB updates page and recent auction result pages.
- `pricing_regime` and `pricing_gap` explicitly classify primary-vs-equity disagreement.
- Production health fails closed if sports contamination survives or a high-conviction regime is assigned with low primary confidence.

## Regimes

- `EQUITY_PROXY_ONLY`
- `PRIMARY_ONLY`
- `LOW_CONFIDENCE`
- `PRIMARY_PRICED_EQUITY_BLIND`
- `EQUITY_PRICED_PRIMARY_BLIND`
- `BROADLY_PRICED`
- `BROADLY_EARLY`
- `CONFLICT`
- `IN_SYNC`

Missing data remains missing data; it is never converted to zero pricing.
