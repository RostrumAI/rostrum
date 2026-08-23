-- UP
CREATE TABLE published_versions (
    workflow_id uuid NOT NULL REFERENCES workflows (id),
    version_number integer NOT NULL CHECK (version_number >= 1),
    revision_id uuid NOT NULL REFERENCES revisions (id),
    interface_version text NOT NULL,
    canonical_text text NOT NULL,
    digest text NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
    created_at timestamptz NOT NULL DEFAULT now(),
    -- Per-workflow monotonic integer version numbers (E1-S3).
    PRIMARY KEY (workflow_id, version_number),
    -- A revision publishes at most once; this index decides the
    -- concurrent-publish race (E1-S3 publish contract).
    UNIQUE (workflow_id, revision_id)
);

-- DOWN
DROP TABLE published_versions;
