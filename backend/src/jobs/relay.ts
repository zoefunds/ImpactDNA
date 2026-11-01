/**
 * Base Sepolia <-> GenLayer relay.
 *
 * Three passes, each idempotent and independently retryable:
 *
 *  1. scanDeposits    — read new confirmed Deposited() events off the
 *     escrow into `pending_deposits`, then apply each unapplied row to
 *     GenLayer via record_deposit(). A crash between "deposit confirmed"
 *     and "GenLayer write landed" just gets retried next tick.
 *  2. relayClosedEpochGrants — for every GenLayer epoch, ask
 *     get_grants_pending_relay(); if any exist, push them to the
 *     escrow's setGrants() and mark them relayed on GenLayer.
 *  3. scanClaims      — read new confirmed Claimed() events off the
 *     escrow and mirror them onto GenLayer via mark_grant_claimed().
 *
 * All three are guarded by a Redis single-flight lock (withLock) so
 * multiple Fly machines running the same cron never double-relay.
 */
import { ethers } from "ethers";
import { query } from "../db.js";
import { logger } from "../lib/logger.js";
import { config } from "../config.js";
import { withLock } from "../redis.js";
import { IMPACT_DNA_ESCROW_ABI } from "../lib/escrowAbi.js";
import { getProviderForScan, isEscrowConfigured, relayGrantsToEscrow, reconcileEscrowDeposit, settleEmptyEscrowEpoch } from "../services/baseSepolia.js";
import {
  isGenlayerRelayConfigured,
  listEpochs,
  getGrantsPendingRelay,
  markGrantsRelayedOnGenlayer,
  markGrantClaimedOnGenlayer,
  recordDepositOnGenlayer,
  listAllGrants,
} from "../services/genlayerRelay.js";
import { grantsForClaim } from "./relayLogic.js";

const DEPOSITED_BLOCK_KEY = "relay:lastScannedDepositBlock";
const CLAIMED_BLOCK_KEY = "relay:lastScannedClaimBlock";
// Base's public RPC accepts at most 200 inclusive blocks per eth_getLogs.
const MAX_BLOCK_RANGE = 199;

async function getSyncState(key: string): Promise<string | null> {
  const res = await query<{ value: string }>("SELECT value FROM relay_sync_state WHERE key = $1", [key]);
  return res.rows[0]?.value ?? null;
}

