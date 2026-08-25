import { createDatabase, type Database, WorkflowRepository } from "@rostrum/database";
import { PublicationPreparer, V1_RULE_SET } from "@rostrum/workflow";
import type { Kysely } from "kysely";

/** One open workflow database: the typed connection plus the repository. */
export interface WorkflowDatabase {
    readonly db: Kysely<Database>;
    readonly workflows: WorkflowRepository;
    /** Closes the underlying connection pool. */
    close(): Promise<void>;
}

/**
 * Opens the workflow database against one Postgres URL. Each process owns
 * its pool and no other shared state, so any number of instances can run
 * in parallel behind a load balancer: saves, publishes, and rewinds
 * coordinate through Postgres row locks, and the unique indexes decide
 * concurrent publish races. Migrations are not run here; deploy tooling
 * applies them once per rollout with `bun run db:migrate`.
 *
 * The publication preparer supplies the metadata members the digest
 * excludes; it defaults to the frozen v1 rule set's classification.
 */
export function createWorkflowDatabase(
    databaseUrl: string,
    preparer: PublicationPreparer = new PublicationPreparer(V1_RULE_SET),
): WorkflowDatabase {
    const db = createDatabase(databaseUrl);
    return {
        db,
        workflows: new WorkflowRepository(db, preparer),
        close: () => db.destroy(),
    };
}
