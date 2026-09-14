/** @fileoverview Explicit database migration command. */

import { createDatabase, type DatabaseOptions, migrateToLatest } from "../index";

// Migration is an explicit operator command; application startup never calls it.
// Use environment only, with no application YAML or implicit database target.
const url = process.env.DATABASE_URL;
if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
}
const tls = process.env.DATABASE_TLS ?? "true";
const nodeEnv = process.env.NODE_ENV ?? "development";
const insecure = process.env.ALLOW_INSECURE_LOCAL ?? "false";
if (
    (tls !== "true" && tls !== "false") ||
    (nodeEnv !== "development" && nodeEnv !== "test" && nodeEnv !== "production") ||
    (insecure !== "true" && insecure !== "false")
) {
    console.error("Invalid database migration environment settings.");
    process.exit(1);
}
const options: DatabaseOptions = {
    url,
    tls: tls === "true",
    nodeEnv,
    allowInsecureLocal: insecure === "true",
    applicationName: "migrate",
};
let handle: ReturnType<typeof createDatabase> | undefined;
try {
    handle = createDatabase(options);
    const applied = await migrateToLatest(handle.db);
    for (const result of applied) {
        console.log(`${result.status}: ${result.migrationName}`);
    }
} catch {
    // Driver errors may include credentials, SQL, or connection parameters.
    console.error("Database migration failed; check configuration and database availability.");
    process.exitCode = 1;
} finally {
    await handle?.close({ timeoutMs: 5_000 });
}
