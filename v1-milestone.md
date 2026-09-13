# ImpactDNA — V1 Milestone: Wallet-Connect & USDC Relaunch

**Date:** 2026-09-13
**Commit:** `be73630`
**Repo:** [github.com/zoefunds/ImpactDNA](https://github.com/zoefunds/ImpactDNA)

## Summary

Full relaunch of ImpactDNA's identity and funding layers. Replaced
email/password authentication and server-held custodial wallets with
wallet-connect login, and replaced native-GEN funding with USDC on Base
Sepolia, bridged to the GenLayer intelligent contract by a dedicated
relayer. Funding epochs became fully permissionless. All prior
user/contribution data was intentionally erased as part of this
relaunch — this is a fresh start, not a migration.

## What changed

### 1. Wallet-connect identity (replaces email/password + custodial wallets)

- Integrated **Reown AppKit** (WalletConnect, MetaMask, Trust Wallet,
  Binance Wallet, SafePal, and more) as the sole login method.
- New SIWE-style challenge/response auth: `GET /api/auth/nonce` issues a
  single-use, 5-minute nonce; `POST /api/auth/verify` checks the wallet's
  signature (`viem.verifyMessage`) and issues the session JWT. A wallet is
  registered automatically on first successful verification — no separate
  signup step.
- Removed: `/register`, `/forgot-password`, `/reset-password` pages and
  routes, `bcrypt` password hashing, AES-256-GCM custodial wallet
  generation/encryption/export, and the `WALLET_ENCRYPTION_KEY` secret.
- `users` table rebuilt around `wallet_address` as the identity key; added
  `auth_nonces` for the SIWE challenges.

### 2. Client-side signing for every user action

- Every per-user GenLayer write — `register_developer`,
  `verify_developer`, `submit_contribution`, `evaluate_contribution`,
  `request_appeal`, `open_epoch`, `close_epoch` — is now signed **directly
  by the user's own connected wallet** via `genlayer-js`'s support for a
  generic EIP-1193 provider (`frontend/lib/genlayerClient.ts`). The backend
  never holds or touches a per-user private key.
- Added explicit wallet network-switching (`frontend/lib/chainSwitch.ts`):
  the wallet is switched to GenLayer StudioNet (chain id `61999`) before a
  GenLayer write, and back to Base Sepolia (chain id `84532`) before an
  escrow call — without this, the wallet silently signed against whichever
  chain it happened to be on.
- Registered GenLayer StudioNet as a second AppKit/wagmi network alongside
  Base Sepolia, so AppKit stops treating it as an "unsupported network"
  and nagging with its own switch-network modal.
- Rare, trusted-operator-only actions (`detect_manipulation`,
  `resolve_appeal`, `set_min_eligible_score`, `add_curator`/
  `remove_curator`) remain backend-signed via one operator key
  (`GENLAYER_OPERATOR_PRIVATE_KEY`), gated by curator/admin role.

### 3. USDC on Base Sepolia, bridged by a relayer

- New Solidity contract **`contracts/base/ImpactDnaEscrow.sol`**: holds
  real USDC per funding epoch, no external dependencies. `deposit(epochId,
  amount)` (standard ERC20 approve + deposit), relayer-only
  `setGrants(epochId, recipients, amounts)` (one-shot per epoch), and
  self-serve `claim(epochId)` / `claimMany(epochIds)`.
- GenLayer contract (`contracts/impact_dna.py`) rewritten as the
  authoritative ledger: new relayer-only methods `record_deposit`,
  `mark_grants_relayed`, `mark_grant_claimed` — every one idempotent on a
  `base_tx_hash`, guarded by a `processed_base_tx` map, so a retried relay
  sweep can never double-apply a deposit or a claim.
- New backend relay loop (`backend/src/jobs/relay.ts` +
  `services/baseSepolia.ts` + `services/genlayerRelay.ts`): scans Base
  Sepolia for confirmed `Deposited`/`Claimed` events, applies them to
  GenLayer, and pushes closed epochs' settled grants to the escrow.
  Guarded by a Redis-backed distributed lock so multiple Fly machines
  never double-relay; durable via a `pending_deposits` table so a crash
  mid-relay is simply retried, never lost.
- All GEN-denominated fields renamed to USDC (`treasury_usdc`,
  `reserved_usdc`, `pool_usdc`, `amount_usdc`, etc., 6-decimal base units)
  across the contract, backend, and frontend.

### 4. Permissionless funding epochs

- `open_epoch(label)` is no longer curator-gated or pre-funded — **any
  wallet can open and name an epoch**. It starts empty; anyone can then
  deposit USDC into it on Base Sepolia.
- `close_epoch(epoch_id)` — callable by that epoch's own opener **or** any
  curator — settles it deterministically by the same quadratic-weight
  formula (`pool * score² / Σscore²`) as before. Multiple epochs can be
  open concurrently; a submitter picks which one to compete in.
- `submit_contribution` gained an `epoch_id` argument so a contribution is
  tied to a specific epoch at submission time, not a single global "open"
  slot.

### 5. Infrastructure migration

- New Fly.io app **`impactdna-api-v2`** (the prior `impactdna-api` app was
  on an account access to which was lost) with a fresh Fly Postgres
  cluster (`impactdna-db`) — no data carried over, by design.
- Frontend redeployed to the existing Vercel project
  (`impactdna.vercel.app`) with new `NEXT_PUBLIC_*` env vars for the
  contract, USDC, and escrow addresses.
- GitHub OAuth re-registered against the new backend, including fixing an
  initial misconfigured callback URL (`localhost:8080` instead of the
  live Fly domain — `BACKEND_URL`/`GITHUB_OAUTH_CALLBACK_URL` were never
  set on the new app).

### 6. UI completeness and correctness fixes

- Added missing UI for actions that had backend/contract support but no
  way to trigger them: closing an epoch as its own opener (Funding page),
  running the fraud screen and resolving appeals (Admin page), and
  displaying which epoch a contribution belongs to (contribution detail
  page).
- Fixed stale post-action UI state: the shared `run()` action-wrapper on
  every page was unconditionally re-fetching from the backend's cached
  read endpoints (60–120s TTL) immediately after a write succeeded,
  clobbering the correct just-changed state with stale data. Added a
  `skipRefresh` option and precise local-state updates (direct on-chain
  reads for GenLayer writes; optimistic updates for escrow claims, since
  the escrow transaction succeeding is itself the authoritative proof of
  claim) for close-epoch, claim, register, verify, and resolve-appeal.

## New contract addresses

| Chain | Contract | Address |
|---|---|---|
| GenLayer StudioNet (61999) | ImpactDNA | `0xC670690Cd75C3bD06710c85A13bAE99A2AC4faA4` |
| Base Sepolia (84532) | ImpactDnaEscrow | `0x1C588195832F87496cE797C7C28c82F532d95E4E` |
| Base Sepolia (84532) | USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

## Verification performed

- GenLayer contract: `genvm-lint check` clean, 7/7 unit tests passing
  (covers the full open-epoch → deposit → submit → evaluate → close →
  relay → claim lifecycle, including permissionless-epoch access control).
- Backend: `tsc` builds clean; live end-to-end smoke test against the
  deployed contract (`open_epoch` → consensus ACCEPTED → epoch visible
  on-chain); relay loop confirmed picking up a real deposit and applying
  it to GenLayer within seconds (Fly logs).
- Frontend: production builds clean; wallet-connect modal, funding page
  (epoch open/deposit), and dashboard verified live in-browser against
  the production deployment.

## Known follow-ups

- The relayer/operator key currently in use was shared in a development
  chat session and must be treated as already compromised — rotate to a
  freshly generated key before any real (non-testnet) value passes
  through the escrow.
- Both GenLayer StudioNet and Base Sepolia are testnets; mainnet
  deployment is a future step once a funding round has run with real
  external participants.
