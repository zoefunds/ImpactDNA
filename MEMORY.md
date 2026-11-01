# ImpactDNA — Current Project State

Last verified: 2026-11-01. This file records current operational facts; historical deployments are intentionally omitted.

## Production/testnet deployments

- Frontend: `https://impactdna.vercel.app`
- Backend: `https://impactdna-milestone-api.fly.dev` (`impactdna-milestone-api`, Fly region `iad`)
- Database: `impactdna-milestone-db`; migrations `001` through `008` applied
- GenLayer StudioNet contract: `0xC7606d65963A7e45a2A5E08B102C73efBB307466`
- Base Sepolia escrow: `0x728A280E9E2DD05320B8AbA89Cd7c4E79046Cc07`
- Base Sepolia USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- Owner, relayer, and first curator: `0x0f4CAd4b62DfcEce23a6e88565BFf83C703B28e2` (rotated 2026-11-01)
- Eligibility threshold: `40`

Both chains are testnets. The Base escrow is the sole custodian of USDC; GenLayer is the authoritative evaluation and grant ledger.

## Architecture decisions

- One Intelligent Contract owns GitHub identity verification, AI-validator impact scoring, manipulation screening, appeals, epochs, and deterministic quadratic grant settlement.
- Developer registration requires a public proof gist created through authenticated GitHub OAuth. Its owner and exact `{github, wallet}` payload are independently verified on-chain before a username is reserved.
- User actions are signed by the connected wallet. Only curator/admin operations and relay acknowledgements use trusted backend keys.
- Every Base deposit has a unique `depositId`. It remains pending until GenLayer accepts or rejects it; rejected or late deposits become exactly refundable.
- Accepted collateral cannot be withdrawn while active. Grants can only be allocated from accepted collateral.
- Relay scans are durable: deposits and claims are persisted in Postgres before cursors advance. Failed events remain retryable, and multi-grant claims in one transaction are supported.
- Settlement recovery verifies an existing Base allocation per wallet before retrying only the missing GenLayer acknowledgement.
- Client-side writes require successful transaction receipts, not transaction submission alone.

## Operations

- Fly runs one always-on backend machine with `/health` checks and automatic migrations at startup.
- The relay scans Base Sepolia in 200-block inclusive ranges to satisfy the public RPC limit.
- GitHub OAuth callback: `https://impactdna-milestone-api.fly.dev/api/auth/github/callback`
- Production secrets live only in Fly/Vercel configuration. Never commit private keys, OAuth client secrets, database URLs, JWT secrets, or provider credentials.
- Local Postgres uses port `5439`; copy the `.env.example` files for local development.

## Verification

- Python Intelligent Contract tests: 12 passing.
- Solidity escrow regression tests: 4 passing.
- Backend relay/receipt tests: 6 passing.
- Frontend production build: passing (third-party `ox` dynamic-import warnings remain non-fatal).
- A complete 1-USDC Base Sepolia deposit-to-claim run is recorded in `docs/MILESTONE-REMEDIATION.md`.
