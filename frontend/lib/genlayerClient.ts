"use client";

/**
 * Client-side GenLayer writes, signed directly by the user's own
 * connected wallet — the same wallet used for Base Sepolia. genlayer-js's
 * createClient accepts a generic EIP-1193 `provider` for exactly this
 * (see genlayer-js/dist/index.d.ts: ClientConfig.provider), so no
 * server-held private key is involved in any per-user action
 * (submit_contribution, evaluate_contribution, request_appeal,
 * register_developer, verify_developer, open_epoch, close_epoch).
 */
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { getAccount } from "@wagmi/core";
import { wagmiConfig } from "./wallet";
import { ensureChain, GENLAYER_STUDIONET } from "./chainSwitch";

const GENLAYER_CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_GENLAYER_CONTRACT_ADDRESS ?? "";

async function getBrowserGenlayerClient() {
  const account = getAccount(wagmiConfig);
  if (!account.address || !account.connector) {
    throw new Error("Connect your wallet first");
  }
  const provider = await account.connector.getProvider();
  // The wallet must actually be switched to StudioNet before signing —
  // otherwise it silently signs/sends against whatever chain it's
  // currently on (Base Sepolia), which is wrong for a GenLayer call.
  await ensureChain(provider as never, GENLAYER_STUDIONET);
  return createClient({
    chain: studionet,
    account: account.address,
    provider: provider as never,
  });
}

export interface GenlayerWriteResult {
  txHash: string;
  result: unknown;
}

/** Submit a GenLayer contract write, signed by the connected wallet, and
 * wait for consensus acceptance before returning. */
export async function genlayerWrite(
  functionName: string,
  args: unknown[] = [],
): Promise<GenlayerWriteResult> {
  if (!GENLAYER_CONTRACT_ADDRESS) {
    throw new Error("GenLayer contract address is not configured (NEXT_PUBLIC_GENLAYER_CONTRACT_ADDRESS)");
  }
  const client = await getBrowserGenlayerClient();
  const txHash = await client.writeContract({
    address: GENLAYER_CONTRACT_ADDRESS,
    functionName,
    args: args as never[],
  } as never);
  const receipt = await client.waitForTransactionReceipt({
    hash: txHash,
    status: "ACCEPTED" as never,
    retries: 60,
    interval: 3000,
  } as never);
  const r = receipt as unknown as Record<string, unknown>;
  return { txHash: String(txHash), result: r?.consensus_data ?? null };
}

export async function genlayerRead(functionName: string, args: unknown[] = []): Promise<unknown> {
  if (!GENLAYER_CONTRACT_ADDRESS) return null;
  const client = createClient({ chain: studionet });
  return client.readContract({
    address: GENLAYER_CONTRACT_ADDRESS,
    functionName,
    args: args as never[],
  } as never);
}
