import { Router } from "express";
import { z } from "zod";
import { query } from "../db.js";
import { contractRead } from "../lib/genlayer.js";
import { requireAuth } from "../middleware/auth.js";
import { wrap, validateBody, HttpError } from "../middleware/errors.js";
import { sendEmail, notifyEmail } from "../lib/email.js";
import { logger } from "../lib/logger.js";
import { config } from "../config.js";

// contribution_mirror rows are scoped by the contract address that
// assigned their on-chain ID, since a redeployed contract restarts its
// own ID counter from c-1 and would otherwise collide with history.
const CONTRACT_ADDRESS = config.GENLAYER_CONTRACT_ADDRESS;

/**
 * Every write against the GenLayer contract (register_developer,
 * submit_contribution, evaluate_contribution, request_appeal, ...) is
 * now signed client-side, directly by the user's own connected wallet
 * via genlayer-js + the AppKit wallet provider (frontend/lib/wallet.ts) —
 * genlayer-js's createClient accepts a generic EIP-1193 `provider`, so
 * the same wallet used for Base Sepolia signs GenLayer txs too. This
 * layer only mirrors already-confirmed on-chain state for fast
 * dashboards and sends notification emails; it never holds or signs
 * with anyone's key.
 */
export const contributionsRouter = Router();

// ------------------------------------------------------- sync a submission
// Called by the frontend right after its own submit_contribution tx is
// accepted, so the dashboard doesn't have to wait on a slow chain scan.
contributionsRouter.post(
  "/sync",
  requireAuth,
  validateBody(z.object({ contributionId: z.string().min(1).max(40), txHash: z.string().optional() })),
  wrap(async (req, res) => {
    const { contributionId, txHash } = req.body as { contributionId: string; txHash?: string };
    const onchain = (await contractRead("get_contribution", [contributionId], { skipCache: true })) as
      Record<string, unknown>;
    await query(
      `INSERT INTO contribution_mirror
         (contribution_id, user_id, repo, category, status, score_total, eligible, payload, tx_hash, contract_address)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (contract_address, contribution_id) DO UPDATE
         SET status = EXCLUDED.status, score_total = EXCLUDED.score_total,
             eligible = EXCLUDED.eligible, payload = EXCLUDED.payload, updated_at = now()`,
      [
        contributionId,
        req.user!.id,
        String(onchain.repo ?? ""),
        String(onchain.category ?? "library"),
        String(onchain.status ?? "submitted"),
        Number(onchain.score_total ?? 0),
        Boolean(onchain.eligible),
        JSON.stringify(onchain),
        txHash ?? null,
        CONTRACT_ADDRESS,
      ],
    );

    if (onchain.status === "evaluated" || onchain.status === "rejected") {
      const found = await query("SELECT email FROM users WHERE id = $1", [req.user!.id]);
      const email = found.rows[0]?.email as string | null;
      if (email) {
        const mail = notifyEmail(
          "Evaluation complete",
          `Your contribution <b>${contributionId}</b> has been evaluated by GenLayer validator consensus. Open your dashboard to see the impact score and funding eligibility.`,
        );
        void sendEmail({ to: email, ...mail, kind: "evaluation_done", userId: req.user!.id });
      }
    }
    res.json({ ok: true });
  }),
);

// Reconcile every on-chain contribution belonging to this developer into
// contribution_mirror, including ones with no row at all — e.g. an
// insert that no-op'd because a contract redeploy's fresh c-N collided
// with a bare-ID row left over from a previous contract deployment.
// Mirror completeness (not just the chain) is what the dashboard reads,
// so a missing row means a real submission never shows an Evaluate
// button; this closes that gap regardless of how a row went missing.
async function reconcileMineFromChain(userId: string, githubUsername: string | null): Promise<void> {
  if (!githubUsername) return;
  const pageSize = 50;
  const maxPages = 10; // matches the per-developer submission cap (25) with headroom
  let offset = 0;
  for (let page = 0; page < maxPages; page++) {
    const batch = (await contractRead("list_contributions", [offset, pageSize, ""], 30)) as {
      total: number;
      items: Array<Record<string, unknown>>;
    };
    for (const c of batch.items) {
      if (c.developer !== githubUsername) continue;
      await query(
        `INSERT INTO contribution_mirror
           (contribution_id, user_id, repo, category, status, score_total, eligible, contract_address)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (contract_address, contribution_id) DO UPDATE
           SET status = EXCLUDED.status, score_total = EXCLUDED.score_total,
               eligible = EXCLUDED.eligible, updated_at = now()`,
        [
          String(c.id),
          userId,
          String(c.repo ?? ""),
          String(c.category ?? "library"),
          String(c.status ?? "submitted"),
          Number(c.score_total ?? 0),
          Boolean(c.eligible),
          CONTRACT_ADDRESS,
        ],
      ).catch((err) => logger.warn({ err }, "mirror chain reconcile failed"));
    }
    offset += pageSize;
    if (offset >= batch.total) break;
  }
}

// ------------------------------------------------------------ my submissions
contributionsRouter.get(
  "/mine",
  requireAuth,
  wrap(async (req, res) => {
    const userRow = await query("SELECT github_username FROM users WHERE id = $1", [req.user!.id]);
    const githubUsername = (userRow.rows[0]?.github_username as string | null) ?? null;
    await reconcileMineFromChain(req.user!.id, githubUsername).catch((err) =>
      logger.warn({ err }, "mine reconcile failed"),
    );

    const rows = await query(
      `SELECT contribution_id, repo, category, status, score_total, eligible, tx_hash, created_at
       FROM contribution_mirror WHERE user_id = $1 AND contract_address = $2
       ORDER BY created_at DESC LIMIT 100`,
      [req.user!.id, CONTRACT_ADDRESS],
    );
    res.json({ items: rows.rows });
  }),
);

// -------------------------------------------------------------- my grants
// The contract only exposes paginated list_grants (no per-wallet filter),
// so we page through it server-side and match by wallet. Grant volume is
// expected to stay small (one grant per eligible contribution per epoch).
// Recipients claim their USDC directly on the Base Sepolia escrow
// (ImpactDnaEscrow.claim) once the relayer has pushed the epoch's grants
// there — this endpoint is read-only, listing what's owed/claimed.
contributionsRouter.get(
  "/grants/mine",
  requireAuth,
  wrap(async (req, res) => {
    const found = await query("SELECT wallet_address FROM users WHERE id = $1", [req.user!.id]);
    if (!found.rowCount) throw new HttpError(404, "User not found");
    const wallet = String(found.rows[0].wallet_address).toLowerCase();

    const mine: Array<Record<string, unknown>> = [];
    const pageSize = 50;
    const maxPages = 20; // safety cap: 1000 grants
    let offset = 0;
    for (let page = 0; page < maxPages; page++) {
      const batch = (await contractRead("list_grants", [offset, pageSize], 30)) as {
        total: number;
        items: Array<Record<string, unknown>>;
      };
      for (const g of batch.items) {
        if (String(g.wallet).toLowerCase() === wallet) mine.push(g);
      }
      offset += pageSize;
      if (offset >= batch.total) break;
    }
    res.json({ items: mine });
  }),
);
