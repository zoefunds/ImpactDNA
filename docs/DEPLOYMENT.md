# Deployment Guide

## 1. Intelligent Contract (GenLayer Studio — already deployed)

Deployed to StudioNet at `0x8284169B3c5E5c03A893Ea6b087661b2Ebd1e24f`.

To redeploy (e.g. after changes):
1. Open https://studio.genlayer.com, create/select an account.
2. Upload `contracts/impact_dna.py`.
3. Constructor: `platform_name` (string), `min_eligible_score` (int, recommend **40**).
4. Deploy on **StudioNet** (gasless — 0 GEN balance is fine).
5. Put the new address in backend secrets (`GENLAYER_CONTRACT_ADDRESS`).

Post-deploy (owner account, in Studio or CLI):
```bash
genlayer network set studionet
genlayer write <ADDR> set_min_eligible_score --args 40
genlayer write <ADDR> deposit_to_treasury --args 1000000000000000000000   # 1000 GEN (atto)
genlayer write <ADDR> open_epoch --args 500000000000000000000 "Genesis Round"
```

Lint before any redeploy: `pip install genvm-linter && genvm-lint check contracts/impact_dna.py`.

## 2. Backend → Fly.io (24/7)

```bash
cd backend
fly launch --no-deploy --copy-config --name impactdna-api   # first time only
fly postgres create --name impactdna-db --region iad        # managed Postgres
fly postgres attach impactdna-db --app impactdna-api        # sets DATABASE_URL

fly secrets set \
  JWT_SECRET="$(openssl rand -hex 32)" \
  WALLET_ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  REDIS_URL="rediss://…upstash…" \
  BREVO_API_KEY="xkeysib-…" \
  BREVO_SENDER_EMAIL="preciousmofeoluwa@gmail.com" \
  GENLAYER_CONTRACT_ADDRESS="0x8284169B3c5E5c03A893Ea6b087661b2Ebd1e24f" \
  GITHUB_CLIENT_ID="…" \
  GITHUB_CLIENT_SECRET="…" \
  GITHUB_OAUTH_CALLBACK_URL="https://impactdna-api.fly.dev/api/auth/github/callback" \
  FRONTEND_URL="https://<your-vercel-domain>" \
  BACKEND_URL="https://impactdna-api.fly.dev" \
  CORS_ORIGINS="https://<your-vercel-domain>"

fly deploy
curl https://impactdna-api.fly.dev/health
```

24/7 guarantees are in `fly.toml`: `auto_stop_machines="off"`,
`min_machines_running=1`, restart policy `always`, health checks on `/health`.
Migrations run automatically at boot.

### GitHub OAuth App

Register one at github.com/settings/developers → New OAuth App:
- Homepage URL: your Vercel domain
- Authorization callback URL: `https://impactdna-api.fly.dev/api/auth/github/callback`

Put the Client ID/Secret in the `fly secrets set` command above. This
replaces free-text GitHub username entry — a user can only link an
account they can actually authenticate as via GitHub's own login.

### Treasury payouts (real GEN)

GenVM intelligent contracts can receive native value (`@gl.public.write.payable`
+ `gl.message.value`) but expose **no primitive to send it back out** —
confirmed by introspecting the runtime (`gl.evm` has no transfer/send
function; `gl.message` is read-only). Holding real GEN inside the
contract would trap it permanently.

Instead, the backend generates and encrypts a **treasury wallet** (a
plain EOA, stored in the `treasury_wallet` table, lazily created on
first use). The contract stays the authoritative ledger — grants,
claims, eligibility — while the treasury wallet executes real payouts
as plain native-value transfers once a developer's `claim_grant` call
finalizes on-chain (verified working end-to-end on StudioNet: balance
provably moved between two test wallets via `sendTransaction`).

To fund a real epoch:
1. `GET /api/admin/treasury` (curator) — returns the treasury address and balance.
2. Send real GEN to that address from wherever your GEN lives (Studio account, exchange, etc).
3. Call `POST /api/admin/treasury/deposit` with `{ "atto": "..." }` to record the matching ledger entry on-chain (`deposit_to_treasury`) — this is bookkeeping only, it does not move funds itself.
4. Proceed with `open_epoch` / `close_epoch` as before.
5. When a developer claims a grant, the payout is sent automatically. If the send fails (e.g. treasury underfunded), retry with `POST /api/admin/grant-payouts/:grantId/retry` once funded. `GET /api/admin/grant-payouts` lists payout status/history.

## 3. Frontend → Vercel

```bash
cd frontend
vercel link
vercel env add NEXT_PUBLIC_API_URL production   # https://impactdna-api.fly.dev
vercel --prod
```

Then update backend `FRONTEND_URL`/`CORS_ORIGINS` with the final Vercel domain
and `fly deploy` again (or `fly secrets set`, which restarts the app).

## 4. Local development

```bash
docker compose up -d          # Postgres on localhost:5439
cd backend && cp .env.example .env && npm i && npm run dev
cd frontend && npm i && npm run dev
```

## Rollback

- Backend: `fly releases` → `fly deploy --image <previous>`.
- Frontend: Vercel dashboard → previous deployment → promote.
- Contract: immutable; deploy a new address and update `GENLAYER_CONTRACT_ADDRESS`.
