# API Reference

Base URL: `https://impactdna-api.fly.dev` (local: `http://localhost:8080`)

Auth: `Authorization: Bearer <accessToken>` unless marked public.
All bodies are JSON. Errors: `{ "error": "message" }` with 4xx/5xx status.

## Health
- `GET /health` — liveness (public).

## Auth
- `POST /api/auth/register` `{ email, password, displayName }` → user + tokens. Creates the permanent custodial wallet; sends welcome email.
- `POST /api/auth/login` `{ email, password }` → user + tokens. Rate-limited.
- `POST /api/auth/refresh` `{ refreshToken }` → new token pair (rotation).
- `POST /api/auth/logout` `{ refreshToken }` — revokes it.
- `GET  /api/auth/me` → current user.
- `POST /api/auth/forgot-password` `{ email }` — always 200; sends Brevo reset link (30-min one-time token).
- `POST /api/auth/reset-password` `{ token, password }` — resets and revokes all refresh tokens.

## Wallet
- `GET  /api/wallet` → address.
- `POST /api/wallet/export` `{ password }` → decrypted private key (password re-confirmation required, audited).

## Contributions (writes — signed with the caller's wallet)
- `POST /api/contributions/register-developer` `{ githubUsername, displayName }` — on-chain registration.
- `POST /api/contributions/verify-developer` — validators verify the GitHub identity in-consensus.
- `POST /api/contributions` `{ repo: "owner/name", category, description }` — submit for evaluation.
- `POST /api/contributions/:id/evaluate` — trigger validator evaluation (long-running; waits for ACCEPTED).
- `POST /api/contributions/:id/appeal` `{ reason }` — file an on-chain appeal.
- `GET  /api/contributions/mine` — the caller's submissions (local mirror).

## Platform (public reads, cached ~3 min)
- `GET /api/platform/info` — contract config + headline counters.
- `GET /api/platform/stats` — operational counters.
- `GET /api/platform/contributions?offset&limit&status`
- `GET /api/platform/contributions/:id`
- `GET /api/platform/developers/:username`
- `GET /api/platform/leaderboard?limit`
- `GET /api/platform/epochs` · `GET /api/platform/grants?offset&limit`
- `GET /api/platform/audit?offset&limit` — on-chain audit log.

## Admin (role: admin/curator)
- `GET /api/admin/users` · `POST /api/admin/users/:id/role` `{ role }`
- `GET /api/admin/audit-events` — API-side audit trail.
