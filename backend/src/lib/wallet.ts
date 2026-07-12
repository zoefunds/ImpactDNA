import { Wallet } from "ethers";
import { encryptSecret, decryptSecret } from "./crypto.js";

/**
 * Custodial wallet lifecycle. Every account gets exactly one wallet at
 * registration; the address never changes and survives device loss
 * because the encrypted key lives server-side (AES-256-GCM).
 */

export interface CreatedWallet {
  address: string;
  ciphertext: string;
}

export function createWallet(): CreatedWallet {
  const wallet = Wallet.createRandom();
  return {
    address: wallet.address,
    ciphertext: encryptSecret(wallet.privateKey),
  };
}

/** Decrypt a stored wallet key. Callers must gate this behind re-auth. */
export function revealPrivateKey(ciphertext: string): string {
  return decryptSecret(ciphertext);
}
