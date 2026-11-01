# ImpactDNA steward review closure

Last verified: 2026-11-01.

All findings from the identity, scoring, escrow, relay, settlement-recovery,
transaction-confirmation, and operator-key reviews are resolved in the current
testnet release. Detailed regression names and archived transaction evidence
are in [`docs/MILESTONE-REMEDIATION.md`](docs/MILESTONE-REMEDIATION.md).

## Current deployments

| Component | Deployment |
|---|---|
| Frontend | `https://impactdna.vercel.app` |
| Backend | `https://impactdna-milestone-api.fly.dev` |
| GenLayer StudioNet | `0xC7606d65963A7e45a2A5E08B102C73efBB307466` |
| Base Sepolia escrow | `0x728A280E9E2DD05320B8AbA89Cd7c4E79046Cc07` |
| Base Sepolia USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Owner / relayer / first curator | `0x0f4CAd4b62DfcEce23a6e88565BFf83C703B28e2` |

The former operator key has been retired. Both live backend signing variables
resolve to the rotated address above. Fly migration `009` is applied and the
Vercel production deployment is Ready.

## Finding closure

- **Wallet-bound GitHub ownership:** authenticated OAuth creates a public proof
  gist whose owner and exact `{github, wallet}` payload are verified through
  GenLayer consensus before the username is reserved. Impersonation and
  username-squatting attempts are regression-tested.
- **Mathematically consistent score caps:** fork and non-owner caps modify the
  five dimensions first, then recompute total and bucket. Consistency is checked
  both at evaluation and before settlement, including fork, non-owner, and
  threshold-boundary tests.
- **Deposit lifecycle safety:** Base deposits are uniquely identified and remain
  pending until reconciled as accepted or refundable. Late deposits receive an
  exact refund path, and active accepted collateral cannot be withdrawn.
- **Zero-allocation terminal outcome:** a funded closed epoch with no eligible
  recipients is finalized through relayer-only `settleEmptyEpoch`. This unlocks
  only its unallocated balance and is covered in both GenLayer and Foundry tests.
- **Durable claims:** claim logs are persisted before scan cursors advance,
  matched against complete grant records, and support several grants represented
  by one Base transaction.
- **Partial-settlement recovery:** the original Base settlement hash is stored
  in `epoch_settlements`; retries verify on-chain totals and per-wallet grants.
  The fallback event query is bounded to the public RPC's 200-block limit.
- **Execution-aware confirmation:** browser and backend clients require
  `FINALIZED`, `execution_result=SUCCESS`, and `result.status=return`. A
  finalized execution error is explicitly regression-tested and rejected.

## Verification

- Intelligent Contract: 13 tests passing.
- Base escrow: 5 Foundry tests passing.
- Backend: TypeScript build plus 7 relay/receipt tests passing.
- Frontend: optimized production build passing; only the documented non-fatal
  third-party `ox` dynamic-import warning remains.
- Production: Fly health check passing, migration `009` applied, Vercel Ready,
  and both public contract addresses present in the live documentation page.

The currently advertised networks remain GenLayer StudioNet and Base Sepolia;
they are testnets, not a mainnet or real-value deployment.
