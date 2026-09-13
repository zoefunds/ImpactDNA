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
import { getProviderForScan, isEscrowConfigured, relayGrantsToEscrow } from "../services/baseSepolia.js";
import {
  isGenlayerRelayConfigured,
  listEpochs,
  getGrantsPendingRelay,
  markGrantsRelayedOnGenlayer,
  markGrantClaimedOnGenlayer,
  recordDepositOnGenlayer,
} from "../services/genlayerRelay.js";

const DEPOSITED_BLOCK_KEY = "relay:lastScannedDepositBlock";
const CLAIMED_BLOCK_KEY = "relay:lastScannedClaimBlock";
const MAX_BLOCK_RANGE = 2000;

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
      const epochId = hashToId.get(ev.args.epochId as string);
      if (!epochId) {
        logger.warn({ escrowEpochHash: ev.args.epochId, baseTxHash }, "deposit event doesn't match any known epoch; skipping");
        continue;
      }
      await query(
        `INSERT INTO pending_deposits (base_tx_hash, epoch_id, depositor, amount_usdc, block_number)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (base_tx_hash) DO NOTHING`,
        [baseTxHash, epochId, ev.args.from as string, (ev.args.amount as bigint).toString(), ev.blockNumber],
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
    epoch_id: string;
    depositor: string;
    amount_usdc: string;
    attempts: number;
  }>(
    `SELECT base_tx_hash, epoch_id, depositor, amount_usdc, attempts FROM pending_deposits
     WHERE status = 'pending' ORDER BY created_at ASC LIMIT 25`,
  );
  for (const row of rows.rows) {
    try {
      const txHash = await recordDepositOnGenlayer(row.epoch_id, row.depositor, BigInt(row.amount_usdc), row.base_tx_hash);
      await query(
        `UPDATE pending_deposits SET status = 'applied', applied_tx = $2, updated_at = now() WHERE base_tx_hash = $1`,
        [row.base_tx_hash, txHash],
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
    if (pending.length === 0) continue;

    const txHash = await relayGrantsToEscrow(
      epochId,
      pending.map((g) => ({ grant: g.id, wallet: g.wallet, amount_usdc: g.amount_usdc })),
    );
    await markGrantsRelayedOnGenlayer(epochId, txHash);
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
    // The escrow only knows (epochId, recipient) — resolve to a grant id
    // via GenLayer's grant records is unnecessary here: mark_grant_claimed
    // takes a grant_id, so instead we look it up by scanning the closed
    // epoch's grant list for a matching wallet. Cheap: epochs are small.
    const epochId = ev.args.epochId as string;
    const recipient = (ev.args.recipient as string).toLowerCase();
    const { items } = await listEpochs();
    const epoch = items.find((e) => e.id === epochId || ethers.id(e.id as string) === epochId);
    if (!epoch) continue;
    const grantIds = (epoch.grant_ids as string[]) ?? [];
    for (const gid of grantIds) {
      const pending = await getGrantsPendingRelay(epoch.id as string).catch(() => []);
      const match = pending.find((g) => g.id === gid && g.wallet.toLowerCase() === recipient);
      if (match) {
        await markGrantClaimedOnGenlayer(gid, baseTxHash).catch((err) =>
          logger.error({ err, gid, baseTxHash }, "mark_grant_claimed failed; will retry next tick"),
        );
      }
    }
  }
  await setSyncState(CLAIMED_BLOCK_KEY, String(toBlock));
}

export async function runRelayTick(): Promise<void> {
  if (!isConfigured()) return;
  await withLock("base-sepolia-relay", 120, async () => {
    await scanDeposits().catch((err) => logger.error({ err }, "scanDeposits failed"));
    await applyPendingDeposits().catch((err) => logger.error({ err }, "applyPendingDeposits failed"));
    await relayClosedEpochGrants().catch((err) => logger.error({ err }, "relayClosedEpochGrants failed"));
    await scanClaims().catch((err) => logger.error({ err }, "scanClaims failed"));
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
