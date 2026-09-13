"use client";

/**
 * Explicit wallet network switching via the raw EIP-1193 provider.
 *
 * genlayer-js and our escrow calls both sign through the connected
 * wallet's *currently active* chain — neither one asks the wallet to
 * switch first. Without this, a GenLayer write (StudioNet, chain id
 * 61999) silently gets sent against whatever chain the wallet happens to
 * be on (Base Sepolia, since that's the only chain AppKit/wagmi knows
 * about), and vice versa for an escrow call made right after a GenLayer
 * write left the wallet on StudioNet. Every write in genlayerClient.ts /
 * escrowClient.ts must call ensureChain for its own chain first.
 */
export interface ChainParams {
  chainIdHex: string;
  chainName: string;
  rpcUrls: string[];
  nativeCurrency: { name: string; symbol: string; decimals: number };
  blockExplorerUrls?: string[];
}

export const GENLAYER_STUDIONET: ChainParams = {
  chainIdHex: "0xf22f", // 61999
  chainName: "GenLayer Studio Network",
  rpcUrls: ["https://studio.genlayer.com/api"],
  nativeCurrency: { name: "GEN Token", symbol: "GEN", decimals: 18 },
  blockExplorerUrls: ["https://genlayer-explorer.vercel.app"],
};

export const BASE_SEPOLIA: ChainParams = {
  chainIdHex: "0x14a34", // 84532
  chainName: "Base Sepolia",
  rpcUrls: ["https://sepolia.base.org"],
  nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
  blockExplorerUrls: ["https://sepolia.basescan.org"],
};

type Eip1193Provider = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };

export async function ensureChain(provider: Eip1193Provider, chain: ChainParams): Promise<void> {
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chain.chainIdHex }] });
  } catch (err) {
    // 4902: chain not added to the wallet yet — add it, then switch.
    const code = (err as { code?: number } | undefined)?.code;
    if (code === 4902) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: chain.chainIdHex,
            chainName: chain.chainName,
            rpcUrls: chain.rpcUrls,
            nativeCurrency: chain.nativeCurrency,
            blockExplorerUrls: chain.blockExplorerUrls,
          },
        ],
      });
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chain.chainIdHex }] });
    } else {
      throw err;
    }
  }
}
