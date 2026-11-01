/** Pure helpers for the receipt variants returned by GenLayer StudioNet. */
export function genlayerReceiptStatus(receipt: Record<string, unknown>): string {
  return String(receipt.statusName ?? receipt.status_name ?? receipt.status ?? "UNKNOWN");
}

export function genlayerReceiptReturnValue(receipt: Record<string, unknown>): unknown {
  const consensus = receipt.consensus_data;
  if (!consensus || typeof consensus !== "object") return null;
  const leaders = (consensus as Record<string, unknown>).leader_receipt;
  if (!Array.isArray(leaders)) return null;
  for (const entry of leaders) {
    if (!entry || typeof entry !== "object") continue;
    const result = (entry as Record<string, unknown>).result;
    if (!result || typeof result !== "object") continue;
    const payload = (result as Record<string, unknown>).payload;
    if (!payload || typeof payload !== "object") continue;
    const readable = (payload as Record<string, unknown>).readable;
    if (typeof readable !== "string") continue;
    try {
      return JSON.parse(readable);
    } catch {
      // GenVM's current readable form omits commas between dict entries.
      return readable;
    }
  }
  return null;
}

/** FINALIZED only describes consensus finality. A reverted GenVM call may
 * also finalize, so require the canonical successful leader execution. */
export function assertGenlayerReceiptSucceeded(receipt: Record<string, unknown>): void {
  const status = genlayerReceiptStatus(receipt).toUpperCase();
  if (status !== "FINALIZED") throw new Error(`GenLayer transaction was not finalized (${status})`);
  const consensus = receipt.consensus_data;
  if (!consensus || typeof consensus !== "object") throw new Error("GenLayer receipt has no consensus result");
  const data = consensus as Record<string, unknown>;
  if (data.error) throw new Error(String(data.error));
  const leaders = data.leader_receipt;
  if (!Array.isArray(leaders) || leaders.length === 0) throw new Error("GenLayer receipt has no leader execution result");
  const successful = leaders.some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const leader = entry as Record<string, unknown>;
    const result = leader.result;
    return String(leader.execution_result ?? "").toUpperCase() === "SUCCESS"
      && !!result && typeof result === "object"
      && String((result as Record<string, unknown>).status ?? "").toLowerCase() === "return";
  });
  if (!successful) throw new Error("GenLayer transaction finalized without FINISHED_WITH_RETURN");
}

export function genlayerBooleanResult(value: unknown, key: string): boolean {
  if (value && typeof value === "object") {
    return (value as Record<string, unknown>)[key] === true;
  }
  if (typeof value !== "string") return false;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`["']${escaped}["']\\s*:\\s*true\\b`, "i").test(value);
}
