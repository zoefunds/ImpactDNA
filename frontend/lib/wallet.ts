"use client";

import { createAppKit } from "@reown/appkit/react";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { baseSepolia } from "@reown/appkit/networks";
import { defineChain } from "@reown/appkit/networks";
import { cookieStorage, createStorage } from "wagmi";

export const REOWN_PROJECT_ID = "c899692e49883030daba3ad14aa97388";

/**
 * GenLayer StudioNet, registered as a second AppKit/wagmi network
 * alongside Base Sepolia. Without this, AppKit/wagmi treats any chain
 * outside its configured list as globally "unsupported" and nags the
 * user with its own "Switch Network" modal the moment their wallet is on
 * StudioNet (e.g. left over from a previous session) — even though
 * genlayer-js writes work fine via the raw provider regardless of what
 * wagmi thinks the "current" chain is. Registering it here just stops
 * that unrelated nag; lib/chainSwitch.ts still does the actual
 * switching for each write.
 */
export const genlayerStudionet = defineChain({
  id: 61999,
  caipNetworkId: "eip155:61999",
  chainNamespace: "eip155",
  name: "GenLayer Studio Network",
  nativeCurrency: { name: "GEN Token", symbol: "GEN", decimals: 18 },
  rpcUrls: { default: { http: ["https://studio.genlayer.com/api"] } },
  blockExplorers: { default: { name: "GenLayer Explorer", url: "https://genlayer-explorer.vercel.app" } },
  testnet: true,
});

export const networks = [baseSepolia, genlayerStudionet];

export const wagmiAdapter = new WagmiAdapter({
  storage: createStorage({ storage: cookieStorage }),
  ssr: true,
  projectId: REOWN_PROJECT_ID,
  networks,
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;

let appKitInitialized = false;

/** Idempotent — Next.js can re-render this module client-side more than
 * once; createAppKit must only run once per page load. */
export function initAppKit(): void {
  if (appKitInitialized || typeof window === "undefined") return;
  appKitInitialized = true;
  createAppKit({
    adapters: [wagmiAdapter],
    networks: [baseSepolia, genlayerStudionet],
    defaultNetwork: baseSepolia,
    projectId: REOWN_PROJECT_ID,
    metadata: {
      name: "ImpactDNA",
      description: "Retroactive Public Goods Funding for open source",
      url: typeof window !== "undefined" ? window.location.origin : "https://impactdna.app",
      icons: ["https://impactdna.app/icon.png"],
    },
    features: { analytics: false, email: false, socials: [] },
  });
}
