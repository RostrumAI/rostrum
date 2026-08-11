import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config";
import { createDb, type Sql } from "../src/db/client";
import { migrateDown, migrateToLatest } from "../src/db/migrate";

/**
 * Row 7: Kysely Migrator with SQL-file migrations. Uses a dedicated scratch
 * database so the shared dev database is never touched. Requires the local
 * Postgres and a superuser-capable DATABASE_URL (the compose default is).
 */
const TEST_DB = "rostrum_migrations_test";
const config = loadConfig();

async function databaseExists(db: Sql, name: string): Promise<boolean> {
  const rows = await db`SELECT 1 FROM pg_database WHERE datname = ${name}`;
  return rows.length > 0;
}

async function tableNames(db: Sql): Promise<string[]> {
  const rows = await db`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `;
  return rows.map((r) => r.table_name as string);
}

let admin: Sql;
let testDb: Sql;

beforeAll(async () => {
  admin = createDb(config.databaseUrl);
  if (await databaseExists(admin, TEST_DB)) {
    await admin.unsafe(`DROP DATABASE ${TEST_DB} WITH (FORCE)`);
  }
  await admin.unsafe(`CREATE DATABASE ${TEST_DB}`);
  const url = new URL(config.databaseUrl);
  url.pathname = `/${TEST_DB}`;
  testDb = createDb(url.toString());
});

afterAll(async () => {
  await testDb?.end();
  if (admin) {
    await admin.unsafe(`DROP DATABASE ${TEST_DB} WITH (FORCE)`).catch(() => undefined);
    await admin.end();
  }
});

describe("SQL-file migrations", () => {
  test("fresh database migrates to the correct schema", async () => {
    const results = await migrateToLatest(testDb);
    expect(results.map((r) => r.migrationName).sort()).toEqual(["001_drafts", "002_revisions"]);
    expect(results.every((r) => r.status === "Success")).toBe(true);

    const tables = await tableNames(testDb);
    expect(tables).toContain("drafts");
    expect(tables).toContain("revisions");
    expect(tables).toContain("published_versions");
    expect(tables).toContain("kysely_migration");
  });

  test("rerunning migrations is a no-op", async () => {
    const results = await migrateToLatest(testDb);
    expect(results).toEqual([]);
  });

  test("down-migration rolls the second step back", async () => {
    const results = await migrateDown(testDb);
    expect(results).toHaveLength(1);
    expect(results[0]?.migrationName).toBe("002_revisions");
    expect(results[0]?.status).toBe("Success");

    const tables = await tableNames(testDb);
    expect(tables).toContain("drafts");
    expect(tables).not.toContain("revisions");
    expect(tables).not.toContain("published_versions");
  });

  test("up again after down restores the schema", async () => {
    // 001_drafts stayed applied through the down; only 002 re-runs.
    const results = await migrateToLatest(testDb);
    expect(results.map((r) => r.migrationName)).toEqual(["002_revisions"]);
    const tables = await tableNames(testDb);
    expect(tables).toContain("revisions");
    expect(tables).toContain("published_versions");
  });
});
