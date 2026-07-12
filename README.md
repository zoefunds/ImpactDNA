# ImpactDNA 🧬

**Retroactive Public Goods Funding on GenLayer.**

Instead of funding proposals before work begins, ImpactDNA evaluates open-source
repositories *months after release* and rewards the ones that became genuinely
foundational. The subjective judgment — is this work original, adopted,
influential? — is performed by a **GenLayer Intelligent Contract**: validators
independently fetch live GitHub evidence and score impact with LLM reasoning,
and must reach consensus before anything is recorded or funded.

**Deployed contract (GenLayer StudioNet):** `0xAa14d19Ad58AdB34b34B22936E1B0640EF951648`

## Why GenLayer (and not an off-chain AI app)

The contract owns the minimum state transition that needs consensus:

- **Identity verification** — validators re-fetch `api.github.com/users/<name>`
  inside the contract; strict equality over stable fields. No user-submitted claim is trusted.
- **Impact evaluation** — the leader fetches the repository from GitHub in-contract
  and scores five dimensions with an LLM; **every validator independently re-fetches
  and re-scores**, then compares substance: hard gates (fork / ownership / eligibility)
  must match exactly, scores must land in the same or adjacent 25-point bucket.
  Never format-only validation.
- **Fraud detection & appeals** — comparative validation on the decision field.
- **Funding settlement** — deterministic integer math: `pool × score² / Σscore²`
  across eligible contributions when an epoch closes.

Classified errors (`[EXPECTED] / [EXTERNAL] / [TRANSIENT] / [LLM_ERROR]`) let
validators agree on failure paths, and tolerant score buckets keep honest
evaluations converging — avoiding needless leader rotation and UNDETERMINED results.

## Repository layout

```
contracts/impact_dna.py   Intelligent Contract (1,500+ lines, genvm-lint clean)
backend/                  Node 20 + TypeScript + Express API (Fly.io, 24/7)
frontend/                 Next.js 14 app (Vercel)
docs/                     Architecture, deployment, API reference
docker-compose.yml        Local PostgreSQL
MEMORY.md                 Project memory / decision log
```

## Stack

| Layer      | Technology |
|------------|------------|
| Contract   | GenLayer GenVM (Python), StudioNet, gasless |
| Backend    | Express + PostgreSQL + Upstash Redis (conservative usage) + Brevo email |
| Wallets    | Custodial per-user (ethers), AES-256-GCM encrypted, exportable |
| Frontend   | Next.js 14, Tailwind ("Synthetic Integrity" design system) |
| Deploy     | Fly.io (API, never sleeps) · Vercel (web) · GenLayer Studio (contract) |

## Quick start (local)

```bash
docker compose up -d                 # PostgreSQL on :5439
cd backend && cp .env.example .env   # fill secrets
npm install && npm run build && npm start   # API on :8080
cd ../frontend && npm install && npm run dev # web on :3000
```

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for production deployment and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full system design.

## Contract lifecycle

```
register_developer → verify_developer (GitHub evidence, strict_eq)
  → submit_contribution → evaluate_contribution (LLM + web, tolerant consensus)
    → [detect_manipulation] → open_epoch → close_epoch (deterministic settlement)
      → claim_grant · request_appeal → resolve_appeal
```

## License

MIT
