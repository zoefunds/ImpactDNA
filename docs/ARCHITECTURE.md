# ImpactDNA Architecture

## System overview

```
┌────────────┐     HTTPS      ┌───────────────┐   genlayer-js    ┌──────────────────────┐
│  Next.js   │ ─────────────▶ │  Express API   │ ───────────────▶ │  Intelligent Contract │
│  (Vercel)  │                │  (Fly.io 24/7) │                  │  (GenLayer StudioNet) │
└────────────┘                └──────┬────────┘                  └──────────┬───────────┘
                                     │                                      │ in-consensus
                       ┌─────────────┼──────────────┐                       ▼
                       ▼             ▼              ▼               api.github.com
                  PostgreSQL   Upstash Redis     Brevo              (validator-fetched
                  (users,      (cache + rate     (email)             evidence)
                   mirror)      limits, low use)
```

The **contract is the source of truth** for developers, contributions, scores,
epochs, grants, appeals and the audit log. The backend adds authentication,
custodial wallets, notifications, and a fast local mirror for dashboards.

## Intelligent Contract (`contracts/impact_dna.py`)

Single production contract (per the review-team guidance: one serious project,
no format-only validators, real evidence).

### Storage
GenLayer-native types only: `TreeMap[str, str]` holding JSON records
(developers, contributions, epochs, grants, appeals), `DynArray[str]` orderings
and the append-only audit log, `u256` counters/treasury, `Address` owner.
O(1) stat counters are maintained alongside collections.

### Consensus design per operation

| Operation | Nondet primitive | Validator agreement |
|---|---|---|
| `verify_developer` | `gl.eq_principle.strict_eq` over stable GitHub user fields (id, login, type, created_at) | exact |
| `evaluate_contribution` | `gl.vm.run_nondet_unsafe` — leader fetches repo + LLM-scores 5 dimensions | validator re-fetches & re-scores; gates (fork/ownership/eligible) exact, score in same or adjacent 25-pt bucket, repo id equal |
| `detect_manipulation` | `run_nondet_unsafe` | manipulative flag match (medium-risk corridor), risk within 1 level |
| `resolve_appeal` | `run_nondet_unsafe` | uphold/deny must match |
| `close_epoch` | none — deterministic | trivial |

### Anti-gaming layers
- Deterministic gates on top of LLM output: forks get `originality=0` and a
  30-point cap; non-owned repos are capped below the eligibility gate.
- Duplicate-submission guard by repo name; per-developer submission cap.
- Curator-triggered fraud screen; funded contributions immutable.
- Volatile metrics (stars, forks) enter LLM evidence only as order-of-magnitude
  buckets so they can't break validator agreement.

### Error classification
`[EXPECTED]` business errors and `[EXTERNAL]` 4xx must match exactly between
leader and validator; `[TRANSIENT]` network/5xx agree if both transient;
`[LLM_ERROR]` always disagrees to force rotation away from a broken leader.

## Backend (`backend/`)

Node 20, TypeScript strict, Express.

- **Auth**: bcrypt (12 rounds), JWT access (2h) + rotating refresh tokens (30d,
  SHA-256-hashed at rest), password policy, forgot/reset via Brevo one-time
  tokens (30 min).
- **Wallets**: ethers random wallet at signup; private key AES-256-GCM encrypted
  with `WALLET_ENCRYPTION_KEY` (scrypt-derived). Export requires password
  re-confirmation. The wallet signs GenLayer transactions server-side via
  genlayer-js — StudioNet is gasless so no funding is needed.
- **GenLayer service**: read client (no key) for views with Redis-backed cache;
  per-user write client signs `register_developer`, `verify_developer`,
  `submit_contribution`, `evaluate_contribution`, `request_appeal` and waits for
  ACCEPTED status.
- **Redis conservation**: single lazy connection; in-process micro-cache in
  front of every read; TTL on all keys; fixed-window rate limiting costs 1–2
  commands per hit; automatic degradation to in-memory if Redis is unreachable.
- **Security**: helmet, strict CORS allowlist, zod validation on every input,
  rate limits on auth endpoints, audit_events table, pino logs with secret
  redaction, environment validated at boot (fail-fast).

### Database schema
`users` (email, password_hash, wallet_address, wallet_ciphertext, github_username, role),
`refresh_tokens`, `password_reset_tokens`, `contribution_mirror` (fast reads;
chain is canonical), `notification_log`, `audit_events`, `schema_migrations`.
Forward-only SQL migrations applied transactionally at boot.

## Frontend (`frontend/`)

Next.js 14 App Router + Tailwind implementing the **"Synthetic Integrity"**
design system (dark obsidian surfaces, GenLayer-purple / data-cyan / impact-green,
Inter for narrative + JetBrains Mono for verifiable data, glassmorphism with a
40px dependency-grid overlay).

Pages: landing, register/login/forgot/reset, dashboard (identity → submit →
evaluate flow, wallet panel with key export), contribution explorer,
per-contribution evaluation report (dimension bars, consensus evidence,
funding decision, appeal), funding explorer (epochs + grant ledger),
developer leaderboard, documentation.

## Availability

- Fly.io: `auto_stop_machines="off"`, `min_machines_running=1`, restart policy
  `always`, `/health` checks every 30s → the API never sleeps (24/7).
- Graceful shutdown drains HTTP, closes Postgres pool and Redis.
- Contract: StudioNet-hosted; no infrastructure to keep alive.
