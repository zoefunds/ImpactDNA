import { verifyMessage } from "ethers";
import { query } from "../db.js";
import { randomToken } from "./crypto.js";

const NONCE_TTL_SECONDS = 5 * 60;

export function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

export function buildSignMessage(address: string, nonce: string): string {
  return [
    "ImpactDNA wants you to sign in with your wallet.",
    "",
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    `Issued At: ${new Date().toISOString()}`,
  ].join("\n");
}

/** One single-use nonce per wallet at a time; replaces any prior one. */
export async function issueNonce(address: string): Promise<string> {
  const normalized = normalizeAddress(address);
  const nonce = randomToken(16);
  await query(
    `INSERT INTO auth_nonces (wallet_address, nonce, expires_at)
     VALUES ($1, $2, now() + ($3 || ' seconds')::interval)
     ON CONFLICT (wallet_address) DO UPDATE SET nonce = $2, expires_at = now() + ($3 || ' seconds')::interval`,
    [normalized, nonce, String(NONCE_TTL_SECONDS)],
  );
  return nonce;
}

/**
 * Verify a signed SIWE-style message and consume its nonce (deleted
 * whether or not verification succeeds, so a captured signature can
 * never be replayed against a fresh challenge).
 */
export async function verifyWalletSignature(
  address: string,
  message: string,
  signature: string,
): Promise<boolean> {
  const normalized = normalizeAddress(address);
  const stored = await query<{ nonce: string; expires_at: Date }>(
    "SELECT nonce, expires_at FROM auth_nonces WHERE wallet_address = $1",
    [normalized],
  );
  await query("DELETE FROM auth_nonces WHERE wallet_address = $1", [normalized]);

  const row = stored.rows[0];
  if (!row) return false;
  if (new Date(row.expires_at).getTime() < Date.now()) return false;
  if (!message.includes(`Nonce: ${row.nonce}`)) return false;
  if (!message.includes(`Address: ${address}`) && !message.includes(`Address: ${normalized}`)) {
    return false;
  }

  let recovered: string;
  try {
    recovered = verifyMessage(message, signature).toLowerCase();
  } catch {
    return false;
  }
  return recovered === normalized;
}
