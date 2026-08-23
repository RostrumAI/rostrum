import { PublicationPreparer, V1_RULE_SET } from "@rostrum/workflow";
import type { Kysely } from "kysely";
import type { WorkflowDatabase } from "./database";
import { createDatabase } from "./database";
import { WorkflowStorage } from "./workflow-storage";

/** One open storage: the typed Kysely instance plus the workflow repository. */
export interface RostrumStorage {
    readonly db: Kysely<WorkflowDatabase>;
    readonly workflows: WorkflowStorage;
    /** Closes the underlying connection pool. */
    close(): Promise<void>;
}

/**
 * Opens storage against one Postgres URL. Migrations are not run here;
 * call {@link migrateToLatest} when startup or tests need the schema.
 */
export function createStorage(
    databaseUrl: string,
    preparer: PublicationPreparer = new PublicationPreparer(V1_RULE_SET),
): RostrumStorage {
    const db = createDatabase(databaseUrl);
    return {
        db,
        workflows: new WorkflowStorage(db, preparer),
        close: () => db.destroy(),
    };
}
