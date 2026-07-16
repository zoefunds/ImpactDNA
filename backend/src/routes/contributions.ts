import { Router } from "express";
import { z } from "zod";
import { query } from "../db.js";
import { contractWrite, contractRead } from "../lib/genlayer.js";
import { revealPrivateKey } from "../lib/wallet.js";
import { requireAuth } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { wrap, validateBody, HttpError } from "../middleware/errors.js";
import { sendEmail, notifyEmail } from "../lib/email.js";
import { sendGenPayout } from "../lib/treasury.js";
import { logger } from "../lib/logger.js";

/**
 * Authenticated on-chain actions. Each write is signed with the calling
 * user's custodial wallet so the contract sees their real address.
 * GenLayer consensus (including LLM evaluation) happens on-chain; this
 * layer only submits transactions, mirrors results, and notifies.
 */
export const contributionsRouter = Router();

const CATEGORIES = [
  "library",
  "sdk",
  "tooling",
  "documentation",
  "smart-contract",
  "infrastructure",
  "education",
  "research",
  "application",
] as const;

async function userWalletKey(userId: string): Promise<{ key: string; email: string; github: string | null }> {
  const found = await query(
    "SELECT wallet_ciphertext, email, github_username FROM users WHERE id = $1",
    [userId],
  );
  if (!found.rowCount) throw new HttpError(404, "User not found");
  return {
    key: revealPrivateKey(String(found.rows[0].wallet_ciphertext)),
    email: String(found.rows[0].email),
    github: found.rows[0].github_username as string | null,
  };
}

// ------------------------------------------------- register on-chain identity
// githubUsername is never taken as free text: it must already be linked
// via the GitHub OAuth flow (see /api/auth/github/start), so a user can
// only register the account they actually authenticated as.
contributionsRouter.post(
  "/register-developer",
  requireAuth,
  rateLimit("chain-register", 5, 3600),
  validateBody(z.object({ displayName: z.string().trim().min(2).max(60) })),
  wrap(async (req, res) => {
    const { displayName } = req.body as { displayName: string };
    const { key, github } = await userWalletKey(req.user!.id);
    if (!github) throw new HttpError(400, "Connect your GitHub account first");
    const result = await contractWrite(key, "register_developer", [github, displayName]);
    res.json({ ok: true, tx: result });
  }),
);

// -------------------------------------------------------- verify via GitHub
contributionsRouter.post(
  "/verify-developer",
  requireAuth,
  rateLimit("chain-verify", 5, 3600),
  wrap(async (req, res) => {
    const { key, github } = await userWalletKey(req.user!.id);
    if (!github) throw new HttpError(400, "Register a GitHub username first");
    const result = await contractWrite(key, "verify_developer", [github]);
    res.json({ ok: true, tx: result });
  }),
);

// ------------------------------------------------------------------ submit
contributionsRouter.post(
  "/",
  requireAuth,
  rateLimit("chain-submit", 10, 3600),
  validateBody(
    z.object({
      repo: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9_.\-]+\/[A-Za-z0-9_.\-]+$/, "repo must be owner/name"),
      category: z.enum(CATEGORIES),
      description: z.string().trim().min(20).max(2000),
    }),
  ),
  wrap(async (req, res) => {
    const { repo, category, description } = req.body as {
      repo: string;
      category: (typeof CATEGORIES)[number];
      description: string;
    };
    const { key } = await userWalletKey(req.user!.id);
    const result = await contractWrite(key, "submit_contribution", [repo, category, description]);

    // Mirror locally for fast dashboards (best effort). The canonical id
    // comes from the chain itself — receipts don't reliably expose it.
    try {
      let cid = extractReturnedId(result.result);
      if (!cid) {
        const onchain = (await contractRead("get_contribution_by_repo", [repo], {
          skipCache: true,
        })) as { id?: string } | null;
        cid = onchain?.id ?? null;
      }
      await query(
        `INSERT INTO contribution_mirror (contribution_id, user_id, repo, category, tx_hash)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (contribution_id) DO NOTHING`,
        [cid ?? `tx-${result.txHash.slice(0, 18)}`, req.user!.id, repo, category, result.txHash],
      );
    } catch (err) {
      logger.warn({ err }, "mirror insert failed");
    }
    res.status(201).json({ ok: true, tx: result });
  }),
);

