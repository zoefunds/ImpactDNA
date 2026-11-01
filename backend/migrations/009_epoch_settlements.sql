CREATE TABLE IF NOT EXISTS epoch_settlements (
  epoch_id TEXT PRIMARY KEY,
  base_tx_hash TEXT,
  settlement_kind TEXT NOT NULL CHECK (settlement_kind IN ('grants', 'empty')),
  genlayer_marked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
