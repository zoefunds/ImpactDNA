# ImpactDNA

**Retroactive Public Goods Funding on GenLayer, funded in USDC on Base Sepolia.**

ImpactDNA flips the traditional grants model: instead of funding proposals before work begins, it evaluates open-source repositories *after* release and rewards the ones that became genuinely foundational. The subjective judgment — is this work original, adopted, influential? — is performed entirely by a **GenLayer Intelligent Contract**: validators independently fetch live GitHub evidence and score impact with LLM reasoning, reaching consensus before anything is recorded or funded. Real money moves on **Base Sepolia**, in **USDC**, through a dedicated escrow contract; GenLayer is the authoritative ledger and a backend relayer bridges the two chains.

![Landing page](docs/screenshots/landing.png)

## Live deployment

| Component | URL / Address |
|---|---|
| **Web app** | [impactdna.vercel.app](https://impactdna.vercel.app) |
| **REST API** (24/7, health-checked) | [impactdna-api-v2.fly.dev](https://impactdna-api-v2.fly.dev) |
| **GenLayer Intelligent Contract** | [`0xC670690Cd75C3bD06710c85A13bAE99A2AC4faA4`](https://studio.genlayer.com) — GenLayer StudioNet (gasless) |
| **Base Sepolia escrow** | [`0x1C588195832F87496cE797C7C28c82F532d95E4E`](https://sepolia.basescan.org) — `ImpactDnaEscrow.sol` |
| **USDC (Base Sepolia)** | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| **Owner / relayer / first curator** | `0x7401c129EDfc26E68FE19309fE461eb3Db1058Eb` |

Constructor: `platform_name="Impact_DNA"`, `min_eligible_score=10` (owner-adjustable).

This is a full relaunch (2026-09-13) of an earlier native-GEN, email/password version — see [Current stage & path forward](#current-stage--path-forward) for what changed and why.

## How it works

```
Anyone connects their wallet (Reown AppKit — WalletConnect, MetaMask, etc.)
and signs a nonce to log in. No email, no password, no custodial key.
         |
         v
Anyone opens and names a funding epoch (permissionless) --> anyone deposits
USDC into it on the Base Sepolia escrow --> a relayer confirms the deposit
and credits that epoch's pool on GenLayer
         |
         v
Developer connects GitHub via OAuth (never a typed username — you can only
link an account you actually control) + registers + verifies on-chain,
signed directly by their own connected wallet
         |
         v
Submits a repository with category + description, into a chosen open epoch
         |
         v
Evaluation: leader fetches repo from GitHub, scores 5 dimensions (0-20 each)
with LLM reasoning. Every validator independently re-fetches and re-scores.
Hard gates (fork/ownership/eligibility) must match exactly; scores must land
in the same or adjacent 25-point bucket.
         |
         v
Score >= gate --> eligible for funding   |   Score < gate --> rejected (appeal available once)
         |
         v
Epoch's opener (or any curator) closes it --> pool split deterministically
by quadratic weight (score^2) — same formula regardless of who opened or
funded the epoch
         |
         v
Relayer pushes the settled grants to the Base Sepolia escrow --> developer
self-claims USDC directly from the escrow with their own wallet
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
- Curator-triggered manipulation screening (`detect_manipulation`) with comparative validation, immutable once funded
- Appeals (`request_appeal` / `resolve_appeal`) require *fresh evidence that materially contradicts the original decision* — a well-argued complaint alone is denied
- Dimension scores, the derived total, and the score bucket must agree (`_validate_score_consistency`) before a score can affect funding — checked both when a score is written and again at settlement time

### Consensus reliability

Errors are classified (`[EXPECTED]` / `[EXTERNAL]` / `[TRANSIENT]` / `[LLM_ERROR]`) so validators agree on failure paths instead of rotating leaders. Score tolerance uses adjacent 25-point buckets — honest evaluations converge instead of ending UNDETERMINED, while a leader who lies about a hard gate (fork status, ownership, eligibility) is always caught.

## Why GenLayer (and not an off-chain AI app)

Every judgment that matters happens inside the contract under multi-validator consensus:

- **Identity verification** — validators re-fetch `api.github.com/users/<name>` inside the contract; `strict_eq` over stable fields (id, login, type, created_at). No user-submitted claim is trusted.
- **Impact evaluation** — leader and validators independently fetch the repository, score with LLM reasoning, and cross-check substance (gates, buckets, repo identity). Never format-only validation.
- **Funding settlement** — pure integer math: `pool * score^2 / sum(score^2)`. Trivial consensus by construction.

An off-chain AI could score repositories, but there would be no way to verify that the scoring was honest, consistent, or tamper-proof. GenLayer makes every evaluation auditable and adversarially robust.

## USDC on Base Sepolia, bridged by a relayer

GenLayer's own EVM-compatibility layer can move its native GEN token, but not an ERC20 on another chain — so real USDC custody lives in `ImpactDnaEscrow.sol` on Base Sepolia, and a single backend relayer bridges the two chains (the same pattern used by this project's sibling `meme-olympics` and `Event-Weaver` builds):

- **Deposits**: anyone calls `ImpactDnaEscrow.deposit(epochId, amount)` (standard ERC20 approve + deposit). The relayer scans for confirmed `Deposited` events, resolves the escrow's `bytes32` key back to a GenLayer epoch id, and calls `record_deposit(epoch_id, depositor, amount, base_tx_hash)` — idempotent on `base_tx_hash`, so a retried relay sweep can never double-count a deposit.
- **Settlement relay**: once a curator (or the epoch's own opener) closes an epoch, the relayer reads `get_grants_pending_relay(epoch_id)` and pushes the recipient list to `ImpactDnaEscrow.setGrants(...)` — the contract rejects a second call for the same epoch, so a retry after a partial failure is always safe.
- **Claims**: a grant recipient calls `ImpactDnaEscrow.claim(epochId)` directly with their own wallet — the escrow holds the real USDC and pays out itself; the relayer only mirrors the `Claimed` event back onto GenLayer (`mark_grant_claimed`) so the dashboard shows accurate status.
- **No custodial keys anywhere in this path.** Deposits and claims are signed by the user's own connected wallet; only the relayer's own bridging calls (`record_deposit`, `mark_grants_relayed`, `mark_grant_claimed`) use a dedicated backend key, which must be set as the contract's `relayer` (`set_relayer`) on GenLayer and the escrow's `relayer` on Base Sepolia.

## Screenshots

| Dashboard | Contribution Explorer |
|---|---|
| ![Dashboard](docs/screenshots/dashboard.png) | ![Contribution Explorer](docs/screenshots/contribution-explorer.png) |

| Funding Explorer | Curator Admin panel |
|---|---|
| ![Funding Explorer](docs/screenshots/funding-explorer.png) | ![Admin panel](docs/screenshots/admin-panel.png) |

*(Screenshots predate this relaunch and still show the old email/GEN UI — refresh pending.)*

## Epochs are permissionless

Unlike the earlier version of this project, **anyone can open and name a funding epoch, and anyone can deposit USDC into it** — there is no curator gate on opening a round or funding it. What stays curator/admin-gated:

- **Closing an epoch** — either that epoch's own opener, or any curator, can call `close_epoch`. This prevents a third party from prematurely settling someone else's round.
- **Manipulation screening, appeal resolution, the eligibility gate, and curator management** — these are judgment calls about the platform's integrity, not about who gets to participate in funding, so they stay with curators/the owner (`detect_manipulation`, `resolve_appeal`, `set_min_eligible_score`, `add_curator`/`remove_curator`).

The sharing formula itself (`pool * score^2 / sum(score^2)`) is identical no matter who opened or funded the epoch — permissionless funding didn't require any change to how grants are computed.

## Repository layout

```
contracts/impact_dna.py    GenLayer Intelligent Contract — ledger, evaluation,
                           permissionless epochs, relayer-only USDC bridging
contracts/base/            ImpactDnaEscrow.sol (Base Sepolia USDC vault) +
                           deploy.js
contracts/tests/           Unit tests (fake genlayer runtime stub) covering
                           the full open-epoch -> deposit -> submit -> evaluate
                           -> close -> relay -> claim lifecycle
backend/                   Node 20 + TypeScript + Express (Fly.io, 24/7)
  src/routes/               Wallet-connect auth (nonce/verify), contributions
                            (mirror sync), platform (reads), admin
                            (curator/operator-signed ops)
  src/services/             baseSepolia.ts (escrow contract client),
                            genlayerRelay.ts (relayer-signed GenLayer writes)
  src/jobs/relay.ts          Scans Base Sepolia deposits/claims, relays
                            settled grants — Redis-locked against overlap
  src/lib/                  GenLayer client, SIWE-style nonce/signature auth,
                            GitHub OAuth, email, Redis, logger
  src/middleware/           JWT auth, rate limiting, error handling
  migrations/                Forward-only SQL migrations (run at boot)
frontend/                  Next.js 14 + Tailwind CSS (Vercel)
  lib/wallet.ts              Reown AppKit + wagmi config (Base Sepolia)
  lib/genlayerClient.ts      Client-side GenLayer writes, signed by the
                            connected wallet via genlayer-js's EIP-1193 provider
  lib/escrowClient.ts        Client-side USDC approve/deposit/claim (wagmi)
  app/                      Landing, dashboard, explorer, contribution detail,
                            funding (open/deposit/claim), developers, docs,
                            login (wallet-connect), admin panel
  components/               Glassmorphism UI kit, nav, footer, auth shell
docs/                       ARCHITECTURE.md, DEPLOYMENT.md, API.md, screenshots/
.github/workflows/ci.yml   Contract lint + backend & frontend builds
docker-compose.yml         Local PostgreSQL (port 5439)
```

## Tech stack

| Layer | Technology |
|---|---|
| GenLayer contract | Python, GenLayer VM, `gl.vm.run_nondet_unsafe`, pinned runner |
| Base Sepolia contract | Solidity 0.8.24, no external deps (`contracts/base/ImpactDnaEscrow.sol`) |
| Backend | Node.js 20, TypeScript, Express, PostgreSQL, Upstash Redis, Brevo |
| Frontend | Next.js 14, React 18, Tailwind CSS, TypeScript |
| Wallet / chain | Reown AppKit, wagmi, viem, genlayer-js, ethers.js |
| Infrastructure | Fly.io (24/7), Vercel, Docker, GitHub Actions CI |
| Identity | Wallet-connect (SIWE-style nonce/signature) + GitHub OAuth 2.0 for developer verification |
| Email | Brevo transactional HTTP API, every send logged to `notification_log` |

## Platform features

- **Wallet-connect identity** — sign in with any wallet via Reown AppKit (WalletConnect, MetaMask, Trust Wallet, Binance Wallet, ...). No email, no password, no custodial key ever held by the backend. A short-lived signed nonce (`GET /api/auth/nonce`, `POST /api/auth/verify`) proves wallet ownership and issues the session JWT.
- **GitHub OAuth developer identity** — users connect via OAuth (never a typed username), so an account can only be linked by someone who actually controls it; `github_id` is uniquely constrained so one GitHub account can't be linked to multiple ImpactDNA accounts.
- **Client-side signing for every user action** — register/verify/submit/evaluate/appeal/open_epoch/close_epoch are all signed directly by the connected wallet (`genlayer-js` with an EIP-1193 provider). The backend never proxies a user's key.
- **Permissionless, USDC-funded epochs** — anyone opens and names a round, anyone deposits USDC into it on Base Sepolia; a relayer bridges deposits and settled grants between chains (see above).
- **Conservative Redis usage** (Upstash, billed per command): single lazy connection, in-process micro-cache (Map, max 500 entries) in front of every read, TTL on all keys, fixed-window rate limiter costing 1-2 commands per hit, graceful degradation to in-memory if Redis is unreachable, and a distributed relay lock so multiple Fly machines never double-relay.
- **24/7 backend**: Fly.io with `auto_stop_machines="off"`, `min_machines_running=1`, restart policy `always`, `/health` endpoint checked every 30 seconds.
- **Self-healing mirror**: the dashboard reads a local Postgres mirror table that automatically reconciles with authoritative on-chain records when stale data is detected.
- **Security**: helmet, strict CORS allowlist, Zod validation on every input, single-use signed nonces for login, RBAC (developer/curator/admin) for the narrow set of operator actions, audit logging on-chain and in Postgres, secret-redacting structured logs (pino), fail-fast environment validation.

## Quick start (local)

```bash
git clone https://github.com/zoefunds/ImpactDNA.git && cd ImpactDNA
docker compose up -d                          # PostgreSQL on :5439
cd backend && cp .env.example .env            # fill in secrets
npm install && npm run dev                    # API on :8080
cd ../frontend && cp .env.example .env.local  # fill in NEXT_PUBLIC_* vars
npm install && npm run dev                    # web on :3000
```

The backend's dev script loads `.env` itself (see `src/config.ts`) — no extra tooling needed even on older Node versions without `--env-file` support.

## Operating a funding round

Opening and funding an epoch is now open to anyone via the **`/funding` page** — no admin access required. Curators still handle the narrower operator actions from **`/admin`**:

- **Close an epoch** — settles grants deterministically; available to that epoch's own opener too, not just curators
- **Manipulation screen** (`detect_manipulation`) and **appeal resolution** (`resolve_appeal`)
- **Eligibility gate** (admin only) — adjust `min_eligible_score` (0–100)
- **Curator management** (admin only) — add/remove curators on-chain; owner-gated by the contract itself

The same operations are available directly against the contract for scripted or emergency use:

```bash
# Open a permissionless epoch (any wallet)
genlayer write 0xC670…4aA4 open_epoch --args "Season 1"

# Anyone deposits USDC into it on Base Sepolia (ImpactDnaEscrow.deposit),
# which the relayer picks up and credits to the epoch automatically.

# Close epoch — deterministic quadratic settlement (opener or curator)
genlayer write 0xC670…4aA4 close_epoch --args e-1

# Resolve any open appeals / run a manipulation screen (curator)
genlayer write 0xC670…4aA4 resolve_appeal --args a-1
genlayer write 0xC670…4aA4 detect_manipulation --args c-1

# Adjust the eligibility gate (owner only)
genlayer write 0xC670…4aA4 set_min_eligible_score --args 40
```

## Current stage & path forward

ImpactDNA was fully relaunched on 2026-09-13: the earlier email/password + custodial-wallet + native-GEN version was replaced end-to-end with wallet-connect identity and USDC funding on Base Sepolia, and permissionless epochs replaced curator-only funding rounds. All prior user/contribution data was intentionally erased as part of this relaunch — this is a fresh start, not a migration.

Concrete next steps:

- **Onboard real external developers and funders.** Both the developer-verification pipeline and the now-permissionless funding side are ready for anyone to use directly — the next milestone is getting real, unaffiliated participants through both paths.
- **Recruit additional curators.** One wallet currently holds owner + first-curator + relayer power. The contract and admin panel already support adding independent curators (`add_curator`); spreading that role out (and moving the relayer to its own dedicated key) is a trust improvement, not just a feature.
- **Rotate the relayer/operator key.** The current key was shared in a development chat session and should be treated as already compromised for anything beyond testnet — generate and wire in a fresh one before any real value passes through the escrow.
- **Mainnet / Base deployment.** Both StudioNet and Base Sepolia are testnets; moving to live networks is the natural next step once a funding round has run with real external participants.
- **Recurring, concurrent funding rounds.** The quadratic-settlement math is unit-verified and now supports multiple simultaneously-open epochs by construction — a real round with several concurrently open, differently-funded epochs is the next proof point.

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — system design, data flow, consensus model
- [Deployment](docs/DEPLOYMENT.md) — step-by-step for contracts, Fly.io, Vercel
- [API Reference](docs/API.md) — all endpoints, auth, request/response schemas
- [review.md](review.md) — reserved-vs-treasury and score-consistency fix, with tests (pre-relaunch)

## License

MIT
