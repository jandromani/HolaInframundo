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

Required for automatic production deployment to the existing Vercel project:

- `VERCEL_TOKEN`

`VERCEL_TOKEN` is only used by `.github/workflows/deploy-vercel.yml`. The project/team IDs are non-secret and are already pinned in that workflow.

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

Only needed if the protected Vercel dashboard should read the real Trading 212 account at runtime. Configure these as **Vercel environment variables**, not GitHub files:

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

The autonomous workflow is intentionally paper-only and enforces:

- Initial synthetic capital: `$500`
- Max individual paper order: `$80`
- Max simultaneous GearWatch positions: `6`
- Scout paper order: `$40`
- Deploy paper order: `$80`
- Small residual top-up: max `$20`, only into an existing Deploy position and never while averaging down
- Max exposure to one risk group: `$160`
- Only the top `20%` of current mechanism opportunities may be considered
- `RISK_OFF` blocks all new entries
- No valid setup means no trade

The synthetic sleeve is benchmarked against QQQ and S&P 500 from its inception.

## Final setup checklist

GitHub → HolaInframundo → Settings → Secrets and variables → Actions → Secrets:

1. `OPENROUTER_API_KEY` — already configured if the intelligence scans work.
2. `OPENAI_API_KEY` — already configured if the Jury runs.
3. `TRADING212_API_KEY` — add a **rotated replacement** for any Trading 212 key that has appeared in chat/plaintext.
4. `TRADING212_API_SECRET` — add only if Trading 212 gave you a separate secret.
5. `VERCEL_TOKEN` — create in Vercel account settings and add here to enable automatic production deploys.

Then run these workflows once manually:

- `GearWatch V3 Causal Portfolio Scan`
- `GearWatch V3 Deploy Vercel`

After that the intelligence/portfolio scan runs every six hours and frontend code changes deploy automatically.

## Credential hygiene

If a Trading 212 key has ever been pasted into a chat, issue, terminal transcript, screenshot, or other non-secret surface, rotate/revoke it and store the replacement only in the secret manager.
