import { CamelCasePlugin, Kysely } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";

/**
 * Creates one typed Kysely instance over postgres.js.
 *
 * The caller owns the database shape: `DB` is the caller's own table map,
 * so this package never names a table or a column. The CamelCase plugin
 * maps TypeScript identifiers to the snake_case columns migrations define,
 * so queries stay idiomatic without duplicating column names. One call
 * opens one connection pool; close it with `db.destroy()`.
 */
export function createDatabase<DB>(databaseUrl: string): Kysely<DB> {
    return new Kysely<DB>({
        dialect: new PostgresJSDialect({ postgres: postgres(databaseUrl) }),
        plugins: [new CamelCasePlugin()],
    });
}
