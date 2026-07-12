import { Router } from "express";
import { z } from "zod";
import { query } from "../db.js";
import { contractWrite } from "../lib/genlayer.js";
import { revealPrivateKey } from "../lib/wallet.js";
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

adminRouter.get(
  "/audit",
  wrap(async (_req, res) => {
    const rows = await query(
      "SELECT id, user_id, action, ip, detail, created_at FROM audit_events ORDER BY id DESC LIMIT 200",
    );
    res.json({ items: rows.rows });
  }),
);
