import type { ColumnType } from "kysely";

/**
 * Kysely table shapes for the proof of concept. The persistence contract the
 * Control API and the future daemon share lands here; E1-07 extends it with
 * findings and the full lifecycle.
 */
export interface Database {
  drafts: {
    id: string;
    content: unknown;
    created_at: ColumnType<Date, never, Date>;
  };
  revisions: {
    id: string;
    draft_id: string;
    revision: number;
    content: unknown;
    created_at: ColumnType<Date, never, Date>;
  };
  published_versions: {
    id: string;
    version: number;
    content: unknown;
    digest: string;
    created_at: ColumnType<Date, never, Date>;
  };
}
