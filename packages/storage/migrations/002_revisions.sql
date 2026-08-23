-- UP
CREATE TABLE revisions (
    id uuid PRIMARY KEY,
    workflow_id uuid NOT NULL REFERENCES workflows (id),
    -- The exact submitted bytes; retrieval returns them unchanged and
    -- findings' line and column stay anchored to this text (E1-S3).
    content text NOT NULL,
    -- The validation findings snapshot, serialized JSON.
    findings text NOT NULL,
    name text,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Backstop unique index named by E1-S3's save contract; the primary key
-- already enforces global uniqueness.
CREATE UNIQUE INDEX revisions_workflow_backstop_idx ON revisions (workflow_id, id);

ALTER TABLE workflows
    ADD CONSTRAINT workflows_current_revision_fk
    FOREIGN KEY (current_revision) REFERENCES revisions (id)
    DEFERRABLE INITIALLY DEFERRED;

-- DOWN
ALTER TABLE workflows DROP CONSTRAINT workflows_current_revision_fk;
DROP INDEX revisions_workflow_backstop_idx;
DROP TABLE revisions;