// ---------------------------------------------------------------- evaluate
contributionsRouter.post(
  "/:id/evaluate",
  requireAuth,
  rateLimit("chain-evaluate", 6, 3600),
  wrap(async (req, res) => {
    const contributionId = String(req.params.id);
    const { key, email } = await userWalletKey(req.user!.id);
    const result = await contractWrite(key, "evaluate_contribution", [contributionId]);

    try {
      // Pull the authoritative record from the chain and reconcile the
      // mirror by repo (covers rows stored under a fallback tx- id).
      const onchain = (await contractRead("get_contribution", [contributionId], {
        skipCache: true,
      })) as Record<string, unknown>;
      await query(
        `UPDATE contribution_mirror
         SET contribution_id = $1, status = $2, score_total = $3, eligible = $4,
             payload = $5, updated_at = now()
         WHERE repo = $6 OR contribution_id = $1`,
        [
          contributionId,
          String(onchain.status ?? "evaluated"),
          Number(onchain.score_total ?? 0),
          Boolean(onchain.eligible),
          JSON.stringify(onchain ?? {}),
          String(onchain.repo ?? ""),
        ],
      );
    } catch (err) {
      logger.warn({ err }, "mirror update failed");
    }

    const mail = notifyEmail(
      "Evaluation complete",
      `Your contribution <b>${contributionId}</b> has been evaluated by GenLayer validator consensus. Open your dashboard to see the impact score and funding eligibility.`,
    );
    void sendEmail({ to: email, ...mail, kind: "evaluation_done", userId: req.user!.id });

    res.json({ ok: true, tx: result });
  }),
);

// ------------------------------------------------------------------ appeal
contributionsRouter.post(
  "/:id/appeal",
  requireAuth,
  rateLimit("chain-appeal", 4, 3600),
  validateBody(z.object({ reason: z.string().trim().min(20).max(1500) })),
  wrap(async (req, res) => {
    const { reason } = req.body as { reason: string };
    const { key } = await userWalletKey(req.user!.id);
    const result = await contractWrite(key, "request_appeal", [String(req.params.id), reason]);
    res.json({ ok: true, tx: result });
  }),
);

// -------------------------------------------------------------- claim grant
contributionsRouter.post(
  "/grants/:grantId/claim",
  requireAuth,
  rateLimit("chain-claim", 10, 3600),
  wrap(async (req, res) => {
    const grantId = String(req.params.grantId);
    const { key, email } = await userWalletKey(req.user!.id);
    const result = await contractWrite(key, "claim_grant", [grantId]);

    // On-chain claim is now the authoritative, tamper-evident record.
    // The matching real GEN payout is a plain native-value transfer from
    // the treasury wallet (contracts can't send value back out — see
    // lib/treasury.ts). Recorded in grant_payouts for auditability and
    // so a failed send can be retried without re-claiming on-chain.
    let payout: { status: string; txHash: string | null; error?: string } = {
      status: "pending",
      txHash: null,
    };
    const grant = (await contractRead("get_grant", [grantId], { skipCache: true })) as {
      wallet: string;
      amount_atto: string;
    };
    try {
      const txHash = await sendGenPayout(grant.wallet, BigInt(grant.amount_atto));
      await query(
        `INSERT INTO grant_payouts (grant_id, wallet, amount_atto, tx_hash, status)
         VALUES ($1,$2,$3,$4,'sent')
         ON CONFLICT (grant_id) DO UPDATE SET tx_hash = $4, status = 'sent', updated_at = now()`,
        [grantId, grant.wallet, grant.amount_atto, txHash],
      );
      payout = { status: "sent", txHash };
    } catch (err) {
      logger.error({ err, grantId }, "treasury payout failed after on-chain claim");
      await query(
        `INSERT INTO grant_payouts (grant_id, wallet, amount_atto, status, error)
         VALUES ($1, $2, $3, 'failed', $4)
         ON CONFLICT (grant_id) DO UPDATE SET status = 'failed', error = $4, updated_at = now()`,
        [grantId, grant.wallet, grant.amount_atto, err instanceof Error ? err.message : String(err)],
      );
      payout = { status: "failed", txHash: null, error: "Payout delayed — will be retried" };
    }

    const mail = notifyEmail(
      "Grant claimed",
      `Your retroactive funding grant <b>${grantId}</b> has been claimed on-chain.` +
        (payout.status === "sent"
          ? " Your GEN payout has been sent to your wallet."
          : " Your payout is being processed and will arrive shortly."),
    );
    void sendEmail({ to: email, ...mail, kind: "grant_claimed", userId: req.user!.id });
    res.json({ ok: true, tx: result, payout });
  }),
);

