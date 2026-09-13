# Deployment Guide

## 1. GenLayer Intelligent Contract

Deployed to StudioNet at `0xC670690Cd75C3bD06710c85A13bAE99A2AC4faA4`.

To redeploy (e.g. after changes):
1. Open https://studio.genlayer.com, create/select an account.
2. Upload `contracts/impact_dna.py`.
3. Constructor: `platform_name` (string), `min_eligible_score` (int, recommend **40**).
4. Deploy on **StudioNet** (gasless — 0 GEN balance is fine).
5. Point the relayer at itself: `genlayer write <ADDR> set_relayer --args <relayer_address>` (the deployer is both owner and first curator by default, but `relayer` needs setting explicitly if it should differ from the deployer).
6. Put the new address in backend secrets (`GENLAYER_CONTRACT_ADDRESS`) and frontend env (`NEXT_PUBLIC_GENLAYER_CONTRACT_ADDRESS`).

Lint before any redeploy: `pip install genvm-linter && genvm-lint check contracts/impact_dna.py`.

Epochs are permissionless — no post-deploy `open_epoch` step is required; any wallet can open one from the `/funding` page or the CLI:
```bash
genlayer write <ADDR> open_epoch --args "Genesis Round"
```

## 2. Base Sepolia escrow (`ImpactDnaEscrow.sol`)

Deployed at `0x1C588195832F87496cE797C7C28c82F532d95E4E` (USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e`, relayer `0x7401c129EDfc26E68FE19309fE461eb3Db1058Eb`).

To redeploy:
```bash
cd contracts/base
npm install   # ethers + solc, local to this directory
DEPLOYER_PRIVATE_KEY=0x... \
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org \
BASE_SEPOLIA_USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e \
RELAYER_ADDRESS=0x... \
node deploy.js
```
Prints the addresses to set as `IMPACT_DNA_ESCROW_ADDRESS` (backend) and `NEXT_PUBLIC_IMPACT_DNA_ESCROW_ADDRESS` (frontend). **Never pass a private key as a CLI argument in a shared shell/log** — export it in your own local shell session only.

## 3. Backend → Fly.io (24/7)

```bash
cd backend
fly apps create impactdna-api-v2                              # first time only
fly postgres create --name impactdna-db --region iad          # fresh managed Postgres
fly postgres attach impactdna-db --app impactdna-api-v2       # sets DATABASE_URL secret

fly secrets set \
  JWT_SECRET="$(openssl rand -hex 32)" \
  FRONTEND_URL="https://impactdna.vercel.app" \
  CORS_ORIGINS="https://impactdna.vercel.app" \
  GENLAYER_RPC_URL="https://studio.genlayer.com/api" \
  GENLAYER_NETWORK="studionet" \
  GENLAYER_CONTRACT_ADDRESS="0xC670690Cd75C3bD06710c85A13bAE99A2AC4faA4" \
  GENLAYER_OPERATOR_PRIVATE_KEY="0x..." \
  BASE_SEPOLIA_RPC_URL="https://sepolia.base.org" \
  BASE_SEPOLIA_RELAYER_PRIVATE_KEY="0x..." \
  USDC_CONTRACT_ADDRESS="0x036CbD53842c5426634e7929541eC2318f3dCF7e" \
  IMPACT_DNA_ESCROW_ADDRESS="0x1C588195832F87496cE797C7C28c82F532d95E4E" \
  BREVO_API_KEY="xkeysib-…" \
  BREVO_SENDER_EMAIL="preciousmofeoluwa@gmail.com" \
  GITHUB_CLIENT_ID="…" \
  GITHUB_CLIENT_SECRET="…" \
  GITHUB_OAUTH_CALLBACK_URL="https://impactdna-api-v2.fly.dev/api/auth/github/callback" \
  REDIS_URL="rediss://…upstash…"

fly deploy
fly ips allocate-v4 --shared      # only if the first deploy's IP auto-provisioning fails
fly ips allocate-v6
curl https://impactdna-api-v2.fly.dev/health
```

`GENLAYER_OPERATOR_PRIVATE_KEY` and `BASE_SEPOLIA_RELAYER_PRIVATE_KEY` can be
the same key (a single trusted operator identity) or different — either
works, but whichever address you use as the relayer must be set via
`set_relayer` on the GenLayer contract and passed as `RELAYER_ADDRESS` when
deploying the escrow.

24/7 guarantees are in `fly.toml`: `auto_stop_machines="off"`,
`min_machines_running=1`, restart policy `always`, health checks on `/health`.
Migrations run automatically at boot.

### GitHub OAuth App (optional — developer identity linking only)

Register one at github.com/settings/developers → New OAuth App:
- Homepage URL: your Vercel domain
- Authorization callback URL: `https://impactdna-api-v2.fly.dev/api/auth/github/callback`

Put the Client ID/Secret in the `fly secrets set` command above. This is
never the login method (wallet-connect is) — it only links a verified
GitHub identity for the impact-evaluation flow. Without it,
`githubConfigured()` returns false and that flow is disabled gracefully.

### Relay loop (Base Sepolia <-> GenLayer)

Once `BASE_SEPOLIA_RELAYER_PRIVATE_KEY` and `IMPACT_DNA_ESCROW_ADDRESS` are
both set, `src/jobs/relay.ts` starts automatically at boot — no separate
process to deploy. Check `fly logs` for "Base Sepolia relay disabled" to
confirm it's picked up the config; its absence means the relay loop is active.

## 4. Frontend → Vercel

```bash
cd frontend
vercel link
vercel env add NEXT_PUBLIC_API_URL production                       # https://impactdna-api-v2.fly.dev
vercel env add NEXT_PUBLIC_GENLAYER_CONTRACT_ADDRESS production     # 0xC670690Cd75C3bD06710c85A13bAE99A2AC4faA4
vercel env add NEXT_PUBLIC_USDC_CONTRACT_ADDRESS production         # 0x036CbD53842c5426634e7929541eC2318f3dCF7e
vercel env add NEXT_PUBLIC_IMPACT_DNA_ESCROW_ADDRESS production     # 0x1C588195832F87496cE797C7C28c82F532d95E4E
vercel --prod
```

Then update backend `FRONTEND_URL`/`CORS_ORIGINS` with the final Vercel
domain and `fly deploy` again (or `fly secrets set`, which restarts the app).

## 5. Local development

```bash
docker compose up -d          # Postgres on localhost:5439
cd backend && cp .env.example .env && npm i && npm run dev
cd frontend && cp .env.example .env.local && npm i && npm run dev
```

The backend's `dev` script (`tsx watch src/index.ts`) loads `.env` itself
via a small built-in loader in `src/config.ts` — this works even on an older
Node (e.g. via nvm) that predates `node --env-file`, since it doesn't rely
on that flag.

## Rollback

- Backend: `fly releases` → `fly deploy --image <previous>`.
- Frontend: Vercel dashboard → previous deployment → promote.
- Contracts: immutable; deploy a new address and update
  `GENLAYER_CONTRACT_ADDRESS` / `IMPACT_DNA_ESCROW_ADDRESS` everywhere they're
  configured (backend secrets, frontend env, and each other via
  `set_relayer`/the escrow's constructor argument).
