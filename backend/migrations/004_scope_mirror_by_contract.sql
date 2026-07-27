-- contribution_mirror.contribution_id (c-1, c-2, ...) is assigned by the
-- on-chain contract's own counter, which restarts from c-1 whenever the
-- app points at a newly-deployed contract. Without a notion of *which*
-- contract a row came from, a redeploy collides bare IDs with history:
-- a fresh c-2 from the new contract silently no-ops against an old c-2
-- row via ON CONFLICT DO NOTHING, so the new submission never gets
-- mirrored (and never shows an "Evaluate now" button).
--
-- Existing rows predate this column and cannot be attributed to a
-- specific historical contract address with certainty, so they're
-- backfilled with the 'legacy' sentinel -- distinct from any real
-- address (which always starts with 0x) and therefore never collides.

ALTER TABLE contribution_mirror
  ADD COLUMN contract_address TEXT NOT NULL DEFAULT 'legacy';

ALTER TABLE contribution_mirror
  DROP CONSTRAINT contribution_mirror_pkey;

ALTER TABLE contribution_mirror
  ADD CONSTRAINT contribution_mirror_pkey PRIMARY KEY (contract_address, contribution_id);

CREATE INDEX contribution_mirror_contract_idx ON contribution_mirror (contract_address);
