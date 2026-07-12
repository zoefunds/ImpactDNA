import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { query } from "../db.js";
import { revealPrivateKey } from "../lib/wallet.js";
import { requireAuth } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { wrap, validateBody, HttpError } from "../middleware/errors.js";

export const walletRouter = Router();

walletRouter.get(
  "/",
  requireAuth,
  wrap(async (req, res) => {
    const found = await query("SELECT wallet_address, created_at FROM users WHERE id = $1", [
      req.user!.id,
    ]);
    if (!found.rowCount) throw new HttpError(404, "User not found");
    res.json({
      address: found.rows[0].wallet_address,
      network: "GenLayer StudioNet",
      custody: "server-side AES-256-GCM",
      createdAt: found.rows[0].created_at,
    });
  }),
);

/**
 * Secure key export: requires the account password again (re-auth) and
 * is strictly rate limited + audit logged.
 */
walletRouter.post(
  "/export",
  requireAuth,
  rateLimit("wallet-export", 5, 3600),
  validateBody(z.object({ password: z.string().min(1).max(200) })),
  wrap(async (req, res) => {
    const { password } = req.body as { password: string };
    const found = await query(
      "SELECT password_hash, wallet_address, wallet_ciphertext FROM users WHERE id = $1",
      [req.user!.id],
    );
    const user = found.rows[0];
    if (!user || !(await bcrypt.compare(password, String(user.password_hash)))) {
      throw new HttpError(401, "Password confirmation failed");
    }
    await query(
      "INSERT INTO audit_events (user_id, action, ip, detail) VALUES ($1,'wallet_export',$2,'{}')",
      [req.user!.id, req.ip ?? null],
    );
    res.json({
      address: user.wallet_address,
      privateKey: revealPrivateKey(String(user.wallet_ciphertext)),
      warning:
        "Anyone with this key controls your wallet permanently. Store it in a password manager and never share it.",
    });
  }),
);
