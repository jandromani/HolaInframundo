# GearWatch V3.1 · Secrets and runtime safety

Never commit API keys to this public repository.

## GitHub Actions secrets

Required for the intelligence pipeline:

- `OPENROUTER_API_KEY`
- `OPENAI_API_KEY`

Optional upgrade for authoritative Trading 212 catalogue matching:

- `TRADING212_API_KEY`
- `TRADING212_API_SECRET` — only when Trading 212 issued a key-pair credential

The scanner supports a legacy single API key when `TRADING212_API_SECRET` is absent.

**No `VERCEL_TOKEN` is required.** Production deployments are handled through the connected Vercel deployment integration, not from a token stored in this public repository.

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

## Trading 212 modes

Without a T212 secret, GearWatch uses the curated Trading 212 universe as a **shadow-eligible** filter. This is sufficient for ranking and paper execution, but is not permission for live broker writes.

With a rotated `TRADING212_API_KEY`, the broker stage upgrades to the official live instrument catalogue and records the exact Trading 212 ticker, ISIN, currency and instrument metadata. Autonomous live trading still remains disabled.

Any Trading 212 key that has appeared in chat/plaintext should be revoked/rotated before being stored as a secret.

## Vercel private broker gateway (optional)

Only needed if the protected Vercel dashboard should read the real Trading 212 account at runtime. Configure broker credentials as Vercel environment variables, never GitHub files:

- `TRADING212_API_KEY`
- `TRADING212_API_SECRET` — only for key-pair credentials
- `TRADING212_ENV=live`
- `GEARWATCH_BROKER_TOKEN=<long random secret>`
- `T212_LIVE_TRADING_ENABLED=false`
- `GEARWATCH_EXECUTION_MODE=SHADOW_ONLY`

The public repo must never persist real account balances, real positions, pending real orders or broker credentials.

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
- `RISK_OFF`, a closed regular session or stale open-session market data blocks new entries
- No valid setup means no trade

The synthetic sleeve is benchmarked against QQQ and S&P 500 from inception.

## Setup checklist

GitHub → HolaInframundo → Settings → Secrets and variables → Actions → Secrets:

1. `OPENROUTER_API_KEY` — configured if intelligence scans work.
2. `OPENAI_API_KEY` — configured if the Jury runs.
3. Optional: `TRADING212_API_KEY` — use only a rotated replacement for any key ever shown in plaintext.
4. Optional: `TRADING212_API_SECRET` — only if Trading 212 supplied one.

Then run `GearWatch V3 Causal Portfolio Scan` once manually if you want an immediate refresh. Otherwise the scan runs every six hours.

Vercel deployment is performed through the connected Vercel integration; there is no GitHub deployment token to maintain.
