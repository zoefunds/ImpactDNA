-- One Base transaction may emit several Deposited logs (for example through
-- a smart-account batch). Transaction hash alone is therefore not an event
-- identity. Preserve both the transaction/log identity and the contract's
-- globally unique depositId.
ALTER TABLE pending_deposits ADD COLUMN IF NOT EXISTS log_index INTEGER;
ALTER TABLE pending_deposits ADD COLUMN IF NOT EXISTS event_id TEXT;

-- Rows created before this migration were unique by transaction hash, so this
-- legacy key is unambiguous. Newly scanned rows use <tx_hash>:<log_index>.
UPDATE pending_deposits
SET event_id = base_tx_hash || ':legacy'
WHERE event_id IS NULL;

ALTER TABLE pending_deposits ALTER COLUMN event_id SET NOT NULL;
ALTER TABLE pending_deposits DROP CONSTRAINT pending_deposits_pkey;
ALTER TABLE pending_deposits ADD CONSTRAINT pending_deposits_pkey PRIMARY KEY (event_id);

CREATE INDEX IF NOT EXISTS pending_deposits_base_tx_hash_idx
  ON pending_deposits (base_tx_hash);
