import { createStorage, migrateToLatest } from "../index";

// Targets the Docker Compose Postgres service (docker-compose.yml); a
// custom DATABASE_URL selects any other target.
const DEFAULT_DATABASE_URL = "postgres://rostrum:rostrum@localhost:5432/rostrum";

const storage = createStorage(process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL);
try {
    const applied = await migrateToLatest(storage.db);
    for (const result of applied) {
        console.log(`${result.status}: ${result.migrationName}`);
    }
} finally {
    await storage.close();
}
