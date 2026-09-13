/**
 * GenLayer-side half of the Base Sepolia relay. Every write here uses the
 * relayer's own GenLayer identity (BASE_SEPOLIA_RELAYER_PRIVATE_KEY — the
 * same secp256k1 key also signs on Base Sepolia in services/baseSepolia.ts),
 * which the deployed contract must have been pointed at via set_relayer().
 * The contract enforces every one of these as relayer-only and idempotent
 * on base_tx_hash, so this module never has to worry about double-applying
 * a retried call.
 */
import { config } from "../config.js";
import { contractRead, contractWrite, invalidateRead } from "../lib/genlayer.js";
import { logger } from "../lib/logger.js";

export function isGenlayerRelayConfigured(): boolean {
  return Boolean(config.BASE_SEPOLIA_RELAYER_PRIVATE_KEY && config.GENLAYER_CONTRACT_ADDRESS);
}

export async function recordDepositOnGenlayer(
  epochId: string,
  depositor: string,
  amountUsdc: bigint,
  baseTxHash: string,
): Promise<string> {
  const res = await contractWrite(config.BASE_SEPOLIA_RELAYER_PRIVATE_KEY, "record_deposit", [
    epochId,
    depositor,
    Number(amountUsdc),
    baseTxHash,
  ]);
  await invalidateRead("get_epoch", [epochId]);
  logger.info(
    { epochId, depositor, amountUsdc: amountUsdc.toString(), baseTxHash, txHash: res.txHash },
    "recorded deposit on GenLayer",
  );
  return res.txHash;
}

export interface PendingRelayGrant {
  id: string;
  wallet: string;
  amount_usdc: string;
  relayed: boolean;
  claimed: boolean;
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

export async function markGrantsRelayedOnGenlayer(epochId: string, baseTxHash: string): Promise<string> {
  const res = await contractWrite(config.BASE_SEPOLIA_RELAYER_PRIVATE_KEY, "mark_grants_relayed", [
    epochId,
    baseTxHash,
  ]);
  await invalidateRead("get_grants_pending_relay", [epochId]);
  logger.info({ epochId, baseTxHash, txHash: res.txHash }, "marked epoch grants relayed on GenLayer");
  return res.txHash;
}

export async function markGrantClaimedOnGenlayer(grantId: string, baseTxHash: string): Promise<string> {
  const res = await contractWrite(config.BASE_SEPOLIA_RELAYER_PRIVATE_KEY, "mark_grant_claimed", [
    grantId,
    baseTxHash,
  ]);
  await invalidateRead("get_grant", [grantId]);
  logger.info({ grantId, baseTxHash, txHash: res.txHash }, "marked grant claimed on GenLayer");
  return res.txHash;
}
