/**
 * Entry point of the shared storage package.
 *
 * The package is persistence infrastructure and knows nothing about what
 * it stores: `createDatabase` opens one typed Kysely connection pool over
 * postgres.js (E1-S0) against any database shape the caller declares, and
 * `migrateToLatest` applies the caller's TypeScript migration modules.
 * Each application owns its schema types, its migration files, and its
 * domain repositories next to the code that executes them — for workflow
 * drafts, revisions, and published versions, that is the Control API.
 */

export { createDatabase } from "./database";
export { migrateToLatest, TsFileMigrationProvider } from "./migrator";
