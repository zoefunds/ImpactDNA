-- Full relaunch: email/password + custodial wallets are replaced by
-- wallet-connect (Reown AppKit) + a SIWE-style signature challenge. No
-- existing user data is being carried forward (confirmed relaunch), so
-- this drops and recreates the identity tables cleanly rather than
-- ALTERing around now-dead columns (password_hash, wallet_ciphertext,
-- email verification, password reset).

-- CASCADE drops the FK constraints that contribution_mirror/notification_log
-- hold against users(id) — the referencing tables themselves are untouched;
-- the constraints are re-added below once the new users table exists.
DROP TABLE IF EXISTS password_reset_tokens;
DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS users CASCADE;

CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The connected wallet IS the identity; lowercased hex for stable lookup.
  wallet_address  TEXT NOT NULL UNIQUE,
  display_name    TEXT NOT NULL DEFAULT '',
  -- Optional, notification-only — never a login credential.
  email           TEXT,
  github_username TEXT,
  github_id       BIGINT,
  role            TEXT NOT NULL DEFAULT 'developer' CHECK (role IN ('developer','curator','admin')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX users_wallet_idx ON users (lower(wallet_address));
CREATE UNIQUE INDEX users_github_id_idx ON users (github_id) WHERE github_id IS NOT NULL;
CREATE INDEX users_github_username_idx ON users (github_username);

CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);

-- SIWE-style challenge: one single-use nonce per wallet address at a
-- time, short TTL, deleted (not just flagged) once consumed so a nonce
-- can never be replayed.
CREATE TABLE auth_nonces (
  wallet_address TEXT PRIMARY KEY,
  nonce          TEXT NOT NULL,
  expires_at     TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Re-establish the FKs the CASCADE above removed.
ALTER TABLE contribution_mirror
  ADD CONSTRAINT contribution_mirror_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE notification_log
  ADD CONSTRAINT notification_log_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
