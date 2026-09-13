-- USDC funding now lives in ImpactDnaEscrow.sol on Base Sepolia, relayed
-- to/from the GenLayer contract by a dedicated backend relayer (see
-- src/services/baseSepolia.ts, src/services/genlayerRelay.ts,
-- src/jobs/relay.ts). This replaces the old native-GEN treasury wallet.
DROP TABLE IF EXISTS grant_payouts;
DROP TABLE IF EXISTS treasury_wallet;

-- Every confirmed Deposited(epochId, from, amount) event on the escrow
-- lands here before being applied to GenLayer's record_deposit(), so a
-- crash between "deposit confirmed" and "GenLayer write landed" is
-- recoverable by simply retrying unapplied rows — never silently lost.
CREATE TABLE pending_deposits (
  base_tx_hash   TEXT PRIMARY KEY,
  -- Resolved GenLayer epoch id (e.g. "e-3"). The escrow event only carries
  -- the bytes32 hash of this string, so the scanner resolves it back by
  -- matching against list_epochs() before inserting this row.
  epoch_id       TEXT NOT NULL,
  depositor      TEXT NOT NULL,
  amount_usdc    TEXT NOT NULL, -- base units, 6 decimals, stored as text (fits bigint but avoid overflow surprises)
  block_number   BIGINT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','failed')),
  attempts       INTEGER NOT NULL DEFAULT 0,
  last_error     TEXT,
  applied_tx     TEXT, -- GenLayer tx hash once record_deposit() lands
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX pending_deposits_status_idx ON pending_deposits (status);

-- Generic relay cursor storage (last scanned Base Sepolia block, etc.),
-- keyed by an arbitrary string so one table serves every relay loop.
CREATE TABLE relay_sync_state (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
