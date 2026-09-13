# API Reference

Base URL: `https://impactdna-api-v2.fly.dev` (local: `http://localhost:8080`)

Auth: `Authorization: Bearer <accessToken>` unless marked public.
All bodies are JSON. Errors: `{ "error": "message" }` with 4xx/5xx status.

## Health
- `GET /health` — liveness (public).

## Auth (wallet-connect, SIWE-style)
- `GET  /api/auth/nonce?address=0x...` → `{ nonce, message }` — a single-use, 5-minute nonce and the exact message to sign.
- `POST /api/auth/verify` `{ address, message, signature, displayName? }` → user + tokens. Verifies the signature, consumes the nonce, and registers the wallet on first sight — there is no separate register step.
- `POST /api/auth/refresh` `{ refreshToken }` → new token pair (rotation).
- `POST /api/auth/logout` — revokes all of the caller's refresh tokens.
- `GET  /api/auth/me` → current user.
- `GET  /api/auth/github/start?token=<accessToken>` — redirects into GitHub OAuth to link a developer identity (optional, profile-only — never the login method).
- `GET  /api/auth/github/callback` — OAuth callback, redirects back to the frontend.

## Wallet
- `GET  /api/wallet` → connected wallet address + live Base Sepolia USDC balance. Nothing custodial — there is no export endpoint.

## Contributions (mirror sync + reads — writes are signed client-side)
Every GenLayer write that used to be proxied here (register/verify/submit/evaluate/appeal) is now signed directly by the caller's own connected wallet from the frontend (`genlayer-js` + an EIP-1193 provider — see `frontend/lib/genlayerClient.ts`). This backend only mirrors already-confirmed on-chain state for fast dashboards:
- `POST /api/contributions/sync` `{ contributionId, txHash? }` — call right after a client-signed `submit_contribution`/`evaluate_contribution` tx is accepted, to reconcile the local mirror immediately instead of waiting on a background scan.
- `GET  /api/contributions/mine` — the caller's submissions (local mirror, self-healing against chain state).
- `GET  /api/contributions/grants/mine` — the caller's grants (read-only; claiming happens directly against the Base Sepolia escrow, see below).

## Platform (public reads, cached ~3 min)
- `GET /api/platform/info` — contract config + headline counters.
- `GET /api/platform/stats` — operational counters.
- `GET /api/platform/contributions?offset&limit&status`
- `GET /api/platform/contributions/:id`
- `GET /api/platform/developers/:username`
- `GET /api/platform/leaderboard?limit`
- `GET /api/platform/epochs` · `GET /api/platform/epochs/:id` · `GET /api/platform/grants?offset&limit`
- `POST /api/platform/deposits/sync` `{ epochId }` — best-effort nudge to run the relay loop immediately after a client-signed USDC deposit, instead of waiting for the next scheduled tick.
- `GET /api/platform/audit?offset&limit` — on-chain audit log.

## Admin (role: admin/curator — operator-signed, rare actions only)
Opening/closing epochs, depositing, and claiming are **not** here — those are permissionless and signed by whichever wallet is acting, directly against GenLayer or the Base Sepolia escrow. This router only covers actions that stay backend-signed by one operator key:
- `POST /api/admin/contributions/:id/detect-manipulation` — curator-triggered fraud screen.
- `POST /api/admin/appeals/:id/resolve` — curator-triggered appeal resolution.
- `POST /api/admin/config/min-eligible-score` `{ score }` (admin only).
- `POST /api/admin/curators` `{ address }` · `DELETE /api/admin/curators/:address` (admin only, owner-gated on-chain).
- `GET  /api/admin/curators/:address` — on-chain curator check.
- `POST /api/admin/users/:id/role` `{ role }` (admin only) — local role, separate from on-chain curator status.
- `GET  /api/admin/audit` — API-side audit trail.

## On-chain (client-signed directly, no backend endpoint)
These are called by the frontend directly against the deployed contracts — listed here for completeness:
- **GenLayer** (`genlayer-js`, connected wallet): `register_developer`, `verify_developer`, `submit_contribution(repo, category, description, epoch_id)`, `evaluate_contribution`, `request_appeal`, `open_epoch(label)`, `close_epoch(epoch_id)`.
- **Base Sepolia `ImpactDnaEscrow`** (wagmi, connected wallet): `deposit(epochId, amount)` (after an ERC20 `approve`), `claim(epochId)`.
