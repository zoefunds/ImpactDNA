export interface GrantRecord {
  id: string;
  epoch: string;
  wallet: string;
  amount_usdc: string;
  claimed: boolean;
  claim_tx_hash?: string;
}
/** Resolve one Base Claimed log against complete grant history. Includes
 * grants already acknowledged in the same Base tx so a crash midway through
 * a multi-grant acknowledgement remains retryable. */
export function grantsForClaim(
  grants: GrantRecord[], epochId: string, recipient: string, amount: bigint, baseTxHash: string,
): GrantRecord[] {
  const matches = grants.filter((grant) =>
    grant.epoch === epochId &&
    grant.wallet.toLowerCase() === recipient.toLowerCase() &&
    (!grant.claimed || grant.claim_tx_hash === baseTxHash),
  );
  const total = matches.reduce((sum, grant) => sum + BigInt(grant.amount_usdc), BigInt(0));
  return matches.length > 0 && total === amount ? matches : [];
}
