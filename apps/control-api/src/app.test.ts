import { describe, expect, test } from "bun:test";
import postgres from "postgres";
import { createApp } from "./app.ts";

const app = createApp();

describe("socket-free harness (E1-S0 proof-of-concept row 4)", () => {
  test("GET / responds through app.fetch() without a socket", async () => {
    const response = await app.fetch(new Request("http://localhost/"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ service: "rostrum-control-api" });
  });

  test("unknown routes return 404", async () => {
    const response = await app.fetch(new Request("http://localhost/missing"));
    expect(response.status).toBe(404);
  });
});

const databaseUrl = process.env.DATABASE_URL ?? "postgres://rostrum:rostrum@localhost:5432/rostrum";

async function isDatabaseReachable(): Promise<boolean> {
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 3 });
  try {
    await sql`select 1`;
    return true;
  } catch {
    return false;
  } finally {
    await sql.end();
  }
}

const databaseAvailable = await isDatabaseReachable();
if (!databaseAvailable) {
  console.warn(
    "Postgres is not reachable; the DB smoke test is skipped. Start it with: bun run db:up",
  );
}

describe("Postgres seam (E1-S0 proof-of-concept rows 5-6)", () => {
  test.skipIf(!databaseAvailable)("connects to DATABASE_URL and runs a query", async () => {
    const sql = postgres(databaseUrl, { max: 1 });
    try {
      const rows = await sql`select 1 as ok`;
      expect(rows[0]).toEqual({ ok: 1 });
    } finally {
      await sql.end();
    }
  });
});
