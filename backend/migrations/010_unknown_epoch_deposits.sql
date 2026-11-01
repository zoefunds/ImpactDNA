ALTER TABLE pending_deposits ALTER COLUMN epoch_id DROP NOT NULL;
ALTER TABLE pending_deposits ADD COLUMN IF NOT EXISTS epoch_hash TEXT;
CREATE INDEX IF NOT EXISTS pending_deposits_epoch_status_idx
  ON pending_deposits (epoch_id, status, created_at);
