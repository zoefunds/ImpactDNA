-- Real GEN custody lives in a backend-controlled treasury wallet (plain
-- EOA), not inside the intelligent contract: GenVM contracts can receive
-- native value (payable) but expose no way to send it back out, so
-- holding funds in the contract would trap them permanently. The
-- contract remains the authoritative ledger (grants, claims); this
-- wallet executes the matching real payouts as native-value transfers.
CREATE TABLE treasury_wallet (
  id          INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  address     TEXT NOT NULL,
  ciphertext  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE grant_payouts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id     TEXT NOT NULL UNIQUE,
  wallet       TEXT NOT NULL,
  amount_atto  TEXT NOT NULL,
  tx_hash      TEXT,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX grant_payouts_status_idx ON grant_payouts (status);
