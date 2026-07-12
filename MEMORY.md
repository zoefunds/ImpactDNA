# ImpactDNA — Project Memory

A running log of decisions, state, and operational facts. Update as the project evolves.

## Deployed state

- **Intelligent Contract**: `0xAa14d19Ad58AdB34b34B22936E1B0640EF951648` on **GenLayer StudioNet** (gasless).
  - Constructor used: `platform_name="Impact_DNA"`, `min_eligible_score=40`.
  - Contract owner / first curator: `0x7401c129EDfc26E68FE19309fE461eb3Db1058Eb` (the Studio deployer account).
  - Previous deployment (superseded): `0x2403a1bCc526AC1370a5577c5c4712F5Af1F5749` (gate was 0).
- **Backend**: Fly.io app `impactdna-api` (region iad), 24/7 — `auto_stop_machines="off"`, `min_machines_running=1`, restart policy always.
- **Frontend**: Vercel (Next.js 14).
- **GitHub**: https://github.com/zoefunds/ImpactDNA (no AI attribution in commits — project policy).

## Key architecture decisions

- **One contract, not many** (review-team guidance): all reasoning tasks — identity
  verification, impact scoring, fraud detection, appeals, funding settlement — live in
  `contracts/impact_dna.py`.
- **Validators never trust the leader**: they re-fetch GitHub evidence and re-score,
  comparing hard gates exactly and scores by adjacent 25-point buckets (tolerant on
  purpose, to avoid UNDETERMINED/rotation without letting a leader lie about gates).
- **Errors are classified** with prefixes (`[EXPECTED]/[EXTERNAL]/[TRANSIENT]/[LLM_ERROR]`)
  so failure paths reach consensus too.
- **Runner pinned**: `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`
  (never `test`/`latest` — networks reject them). A newer runner exists
  (`1zr6nqk597d…`) if a redeploy is ever needed.
- **Custodial wallets**: generated at signup (ethers), AES-256-GCM encrypted with a
  server key; address permanent; export requires password re-confirmation.
- **Redis conservation** (Upstash bills per command): single lazy connection, in-process
  micro-cache in front, TTL on every key, fixed-window rate limiter (1–2 commands/hit),
  graceful degradation to memory if Redis is down.
- **Postgres**: Docker locally (port **5439** — 5432-5438 taken by other projects);
  managed Postgres in production. `contribution_mirror` table is a fast-read mirror;
  the chain is the source of truth.
- **Email**: Brevo HTTP API, sender `preciousmofeoluwa@gmail.com` — welcome,
  password-reset (30-min one-time token), submission/evaluation notifications.

## Operational notes

- StudioNet rate limits: 60 req/min, 1000/hr, 10000/day per IP; ≤32 pending txs per sender.
- Backend caches contract reads (default TTL 180s) — dashboards may lag the chain by ~3 min.
- Local smoke test: `docker compose up -d`, backend `.env` from example, then
  register → login → wallet export → `/api/platform/info` (reads the live contract).

## Environment secrets (set via `fly secrets` / Vercel env — never commit)

`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `WALLET_ENCRYPTION_KEY`, `BREVO_API_KEY`,
`GENLAYER_CONTRACT_ADDRESS`, `FRONTEND_URL`, `CORS_ORIGINS`, `NEXT_PUBLIC_API_URL`.
