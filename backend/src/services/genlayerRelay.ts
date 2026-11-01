/**
 * GenLayer-side half of the Base Sepolia relay. Every write here uses the
 * relayer's own GenLayer identity (BASE_SEPOLIA_RELAYER_PRIVATE_KEY — the
 * same secp256k1 key also signs on Base Sepolia in services/baseSepolia.ts),
 * which the deployed contract must have been pointed at via set_relayer().
 * The contract enforces every one of these as relayer-only and idempotent on
 * the operation's durable identity: depositId for deposits, settlement hash
 * for allocations, and eventId for claims.
 */
import { config } from "../config.js";
import { contractRead, contractWrite, invalidateRead } from "../lib/genlayer.js";
import { logger } from "../lib/logger.js";
import { genlayerBooleanResult } from "../lib/genlayerReceipt.js";

export function isGenlayerRelayConfigured(): boolean {
  return Boolean(config.BASE_SEPOLIA_RELAYER_PRIVATE_KEY && config.GENLAYER_CONTRACT_ADDRESS);
}

export async function recordDepositOnGenlayer(
  epochId: string,
  depositor: string,
  amountUsdc: bigint,
  depositId: string,
): Promise<{ txHash: string; accepted: boolean }> {
  const res = await contractWrite(config.BASE_SEPOLIA_RELAYER_PRIVATE_KEY, "record_deposit", [
    epochId,
    depositor,
    Number(amountUsdc),
    depositId,
  ]);
  await invalidateRead("get_epoch", [epochId]);
  logger.info(
    { epochId, depositor, amountUsdc: amountUsdc.toString(), depositId, txHash: res.txHash },
    "recorded deposit on GenLayer",
  );
  const result = res.result;
  // StudioNet currently serializes GenVM dict returns in `readable` form
  // without JSON commas (for example {"accepted":true"epoch":"e-1"}).
  // Prefer the structured value when available, but tolerate that wire
  // representation so a successful deposit is never misclassified as late.
  const accepted = genlayerBooleanResult(result, "accepted");
  return { txHash: res.txHash, accepted };
}

export interface PendingRelayGrant {
  id: string;
  epoch: string;
  wallet: string;
  amount_usdc: string;
  relayed: boolean;
  claimed: boolean;
  claim_tx_hash?: string;
}

export async function getGrantsPendingRelay(epochId: string): Promise<PendingRelayGrant[]> {
  const res = (await contractRead("get_grants_pending_relay", [epochId], { skipCache: true })) as {
    items: PendingRelayGrant[];
  };
  return res.items ?? [];
}

export async function listEpochs(): Promise<{ items: Array<Record<string, unknown>>; current: string }> {
  return (await contractRead("list_epochs", [], { skipCache: true })) as {
    items: Array<Record<string, unknown>>;
    current: string;
  };
}

export async function listAllGrants(): Promise<PendingRelayGrant[]> {
  const out: PendingRelayGrant[] = [];
  let offset = 0;
  for (;;) {
    const page = (await contractRead("list_grants", [offset, 50], { skipCache: true })) as {
      total: number;
      items: PendingRelayGrant[];
    };
    out.push(...(page.items ?? []));
    offset += page.items?.length ?? 0;
    if (offset >= Number(page.total ?? 0) || !page.items?.length) return out;
  }
}

export async function markGrantsRelayedOnGenlayer(epochId: string, baseTxHash: string): Promise<string> {
  const res = await contractWrite(config.BASE_SEPOLIA_RELAYER_PRIVATE_KEY, "mark_grants_relayed", [
    epochId,
    baseTxHash,
  ]);
  await invalidateRead("get_grants_pending_relay", [epochId]);
  logger.info({ epochId, baseTxHash, txHash: res.txHash }, "marked epoch grants relayed on GenLayer");
  return res.txHash;
}

export async function markGrantClaimedOnGenlayer(grantId: string, baseTxHash: string, eventId: string): Promise<string> {
  const res = await contractWrite(config.BASE_SEPOLIA_RELAYER_PRIVATE_KEY, "mark_grant_claimed", [
    grantId,
    baseTxHash,
    eventId,
  ]);
  await invalidateRead("get_grant", [grantId]);
  logger.info({ grantId, baseTxHash, txHash: res.txHash }, "marked grant claimed on GenLayer");
  return res.txHash;
}
