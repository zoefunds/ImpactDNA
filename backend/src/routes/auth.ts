import { Router } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { query } from "../db.js";
import { config } from "../config.js";
import { createWallet } from "../lib/wallet.js";
import { sha256Hex, randomToken } from "../lib/crypto.js";
import { sendEmail, welcomeEmail, resetEmail } from "../lib/email.js";
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

const PASSWORD_RULES = z
  .string()
  .min(10, "at least 10 characters")
  .regex(/[a-z]/, "needs a lowercase letter")
  .regex(/[A-Z]/, "needs an uppercase letter")
  .regex(/[0-9]/, "needs a digit");

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
    email: row.email,
    displayName: row.display_name,
    githubUsername: row.github_username,
    role: row.role,
    walletAddress: row.wallet_address,
    emailVerified: row.email_verified,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------- register
authRouter.post(
  "/register",
  rateLimit("register", 10, 3600),
  validateBody(
    z.object({
      email: z.string().email().max(254),
      password: PASSWORD_RULES,
      displayName: z.string().trim().min(2).max(60),
    }),
  ),
  wrap(async (req, res) => {
    const { email, password, displayName } = req.body as {
      email: string;
      password: string;
      displayName: string;
    };
    const existing = await query("SELECT 1 FROM users WHERE lower(email) = lower($1)", [email]);
    if (existing.rowCount) throw new HttpError(409, "An account with this email already exists");

    const passwordHash = await bcrypt.hash(password, 12);
    const wallet = createWallet();
    const inserted = await query(
      `INSERT INTO users (email, password_hash, display_name, wallet_address, wallet_ciphertext)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [email.toLowerCase(), passwordHash, displayName, wallet.address, wallet.ciphertext],
    );
    const user = inserted.rows[0];
    await audit(String(user.id), "register", req.ip, { email: email.toLowerCase() });

    const mail = welcomeEmail(displayName, wallet.address);
    void sendEmail({ to: email, ...mail, kind: "welcome", userId: String(user.id) });

    const accessToken = signAccessToken({
      id: String(user.id),
      email: String(user.email),
      role: user.role as "developer",
    });
    const refreshToken = await issueRefreshToken(String(user.id));
    res.status(201).json({ user: publicUser(user), accessToken, refreshToken });
  }),
);

// ------------------------------------------------------------------- login
authRouter.post(
  "/login",
  rateLimit("login", 15, 900),
  validateBody(z.object({ email: z.string().email(), password: z.string().min(1).max(200) })),
  wrap(async (req, res) => {
    const { email, password } = req.body as { email: string; password: string };
    const found = await query("SELECT * FROM users WHERE lower(email) = lower($1)", [email]);
    const user = found.rows[0];
    const ok = user && (await bcrypt.compare(password, String(user.password_hash)));
    if (!ok) {
      await audit(user ? String(user.id) : null, "login_failed", req.ip, {});
      throw new HttpError(401, "Invalid email or password");
    }
    await audit(String(user.id), "login", req.ip, {});
    const accessToken = signAccessToken({
      id: String(user.id),
      email: String(user.email),
      role: user.role as "developer",
    });
    const refreshToken = await issueRefreshToken(String(user.id));
    res.json({ user: publicUser(user), accessToken, refreshToken });
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
      `SELECT rt.*, u.email, u.role FROM refresh_tokens rt
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
      email: String(row.email),
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

// ---------------------------------------------------------- forgot password
authRouter.post(
  "/forgot-password",
  rateLimit("forgot", 5, 3600),
  validateBody(z.object({ email: z.string().email() })),
  wrap(async (req, res) => {
    const { email } = req.body as { email: string };
    const found = await query("SELECT id, email FROM users WHERE lower(email) = lower($1)", [email]);
    const user = found.rows[0];
    // Uniform response — do not leak account existence.
    if (user) {
      const token = randomToken(32);
      await query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, now() + interval '30 minutes')`,
        [user.id, sha256Hex(token)],
      );
      const url = `${config.FRONTEND_URL}/reset-password?token=${token}`;
      const mail = resetEmail(url);
      void sendEmail({ to: String(user.email), ...mail, kind: "password_reset", userId: String(user.id) });
      await audit(String(user.id), "forgot_password", req.ip, {});
    }
    res.json({ ok: true, message: "If that email exists, a reset link has been sent." });
  }),
);

// ----------------------------------------------------------- reset password
authRouter.post(
  "/reset-password",
  rateLimit("reset", 10, 3600),
  validateBody(z.object({ token: z.string().min(20).max(200), password: PASSWORD_RULES })),
  wrap(async (req, res) => {
    const { token, password } = req.body as { token: string; password: string };
    const found = await query(
      `SELECT * FROM password_reset_tokens
       WHERE token_hash = $1 AND NOT used AND expires_at > now()`,
      [sha256Hex(token)],
    );
    const row = found.rows[0];
    if (!row) throw new HttpError(400, "Reset link is invalid or has expired");
    const passwordHash = await bcrypt.hash(password, 12);
    await query("UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2", [
      passwordHash,
      row.user_id,
    ]);
    await query("UPDATE password_reset_tokens SET used = TRUE WHERE id = $1", [row.id]);
    await query("UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = $1", [row.user_id]);
    await audit(String(row.user_id), "reset_password", req.ip, {});
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------- github oauth
// Replaces free-text GitHub username entry: a user can only link an
// account they can actually authenticate as via GitHub's own login.
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
