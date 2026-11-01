# ImpactDNA — V1 Milestone: Wallet-Connect & USDC Relaunch

> Historical milestone, superseded by the 2026-11-01 remediation release. The
> deployment table and verification section below are maintained as a current
> testnet snapshot; see `docs/MILESTONE-REMEDIATION.md` for the safety
> guarantees and archived transaction chain.

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
  depositId, amount)` (standard ERC20 approve + deposit), relayer-only
  `setGrants(epochId, recipients, amounts)` (one-shot per epoch), and
  self-serve `claim(epochId)` / `claimMany(epochIds)`.
- GenLayer contract (`contracts/impact_dna.py`) rewritten as the
  authoritative ledger: new relayer-only methods `record_deposit`,
  `mark_grants_relayed`, `mark_grant_claimed` — idempotent on the operation's
  durable identity (`depositId`, settlement transaction hash, or claim event
  id), guarded by the contract's processed-operation map so a retried relay
  sweep cannot double-apply a deposit, allocation, or claim.
- New backend relay loop (`backend/src/jobs/relay.ts` +
  `services/baseSepolia.ts` + `services/genlayerRelay.ts`): scans Base
  Sepolia for confirmed `Deposited`/`Claimed` events, applies them to
  GenLayer, and pushes closed epochs' settled grants to the escrow.
  Guarded by a Redis-backed distributed lock so multiple Fly machines
  never double-relay; durable via a `pending_deposits` table so a crash
  mid-relay is simply retried, never lost. Deposit events are keyed by
  transaction hash plus log index, so smart-account batches are preserved.
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

- Current Fly.io app **`impactdna-milestone-api`** with Fly Postgres
  **`impactdna-milestone-db`**. The earlier app is absent from the
  authenticated Fly account; no data was carried over.
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
| GenLayer StudioNet (61999) | ImpactDNA | `0xC7606d65963A7e45a2A5E08B102C73efBB307466` |
| Base Sepolia (84532) | ImpactDnaEscrow | `0x51c7575D0893D6a5cc98dA5356A8e727502Eb8B0` |
| Base Sepolia (84532) | USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

## Current verification status

- GenLayer contract: 13/13 unit tests passing
  (covers the full open-epoch → deposit → submit → evaluate → close →
  relay → claim lifecycle, including permissionless-epoch access control).
- Base escrow: 7/7 Foundry regression tests pass, including invalid-epoch
  refunds and settlement deferral while deposit acknowledgements are pending.
- Backend: TypeScript build and 9/9 relay/receipt tests pass; migrations `001`–`011`
  are applied in production. A complete Base deposit → GenLayer record →
  Base allocation → claim → GenLayer acknowledgement run is documented.
- The deployed relay implementation is commit `d7352ee`; production had `0`
  pending deposit rows at final verification.
- Frontend: production builds clean; wallet-connect modal, funding page
  (epoch open/deposit), and dashboard verified live in-browser against
  the production deployment.

## Remaining product-stage follow-up

- The exposed development operator identity was retired on 2026-11-01. The
  coordinated contracts and production backend now use
  `0x0f4CAd4b62DfcEce23a6e88565BFf83C703B28e2`.
- Both GenLayer StudioNet and Base Sepolia are testnets; mainnet
  deployment is a future step once a funding round has run with real
  external participants.
