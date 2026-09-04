# GearWatch V3 · Secrets and runtime safety

Never commit API keys to this public repository.

## GitHub Actions secrets

Required for the existing intelligence pipeline:

- `OPENROUTER_API_KEY`
- `OPENAI_API_KEY`

Required to validate the live Trading 212 instrument catalogue:

- `TRADING212_API_KEY`

Optional only when Trading 212 issued a key-pair credential:

- `TRADING212_API_SECRET`

The scanner supports a legacy single API key when `TRADING212_API_SECRET` is absent.

## GitHub Actions variables

Optional:

- `TRADING212_ENV=live` (default is `live`)
- `OPENROUTER_MODEL=openai/gpt-oss-20b`
- `OPENROUTER_VERIFIER_MODEL=openai/gpt-oss-120b`
- `OPENAI_INVESTMENT_MODEL=gpt-5-nano`

The scan workflow explicitly forces:

- `T212_LIVE_TRADING_ENABLED=false`
- `GEARWATCH_EXECUTION_MODE=SHADOW_ONLY`

Do not change those for the autonomous workflow.

## Vercel private broker gateway (optional)

Only needed if the private dashboard should read the real Trading 212 account at runtime. Configure these as Vercel environment variables, not GitHub files:

- `TRADING212_API_KEY`
- `TRADING212_API_SECRET` (only for key-pair credentials)
- `TRADING212_ENV=live`
- `GEARWATCH_BROKER_TOKEN=<long random secret>`
- `T212_LIVE_TRADING_ENABLED=false`
- `GEARWATCH_EXECUTION_MODE=SHADOW_ONLY`

The public repo must never persist account balances, real positions, pending real orders, or broker credentials.

## SGMOQ isolation

`SGMOQ` is hard-protected in both `config/execution-policy.json` and `lib/trading212.mjs`.

GearWatch must never open, close, top-up, reduce, cancel an order for, or count SGMOQ inside its $500 shadow sleeve. SGMOQ remains a manual-only external position.

## Credential hygiene

If a Trading 212 key has ever been pasted into a chat, issue, terminal transcript, screenshot, or other non-secret surface, rotate/revoke it and store the replacement only in the secret manager.
