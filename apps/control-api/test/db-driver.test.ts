import { afterAll, describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config";
import { createDb } from "../src/db/client";

/**
 * Row 5: the postgres.js driver under Bun — connection, prepared statements,
 * and transaction commit/rollback. Requires the local Postgres
 * (docker compose up -d --wait postgres).
 */
const config = loadConfig();
const db = createDb(config.databaseUrl);

afterAll(async () => {
  await db.end();
});

describe("postgres.js driver under Bun", () => {
  test("connects and runs a prepared statement", async () => {
    const rows = await db`select 1 as one`;
    expect(rows[0]?.one).toBe(1);
  });

  test("prepared statements round-trip through a temp table", async () => {
    await db.unsafe("CREATE TEMP TABLE poc_driver_rows (id int, label text)");
    await db`INSERT INTO poc_driver_rows ${db([
      { id: 1, label: "one" },
      { id: 2, label: "two" },
    ])}`;
    const rows = await db`SELECT id, label FROM poc_driver_rows ORDER BY id`;
    expect(rows.map((r) => ({ id: r.id, label: r.label }))).toEqual([
      { id: 1, label: "one" },
      { id: 2, label: "two" },
    ]);
  });

  test("commits a transaction", async () => {
    await db.unsafe("CREATE TEMP TABLE poc_driver_commit (id int)");
    await db.begin(async (tx) => {
      await tx`INSERT INTO poc_driver_commit VALUES (${7})`;
    });
    const rows = await db`SELECT count(*)::int AS count FROM poc_driver_commit`;
    expect(rows[0]?.count).toBe(1);
  });

  test("rolls back a transaction", async () => {
    await db.unsafe("CREATE TEMP TABLE poc_driver_rollback (id int)");
    try {
      await db.begin(async (tx) => {
        await tx`INSERT INTO poc_driver_rollback VALUES (${9})`;
        throw new Error("rollback me");
      });
    } catch {
      // expected
    }
    const rows = await db`SELECT count(*)::int AS count FROM poc_driver_rollback`;
    expect(rows[0]?.count).toBe(0);
  });
});
