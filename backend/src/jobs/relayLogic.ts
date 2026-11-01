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

export function depositEventId(baseTxHash: string, logIndex: number): string {
  return `${baseTxHash.toLowerCase()}:${logIndex}`;
}

export interface PendingDepositRow {
  event_id: string;
  base_tx_hash: string;
  deposit_id: string;
  epoch_id: string | null;
  depositor: string;
  amount_usdc: string;
}

export interface DepositApplyResult {
  eventId: string;
  depositId: string;
  appliedTx: string | null;
  reconciliationTx: string;
}

/** Apply every durable deposit event independently. Transaction hash is
 * deliberately metadata only: batched Deposited logs share it but must never
 * share retry or completion state. */
export async function reconcileDepositRows(
  rows: PendingDepositRow[],
  record: (row: PendingDepositRow) => Promise<{ txHash: string | null; accepted: boolean }>,
  reconcile: (depositId: string, accepted: boolean) => Promise<string>,
): Promise<DepositApplyResult[]> {
  const results: DepositApplyResult[] = [];
  for (const row of rows) {
    const applied = depositResolution(row.epoch_id) === "record"
      ? await record(row)
      : { txHash: null, accepted: false };
    const reconciliationTx = await reconcile(row.deposit_id, applied.accepted);
    results.push({
      eventId: row.event_id,
      depositId: row.deposit_id,
      appliedTx: applied.txHash,
      reconciliationTx,
    });
  }
  return results;
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
