import { createAccount, createClient } from "genlayer-js";
import { studionet, localnet, testnetAsimov } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import { query } from "../db.js";
import { config } from "../config.js";
import { createWallet, revealPrivateKey } from "./wallet.js";
import { logger } from "./logger.js";

/**
 * Real GEN custody and payouts. GenVM intelligent contracts can receive
 * native value (payable) but expose no primitive to send it back out —
 * confirmed by introspecting the runtime (gl.evm has no transfer/send;
 * gl.message is read-only). So the contract stays the authoritative
 * ledger (grants, claims) while this backend-controlled EOA holds real
 * GEN and executes payouts as plain native-value transactions, which
 * GenLayer's chain layer does support (verified end-to-end on StudioNet:
 * balances moved between two throwaway wallets via sendTransaction).
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

async function getOrCreateTreasuryWallet(): Promise<{ address: string; key: string }> {
  const found = await query("SELECT address, ciphertext FROM treasury_wallet WHERE id = 1");
  if (found.rowCount) {
    const row = found.rows[0];
    return { address: String(row.address), key: revealPrivateKey(String(row.ciphertext)) };
  }
  const wallet = createWallet();
  await query(
    "INSERT INTO treasury_wallet (id, address, ciphertext) VALUES (1, $1, $2) ON CONFLICT (id) DO NOTHING",
    [wallet.address, wallet.ciphertext],
  );
  // Re-read in case of a concurrent insert race — the row in the DB wins.
  const settled = await query("SELECT address, ciphertext FROM treasury_wallet WHERE id = 1");
  const row = settled.rows[0];
  return { address: String(row.address), key: revealPrivateKey(String(row.ciphertext)) };
}

export async function treasuryAddress(): Promise<string> {
  const { address } = await getOrCreateTreasuryWallet();
  return address;
}

export async function treasuryBalanceAtto(): Promise<string> {
  const { address } = await getOrCreateTreasuryWallet();
  const client = createClient({ chain });
  const bal = await client.getBalance({ address: address as `0x${string}` });
  return bal.toString();
}

/** Send real GEN from the treasury wallet to a recipient. Throws on failure. */
export async function sendGenPayout(toAddress: string, amountAtto: bigint): Promise<string> {
  const { key } = await getOrCreateTreasuryWallet();
  const account = createAccount(key as `0x${string}`);
  const client = createClient({ chain, account });
  const hash = await client.sendTransaction({
    to: toAddress as `0x${string}`,
    value: amountAtto,
  } as never);
  await client.waitForTransactionReceipt({
    hash,
    status: TransactionStatus.ACCEPTED,
    retries: 60,
    interval: 5000,
  } as never);
  logger.info({ toAddress, amountAtto: amountAtto.toString(), hash }, "treasury payout sent");
  return String(hash);
}
