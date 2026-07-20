# Deployment Guide

## 1. Intelligent Contract (GenLayer Studio — already deployed)

Deployed to StudioNet at `0x0B20d8C224FE2BE01469C70663C0eEcbBD155978`.

To redeploy (e.g. after changes):
1. Open https://studio.genlayer.com, create/select an account.
2. Upload `contracts/impact_dna.py`.
3. Constructor: `platform_name` (string), `min_eligible_score` (int, recommend **40**).
4. Deploy on **StudioNet** (gasless — 0 GEN balance is fine).
5. Put the new address in backend secrets (`GENLAYER_CONTRACT_ADDRESS`).

Post-deploy (owner account):
```bash
genlayer network set studionet
genlayer write <ADDR> set_min_eligible_score --args 40
```
`deposit_to_treasury` is `payable` — deposit real GEN from Studio's UI (it has a
transaction-value field); the CLI's `write` command doesn't expose a `--value`
flag. Then:
```bash
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
  GENLAYER_CONTRACT_ADDRESS="0x0B20d8C224FE2BE01469C70663C0eEcbBD155978" \
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

### Treasury payouts (real GEN, escrowed in-contract)

The contract holds and pays out real GEN directly — no off-chain treasury
wallet. `deposit_to_treasury` is `@gl.public.write.payable`: the deposited
amount is `gl.message.value`, credited straight into the contract's own
balance. `claim_grant` sends the payout in the same call, via a single
`_send_gen` choke point that uses an EVM-interface stub
(`_Recipient(...).emit_transfer(value=...)`) — the mechanism GenVM actually
uses to deliver native value to a plain wallet, confirmed live against this
exact pinned runner. State (grant marked claimed, treasury ledger debited) is
committed *before* the transfer, so a repeated or re-entrant claim call finds
the balance already reduced — no double-spend, no separate retry path needed,
because a failed transfer reverts the whole call and leaves nothing claimed.

To fund a real epoch:
1. Deposit real GEN via the `/admin` panel (or `POST /api/admin/treasury/deposit` with `{ "atto": "<atto-amount>" }`) — this attaches the GEN as the call's value and credits the contract directly.
2. Proceed with `open_epoch` / `close_epoch` as before.
3. When a developer claims a grant, the payout is sent in the same on-chain transaction — nothing to retry or reconcile off-chain.

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
