/**
 * Base Sepolia payment layer.
 *
 * GenLayer (lib/genlayer.ts / services/genlayerRelay.ts) is the
 * adjudication layer only — it never escrows or moves real value. Real
 * USDC funding-epoch pools live in ImpactDnaEscrow
 * (contracts/base/ImpactDnaEscrow.sol) on Base Sepolia. This module is
 * the only place that talks to that contract: turning a GenLayer epoch
 * id into the escrow's bytes32 key, and relaying a closed epoch's
 * grants list once.
 */
import { ethers } from "ethers";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { IMPACT_DNA_ESCROW_ABI, ERC20_ABI } from "../lib/escrowAbi.js";

let provider: ethers.JsonRpcProvider | null = null;
let relayerWallet: ethers.Wallet | null = null;
let escrowContract: ethers.Contract | null = null;

function getProvider(): ethers.JsonRpcProvider {
  if (!provider) {
    provider = new ethers.JsonRpcProvider(config.BASE_SEPOLIA_RPC_URL);
  }
  return provider;
}

export function isEscrowConfigured(): boolean {
  return Boolean(config.IMPACT_DNA_ESCROW_ADDRESS && config.BASE_SEPOLIA_RELAYER_PRIVATE_KEY);
}

function getRelayerContract(): ethers.Contract {
  if (!config.IMPACT_DNA_ESCROW_ADDRESS) {
    throw new Error("IMPACT_DNA_ESCROW_ADDRESS is not configured");
  }
  if (!config.BASE_SEPOLIA_RELAYER_PRIVATE_KEY) {
    throw new Error("BASE_SEPOLIA_RELAYER_PRIVATE_KEY is not configured");
  }
  if (!escrowContract) {
    relayerWallet = new ethers.Wallet(config.BASE_SEPOLIA_RELAYER_PRIVATE_KEY, getProvider());
    escrowContract = new ethers.Contract(
      config.IMPACT_DNA_ESCROW_ADDRESS,
      IMPACT_DNA_ESCROW_ABI,
      relayerWallet,
    );
  }
  return escrowContract;
}

function getReadContract(): ethers.Contract {
  if (!config.IMPACT_DNA_ESCROW_ADDRESS) {
    throw new Error("IMPACT_DNA_ESCROW_ADDRESS is not configured");
  }
  return new ethers.Contract(config.IMPACT_DNA_ESCROW_ADDRESS, IMPACT_DNA_ESCROW_ABI, getProvider());
}

/** GenLayer epoch ids are short strings (e.g. "e-12"); the escrow
 * contract keys pools by bytes32, so we hash the id deterministically
 * the same way on both the backend and the frontend. */
export function epochIdToBytes32(epochId: string): string {
  return ethers.id(epochId);
}

export interface OnchainGrant {
  grant: string;
  wallet: string;
  amount_usdc: string;
}

/**
 * Push a GenLayer-closed epoch's grants onto the Base Sepolia escrow.
 * Idempotent from the caller's perspective: the contract itself rejects
 * a second setGrants call for the same epochId, so a retry after a
 * partial failure (e.g. the GenLayer mark_grants_relayed call failing
 * after this succeeded) is safe to just call again.
 */
export async function relayGrantsToEscrow(epochId: string, grants: OnchainGrant[]): Promise<string> {
  const contract = getRelayerContract();
  const nonZero = grants.filter((g) => BigInt(g.amount_usdc || "0") > BigInt(0));
  if (nonZero.length === 0) {
    throw new Error(`No non-zero grants to relay for epoch ${epochId}`);
  }
  const addresses = nonZero.map((g) => g.wallet);
  const amounts = nonZero.map((g) => BigInt(g.amount_usdc));
  const key = epochIdToBytes32(epochId);

  const tx = await contract.setGrants(key, addresses, amounts);
  logger.info({ epochId, txHash: tx.hash, grantCount: addresses.length }, "relaying grants to Base Sepolia escrow");
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) {
    throw new Error(`setGrants transaction failed for epoch ${epochId}`);
  }
  return tx.hash as string;
}

export async function getEscrowPool(epochId: string) {
  const contract = getReadContract();
  const key = epochIdToBytes32(epochId);
  const [deposited, allocated, grantsSet] = await contract.getPool(key);
  return {
    deposited: (deposited as bigint).toString(),
    allocated: (allocated as bigint).toString(),
    grantsSet: grantsSet as boolean,
  };
}

export async function getEscrowClaimable(epochId: string, address: string) {
  const contract = getReadContract();
  const key = epochIdToBytes32(epochId);
  const amount = await contract.getClaimable(key, address);
  return (amount as bigint).toString();
}

/** The wallet's own real USDC balance on Base Sepolia (base units, 6
 * decimals) — distinct from declared/claimable grant money. Works even
 * if the escrow contract isn't configured yet. */
export async function getWalletUsdcBalance(address: string): Promise<string> {
  const usdc = new ethers.Contract(config.USDC_CONTRACT_ADDRESS, ERC20_ABI, getProvider());
  const balance = await usdc.balanceOf(address);
  return (balance as bigint).toString();
}

export function getProviderForScan(): ethers.JsonRpcProvider {
  return getProvider();
}
