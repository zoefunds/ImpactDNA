import { Router } from "express";
import { z } from "zod";
import { query } from "../db.js";
import { contractWrite, contractRead } from "../lib/genlayer.js";
import { revealPrivateKey } from "../lib/wallet.js";
import { treasuryAddress, treasuryBalanceAtto, sendGenPayout } from "../lib/treasury.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { wrap, validateBody, HttpError } from "../middleware/errors.js";

/**
 * Curator/admin operations (RBAC enforced here AND on-chain — the
 * contract independently checks curator status of the signing wallet).
 */
export const adminRouter = Router();

adminRouter.use(requireAuth, requireRole("curator", "admin"));

async function adminKey(userId: string): Promise<string> {
  const found = await query("SELECT wallet_ciphertext FROM users WHERE id = $1", [userId]);
  if (!found.rowCount) throw new HttpError(404, "User not found");
  return revealPrivateKey(String(found.rows[0].wallet_ciphertext));
}

adminRouter.post(
  "/epochs/open",
  rateLimit("admin-epoch", 10, 3600),
  validateBody(z.object({ poolAtto: z.string().regex(/^\d+$/), label: z.string().trim().min(1).max(80) })),
  wrap(async (req, res) => {
    const { poolAtto, label } = req.body as { poolAtto: string; label: string };
    const key = await adminKey(req.user!.id);
    res.json({ ok: true, tx: await contractWrite(key, "open_epoch", [poolAtto, label]) });
  }),
);

adminRouter.post(
  "/epochs/close",
  rateLimit("admin-epoch", 10, 3600),
  wrap(async (req, res) => {
    const key = await adminKey(req.user!.id);
    res.json({ ok: true, tx: await contractWrite(key, "close_epoch", []) });
  }),
);

adminRouter.post(
  "/treasury/deposit",
  rateLimit("admin-treasury", 10, 3600),
  validateBody(z.object({ atto: z.string().regex(/^\d+$/) })),
  wrap(async (req, res) => {
    const key = await adminKey(req.user!.id);
    res.json({
      ok: true,
      tx: await contractWrite(key, "deposit_to_treasury", [(req.body as { atto: string }).atto]),
    });
  }),
);

// -------------------------------------------------------- treasury (real GEN)
adminRouter.get(
  "/treasury",
  wrap(async (_req, res) => {
    res.json({ address: await treasuryAddress(), balanceAtto: await treasuryBalanceAtto() });
  }),
);

adminRouter.post(
  "/grant-payouts/:grantId/retry",
  rateLimit("admin-payout-retry", 20, 3600),
  wrap(async (req, res) => {
    const grantId = String(req.params.grantId);
    const existing = await query("SELECT status FROM grant_payouts WHERE grant_id = $1", [grantId]);
    if (existing.rowCount && existing.rows[0].status === "sent") {
      throw new HttpError(409, "Payout already sent for this grant");
    }
    const grant = (await contractRead("get_grant", [grantId], { skipCache: true })) as {
      claimed: boolean;
      wallet: string;
      amount_atto: string;
    };
    if (!grant.claimed) throw new HttpError(400, "Grant has not been claimed on-chain yet");
    const txHash = await sendGenPayout(grant.wallet, BigInt(grant.amount_atto));
    await query(
      `INSERT INTO grant_payouts (grant_id, wallet, amount_atto, tx_hash, status)
       VALUES ($1,$2,$3,$4,'sent')
       ON CONFLICT (grant_id) DO UPDATE SET tx_hash = $4, status = 'sent', error = NULL, updated_at = now()`,
      [grantId, grant.wallet, grant.amount_atto, txHash],
    );
    res.json({ ok: true, txHash });
  }),
);

adminRouter.get(
  "/grant-payouts",
  wrap(async (_req, res) => {
    const rows = await query(
      "SELECT * FROM grant_payouts ORDER BY created_at DESC LIMIT 200",
    );
    res.json({ items: rows.rows });
  }),
);

adminRouter.post(
  "/contributions/:id/detect-manipulation",
  rateLimit("admin-fraud", 10, 3600),
  wrap(async (req, res) => {
    const key = await adminKey(req.user!.id);
    res.json({
      ok: true,
      tx: await contractWrite(key, "detect_manipulation", [String(req.params.id)]),
    });
  }),
);

adminRouter.post(
  "/appeals/:id/resolve",
  rateLimit("admin-appeal", 10, 3600),
  wrap(async (req, res) => {
    const key = await adminKey(req.user!.id);
    res.json({ ok: true, tx: await contractWrite(key, "resolve_appeal", [String(req.params.id)]) });
  }),
);

adminRouter.post(
  "/users/:id/role",
  validateBody(z.object({ role: z.enum(["developer", "curator", "admin"]) })),
  requireRole("admin"),
  wrap(async (req, res) => {
    const { role } = req.body as { role: string };
    const updated = await query(
      "UPDATE users SET role = $1, updated_at = now() WHERE id = $2 RETURNING id, email, role",
      [role, String(req.params.id)],
    );
    if (!updated.rowCount) throw new HttpError(404, "User not found");
    res.json({ ok: true, user: updated.rows[0] });
  }),
);

// -------------------------------------------------------- curator management (owner-gated on-chain)
adminRouter.post(
  "/curators",
  requireRole("admin"),
  rateLimit("admin-curators", 10, 3600),
  validateBody(z.object({ address: z.string().trim().min(10).max(64) })),
  wrap(async (req, res) => {
    const { address } = req.body as { address: string };
    const key = await adminKey(req.user!.id);
    res.json({ ok: true, tx: await contractWrite(key, "add_curator", [address]) });
  }),
);

adminRouter.delete(
  "/curators/:address",
  requireRole("admin"),
  rateLimit("admin-curators", 10, 3600),
  wrap(async (req, res) => {
    const key = await adminKey(req.user!.id);
    res.json({ ok: true, tx: await contractWrite(key, "remove_curator", [String(req.params.address)]) });
  }),
);

adminRouter.get(
  "/curators/:address",
  wrap(async (req, res) => {
    const isCurator = await contractRead("is_curator", [String(req.params.address)], { skipCache: true });
    res.json({ address: req.params.address, isCurator });
  }),
);

adminRouter.get(
  "/audit",
  wrap(async (_req, res) => {
    const rows = await query(
      "SELECT id, user_id, action, ip, detail, created_at FROM audit_events ORDER BY id DESC LIMIT 200",
    );
    res.json({ items: rows.rows });
  }),
);
