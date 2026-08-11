-- UP
CREATE TABLE revisions (
  id text PRIMARY KEY,
  draft_id text NOT NULL REFERENCES drafts(id),
  revision integer NOT NULL,
  content jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (draft_id, revision)
);
CREATE TABLE published_versions (
  id text NOT NULL,
  version integer NOT NULL,
  content jsonb NOT NULL,
  digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, version)
);
-- DOWN
DROP TABLE published_versions;
DROP TABLE revisions;
