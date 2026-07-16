-- GitHub identity is now bound via OAuth (not free-text username entry),
-- so a stable numeric id is required to prevent one GitHub account being
-- claimed by multiple ImpactDNA users, and to survive username changes.
ALTER TABLE users ADD COLUMN github_id BIGINT;
CREATE UNIQUE INDEX users_github_id_idx ON users (github_id) WHERE github_id IS NOT NULL;
