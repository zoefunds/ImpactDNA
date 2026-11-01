ALTER TABLE users ADD COLUMN IF NOT EXISTS github_proof_gist_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_github_proof_gist_id_idx
  ON users (github_proof_gist_id) WHERE github_proof_gist_id IS NOT NULL;
