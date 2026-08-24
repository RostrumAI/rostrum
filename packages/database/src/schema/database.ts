import type { PublishedVersionRow } from "./published-versions";
import type { RevisionRow } from "./revisions";
import type { WorkflowRow } from "./workflows";

/**
 * The complete database schema: every table Rostrum stores in Postgres.
 *
 * These interfaces are the compile-time image of the tables the migration
 * modules in `../../migrations/` create; the CamelCase plugin maps each
 * member to its snake_case column. Every value is a storage primitive:
 * documents and findings snapshots travel as text, and the repositories
 * own parsing them back into application types.
 */
export interface Database {
    workflows: WorkflowRow;
    revisions: RevisionRow;
    publishedVersions: PublishedVersionRow;
}
