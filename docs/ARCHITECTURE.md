# ImpactDNA Architecture

## System overview

```
┌────────────┐     HTTPS      ┌───────────────┐   genlayer-js    ┌──────────────────────┐
│  Next.js   │ ─────────────▶ │  Express API   │ ───────────────▶ │  Intelligent Contract │
│  (Vercel)  │◀── wallet ────▶│  (Fly.io 24/7) │                  │  (GenLayer StudioNet) │
└─────┬──────┘   connect      └──────┬────────┘                  └──────────┬───────────┘
      │ genlayer-js + wagmi          │                                      │ in-consensus
      │ (client-side signing)  ┌─────┼──────────────┬──────────────┐        ▼
      ▼                        ▼     ▼              ▼              ▼  api.github.com
┌─────────────┐          PostgreSQL  Upstash Redis  Brevo    relay loop  (validator-fetched
│Base Sepolia │          (users,     (cache + rate  (email)  (jobs/      evidence)
│ USDC escrow │           mirror)     limits)                 relay.ts)
└──────┬──────┘                                                   │
       └───────────────────────────────────────────────────────────┘
              relayer bridges deposits + settled grants both ways
```

The **GenLayer contract is the source of truth** for developers,
contributions, scores, epochs, grants, and the audit log. **Real USDC custody
lives on Base Sepolia** in `ImpactDnaEscrow.sol`, bridged to GenLayer by a
single backend relayer. Every per-user write (register, verify, submit,
evaluate, appeal, open/close epoch, deposit, claim) is signed **client-side**
by the user's own connected wallet — the backend never holds a per-user key.
It adds wallet-connect session issuance, notifications, the relay loop, and a
fast local mirror for dashboards.

## GenLayer Intelligent Contract (`contracts/impact_dna.py`)

Single production contract (per the review-team guidance: one serious project,
no format-only validators, real evidence).

### Storage
GenLayer-native types only: `TreeMap[str, str]` holding JSON records
(developers, contributions, epochs, grants, appeals), `DynArray[str]` orderings
and the append-only audit log, `u256` counters/ledger balances, `Address`
owner/relayer, and a `processed_base_tx` idempotency map guarding every
relayer-only write against double-application.

### Consensus design per operation

| Operation | Nondet primitive | Validator agreement |
|---|---|---|
| `verify_developer` | `gl.eq_principle.strict_eq` over stable GitHub user fields (id, login, type, created_at) | exact |
| `evaluate_contribution` | `gl.vm.run_nondet_unsafe` — leader fetches repo + LLM-scores 5 dimensions | validator re-fetches & re-scores; gates (fork/ownership/eligible) exact, score in same or adjacent 25-pt bucket, repo id equal |
| `detect_manipulation` | `run_nondet_unsafe` | manipulative flag match (medium-risk corridor), risk within 1 level |
| `resolve_appeal` | `run_nondet_unsafe` | uphold/deny must match |
| `open_epoch` / `close_epoch` | none — deterministic | trivial |
| `record_deposit` / `mark_grants_relayed` / `mark_grant_claimed` | none — deterministic, relayer-only | trivial (idempotent on `base_tx_hash`) |

### Permissionless epochs, USDC-funded via relayer

`open_epoch(label)` takes no pool argument and no curator gate — any wallet
opens and names an epoch, which starts with `pool_usdc = 0`. Real funding
happens off this chain entirely: a depositor calls `ImpactDnaEscrow.deposit`
on Base Sepolia, the backend relayer observes the confirmed event and calls
`record_deposit(epoch_id, depositor, amount, base_tx_hash)`, crediting that
epoch's own `pool_usdc`. `close_epoch(epoch_id)` — callable by that epoch's
opener or any curator — then splits `pool_usdc` by quadratic weight
(`score^2`) exactly as before; the relayer reads
`get_grants_pending_relay(epoch_id)` afterward and pushes the recipient list
to the escrow's `setGrants`, then mirrors that back via
`mark_grants_relayed`. A recipient's own `ImpactDnaEscrow.claim(epochId)`
call is mirrored back via `mark_grant_claimed` once observed.

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

## Base Sepolia escrow (`contracts/base/ImpactDnaEscrow.sol`)

