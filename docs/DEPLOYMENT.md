# Deployment Guide

## 1. Intelligent Contract (GenLayer Studio — already deployed)

Deployed to StudioNet at `0x2403a1bCc526AC1370a5577c5c4712F5Af1F5749`.

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
  GENLAYER_CONTRACT_ADDRESS="0x2403a1bCc526AC1370a5577c5c4712F5Af1F5749" \
  FRONTEND_URL="https://<your-vercel-domain>" \
  CORS_ORIGINS="https://<your-vercel-domain>"

fly deploy
curl https://impactdna-api.fly.dev/health
```

24/7 guarantees are in `fly.toml`: `auto_stop_machines="off"`,
`min_machines_running=1`, restart policy `always`, health checks on `/health`.
Migrations run automatically at boot.

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
