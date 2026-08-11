import { Kysely } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";
import type { Database } from "./types";

export type Sql = postgres.Sql<Record<string, unknown>>;

export function createDb(url: string): Sql {
  return postgres(url, {
    max: 5,
    connection: { application_name: "rostrum-control-api" },
  });
}

export function createKysely(db: Sql): Kysely<Database> {
  return new Kysely<Database>({ dialect: new PostgresJSDialect({ postgres: db }) });
}
