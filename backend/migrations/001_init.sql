-- ImpactDNA core schema
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL DEFAULT '',
  github_username TEXT,
  role          TEXT NOT NULL DEFAULT 'developer' CHECK (role IN ('developer','curator','admin')),
  -- Custodial wallet: address is permanent; private key stored AES-256-GCM encrypted.
  wallet_address    TEXT NOT NULL UNIQUE,
  wallet_ciphertext TEXT NOT NULL,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email));
CREATE INDEX users_github_idx ON users (github_username);

CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);

CREATE TABLE password_reset_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX password_reset_user_idx ON password_reset_tokens (user_id);

-- Local mirror of on-chain submissions for fast dashboards (source of
-- truth remains the intelligent contract).
CREATE TABLE contribution_mirror (
  contribution_id TEXT PRIMARY KEY,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  repo        TEXT NOT NULL,
  category    TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'submitted',
  score_total INTEGER NOT NULL DEFAULT 0,
  eligible    BOOLEAN NOT NULL DEFAULT FALSE,
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  tx_hash     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX contribution_mirror_user_idx ON contribution_mirror (user_id);
CREATE INDEX contribution_mirror_status_idx ON contribution_mirror (status);

CREATE TABLE notification_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  kind       TEXT NOT NULL,
  recipient  TEXT NOT NULL,
  subject    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'sent',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_events (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID,
  action     TEXT NOT NULL,
  ip         TEXT,
  detail     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_user_idx ON audit_events (user_id, created_at DESC);
