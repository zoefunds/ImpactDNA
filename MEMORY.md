# ImpactDNA — Project Memory

A running log of decisions, state, and operational facts. Update as the project evolves.

## Deployed state

- **Intelligent Contract**: `0x2B4DE4E66Bbfbe173b6E511583d5A66f7BF58267` on **GenLayer StudioNet** (gasless).
  - Constructor used: `platform_name="Impact_DNA"`, `min_eligible_score=40` (owner-adjustable on-chain via `set_min_eligible_score`, exposed in the `/admin` panel).
  - Contract owner: `0x07E130Bd4bB1dCbB97558FCcDC47F14a58d05Fa7` (ownership transferred here from the original Studio deployer account so the app's own admin wallet can act as owner/curator without touching Studio again).
  - Previous deployments (superseded): `0x8284169B3c5E5c03A893Ea6b087661b2Ebd1e24f`, `0x2403a1bCc526AC1370a5577c5c4712F5Af1F5749`.
  - Treasury wallet (real GEN custody): `0xb062F2d0B911EDaAD359e00D7940bd5e954973aE`.
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
- **GitHub identity is OAuth-only, not free text**: `/api/auth/github/start` (redirect,
  token via query since it's a browser navigation) → GitHub → `/api/auth/github/callback`
  stores `github_username` + `github_id` (unique) on the user row. Prevents a user
  typing someone else's username. `register_developer` reads the OAuth-linked
  username server-side; it no longer accepts a client-supplied one.
- **Real GEN custody is off-chain (treasury wallet), not in the contract**: confirmed
  by introspecting the live GenVM runtime that `gl.evm` has no transfer/send primitive
  and `gl.message` is read-only — a contract can receive value (`payable`) but can
  never send it back out, so making `deposit_to_treasury` payable would trap funds
  forever (tried this, reverted it). The contract stays the ledger of truth (grants,
  claims); `backend/src/lib/treasury.ts` holds an encrypted EOA (`treasury_wallet`
  table) that executes real payouts as plain `sendTransaction` calls when a developer's
  on-chain `claim_grant` finalizes. Verified end-to-end on StudioNet: balance actually
  moved between two throwaway wallets. Failed payouts are tracked in `grant_payouts`
  and retryable via `POST /api/admin/grant-payouts/:grantId/retry`.

## Operational notes

- StudioNet rate limits: 60 req/min, 1000/hr, 10000/day per IP; ≤32 pending txs per sender.
- Backend caches contract reads (default TTL 180s) — dashboards may lag the chain by ~3 min. Curator/treasury writes (`open_epoch`, `close_epoch`, `deposit_to_treasury`, add/remove curator) explicitly invalidate the cached `get_platform_info` read so the admin panel doesn't show stale state right after an action.
- StudioNet does not enforce balance limits on native `sendTransaction` — confirmed by sending 10B GEN from an empty treasury successfully. Real payout failures come from RPC/network conditions, not insufficient funds; `POST /api/admin/treasury/test-send` (admin-only) exists to probe this without touching real grants.
- `/admin` panel (curator/admin role) now covers day-to-day ops that used to require Studio/CLI: treasury deposit (GEN-denominated input, converted to atto client-side), open/close epoch, eligibility gate adjustment (admin only), curator add/remove (admin only, owner-gated on-chain), grant payout retry.
- Local smoke test: `docker compose up -d`, backend `.env` from example, then
  register → login → wallet export → `/api/platform/info` (reads the live contract).

## Environment secrets (set via `fly secrets` / Vercel env — never commit)

`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `WALLET_ENCRYPTION_KEY`, `BREVO_API_KEY`,
`GENLAYER_CONTRACT_ADDRESS`, `FRONTEND_URL`, `CORS_ORIGINS`, `NEXT_PUBLIC_API_URL`.