// ------------------------------------------------------------ my submissions
contributionsRouter.get(
  "/mine",
  requireAuth,
  wrap(async (req, res) => {
    const rows = await query(
      `SELECT contribution_id, repo, category, status, score_total, eligible, tx_hash, created_at
       FROM contribution_mirror WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [req.user!.id],
    );

    // Self-heal rows stored under a fallback tx- id (or left stale) by
    // reconciling with the authoritative on-chain record.
    const items = await Promise.all(
      rows.rows.map(async (row) => {
        const stale = String(row.contribution_id).startsWith("tx-") || row.status === "submitted";
        if (!stale) return row;
        try {
          const onchain = (await contractRead("get_contribution_by_repo", [String(row.repo)], 60)) as
            Record<string, unknown>;
          const fixed = {
            ...row,
            contribution_id: String(onchain.id ?? row.contribution_id),
            status: String(onchain.status ?? row.status),
            score_total: Number(onchain.score_total ?? row.score_total),
            eligible: Boolean(onchain.eligible ?? row.eligible),
          };
          if (fixed.contribution_id !== row.contribution_id || fixed.status !== row.status) {
            void query(
              `UPDATE contribution_mirror
               SET contribution_id = $1, status = $2, score_total = $3, eligible = $4, updated_at = now()
               WHERE repo = $5 AND user_id = $6`,
              [fixed.contribution_id, fixed.status, fixed.score_total, fixed.eligible, row.repo, req.user!.id],
            ).catch((err) => logger.warn({ err }, "mirror self-heal failed"));
          }
          return fixed;
        } catch {
          return row;
        }
      }),
    );
    res.json({ items });
  }),
);

// -------------------------------------------------------------- my grants
// The contract only exposes paginated list_grants (no per-wallet filter),
// so we page through it server-side and match by wallet. Grant volume is
// expected to stay small (one grant per eligible contribution per epoch).
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

    const payoutRows = await query(
      "SELECT grant_id, status, tx_hash FROM grant_payouts WHERE grant_id = ANY($1)",
      [mine.map((g) => String(g.id))],
    );
    const payoutByGrant = new Map(payoutRows.rows.map((r) => [String(r.grant_id), r]));

    res.json({
      items: mine.map((g) => ({
        ...g,
        payout: payoutByGrant.get(String(g.id)) ?? null,
      })),
    });
  }),
);

function extractReturnedId(consensusData: unknown): string | null {
  if (typeof consensusData === "string" && consensusData.startsWith("c-")) return consensusData;
  if (consensusData && typeof consensusData === "object") {
    const maybe = (consensusData as Record<string, unknown>).result;
    if (typeof maybe === "string" && maybe.startsWith("c-")) return maybe;
  }
  return null;
}
