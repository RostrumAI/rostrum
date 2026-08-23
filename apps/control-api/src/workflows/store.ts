import { createDatabase } from "@rostrum/storage";
import { PublicationPreparer, V1_RULE_SET } from "@rostrum/workflow";
import type { Kysely } from "kysely";
import type { WorkflowDatabase } from "./schema";
import { WorkflowStorage } from "./workflow-storage";

/** One open workflow store: the typed connection plus the repository. */
export interface WorkflowStore {
    readonly db: Kysely<WorkflowDatabase>;
    readonly workflows: WorkflowStorage;
    /** Closes the underlying connection pool. */
    close(): Promise<void>;
}

/**
 * Opens the workflow store against one Postgres URL. Each process owns
 * its pool and no other shared state, so any number of instances can run
 * in parallel behind a load balancer: saves, publishes, and rewinds
 * coordinate through Postgres row locks, and the unique indexes decide
 * concurrent publish races. Migrations are not run here; deploy tooling
 * applies them once per rollout with `bun run db:migrate`.
 *
 * The publication preparer supplies the metadata members the digest
 * excludes; it defaults to the frozen v1 rule set's classification.
 */
export function createWorkflowStore(
    databaseUrl: string,
    preparer: PublicationPreparer = new PublicationPreparer(V1_RULE_SET),
): WorkflowStore {
    const db = createDatabase<WorkflowDatabase>(databaseUrl);
    return {
        db,
        workflows: new WorkflowStorage(db, preparer),
        close: () => db.destroy(),
    };
}
