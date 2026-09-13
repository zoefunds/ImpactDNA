import { Router } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { query } from "../db.js";
import { config } from "../config.js";
import { sha256Hex, randomToken } from "../lib/crypto.js";
import { issueNonce, verifyWalletSignature, normalizeAddress, buildSignMessage } from "../lib/siwe.js";
import { signAccessToken, requireAuth } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { wrap, validateBody, HttpError } from "../middleware/errors.js";
import { logger } from "../lib/logger.js";
import {
  githubConfigured,
  signOAuthState,
  verifyOAuthState,
  buildAuthorizeUrl,
  exchangeCodeForProfile,
} from "../lib/githubOAuth.js";

export const authRouter = Router();

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

async function audit(userId: string | null, action: string, ip: string | undefined, detail: object) {
  await query(
    "INSERT INTO audit_events (user_id, action, ip, detail) VALUES ($1,$2,$3,$4)",
    [userId, action, ip ?? null, JSON.stringify(detail)],
  ).catch((err) => logger.error({ err }, "audit insert failed"));
}

async function issueRefreshToken(userId: string): Promise<string> {
  const token = randomToken(48);
  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + ($3 || ' days')::interval)`,
    [userId, sha256Hex(token), String(config.REFRESH_TOKEN_TTL_DAYS)],
  );
  return token;
}

function publicUser(row: Record<string, unknown>) {
  return {
    id: row.id,
    walletAddress: row.wallet_address,
    displayName: row.display_name,
    email: row.email,
    githubUsername: row.github_username,
    role: row.role,
    createdAt: row.created_at,
  };
}

// -------------------------------------------------------------- nonce
// Step 1 of wallet-connect login: get a fresh single-use nonce to sign.
authRouter.get(
  "/nonce",
  rateLimit("auth-nonce", 30, 900),
  wrap(async (req, res) => {
    const address = String(req.query.address ?? "");
    if (!ADDRESS_RE.test(address)) throw new HttpError(400, "Invalid wallet address");
    const nonce = await issueNonce(address);
    res.json({ nonce, message: buildSignMessage(address, nonce) });
  }),
);

// ------------------------------------------------------------------- verify
// Step 2: the wallet signs the message from /nonce; verifying it both
// authenticates and (on first sight of this address) registers the
// account — there is no separate register step for wallet-connect.
authRouter.post(
  "/verify",
  rateLimit("auth-verify", 30, 900),
  validateBody(
    z.object({
      address: z.string().regex(ADDRESS_RE),
      message: z.string().min(10).max(2000),
      signature: z.string().min(10).max(1000),
      displayName: z.string().trim().min(0).max(60).optional(),
    }),
  ),
  wrap(async (req, res) => {
    const { address, message, signature, displayName } = req.body as {
      address: string;
      message: string;
      signature: string;
      displayName?: string;
    };
    const ok = await verifyWalletSignature(address, message, signature);
    if (!ok) {
      await audit(null, "wallet_verify_failed", req.ip, { address });
      throw new HttpError(401, "Signature verification failed");
    }

    const normalized = normalizeAddress(address);
    let found = await query("SELECT * FROM users WHERE lower(wallet_address) = $1", [normalized]);
    let user = found.rows[0];
    let created = false;
    if (!user) {
      const inserted = await query(
        `INSERT INTO users (wallet_address, display_name) VALUES ($1, $2) RETURNING *`,
        [normalized, (displayName || `${normalized.slice(0, 6)}...${normalized.slice(-4)}`).slice(0, 60)],
      );
      user = inserted.rows[0];
      created = true;
    }
    await audit(String(user.id), created ? "wallet_register" : "wallet_login", req.ip, { address: normalized });

    const accessToken = signAccessToken({
      id: String(user.id),
      walletAddress: String(user.wallet_address),
      role: user.role as "developer",
    });
    const refreshToken = await issueRefreshToken(String(user.id));
    res.status(created ? 201 : 200).json({ user: publicUser(user), accessToken, refreshToken });
  }),
);

// ------------------------------------------------------------------ refresh
authRouter.post(
  "/refresh",
  rateLimit("refresh", 60, 3600),
  validateBody(z.object({ refreshToken: z.string().min(20).max(200) })),
  wrap(async (req, res) => {
    const { refreshToken } = req.body as { refreshToken: string };
    const found = await query(
      `SELECT rt.*, u.wallet_address, u.role FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = $1 AND NOT rt.revoked AND rt.expires_at > now()`,
      [sha256Hex(refreshToken)],
    );
    const row = found.rows[0];
    if (!row) throw new HttpError(401, "Invalid refresh token");
    // Rotate: revoke old, issue new.
    await query("UPDATE refresh_tokens SET revoked = TRUE WHERE id = $1", [row.id]);
    const accessToken = signAccessToken({
      id: String(row.user_id),
      walletAddress: String(row.wallet_address),
      role: row.role as "developer",
    });
    const newRefresh = await issueRefreshToken(String(row.user_id));
    res.json({ accessToken, refreshToken: newRefresh });
  }),
);

// ------------------------------------------------------------------- logout
authRouter.post(
  "/logout",
  requireAuth,
  wrap(async (req, res) => {
    await query("UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = $1", [req.user!.id]);
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------- github oauth
// Replaces free-text GitHub username entry: a user can only link an
// account they can actually authenticate as via GitHub's own login.
// Optional profile add-on — identity itself is the connected wallet.
authRouter.get(
  "/github/start",
  rateLimit("github-oauth-start", 20, 3600),
  wrap(async (req, res) => {
    if (!githubConfigured()) throw new HttpError(503, "GitHub OAuth is not configured yet");
    const token = String(req.query.token ?? "");
    let userId: string;
    try {
      const payload = jwt.verify(token, config.JWT_SECRET, { issuer: "impactdna" }) as jwt.JwtPayload;
      userId = String(payload.sub);
    } catch {
      throw new HttpError(401, "Invalid or expired session");
    }
    const state = signOAuthState(userId);
    res.redirect(buildAuthorizeUrl(state));
  }),
);

authRouter.get(
  "/github/callback",
  rateLimit("github-oauth-callback", 30, 3600),
  wrap(async (req, res) => {
    const code = String(req.query.code ?? "");
    const state = String(req.query.state ?? "");
    const fail = (reason: string) =>
      res.redirect(`${config.FRONTEND_URL}/dashboard?github=error&reason=${encodeURIComponent(reason)}`);

    if (!code || !state) return fail("missing_code_or_state");

    let userId: string;
    try {
      userId = verifyOAuthState(state);
    } catch {
      return fail("invalid_state");
    }

    let profile;
    try {
      profile = await exchangeCodeForProfile(code);
    } catch (err) {
      logger.warn({ err }, "github oauth exchange failed");
      return fail("github_exchange_failed");
    }

    const taken = await query(
      "SELECT id FROM users WHERE github_id = $1 AND id <> $2",
      [profile.id, userId],
    );
    if (taken.rowCount) return fail("github_account_already_linked");

    await query(
      "UPDATE users SET github_username = $1, github_id = $2, updated_at = now() WHERE id = $3",
      [profile.login, profile.id, userId],
    );
    await audit(userId, "github_linked", req.ip, { githubId: profile.id, login: profile.login });
    res.redirect(`${config.FRONTEND_URL}/dashboard?github=connected`);
  }),
);

// ---------------------------------------------------------------------- me
authRouter.get(
  "/me",
  requireAuth,
  wrap(async (req, res) => {
    const found = await query("SELECT * FROM users WHERE id = $1", [req.user!.id]);
    if (!found.rowCount) throw new HttpError(404, "User not found");
    res.json({ user: publicUser(found.rows[0]) });
  }),
);
