-- UP
CREATE TABLE drafts (
  id text PRIMARY KEY,
  content jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- DOWN
DROP TABLE drafts;
