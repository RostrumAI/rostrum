import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { createLogger } from "./logger";
import { ErrorResponseSchema, HealthSchema, Schemas, VersionSchema } from "./schemas";

function makeApp() {
  return createApp({
    logger: createLogger("error"),
    config: loadConfig({}),
  });
}

/** Narrow view of the generated OpenAPI document (hono-openapi output). */
interface OpenApiDoc {
  openapi: string;
  paths: Record<string, unknown>;
  components: { schemas: Record<string, Record<string, unknown>> };
}

/** One error response in the single error shape (E1-02 contract). */
interface ErrorBody {
  code: string;
  message: string;
  findings: unknown[];
}

async function fetchJson(app: ReturnType<typeof makeApp>, path: string, init?: RequestInit) {
  const res = await app.fetch(new Request(`http://localhost${path}`, init));
  return { res, body: (await res.json()) as Record<string, unknown> };
}

describe("socket-free app.fetch() harness (E1-02)", () => {
  test("health returns the documented response", async () => {
    const { res, body } = await fetchJson(makeApp(), "/api/v1/health");
    expect(res.status).toBe(200);
    expect(body).toEqual({ status: "ok" });
  });

  test("version returns the documented service and interface version", async () => {
    const { res, body } = await fetchJson(makeApp(), "/api/v1/version");
    expect(res.status).toBe(200);
    expect(body.service).toBe("rostrum-control-api");
    expect(body.interfaceVersion).toBe("v1");
    expect(typeof body.version).toBe("string");
  });

  test("unknown routes return 404 with the error shape", async () => {
    for (const path of ["/api/v1/definitely-not-a-route", "/", "/openapi.html"]) {
      const { res, body } = await fetchJson(makeApp(), path);
      expect(res.status).toBe(404);
      expect(body.code).toBe("not_found");
      expect(body.findings).toEqual([]);
    }
  });

  test("disallowed methods return 405 with Allow and the error shape", async () => {
    const app = makeApp();
    const res = await app.fetch(new Request("http://localhost/api/v1/health", { method: "POST" }));
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("GET, HEAD");
    const body = (await res.json()) as ErrorBody;
    expect(body.code).toBe("method_not_allowed");
    expect(body.findings).toEqual([]);
  });

  test("event-stream route streams events with the documented media type", async () => {
    const res = await makeApp().fetch(new Request("http://localhost/api/v1/events"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain("event: started");
    expect(text).toContain("event: heartbeat");
    expect(text).toContain("event: complete");
  });
});

describe("OpenAPI document", () => {
  test("is OpenAPI 3.1 with the foundation paths documented", async () => {
    const { res, body } = await fetchJson(makeApp(), "/openapi.json");
    expect(res.status).toBe(200);
    const doc = body as unknown as OpenApiDoc;
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.paths["/api/v1/health"]).toBeDefined();
    expect(doc.paths["/api/v1/version"]).toBeDefined();
    expect(doc.paths["/api/v1/events"]).toBeDefined();
  });

  test("renders the SSE media type under /api/v1/events", async () => {
    const { body } = await fetchJson(makeApp(), "/openapi.json");
    const doc = body as unknown as OpenApiDoc;
    const events = doc.paths["/api/v1/events"] as
      | { get?: { responses?: Record<string, { content?: Record<string, unknown> }> } }
      | undefined;
    expect(events?.get?.responses?.["200"]?.content?.["text/event-stream"]).toBeDefined();
  });

  test("TypeBox schemas round-trip unchanged into the components", async () => {
    const { body } = await fetchJson(makeApp(), "/openapi.json");
    const doc = body as unknown as OpenApiDoc;
    expect(doc.components.schemas.Health).toEqual(JSON.parse(JSON.stringify(HealthSchema)));
    expect(doc.components.schemas.Version).toEqual(JSON.parse(JSON.stringify(VersionSchema)));
    expect(doc.components.schemas.ErrorResponse).toEqual(
      JSON.parse(JSON.stringify(ErrorResponseSchema)),
    );
    expect(Object.keys(doc.components.schemas).sort()).toEqual(Object.keys(Schemas).sort());
  });

  test("served document matches the checked-in dump", async () => {
    const { body } = await fetchJson(makeApp(), "/openapi.json");
    const dumped = JSON.parse(
      readFileSync(join(import.meta.dir, "../openapi.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(body).toEqual(dumped);
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

describe("Postgres seam (E1-01 foundation)", () => {
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