async function setSyncState(key: string, value: string): Promise<void> {
  await query(
    `INSERT INTO relay_sync_state (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
    [key, value],
  );
}

function isConfigured(): boolean {
  return isEscrowConfigured() && isGenlayerRelayConfigured();
}

export async function scanDeposits(): Promise<void> {
  const provider = getProviderForScan();
  const escrow = new ethers.Contract(config.IMPACT_DNA_ESCROW_ADDRESS, IMPACT_DNA_ESCROW_ABI, provider);
  const head = await provider.getBlockNumber();
  const safeHead = head - config.BASE_SEPOLIA_DEPOSIT_CONFIRMATIONS;
  if (safeHead < 0) return;

  const stored = await getSyncState(DEPOSITED_BLOCK_KEY);
  const fromBlock = stored ? Number(stored) + 1 : Math.max(0, safeHead - MAX_BLOCK_RANGE);
  if (fromBlock > safeHead) return;
  const toBlock = Math.min(safeHead, fromBlock + MAX_BLOCK_RANGE);

  const events = await escrow.queryFilter(escrow.filters.Deposited(), fromBlock, toBlock);
  if (events.length) {
    const { items } = await listEpochs();
    const hashToId = new Map(items.map((e) => [ethers.id(e.id as string), e.id as string]));
    for (const ev of events) {
      if (!("args" in ev) || !ev.args) continue;
      const baseTxHash = ev.transactionHash.toLowerCase();
      const depositId = ev.args.depositId as string;
      const epochId = hashToId.get(ev.args.epochId as string);
      if (!epochId) {
        logger.warn({ escrowEpochHash: ev.args.epochId, baseTxHash }, "deposit event doesn't match any known epoch; skipping");
        continue;
      }
      await query(
        `INSERT INTO pending_deposits (base_tx_hash, deposit_id, epoch_id, depositor, amount_usdc, block_number)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (base_tx_hash) DO NOTHING`,
        [baseTxHash, depositId, epochId, ev.args.from as string, (ev.args.amount as bigint).toString(), ev.blockNumber],
      );
    }
  }
  if (events.length) {
    logger.info({ count: events.length, fromBlock, toBlock }, "confirmed USDC deposits detected");
  }
  await setSyncState(DEPOSITED_BLOCK_KEY, String(toBlock));
}

export async function applyPendingDeposits(): Promise<void> {
  const rows = await query<{
    base_tx_hash: string;
    deposit_id: string;
    epoch_id: string;
    depositor: string;
    amount_usdc: string;
    attempts: number;
  }>(
    `SELECT base_tx_hash, deposit_id, epoch_id, depositor, amount_usdc, attempts FROM pending_deposits
     WHERE status = 'pending' ORDER BY created_at ASC LIMIT 25`,
  );
  for (const row of rows.rows) {
    try {
      if (!row.deposit_id) throw new Error("legacy deposit lacks a reconciliation id");
      const applied = await recordDepositOnGenlayer(row.epoch_id, row.depositor, BigInt(row.amount_usdc), row.deposit_id);
      const reconciliationTx = await reconcileEscrowDeposit(row.deposit_id, applied.accepted);
      await query(
        `UPDATE pending_deposits SET status = 'applied', applied_tx = $2, reconciliation_tx = $3, updated_at = now() WHERE base_tx_hash = $1`,
        [row.base_tx_hash, applied.txHash, reconciliationTx],
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await query(
        `UPDATE pending_deposits SET attempts = attempts + 1, last_error = $2, updated_at = now() WHERE base_tx_hash = $1`,
        [row.base_tx_hash, message],
      );
      logger.error({ err: message, baseTxHash: row.base_tx_hash }, "deposit apply failed; will retry");
    }
  }
}

export async function relayClosedEpochGrants(): Promise<void> {
  const { items } = await listEpochs();
  for (const epoch of items) {
    if (epoch.status !== "closed") continue;
    const epochId = epoch.id as string;
    const pending = await getGrantsPendingRelay(epochId);
    if (pending.length === 0 && (epoch.relayed === true || BigInt(String(epoch.allocated_usdc ?? "0")) > 0n)) continue;
    const prior = await query<{ base_tx_hash: string }>(
      "SELECT base_tx_hash FROM epoch_settlements WHERE epoch_id = $1 AND base_tx_hash IS NOT NULL",
      [epochId],
    );
    const knownTxHash = prior.rows[0]?.base_tx_hash;
    const txHash = pending.length > 0
      ? await relayGrantsToEscrow(
          epochId,
          pending.map((g) => ({ grant: g.id, wallet: g.wallet, amount_usdc: g.amount_usdc })),
          knownTxHash,
        )
      : await settleEmptyEscrowEpoch(epochId, knownTxHash);
    await query(
      `INSERT INTO epoch_settlements (epoch_id, base_tx_hash, settlement_kind, updated_at)
       VALUES ($1,$2,$3,now()) ON CONFLICT (epoch_id) DO UPDATE SET base_tx_hash=$2, settlement_kind=$3, updated_at=now()`,
      [epochId, txHash, pending.length > 0 ? "grants" : "empty"],
    );
    await markGrantsRelayedOnGenlayer(epochId, txHash);
    await query("UPDATE epoch_settlements SET genlayer_marked_at=now(), updated_at=now() WHERE epoch_id=$1", [epochId]);
  }
}

export async function scanClaims(): Promise<void> {
  const provider = getProviderForScan();
  const escrow = new ethers.Contract(config.IMPACT_DNA_ESCROW_ADDRESS, IMPACT_DNA_ESCROW_ABI, provider);
  const head = await provider.getBlockNumber();
  const safeHead = head - config.BASE_SEPOLIA_DEPOSIT_CONFIRMATIONS;
  if (safeHead < 0) return;

  const stored = await getSyncState(CLAIMED_BLOCK_KEY);
  const fromBlock = stored ? Number(stored) + 1 : Math.max(0, safeHead - MAX_BLOCK_RANGE);
  if (fromBlock > safeHead) return;
  const toBlock = Math.min(safeHead, fromBlock + MAX_BLOCK_RANGE);

  const events = await escrow.queryFilter(escrow.filters.Claimed(), fromBlock, toBlock);
  for (const ev of events) {
    if (!("args" in ev) || !ev.args) continue;
    const baseTxHash = ev.transactionHash.toLowerCase();
    const logIndex = Number(ev.index);
    const eventId = `${baseTxHash}:${logIndex}`;
    await query(
      `INSERT INTO pending_claims (event_id, base_tx_hash, epoch_hash, recipient, amount_usdc, block_number, log_index)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (event_id) DO NOTHING`,
      [eventId, baseTxHash, ev.args.epochId as string, (ev.args.recipient as string).toLowerCase(),
       (ev.args.amount as bigint).toString(), ev.blockNumber, logIndex],
    );
  }
  await setSyncState(CLAIMED_BLOCK_KEY, String(toBlock));
}

export async function applyPendingClaims(): Promise<void> {
  const pending = await query<{
    event_id: string; base_tx_hash: string; epoch_hash: string; recipient: string; amount_usdc: string;
  }>(`SELECT event_id, base_tx_hash, epoch_hash, recipient, amount_usdc FROM pending_claims
      WHERE status = 'pending' ORDER BY block_number, log_index LIMIT 50`);
  if (!pending.rowCount) return;
  const [grants, epochs] = await Promise.all([listAllGrants(), listEpochs()]);
  const epochByHash = new Map(epochs.items.map((e) => [ethers.id(String(e.id)), String(e.id)]));
  for (const row of pending.rows) {
    try {
      const epochId = epochByHash.get(row.epoch_hash);
      if (!epochId) throw new Error(`unknown epoch hash ${row.epoch_hash}`);
      const matches = grantsForClaim(grants, epochId, row.recipient, BigInt(row.amount_usdc), row.base_tx_hash);
      if (!matches.length) {
        throw new Error(`complete grant records do not match claim ${row.event_id}`);
      }
      let txHash = "";
      for (const match of matches) {
        if (match.claimed) continue;
        txHash = await markGrantClaimedOnGenlayer(match.id, row.base_tx_hash, `${row.event_id}:${match.id}`);
        match.claimed = true;
        match.claim_tx_hash = row.base_tx_hash;
      }
      await query(`UPDATE pending_claims SET status='applied', grant_id=$2, applied_tx=$3, updated_at=now() WHERE event_id=$1`,
        [row.event_id, matches.map((g) => g.id).join(","), txHash || "already-applied"]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await query(`UPDATE pending_claims SET attempts=attempts+1, last_error=$2, updated_at=now() WHERE event_id=$1`,
        [row.event_id, message]);
      logger.error({ err: message, eventId: row.event_id }, "claim acknowledgment failed; persisted for retry");
    }
  }
}

export async function runRelayTick(): Promise<void> {
  if (!isConfigured()) return;
  await withLock("base-sepolia-relay", 120, async () => {
    await scanDeposits().catch((err) => logger.error({ err }, "scanDeposits failed"));
    await applyPendingDeposits().catch((err) => logger.error({ err }, "applyPendingDeposits failed"));
    await relayClosedEpochGrants().catch((err) => logger.error({ err }, "relayClosedEpochGrants failed"));
    await scanClaims().catch((err) => logger.error({ err }, "scanClaims failed"));
    await applyPendingClaims().catch((err) => logger.error({ err }, "applyPendingClaims failed"));
  });
}

export function startRelayLoop(): void {
  if (!isConfigured()) {
    logger.warn("Base Sepolia relay disabled: escrow or relayer key not configured");
    return;
  }
  const tick = () => void runRelayTick();
  tick();
  setInterval(tick, config.RELAY_POLL_INTERVAL_MS).unref();
}
