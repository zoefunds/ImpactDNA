# Review: Treasury Accounting & Score-Consistency Fix

## Request

> Please separate reserved grant funds from available treasury funds so every
> closed-epoch allocation remains claimable without later deposits. Also
> enforce that dimensions, total, and the derived score bucket agree before
> the score can affect funding, with tests covering the full
> deposit-to-claim lifecycle.

## Status: Resolved

Both issues were fixed in `contracts/impact_dna.py`, covered by new tests in
`contracts/tests/`, verified live against the deployed contract
(`0x509382e2c63814aCD85ECA415251E8C1f92620F3`).

---

## 1. Reserved grant funds vs. available treasury

### The bug

`treasury_atto` was used for two purposes at once: the pool of undeployed
funds available to back a new epoch, *and* (implicitly) the backing for
grants already allocated by a closed epoch but not yet claimed. There was no
separate ledger for the latter.

Concretely:

- `open_epoch` subtracted the pool from `treasury_atto`.
- `close_epoch` allocated that pool to grants, and only ever added the
  *unallocated remainder* back to `treasury_atto`. The allocated portion —
  real GEN the contract already held, now owed to specific developers —
  was never tracked anywhere.
- `claim_grant` checked `amount > treasury_atto` to decide whether a claim
  could be paid.

Since `treasury_atto` at that point no longer included the allocated funds,
this check was comparing a claim against completely unrelated money. A grant
from a fully-allocated epoch (`treasury_atto == 0` right after `close_epoch`)
would immediately fail to claim — "Contract balance insufficient for
claim" — even though the contract was holding the exact GEN needed the
whole time. Depositing more, or a later epoch, could resolve or worsen this
by coincidence, but nothing tied the claim check to the actual reserved
amount.

### The fix

Added a second field, `reserved_atto`, that exclusively tracks funds
committed to unclaimed grants:

- `close_epoch` now moves the allocated amount into `reserved_atto` (only
  the true remainder returns to `treasury_atto`).
- `claim_grant` checks and debits `reserved_atto`, not `treasury_atto`.

This makes claimability of a closed epoch's grants independent of anything
that happens to the treasury afterward — new epochs, further deposits, or a
treasury balance of zero all leave `reserved_atto` (and therefore existing
claims) untouched.

`get_platform_info` also now surfaces `reserved_atto` alongside
`treasury_atto` so this distinction is visible off-chain (already consumed
by the admin panel / dashboard reads).

**Files:** `contracts/impact_dna.py` — `close_epoch`, `claim_grant`,
`get_platform_info`, storage field `reserved_atto`.

---

## 2. Dimensions / total / score-bucket agreement

### The bug

`evaluate_contribution` computed dimension scores, a `total`, and a
`bucket` all in one place (`_run_impact_analysis` → `_bucket(total)`), so
under normal operation they were consistent by construction. But nothing
enforced that invariant explicitly, and `close_epoch` read the *persisted*
`score_total` back out of storage to compute quadratic grant weights
without re-checking it against the dimensions or bucket that were stored
alongside it. A corrupted record — from a future write path, a storage
migration, or any code that touches a contribution record after evaluation
— could silently skew funding with no failure at the point it mattered.

### The fix

Added `_validate_score_consistency(dims, total, bucket)`, which asserts:

- the five dimension scores sum to the recorded `total`, and
- `bucket == _bucket(total)`.

It's called in two places:

- **`evaluate_contribution`**, right after consensus resolves a score,
  before it's persisted — catches a bad score at the moment it's written.
- **`close_epoch`**, on every contribution's stored record, right before
  computing its grant weight — catches a bad score at the moment it would
  affect funding, independent of how it got that way.

Either check failing raises a classified `[EXPECTED]` error rather than
allowing settlement to proceed.

**Files:** `contracts/impact_dna.py` — `_validate_score_consistency`,
`evaluate_contribution`, `close_epoch`.

---

## 3. Tests

Added `contracts/tests/` with a minimal in-process stand-in for the
`genlayer` runtime (`fake_genlayer.py` — fakes `TreeMap`/`DynArray` storage
provisioning, `gl.public.write/view`, `gl.vm.run_nondet_unsafe` collapsed to
a single leader run, `gl.eq_principle.strict_eq`, and `gl.nondet.web.get` /
`gl.nondet.exec_prompt` as per-test mocks), since no `genlayer` package is
installed locally and consensus itself is out of scope for these tests.

`test_impact_dna.py` covers:

- **`test_full_deposit_to_claim_lifecycle`** — deposit → register →
  verify → submit → evaluate → open/close epoch → claim, asserting the
  grant is correctly funded and claimed, and a second claim attempt is
  rejected.
- **`test_closed_epoch_grant_stays_claimable_without_further_deposits`** —
  the exact regression from issue 1: treasury fully drained by a single
  epoch, grant still claimable because it lives in `reserved_atto`.
- **`test_two_epochs_dont_let_second_drain_first_grants_claimability`** —
  a second epoch draining `treasury_atto` to zero does not affect the
  claimability of a grant from an earlier, already-closed epoch.
- **`test_bucket_helper_matches_total_boundaries`** — sanity-checks the
  bucket boundaries themselves (0–24 / 25–49 / 50–74 / 75–100).
- **`test_evaluate_contribution_rejects_inconsistent_dimension_sum`** —
  a tampered result with a bucket that doesn't match its own total is
  rejected at evaluation time.
- **`test_close_epoch_revalidates_score_consistency_on_stored_records`** —
  a persisted record corrupted after evaluation (simulating any future
  write path) is caught at `close_epoch` time, before it can affect grant
  weights.

All 6 tests pass:

```
cd contracts/tests && python3 -m pytest -q
......                                                                   [100%]
6 passed in 0.03s
```

---

## Verification against the live contract

- Fix implemented and tested locally, then the fixed contract source was
  deployed to `0x509382e2c63814aCD85ECA415251E8C1f92620F3` on GenLayer
  StudioNet.
- Backend (`impactdna-api-zoe.fly.dev`) and frontend (`impactdna.vercel.app`)
  both point at this address (`GENLAYER_CONTRACT_ADDRESS`).
- Manual on-chain testing against the deployed contract confirmed correct
  behavior (per direct user verification).
