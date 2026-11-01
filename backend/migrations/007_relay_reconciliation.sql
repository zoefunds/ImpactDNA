ALTER TABLE pending_deposits ADD COLUMN IF NOT EXISTS deposit_id TEXT;
ALTER TABLE pending_deposits ADD COLUMN IF NOT EXISTS reconciliation_tx TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS pending_deposits_deposit_id_idx
  ON pending_deposits (deposit_id) WHERE deposit_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS pending_claims (
  event_id       TEXT PRIMARY KEY,
  base_tx_hash   TEXT NOT NULL,
  epoch_hash     TEXT NOT NULL,
  recipient      TEXT NOT NULL,
  amount_usdc    TEXT NOT NULL,
  block_number   BIGINT NOT NULL,
  log_index      INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','failed')),
  grant_id       TEXT,
  applied_tx     TEXT,
  attempts       INTEGER NOT NULL DEFAULT 0,
  last_error     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pending_claims_status_idx ON pending_claims (status, created_at);
