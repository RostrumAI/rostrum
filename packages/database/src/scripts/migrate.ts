import { createDatabase, migrateToLatest } from "../index";

// Scripts define no default target: the caller names the database through
// DATABASE_URL so a migration can never run against an unintended server.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
}

const db = createDatabase(databaseUrl);
try {
    const applied = await migrateToLatest(db);
    for (const result of applied) {
        console.log(`${result.status}: ${result.migrationName}`);
    }
} finally {
    await db.destroy();
}
