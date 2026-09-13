import { Router } from "express";
import { query } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { wrap, HttpError } from "../middleware/errors.js";
import { getWalletUsdcBalance } from "../services/baseSepolia.js";

export const walletRouter = Router();

/** The connected wallet IS the account — nothing custodial to reveal or
 * export here anymore. This just surfaces the on-chain USDC balance. */
walletRouter.get(
  "/",
  requireAuth,
  wrap(async (req, res) => {
    const found = await query("SELECT wallet_address, created_at FROM users WHERE id = $1", [
      req.user!.id,
    ]);
    if (!found.rowCount) throw new HttpError(404, "User not found");
    const address = found.rows[0].wallet_address as string;
    const usdcBalance = await getWalletUsdcBalance(address).catch(() => null);
    res.json({
      address,
      network: "Base Sepolia",
      usdcBalance,
      createdAt: found.rows[0].created_at,
    });
  }),
);
