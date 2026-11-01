# ImpactDNA — Current Project State

Last verified: 2026-11-01. This file records current operational facts; historical deployments are intentionally omitted.

## Production/testnet deployments

- Frontend: `https://impactdna.vercel.app`
- Backend: `https://impactdna-milestone-api.fly.dev` (`impactdna-milestone-api`, Fly region `iad`)
- Database: `impactdna-milestone-db`; migrations `001` through `011` applied
- GenLayer StudioNet contract: `0xC7606d65963A7e45a2A5E08B102C73efBB307466`
- Base Sepolia escrow: `0x51c7575D0893D6a5cc98dA5356A8e727502Eb8B0`
- Base Sepolia USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- Owner, relayer, and first curator: `0x0f4CAd4b62DfcEce23a6e88565BFf83C703B28e2` (rotated 2026-11-01)
- Eligibility threshold: `60`

Both chains are testnets. The Base escrow is the sole custodian of USDC; GenLayer is the authoritative evaluation and grant ledger.

## Architecture decisions

- One Intelligent Contract owns GitHub identity verification, AI-validator impact scoring, manipulation screening, appeals, epochs, and deterministic quadratic grant settlement.
- Developer registration requires a public proof gist created through authenticated GitHub OAuth. Its owner and exact `{github, wallet}` payload are independently verified on-chain before a username is reserved.
- User actions are signed by the connected wallet. Only curator/admin operations and relay acknowledgements use trusted backend keys.
- Every Base deposit has a unique `depositId`. It remains pending until GenLayer accepts or rejects it; rejected or late deposits become exactly refundable.
- Deposits with an unrecognized epoch hash are persisted and reconciled as refundable; the scan cursor never discards them.
- Batched deposit logs use `<transaction-hash>:<log-index>` event identities;
  every unique `depositId` has independent retry and completion state even
  when several deposits share one Base transaction.
- Base tracks `pendingDepositCount` per epoch and forbids any terminal settlement while the count is non-zero. The backend also defers settlement while a matching durable queue row is pending.
- Accepted collateral cannot be withdrawn while active. Grants can only be allocated from accepted collateral.
- Relay scans are durable: deposits and claims are persisted in Postgres before cursors advance. Failed events remain retryable, and multi-grant claims in one transaction are supported.
- Funded epochs with no eligible recipients terminate through relayer-only `settleEmptyEpoch`; collateral remains locked until that settlement and only the unallocated balance can then be recovered.
- Settlement recovery persists the original Base transaction hash and verifies an existing allocation per wallet before retrying only the missing GenLayer acknowledgement. Its fallback event lookup is bounded to 200 blocks.
- Backend and browser GenLayer writes require `FINALIZED`, a successful leader execution, and `result.status=return`; finalized execution errors are rejected.

## Operations

- Fly runs one always-on backend machine with `/health` checks and automatic migrations at startup.
- The relay scans Base Sepolia in 200-block inclusive ranges to satisfy the public RPC limit.
- GitHub OAuth callback: `https://impactdna-milestone-api.fly.dev/api/auth/github/callback`
- Production secrets live only in Fly/Vercel configuration. Never commit private keys, OAuth client secrets, database URLs, JWT secrets, or provider credentials.
- Local Postgres uses port `5439`; copy the `.env.example` files for local development.

## Verification

- Python Intelligent Contract tests: 13 passing.
- Solidity escrow regression tests: 7 passing.
- Backend relay/receipt tests: 9 passing.
- Frontend production build: passing (third-party `ox` dynamic-import warnings remain non-fatal).
- A complete 1-USDC Base Sepolia deposit-to-claim run is recorded in `docs/MILESTONE-REMEDIATION.md`.
- Fly production is healthy with migrations `001` through `011` applied;
  Vercel production is Ready and exposes the current contract addresses.
