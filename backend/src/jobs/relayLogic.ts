export interface GrantRecord {
  id: string;
  epoch: string;
  wallet: string;
  amount_usdc: string;
  claimed: boolean;
  claim_tx_hash?: string;
}

export function resolveEpochId(
  epochs: Array<Record<string, unknown>>, epochHash: string, hashEpochId: (id: string) => string,
): string | null {
  const target = epochHash.toLowerCase();
  for (const epoch of epochs) {
    const id = typeof epoch.id === "string" ? epoch.id : "";
    if (id && hashEpochId(id).toLowerCase() === target) return id;
  }
  return null;
}

export function depositResolution(epochId: string | null): "record" | "refund" {
  return epochId ? "record" : "refund";
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
