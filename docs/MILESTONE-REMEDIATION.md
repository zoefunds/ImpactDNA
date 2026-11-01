# GenLayer milestone remediation

This milestone closes the identity, scoring, escrow, relay, and confirmation findings from the steward review.

## Reproducible evidence

Run from the repository root:

```bash
python3 -m pytest contracts/tests -q
(cd contracts/base && forge test -vv)
(cd backend && npm run build && npm test)
(cd frontend && npm run build)
```

The end-to-end ledger scenario is `test_full_deposit_to_claim_lifecycle`: it opens an epoch, records a reconciled USDC deposit, registers a wallet-bound GitHub identity, evaluates a repository, closes the epoch, relays its grants, and acknowledges the Base claim. The escrow companion test `testOnlyAcceptedDepositsBackGrantsAndClaims` transfers mock USDC through deposit, reconciliation, allocation, recipient claim, and exact late-deposit refund.

## Review finding → evidence

- GitHub identity: registration now requires a public proof gist created through authenticated GitHub OAuth. Validators independently verify the gist owner and its exact `{github, wallet}` payload before the username is reserved. `test_registration_rejects_impersonation_and_does_not_squat_username` covers impersonation and squatting.
- Score consistency: deterministic caps reduce dimension values themselves, then derive the total and bucket. Parametrized fork/non-owner tests cover caps and the existing bucket tests cover threshold boundaries.
- Deposit safety: every Base deposit has a unique `depositId` and remains pending until the relayer records GenLayer's accepted/rejected outcome. Rejected late deposits are exactly refundable. Active collateral cannot be owner-withdrawn, and only accepted deposits back grants.
- Claim relay: confirmed claim logs are persisted before the scan cursor advances. Matching uses complete grant history, supports multiple grants in one Base claim event, and uses a unique event/grant id for idempotent acknowledgements.
- Settlement recovery: when Base already has grants, the relayer verifies total allocation and immutable per-wallet assigned amounts, finds the original `GrantsSet` transaction, and only retries the missing GenLayer acknowledgement.
- Transaction confirmation: Base writes require successful receipts and GenLayer writes wait for `FINALIZED`, rejecting consensus errors.

## Deployment order

These are protocol interface changes and require coordinated redeployment:

1. Deploy the updated Base escrow and set its relayer.
2. Deploy the updated Intelligent Contract and set the same relayer identity.
3. Apply backend migrations `007` and `008`, then deploy the backend with both new addresses.
4. Deploy the frontend with the new escrow and Intelligent Contract addresses.
5. Reconnect GitHub accounts created before this milestone so OAuth can create their wallet-proof gist.

## Live Base Sepolia deposit-to-claim evidence

Completed on 2026-11-01 against the milestone deployments:

- GenLayer StudioNet contract: `0x18de100d155851cb179a6dF17f301C158aDed0AC`
- Base Sepolia escrow: `0xB5777c54047DF43024650197B560A227e35f25B8`
- Epoch / contribution / grant: `e-2` / `c-2` / `g-1`
- Recipient: `0x7401c129EDfc26E68FE19309fE461eb3Db1058Eb`
- Amount: `1,000,000` USDC base units (1 test USDC)

Transaction chain:

1. USDC approval: `0xfea4ef1e3260318c00cf275b9eafba38a47048a0e3d1e635125bccb4771bfc17`
2. Base deposit: `0xd645efbbda79b40b321c772e7083e4ff1e6a3759ed56c5a2f3f440634cb3d10f`
3. GenLayer deposit record: `0xa2d226d9b027bac1a0169f050a624d2798a579d1841973f0fbe7d570f65e512e`
4. Base `setGrants`: `0x98e4dccb734a0ff7e4b154113b87d5cae70304d33297b70657ca10c6628c2ba9`
5. GenLayer relay acknowledgement: `0x6688e93d822b97f997a45f10efb1c7b119debae7b350db2cb413d3efe2c967d6`
6. Base claim: `0x1dc434757c1626707938586b9ca5d13438c7d7b3e6c775af6d2a118b01bc6bae`
7. GenLayer claim acknowledgement: `0x9978a523a56f9b8460ca9ba6cd721eb856806dd4012153dca4ec62f0e3786db3`

Before/after recipient USDC balances were `102,139,500` and `103,139,500` base units. The final Base claimable balance is zero. GenLayer `get_grant("g-1")` reports `relayed=true`, `claimed=true`, and the Base relay/claim hashes above. The production eligibility threshold was restored to `40` before funding and remained `40` at final verification.

The same run also exercised late-deposit recovery while correcting a StudioNet SDK receipt-shape mismatch: refundable deposit `0x2e6732122f038115d1a83934340b46d9f0acb2e732a612160209cd7f74cd31a6` was returned in Base transaction `0x74dc65a7ac28033284661d1d3f14d941c0b127ed95e1bbc1dcb4e739bc9dacc9`. Receipt parsing now has dedicated regression coverage for StudioNet's snake-case status and comma-less readable return payload.
