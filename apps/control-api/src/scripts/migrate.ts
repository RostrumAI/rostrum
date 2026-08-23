import { join } from "node:path";
import { migrateToLatest } from "@rostrum/storage";
import { createWorkflowStore } from "../workflows/store";

// Targets the Docker Compose Postgres service (docker-compose.yml); a
// custom DATABASE_URL selects any other target.
const DEFAULT_DATABASE_URL = "postgres://rostrum:rostrum@localhost:5432/rostrum";

const store = createWorkflowStore(process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL);
try {
    const applied = await migrateToLatest(
        store.db,
        join(import.meta.dir, "..", "..", "migrations"),
    );
    for (const result of applied) {
        console.log(`${result.status}: ${result.migrationName}`);
    }
} finally {
    await store.close();
}
