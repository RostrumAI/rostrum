-- UP
CREATE TABLE workflows (
    id uuid PRIMARY KEY,
    current_revision uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- DOWN
DROP TABLE workflows;
