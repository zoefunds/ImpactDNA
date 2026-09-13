import { Router } from "express";
import { z } from "zod";
import { query } from "../db.js";
import { contractWrite, contractRead, invalidateRead } from "../lib/genlayer.js";
import { config } from "../config.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { wrap, validateBody, HttpError } from "../middleware/errors.js";

/**
 * Curator/admin operations (RBAC enforced here AND on-chain — the
 * contract independently checks curator status of the signing wallet).
 * These stay backend-signed by one operator key (GENLAYER_OPERATOR_PRIVATE_KEY)
 * — rare, trusted-operator actions, unlike per-user writes which are now
 * signed client-side by the user's own connected wallet.
 */
export const adminRouter = Router();

adminRouter.use(requireAuth, requireRole("curator", "admin"));

function operatorKey(): string {
  if (!config.GENLAYER_OPERATOR_PRIVATE_KEY) {
    throw new HttpError(503, "GENLAYER_OPERATOR_PRIVATE_KEY is not configured");
  }
  return config.GENLAYER_OPERATOR_PRIVATE_KEY;
}

// Note: open_epoch/close_epoch are NOT here — epochs are permissionless
// (anyone may open and name one, and either its own opener or a curator
// may close it), so those calls are signed client-side by the acting
// user's own connected wallet (frontend/lib/genlayerClient.ts), not
// proxied through this operator-gated router.

adminRouter.post(
  "/contributions/:id/detect-manipulation",
  rateLimit("admin-fraud", 10, 3600),
  wrap(async (req, res) => {
    res.json({
      ok: true,
      tx: await contractWrite(operatorKey(), "detect_manipulation", [String(req.params.id)]),
    });
  }),
);

adminRouter.post(
  "/appeals/:id/resolve",
  rateLimit("admin-appeal", 10, 3600),
  wrap(async (req, res) => {
    res.json({ ok: true, tx: await contractWrite(operatorKey(), "resolve_appeal", [String(req.params.id)]) });
  }),
);

adminRouter.post(
  "/users/:id/role",
  validateBody(z.object({ role: z.enum(["developer", "curator", "admin"]) })),
  requireRole("admin"),
  wrap(async (req, res) => {
    const { role } = req.body as { role: string };
    const updated = await query(
      "UPDATE users SET role = $1, updated_at = now() WHERE id = $2 RETURNING id, wallet_address, role",
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
    const tx = await contractWrite(operatorKey(), "add_curator", [address]);
    await invalidateRead("get_platform_info");
    res.json({ ok: true, tx });
  }),
);

adminRouter.delete(
  "/curators/:address",
  requireRole("admin"),
  rateLimit("admin-curators", 10, 3600),
  wrap(async (req, res) => {
    const tx = await contractWrite(operatorKey(), "remove_curator", [String(req.params.address)]);
    await invalidateRead("get_platform_info");
    res.json({ ok: true, tx });
  }),
);

adminRouter.get(
  "/curators/:address",
  wrap(async (req, res) => {
    const isCurator = await contractRead("is_curator", [String(req.params.address)], { skipCache: true });
    res.json({ address: req.params.address, isCurator });
  }),
);

adminRouter.post(
  "/config/min-eligible-score",
  requireRole("admin"),
  rateLimit("admin-config", 10, 3600),
  validateBody(z.object({ score: z.number().int().min(0).max(100) })),
  wrap(async (req, res) => {
    const { score } = req.body as { score: number };
    const tx = await contractWrite(operatorKey(), "set_min_eligible_score", [score]);
    await invalidateRead("get_platform_info");
    res.json({ ok: true, tx });
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
