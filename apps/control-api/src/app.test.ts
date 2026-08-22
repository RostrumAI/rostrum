import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { LogRecord } from "@logtape/logtape";
import type { Hono } from "hono";
import postgres from "postgres";
import pkg from "../package.json" with { type: "json" };
import { ControlApiApp } from "./app";
import { HealthSchema } from "./features/system/health";
import { VersionSchema } from "./features/system/version";
import { configureLogging } from "./logger";
import { ErrorResponseSchema } from "./schemas";

async function makeApp(): Promise<Hono> {
    return (await ControlApiApp.create()).routes;
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

async function fetchJson(app: Hono, path: string, init?: RequestInit) {
    const res = await app.fetch(new Request(`http://localhost${path}`, init));
    return { res, body: (await res.json()) as Record<string, unknown> };
}

describe("socket-free app.fetch() harness (E1-02)", () => {
    test("health returns the documented response", async () => {
        const { res, body } = await fetchJson(await makeApp(), "/api/v1/system/health");
        expect(res.status).toBe(200);
        expect(body).toEqual({ status: "ok" });
    });
    test("version returns the documented service and interface version", async () => {
        const { res, body } = await fetchJson(await makeApp(), "/api/v1/system/version");
        expect(res.status).toBe(200);
        expect(body.service).toBe(pkg.name);
        expect(body.interfaceVersion).toBe("v1");
        expect(typeof body.version).toBe("string");
    });

    test("unknown routes return 404 with the error shape", async () => {
        for (const path of ["/api/v1/system/definitely-not-a-route", "/", "/openapi.html"]) {
            const { res, body } = await fetchJson(await makeApp(), path);
            expect(res.status).toBe(404);
            expect(body.code).toBe("not_found");
            expect(body.findings).toEqual([]);
        }
    });

    test("disallowed methods return 405 with Allow and the error shape", async () => {
        const app = await makeApp();
        const res = await app.fetch(
            new Request("http://localhost/api/v1/system/health", { method: "POST" }),
        );
        expect(res.status).toBe(405);
        expect(res.headers.get("Allow")).toBe("GET, HEAD");
        const body = (await res.json()) as ErrorBody;
        expect(body.code).toBe("method_not_allowed");
        expect(body.findings).toEqual([]);
    });

    test("handler failures return 500 with the error shape and are logged", async () => {
        const hono = await ControlApiApp.create();
        const records: LogRecord[] = [];
        await configureLogging("info", (r) => records.push(r));
        hono.routes.get("/boom", () => {
            throw new Error("boom");
        });
        const res = await hono.routes.fetch(new Request("http://localhost/boom"));
        expect(res.status).toBe(500);
        const body = (await res.json()) as ErrorBody;
        expect(body.code).toBe("internal_error");
        expect(body.message).toBe("Internal Server Error");
        expect(body.findings).toEqual([]);

        const entry = records.find((r) => r.rawMessage === "handler failed");
        expect(entry).toBeDefined();
        expect(String(entry?.properties.error)).toContain("boom");
        expect(entry?.properties.path).toBe("/boom");
    });

    test("debug logging records the request and its response", async () => {
        const records: LogRecord[] = [];
        await configureLogging("debug", (r) => records.push(r));
        const app = await makeApp();
        await app.fetch(new Request("http://localhost/api/v1/system/health"));

        const sent = records.find((r) => r.rawMessage === "response sent");
        expect(records.some((r) => r.rawMessage === "request received")).toBe(true);
        expect(sent?.properties.path).toBe("/api/v1/system/health");
        expect(sent?.properties.status).toBe(200);
        expect(typeof sent?.properties.durationMs).toBe("number");
    });
});

describe("OpenAPI document", () => {
    test("is OpenAPI 3.1 with the foundation paths documented", async () => {
        const { res, body } = await fetchJson(await makeApp(), "/openapi.json");
        expect(res.status).toBe(200);
        const doc = body as unknown as OpenApiDoc;
        expect(doc.openapi).toBe("3.1.0");
        expect(doc.paths["/api/v1/system/health"]).toBeDefined();
        expect(doc.paths["/api/v1/system/version"]).toBeDefined();
    });

    test("TypeBox schemas round-trip unchanged into the components", async () => {
        const { body } = await fetchJson(await makeApp(), "/openapi.json");
        const doc = body as unknown as OpenApiDoc;
        expect(doc.components.schemas.Health).toEqual(JSON.parse(JSON.stringify(HealthSchema)));
        expect(doc.components.schemas.Version).toEqual(JSON.parse(JSON.stringify(VersionSchema)));
        expect(doc.components.schemas.ErrorResponse).toEqual(
            JSON.parse(JSON.stringify(ErrorResponseSchema)),
        );
        expect(Object.keys(doc.components.schemas).sort()).toEqual([
            "ErrorResponse",
            "Finding",
            "Health",
            "Version",
        ]);
    });

    test("served document matches the checked-in copy", async () => {
        const { body } = await fetchJson(await makeApp(), "/openapi.json");
        const checkedIn = JSON.parse(
            readFileSync(join(import.meta.dir, "../openapi.json"), "utf8"),
        ) as Record<string, unknown>;
        expect(body).toEqual(checkedIn);
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
