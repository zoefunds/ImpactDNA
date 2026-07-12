import { createClient, createAccount } from "genlayer-js";
import { studionet, localnet, testnetAsimov } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import { config } from "../config.js";
import { logger } from "./logger.js";
import { cacheGet, cacheSet } from "../redis.js";

/**
 * GenLayer integration.
 *
 * Reads: proxied through a shared read-only client and cached (Redis +
 * in-process) so dashboard traffic does not hammer StudioNet's rate
 * limits (60 req/min per IP).
 *
 * Writes: signed with the *user's* custodial wallet key so on-chain
 * identity (gl.message.sender_address) matches the wallet shown in the
 * app. StudioNet is gasless — zero balance accounts can transact.
 */

function chainFor(name: string) {
  switch (name) {
    case "localnet":
      return localnet;
    case "testnet-asimov":
      return testnetAsimov;
    default:
      return studionet;
  }
}

const chain = chainFor(config.GENLAYER_NETWORK);

export function contractConfigured(): boolean {
  return config.GENLAYER_CONTRACT_ADDRESS.length > 10;
}

export function contractAddress(): string {
  return config.GENLAYER_CONTRACT_ADDRESS;
}

function readClient() {
  return createClient({ chain });
}

function writeClient(privateKey: string) {
  const account = createAccount(privateKey as `0x${string}`);
  return createClient({ chain, account });
}

function serialize(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(serialize);
  if (value instanceof Map) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of value.entries()) out[String(k)] = serialize(v);
    return out;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = serialize(v);
    return out;
  }
  return value;
}

export async function contractRead(
  functionName: string,
  args: unknown[] = [],
  ttlSeconds?: number | { skipCache: boolean },
): Promise<unknown> {
  if (!contractConfigured()) {
    throw Object.assign(new Error("Intelligent contract address not configured yet"), {
      statusCode: 503,
    });
  }
  const skipCache = typeof ttlSeconds === "object" && ttlSeconds.skipCache;
  const ttl = typeof ttlSeconds === "number" ? ttlSeconds : undefined;
  const cacheKey = `glread:${functionName}:${JSON.stringify(args)}`;
  if (!skipCache) {
    const cached = await cacheGet(cacheKey);
    if (cached) return JSON.parse(cached);
  }

  const client = readClient();
  const result = await client.readContract({
    address: config.GENLAYER_CONTRACT_ADDRESS,
    functionName,
    args: args as never[],
  } as never);
  const plain = serialize(result);
  await cacheSet(cacheKey, JSON.stringify(plain), ttl);
  return plain;
}

export interface WriteResult {
  txHash: string;
  status: string;
  result: unknown;
}

export async function contractWrite(
  privateKey: string,
  functionName: string,
  args: unknown[] = [],
): Promise<WriteResult> {
  if (!contractConfigured()) {
    throw Object.assign(new Error("Intelligent contract address not configured yet"), {
      statusCode: 503,
    });
  }
  const client = writeClient(privateKey);
  const txHash = await client.writeContract({
    address: config.GENLAYER_CONTRACT_ADDRESS,
    functionName,
    args: args as never[],
    value: BigInt(0),
  } as never);
  logger.info({ functionName, txHash }, "genlayer write submitted");

  const receipt = await client.waitForTransactionReceipt({
    hash: txHash,
    status: TransactionStatus.ACCEPTED,
    retries: 60,
    interval: 5000,
  });

  const r = receipt as unknown as Record<string, unknown>;
  const status = String(r?.statusName ?? r?.status ?? "UNKNOWN");
  return {
    txHash: String(txHash),
    status,
    result: serialize(r?.consensus_data ?? null),
  };
}
