# GearWatch V3 · Secrets and runtime safety

Never commit API keys to this public repository.

## GitHub Actions secrets

Required for the intelligence pipeline:

- `OPENROUTER_API_KEY`
- `OPENAI_API_KEY`

Required only if you want GearWatch to validate the live Trading 212 catalogue from the official API:

- `TRADING212_API_KEY`

Optional only when Trading 212 issued a key-pair credential:

- `TRADING212_API_SECRET`

The scanner also supports a legacy single API key when `TRADING212_API_SECRET` is absent.

There is **no `VERCEL_TOKEN` requirement**. This project is deployed through the existing Vercel connection/direct deployment path; GitHub Actions is responsible for intelligence/state, not Vercel authentication.

## GitHub Actions variables

Optional:

- `TRADING212_ENV=live` (default is `live`)
- `OPENROUTER_MODEL=openai/gpt-oss-20b`
- `OPENROUTER_VERIFIER_MODEL=openai/gpt-oss-120b`
- `OPENAI_INVESTMENT_MODEL=gpt-5-nano`

The autonomous scan workflow explicitly forces:

- `T212_LIVE_TRADING_ENABLED=false`
- `GEARWATCH_EXECUTION_MODE=SHADOW_ONLY`

Do not change those for the autonomous workflow.

## Vercel private broker gateway (optional)

Only needed if the protected Vercel dashboard should read the real Trading 212 account at runtime. Configure these as Vercel environment variables, not GitHub files:

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

## $500 shadow sleeve invariants

- Initial synthetic capital: `$500`
- Max individual paper order: `$80`
- Max simultaneous GearWatch positions: `6`
- Scout paper order: `$40`
- Deploy paper order: `$80`
- Residual top-up: max `$20`, only into an existing Deploy position and never while averaging down
- Max exposure to one risk group: `$160`
- Only the top `20%` of current mechanism opportunities may be considered
- `RISK_OFF` blocks all new entries
- No valid setup means no trade

The synthetic sleeve is benchmarked against QQQ and S&P 500 from inception.

## Final setup checklist

GitHub → HolaInframundo → Settings → Secrets and variables → Actions → Secrets:

1. `OPENROUTER_API_KEY` — required for discovery/extraction/verifier.
2. `OPENAI_API_KEY` — required for the independent Jury.
3. `TRADING212_API_KEY` — optional for live catalogue validation; use a rotated replacement for any key ever exposed in plaintext.
4. `TRADING212_API_SECRET` — only if Trading 212 supplied a separate secret.

Then run `GearWatch V3 Causal Portfolio Scan` once manually. It will thereafter run every six hours.

## Credential hygiene

If a Trading 212 key has ever been pasted into a chat, issue, terminal transcript, screenshot, or other non-secret surface, rotate/revoke it and store the replacement only in the secret manager.
