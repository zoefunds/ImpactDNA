# ImpactDNA

**Retroactive Public Goods Funding on GenLayer.**

ImpactDNA flips the traditional grants model: instead of funding proposals before work begins, it evaluates open-source repositories *after* release and rewards the ones that became genuinely foundational. The subjective judgment — is this work original, adopted, influential? — is performed entirely by a **GenLayer Intelligent Contract**: validators independently fetch live GitHub evidence and score impact with LLM reasoning, reaching consensus before anything is recorded or funded.

## Live deployment

| Component | URL / Address |
|---|---|
| **Web app** | [impactdna.vercel.app](https://impactdna.vercel.app) |
| **REST API** (24/7) | [impactdna-api.fly.dev](https://impactdna-api.fly.dev) |
| **Intelligent Contract** | [`0xAa14d19Ad58AdB34b34B22936E1B0640EF951648`](https://studio.genlayer.com) — GenLayer StudioNet (gasless) |
| **Contract owner / curator** | `0x7401c129EDfc26E68FE19309fE461eb3Db1058Eb` (GenLayer Studio account) |

Constructor: `platform_name="Impact_DNA"`, `min_eligible_score=40`.

### End-to-end verification (real on-chain transactions)

Every step of the lifecycle has been exercised against the live contract with 5-validator consensus:

| Step | Tx hash | Result |
|---|---|---|
| `register_developer("zoefunds")` | `0xf9251a…c9b263` | unanimous agree |
| `verify_developer` — validators fetch `api.github.com/users/zoefunds` in-consensus | `0x6fea46…ae86fe` | verified |
| `submit_contribution("zoefunds/OracleRot")` | `0xe1d843…511145` | id `c-1` |
| `evaluate_contribution("c-1")` — LLM + live GitHub evidence | `0x937a53…735cc8` | **14/100 — rejected** |
| `request_appeal("c-1")` | `0xecf353…68b97d` | appeal `a-1` open |

The rejection demonstrates the system working as designed: an 8-day-old repo with zero stars, no forks, no downstream dependents, and no license scored 14/100 against a 40-point eligibility gate. The contract evaluates real evidence — it does not rubber-stamp submissions.

## How it works

```
Developer registers + verifies GitHub identity (on-chain, consensus)
         |
         v
Submits a repository with category + description
         |
         v
Evaluation: leader fetches repo from GitHub, scores 5 dimensions (0-20 each)
with LLM reasoning. Every validator independently re-fetches and re-scores.
Hard gates (fork/ownership/eligibility) must match exactly; scores must land
in the same or adjacent 25-point bucket.
         |
         v
Score >= 40 --> eligible for funding
Score < 40  --> rejected (appeal available once)
         |
         v
Curator opens epoch --> pool split by quadratic weight (score^2)
```

### Impact dimensions (0-20 each, 100 total)

| Dimension | What validators look for |
|---|---|
| **Downstream usage** | Is anything built on top of it? Dependents, imports, integrations |
| **Technical importance** | Does it solve a hard, foundational problem? |
| **Originality** | Is it novel work? Forks get `originality=0` and a 30-point cap automatically |
| **Ecosystem influence** | Did it shape how others build in the ecosystem? |
| **Community adoption** | Stars, forks, contributors relative to its niche |

### Anti-gaming protections (deterministic, not LLM)

- Forks: `originality=0`, hard 30-point cap
- Non-owned repos: capped below the eligibility gate
- Volatile metrics (stars/forks): enter evidence only as order-of-magnitude buckets
- Duplicate repos and per-developer submission caps enforced in contract state
- Curator-triggered manipulation screening with comparative validation

### Consensus reliability

Errors are classified (`[EXPECTED]` / `[EXTERNAL]` / `[TRANSIENT]` / `[LLM_ERROR]`) so validators agree on failure paths instead of rotating leaders. Score tolerance uses adjacent 25-point buckets — honest evaluations converge instead of ending UNDETERMINED, while a leader who lies about a hard gate (fork status, ownership, eligibility) is always caught.

## Why GenLayer (and not an off-chain AI app)

Every judgment that matters happens inside the contract under multi-validator consensus:

- **Identity verification** — validators re-fetch `api.github.com/users/<name>` inside the contract; `strict_eq` over stable fields (id, login, type, created_at). No user-submitted claim is trusted.
- **Impact evaluation** — leader and validators independently fetch the repository, score with LLM reasoning, and cross-check substance (gates, buckets, repo identity). Never format-only validation.
- **Funding settlement** — pure integer math: `pool * score^2 / sum(score^2)`. Trivial consensus by construction.

An off-chain AI could score repositories, but there would be no way to verify that the scoring was honest, consistent, or tamper-proof. GenLayer makes every evaluation auditable and adversarially robust.

## Repository layout

```
contracts/impact_dna.py    Intelligent Contract (1,557 lines, 33 public methods,
                           genvm-lint clean, pinned runner hash)
backend/                   Node 20 + TypeScript + Express (Fly.io, 24/7)
  src/routes/              Auth, contributions, platform, funding endpoints
  src/lib/                 GenLayer client, wallet encryption, email, Redis, logger
  src/middleware/          JWT auth, rate limiting, error handling
  migrations/              Forward-only SQL migrations (run at boot)
frontend/                  Next.js 14 + Tailwind CSS (Vercel)
  app/                     Landing, dashboard, explorer, contribution detail,
                           funding, developers, docs, auth pages
  components/              Glassmorphism UI kit, nav, footer, auth shell
docs/                      ARCHITECTURE.md, DEPLOYMENT.md, API.md
.github/workflows/ci.yml  Contract lint + backend & frontend builds
docker-compose.yml         Local PostgreSQL (port 5439)
```

## Tech stack

| Layer | Technology |
|---|---|
| Intelligent Contract | Python, GenLayer VM, `gl.vm.run_nondet_unsafe`, pinned runner |
| Backend | Node.js 20, TypeScript, Express, PostgreSQL, Upstash Redis, Brevo |
| Frontend | Next.js 14, React 18, Tailwind CSS, TypeScript |
| Infrastructure | Fly.io (24/7), Vercel, Docker, GitHub Actions CI |
| Crypto | ethers.js (wallet generation), AES-256-GCM (key encryption), bcrypt(12) |
| Chain interaction | genlayer-js v1.1.8 SDK |

## Platform features

- **Email + password auth** with JWT access tokens (15-min) and rotating refresh tokens (7-day). Brevo-powered password reset with 30-minute one-time tokens.
- **Permanent custodial wallets**: generated at signup with ethers, AES-256-GCM encrypted at rest. Address never changes, survives device/browser resets. Private-key export requires password re-confirmation. StudioNet is gasless, so users transact without holding tokens.
- **Transactional email** via Brevo HTTP API: welcome, password reset, submission confirmation, evaluation results.
- **Conservative Redis usage** (Upstash, billed per command): single lazy connection, in-process micro-cache (Map, max 500 entries) in front of every read, TTL on all keys, fixed-window rate limiter costing 1-2 commands per hit, graceful degradation to in-memory if Redis is unreachable.
- **24/7 backend**: Fly.io with `auto_stop_machines="off"`, `min_machines_running=1`, restart policy `always`, `/health` endpoint checked every 30 seconds.
- **Self-healing mirror**: the dashboard reads a local Postgres mirror table that automatically reconciles with authoritative on-chain records when stale data is detected.
- **Security**: helmet, strict CORS allowlist, Zod validation on every input, bcrypt(12), RBAC (developer/curator/admin), audit logging on-chain and in Postgres, secret-redacting structured logs (pino), fail-fast environment validation.

## Quick start (local)

```bash
git clone https://github.com/zoefunds/ImpactDNA.git && cd ImpactDNA
docker compose up -d                          # PostgreSQL on :5439
cd backend && cp .env.example .env            # fill in secrets
npm install && npm run build && npm start     # API on :8080
cd ../frontend && npm install && npm run dev  # web on :3000
```

## Operating a funding round (curator)

From GenLayer Studio or CLI, using the contract owner account:

```bash
# Deposit to treasury (amount in atto-GEN; 1000 GEN = 1e21 atto)
genlayer write 0xAa14…1648 deposit_to_treasury --args 1000000000000000000000

# Open an epoch with a 500 GEN pool
genlayer write 0xAa14…1648 open_epoch --args 500000000000000000000 "Genesis Round"

# Developers submit and evaluate during the epoch...

# Close epoch — deterministic quadratic settlement
genlayer write 0xAa14…1648 close_epoch

# Resolve any open appeals
genlayer write 0xAa14…1648 resolve_appeal --args a-1
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — system design, data flow, consensus model
- [Deployment](docs/DEPLOYMENT.md) — step-by-step for contract, Fly.io, Vercel
- [API Reference](docs/API.md) — all endpoints, auth, request/response schemas

## License

MIT
