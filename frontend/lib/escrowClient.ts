"use client";

import { readContract, writeContract, waitForTransactionReceipt, getAccount } from "@wagmi/core";
import { keccak256, toHex } from "viem";
import { wagmiConfig } from "./wallet";
import { ensureChain, BASE_SEPOLIA } from "./chainSwitch";

/** A prior GenLayer write (lib/genlayerClient.ts) may have switched the
 * wallet to StudioNet — every escrow write must switch it back first, or
 * it silently signs/sends against the wrong chain. */
async function ensureBaseSepolia(): Promise<void> {
  const account = getAccount(wagmiConfig);
  if (!account.connector) throw new Error("Connect your wallet first");
  const provider = await account.connector.getProvider();
  await ensureChain(provider as never, BASE_SEPOLIA);
}

export const USDC_ADDRESS = (process.env.NEXT_PUBLIC_USDC_CONTRACT_ADDRESS ??
  "0x036CbD53842c5426634e7929541eC2318f3dCF7e") as `0x${string}`;
export const ESCROW_ADDRESS = (process.env.NEXT_PUBLIC_IMPACT_DNA_ESCROW_ADDRESS ?? "") as `0x${string}`;

const ERC20_ABI = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

const ESCROW_ABI = [
  { type: "function", name: "deposit", stateMutability: "nonpayable", inputs: [{ name: "epochId", type: "bytes32" }, { name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "claim", stateMutability: "nonpayable", inputs: [{ name: "epochId", type: "bytes32" }], outputs: [] },
  { type: "function", name: "getClaimable", stateMutability: "view", inputs: [{ name: "epochId", type: "bytes32" }, { name: "recipient", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getPool", stateMutability: "view", inputs: [{ name: "epochId", type: "bytes32" }], outputs: [{ name: "deposited", type: "uint256" }, { name: "allocated", type: "uint256" }, { name: "grantsSet", type: "bool" }] },
] as const;

/** Same hash the backend relayer uses (services/baseSepolia.ts
 * epochIdToBytes32 — ethers.id === keccak256(utf8 bytes)) so both sides
 * derive the identical escrow pool key from a GenLayer epoch id string. */
export function epochIdToBytes32(epochId: string): `0x${string}` {
  return keccak256(toHex(epochId));
}

function requireEscrowConfigured() {
  if (!ESCROW_ADDRESS) throw new Error("Escrow contract address is not configured yet");
}

/** Approve + deposit USDC (base units, 6 decimals) into an epoch's pool. */
export async function depositUsdc(epochId: string, amountUnits: bigint): Promise<string> {
  requireEscrowConfigured();
  const account = getAccount(wagmiConfig).address;
  if (!account) throw new Error("Connect your wallet first");
  await ensureBaseSepolia();

  const allowance = (await readContract(wagmiConfig, {
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [account, ESCROW_ADDRESS],
  })) as bigint;

  if (allowance < amountUnits) {
    const approveHash = await writeContract(wagmiConfig, {
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [ESCROW_ADDRESS, amountUnits],
    });
    await waitForTransactionReceipt(wagmiConfig, { hash: approveHash });
  }

  const key = epochIdToBytes32(epochId);
  const depositHash = await writeContract(wagmiConfig, {
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "deposit",
    args: [key, amountUnits],
  });
  await waitForTransactionReceipt(wagmiConfig, { hash: depositHash });
  return depositHash;
}

export async function claimGrant(epochId: string): Promise<string> {
  requireEscrowConfigured();
  await ensureBaseSepolia();
  const key = epochIdToBytes32(epochId);
  const hash = await writeContract(wagmiConfig, {
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "claim",
    args: [key],
  });
  await waitForTransactionReceipt(wagmiConfig, { hash });
  return hash;
}

export async function getClaimable(epochId: string, address: `0x${string}`): Promise<bigint> {
  requireEscrowConfigured();
  return (await readContract(wagmiConfig, {
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: "getClaimable",
    args: [epochIdToBytes32(epochId), address],
  })) as bigint;
}

export async function getUsdcBalance(address: `0x${string}`): Promise<bigint> {
  return (await readContract(wagmiConfig, {
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [address],
  })) as bigint;
}
