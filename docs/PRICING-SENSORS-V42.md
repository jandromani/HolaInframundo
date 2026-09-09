# GearWatch V4.2 — Primary Pricing Sensors

Goal: replace a single equity-only `priced_in` proxy with explicit primary/secondary pricing telemetry.

## Sensor families

- PHYSICAL: vessel density/transits, commodity flows, storage, grid load/queues, customs flows, incidents.
- MARKET: spot/futures, spreads, auctions, fund flows, positioning.
- PREDICTION: event probabilities and orderbooks from prediction markets.
- PROCUREMENT: awards, solicitations, repeat orders, contract value and cadence.

## Reachable now

- ACER LNG daily assessment/benchmark — free public, live adapter.
- Kalshi public market data/orderbooks — free public, live adapter.
- AIS Stream — API key required; live adapter included; raw Hormuz density is collected but does not receive a pricing score until a rolling baseline exists.
- Japan Ministry of Finance JGB auctions and weekly securities flows — free public; adapter planned.
- CFTC Commitments of Traders — free public CSV; adapter planned.
- EIA — free API key; petroleum, refining, inventories, gas and power; adapter planned.
- USAspending — free public API; defense/procurement adapter planned.
- SAM.gov/open.gsa — free key/public contract feeds; adapter planned.
- UN Comtrade — public/limited free access; trade-flow adapter planned.
- ENTSO-E — free token; load, generation, cross-border and grid telemetry; adapter planned.
- FRED — free key; rates, spreads, FX and macro market telemetry; adapter planned.
- UKMTO — public notices; maritime incident adapter planned.

## Premium if we later want institutional-grade physical telemetry

- Kpler: strongest direct fit for commodity vessel transits, cargo flows and rerouting.
- VesselFinder API: cheaper area/vessel AIS alternative; credit/subscription model.
- ICE licensed market data: TTF/energy curves and other direct exchange pricing.

## Scoring rule

Primary telemetry never overwrites the equity proxy blindly. For each mechanism GearWatch records:

- `equity_priced_in`
- `primary_priced_in`
- `pricing_confidence`
- `pricing_sources[]`
- `pricing_method`

When primary pricing exists, its weight rises with observed source coverage. When it does not exist, `pricing_method=EQUITY_PROXY_ONLY` and a warning is persisted.

## Important design constraint

A configured sensor is not an observed sensor. Missing API keys, unavailable feeds and unparsed sources contribute zero confidence rather than zero pricing. This prevents absence of data from being interpreted as an unpriced opportunity.
