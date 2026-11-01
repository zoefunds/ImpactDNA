export function assertGenlayerReceiptSucceeded(receipt: Record<string, unknown>): void {
  const status = String(receipt.statusName ?? receipt.status_name ?? receipt.status ?? "UNKNOWN").toUpperCase();
  if (status !== "FINALIZED") throw new Error(`GenLayer transaction was not finalized (${status})`);
  const consensus = receipt.consensus_data;
  if (!consensus || typeof consensus !== "object") throw new Error("GenLayer receipt has no consensus result");
  const data = consensus as Record<string, unknown>;
  if (data.error) throw new Error(String(data.error));
  const leaders = data.leader_receipt;
  const successful = Array.isArray(leaders) && leaders.some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const leader = entry as Record<string, unknown>;
    const result = leader.result;
    return String(leader.execution_result ?? "").toUpperCase() === "SUCCESS"
      && !!result && typeof result === "object"
      && String((result as Record<string, unknown>).status ?? "").toLowerCase() === "return";
  });
  if (!successful) throw new Error("GenLayer transaction finalized without FINISHED_WITH_RETURN");
}