No external dependencies (no OpenZeppelin) — a `Pool` struct per epoch id
(`deposited`, `allocated`, `grantsSet`), a `claimable` mapping credited only
by the relayer's one-shot `setGrants` call, and a `claim`/`claimMany`
self-serve pull pattern with a reentrancy guard. Owner/relayer are
independently settable (`transferOwnership`/`setRelayer`); an owner-only
`withdrawUnallocated` recovers dust below a grant-weight rounding, never
anything already allocated or claimable.

## Backend (`backend/`)

Node 20, TypeScript strict, Express.

- **Auth**: wallet-connect only. `GET /api/auth/nonce` issues a single-use,
  5-minute SIWE-style nonce per address; `POST /api/auth/verify` checks the
  signature (`viem.verifyMessage`) and issues JWT access (2h) + rotating
  refresh tokens (30d, SHA-256-hashed at rest). No password, no custodial
  wallet — the connected wallet address IS the account.
- **GenLayer service**: read client (no key) for views with Redis-backed
  cache. There is no per-user write client anymore — those writes are signed
  client-side by the frontend. The backend's only GenLayer-signing key
  (`GENLAYER_OPERATOR_PRIVATE_KEY`) is reserved for rare curator/admin ops
  (`detect_manipulation`, `resolve_appeal`, `set_min_eligible_score`,
  `add_curator`/`remove_curator`).
- **Relay loop** (`src/jobs/relay.ts`): scans Base Sepolia for confirmed
  `Deposited`/`Claimed` events, applies them to GenLayer
  (`record_deposit`/`mark_grant_claimed`), and pushes closed epochs' settled
  grants to the escrow (`setGrants` → `mark_grants_relayed`). Guarded by a
  Redis-backed distributed lock (`withLock`) so multiple Fly machines never
  double-relay; degrades to an in-process lock if Redis is unavailable.
  Signs with `BASE_SEPOLIA_RELAYER_PRIVATE_KEY` on both chains (a plain
  secp256k1 key works as both an ethers.js wallet and a genlayer-js account).
- **Redis conservation**: single lazy connection; in-process micro-cache in
  front of every read; TTL on all keys; fixed-window rate limiting costs 1–2
  commands per hit; automatic degradation to in-memory if Redis is unreachable.
- **Security**: helmet, strict CORS allowlist, zod validation on every input,
  rate limits on auth endpoints, audit_events table, pino logs with secret
  redaction, environment validated at boot (fail-fast).

### Database schema
`users` (wallet_address, display_name, email — notification-only, nullable —
github_username, role), `refresh_tokens`, `auth_nonces` (SIWE challenges),
`contribution_mirror` (fast reads; chain is canonical), `pending_deposits` +
`relay_sync_state` (relay-loop durability/cursors), `notification_log`,
`audit_events`, `schema_migrations`. Forward-only SQL migrations applied
transactionally at boot.

## Frontend (`frontend/`)

Next.js 14 App Router + Tailwind implementing the **"Synthetic Integrity"**
design system (dark obsidian surfaces, GenLayer-purple / data-cyan / impact-green,
Inter for narrative + JetBrains Mono for verifiable data, glassmorphism with a
40px dependency-grid overlay).

- **`lib/wallet.ts`**: Reown AppKit + wagmi config (Base Sepolia network).
- **`lib/genlayerClient.ts`**: client-side GenLayer writes — `genlayer-js`'s
  `createClient` takes the connected wallet's EIP-1193 provider directly, so
  the same wallet used for Base Sepolia signs GenLayer transactions too.
- **`lib/escrowClient.ts`**: client-side USDC approve/deposit/claim against
  `ImpactDnaEscrow` via wagmi.
- **Pages**: landing, login (wallet-connect, `next/dynamic` with `ssr:false`
  since AppKit hooks require the client-only-initialized modal), dashboard
  (identity → submit → evaluate flow, epoch picker, grant claims), funding
  explorer (open/name an epoch, deposit USDC, grant ledger — also
  `ssr:false`), contribution explorer, per-contribution evaluation report,
  developer leaderboard, admin panel (curator/admin-only operator actions),
  documentation.

## Availability

- Fly.io: `auto_stop_machines="off"`, `min_machines_running=1`, restart policy
  `always`, `/health` checks every 30s → the API never sleeps (24/7).
- Graceful shutdown drains HTTP, closes Postgres pool and Redis.
- GenLayer contract: StudioNet-hosted; no infrastructure to keep alive.
- Base Sepolia escrow: standard EVM contract; no infrastructure to keep alive.
