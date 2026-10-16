# CANARY-001 — Probabilistic engine / as-known research report

**Version:** 1.0 · Objective: turn a single frozen causal thesis into falsifiable conditional economics, NOT a random stock-price generator.

## What is actually implemented
1. `lib/canary-probability.mjs` implements binary Bayesian odds updates with explicit prior, out-of-sample likelihood calibration, future-information rejection and deduplication by original event / dependency group. Unknown input -> UNCALIBRATED with null probability.
2. Same module implements seeded Monte Carlo using a common Gaussian latent factor and empirical input distributions. Correlated shocks do not get treated as independent. Calibration is mandatory before returning percentiles or means; toy calibration appears **only in tests**.
3. It provides Brier scoring of predictions **committed before outcomes**. Until at least 30 admissible observations, it refuses to claim calibration.
4. `config/canary-001-economic-scenarios.json` contains the sourced LSB Q2 2026 disclosures for three product groups: AN/acid, UAN and ammonia. Prices and volumes are company product netbacks, NOT EBITDA margins.
5. `lib/canary-001-economics.mjs` computes reproducible quarter-specific product-netback sensitivity for three unweighted stresses (down/unchanged/up). It validates reported quarterly netback against rounded per-ton disclosure figures.
6. `scripts/canary-001-model.mjs` pins the original preregistration blob SHA (aa9b19f1efe5e077079a402a52402a21f0f69c01) and emits `data/experiments/CANARY-001.model.json`. This first snapshot is **as-known before Oct 16**, and does not mutate the earlier LXU/CF market test.
7. V6 / MIS TESIS displays these scenarios with a clear *no calibrated probabilities and no expected price return* warning.

## Why no probability number yet?
There is no out-of-sample calibrated prior that captures **P(fertilizer trade remains impaired | current evidence)**, no identifiable likelihood ratios for the fresh evidence, no source-specific observation model with dependencies, and no company-derived distribution of prices/volumes/gas consumption. Inventing 25/55/20 scenario weights would generate fake precision.

### Calibration entry gate
An update requires a verifiable dated base rate, independent validation cohort, source provenance, dependence review and observed event timestamps before model cut-off. The probability kernel's minimum 50 calibration examples is a policy safeguard, **not a claim that 50 events guarantee accuracy**. Future regime-shift monitoring and probability intervals will be necessary even after passing that gate.

### Company-economic missing gates
- Current public press release reports Q2 2026 product volumes of AN/acid 179,339 tons, UAN 130,818 tons and ammonia 35,667 tons, with respective netback selling prices USD 333, USD 433 and USD 658 per short ton.
- Q2 company reported adjusted EBITDA USD 53.1m; that is **not** equivalent to any modelled netback-sales change.
- Gas realized cost USD 2.96/MMBtu cannot be converted into product costs without plant consumption intensity, contracts and hedging.
- Net debt is roughly USD 223.3m as of Q2, but this is **not** a bridge from extra netback to equity price.
- No share valuation, terminal multiple or market price distribution is inferred. CF benchmark's financial sensitivity is not yet modelled.
- No probabilities, risk-adjusted target price, stock-return expectation or automatic orders are emitted.

## Actual publishing, safety and reliability
The initial Canary observer and standard six-hour scan now publish the model artifact alongside the original forward-only LXU/CF market observations. GitHub CI includes a pure selftest covering frozen preregistration hash, company-reported netback reconciliation, anti-lookahead, dependence and contradictory evidence, uncalibrated defaults, deterministically seeded Monte Carlo and Brier score.

**Next scientific step:** collect historically synchronized fertilizer export flows, UAN realized prices, plant production and gas energy intensity across several regimes; validate the joint stochastic model against held-out cohorts; use market expectations as an independently dated baseline; then score genuinely forward-registered predictions vs CF and passive sector benchmarks. Do not promote until the model improves a simple baseline out of sample.

**Original frozen prediction stays in** `experiments/CANARY-001.preregistered.json`. This document and the economic stress configuration are a newly timestamped method; they must never be misrepresented as claims registered before that original forecast.
