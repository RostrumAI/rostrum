import { CamelCasePlugin, Kysely } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";
import type { Database } from "./schema/database";

/**
 * Creates one typed Kysely instance over postgres.js bound to this
 * package's schema.
 *
 * The `Database` table map in `./schema/` is the compile-time image of the
 * tables the migration modules create, so every query written against the
 * returned instance is checked by `tsc` before anything runs. The
 * CamelCase plugin maps TypeScript identifiers to the snake_case columns
 * the migrations define, so queries stay idiomatic without duplicating
 * column names. One call opens one connection pool; close it with
 * `db.destroy()`.
 */
export function createDatabase(databaseUrl: string): Kysely<Database> {
    return new Kysely<Database>({
        dialect: new PostgresJSDialect({ postgres: postgres(databaseUrl) }),
        plugins: [new CamelCasePlugin()],
    });
}
