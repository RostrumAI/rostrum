import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createDatabase, migrateToLatest } from "@rostrum/database";
import { startTestPostgres, type TestPostgres } from "@rostrum/database/testing";
import minimumJson from "@rostrum/workflow/fixtures/valid/minimum.json";
import pkg from "../package.json" with { type: "json" };

/**
 * Boots the real Control API process over HTTP and runs the foundation
 * assertions. No database is required for the foundation suite: storage
 * arrives with the workflow operations, exercised by the database-backed
 * describe below.
 */
interface BootedServer {
    baseUrl: string;
    proc: ReturnType<typeof Bun.spawn>;
    output: string[];
    /** Resolves when the process stdout closes (after exit). */
    drained: Promise<void>;
}

async function bootServer(extraEnv: Record<string, string> = {}): Promise<BootedServer> {
    const proc = Bun.spawn(["bun", "run", "src/index.ts"], {
        cwd: join(import.meta.dir, ".."),
        env: { ...process.env, PORT: "0", LOG_LEVEL: "info", ...extraEnv },
        stdout: "pipe",
        stderr: "pipe",
    });
    const output: string[] = [];
    let port: number | undefined;
    const deadline = Date.now() + 15_000;
    const reader = proc.stdout.getReader();
    const errReader = proc.stderr.getReader();
    const decoder = new TextDecoder();
    const feed = (chunk: Uint8Array, prefix: string) => {
        for (const line of decoder.decode(chunk).split("\n")) {
            if (!line) continue;
            output.push(`${prefix}${line}`);
            if (prefix) continue;
            try {
                const entry = JSON.parse(line) as { msg?: string; port?: number };
                if (entry.msg === "listening" && typeof entry.port === "number") port = entry.port;
            } catch {
                // non-JSON stdout line
            }
        }
    };
    void (async () => {
        try {
            while (true) {
                const { value, done } = await errReader.read();
                if (done) break;
                feed(value, "stderr: ");
            }
        } catch {
            // stream already closed
        }
    })();
    while (Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        feed(value, "");
        if (port !== undefined) break;
    }
    if (port === undefined) {
        await proc.kill();
        throw new Error(`server did not report a listening port; output: ${output.join("\n")}`);
    }
    // Keep draining stdout so post-listen logs (e.g. shutdown) are captured.
    const drained = (async () => {
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                feed(value, "");
            }
        } catch {
            // stream already closed
        }
    })();
    return { baseUrl: `http://127.0.0.1:${port}`, proc, output, drained };
}

let server: BootedServer;

// Bun on Windows hard-terminates child processes for SIGTERM/SIGINT without
// delivering the JS signal event (verified on Bun 1.3.14); the graceful-
// shutdown assertions run on POSIX, where CI (ubuntu-latest) exercises them.
const signalTestSupported = process.platform !== "win32";

beforeAll(async () => {
    server = await bootServer();
});

afterAll(async () => {
    if (server?.proc) {
        server.proc.kill("SIGTERM");
        const exited = await server.proc.exited.catch(() => undefined);
        if (signalTestSupported && exited !== 0) {
            throw new Error(`server exited with ${exited}`);
        }
    }
});

describe("real process over HTTP", () => {
    test("boots through the normal path and foundation routes answer over HTTP", async () => {
        const health = await fetch(`${server.baseUrl}/api/v1/system/health`);
        expect(health.status).toBe(200);
        expect(await health.json()).toEqual({ status: "ok" });

        const version = await fetch(`${server.baseUrl}/api/v1/system/version`);
        expect(version.status).toBe(200);
        const versionBody = (await version.json()) as Record<string, unknown>;
        expect(versionBody.service).toBe(pkg.name);
        expect(versionBody.interfaceVersion).toBe("v1");

        const missing = await fetch(`${server.baseUrl}/api/v1/nope`);
        expect(missing.status).toBe(404);
        expect(((await missing.json()) as { code: string }).code).toBe("not_found");

        const doc = await fetch(`${server.baseUrl}/openapi.json`);
        expect(doc.status).toBe(200);
        expect(((await doc.json()) as { openapi: string }).openapi).toBe("3.1.0");
    });

    test.skipIf(!signalTestSupported)("graceful shutdown on SIGTERM logs and exits 0", async () => {
        // Boot a second server so the shared one keeps serving the suite.
        const second = await bootServer();
        const health = await fetch(`${second.baseUrl}/api/v1/system/health`);
        expect(health.status).toBe(200);

        second.proc.kill("SIGTERM");
        const exitCode = await second.proc.exited;
        expect(exitCode).toBe(0);
        await second.drained;
        const shutdownLines = second.output.filter((line) => line.includes("shutdown"));
        expect(shutdownLines.some((line) => line.includes("shutdown started"))).toBe(true);
        expect(shutdownLines.some((line) => line.includes("shutdown complete"))).toBe(true);
    });
});

/** The create response: the draft's first revision. */
interface RevisionResponse {
    workflowId: string;
    revisionId: string;
    content: string;
}

/** The publish response. */
interface PublishResponse {
    workflowId: string;
    versionNumber: number;
    interfaceVersion: string;
    digest: string;
}

/**
 * One create-to-publish smoke over actual HTTP, with the real process
 * pointed at a disposable Postgres. The embedded fallback needs no Docker,
 * so this runs unconditionally.
 */
describe("real process with a database", () => {
    let database: TestPostgres;
    let booted: BootedServer;

    beforeAll(async () => {
        database = await startTestPostgres();
        const db = createDatabase(database.url);
        try {
            await migrateToLatest(db);
        } finally {
            await db.destroy();
        }
        booted = await bootServer({ DATABASE_URL: database.url });
    }, 120_000);

    afterAll(async () => {
        if (booted?.proc) {
            booted.proc.kill();
            await booted.proc.exited.catch(() => undefined);
        }
        await database?.stop();
    }, 60_000);

    test("creates, saves, and publishes a workflow over HTTP", async () => {
        const created = await fetch(`${booted.baseUrl}/api/v1/workflows`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(minimumJson),
        });
        expect(created.status).toBe(201);
        const draft = (await created.json()) as RevisionResponse;
        expect(JSON.parse(draft.content).id).toBe(draft.workflowId);

        const published = await fetch(
            `${booted.baseUrl}/api/v1/workflows/${draft.workflowId}/publish`,
            { method: "POST" },
        );
        expect(published.status).toBe(200);
        const version = (await published.json()) as PublishResponse;
        expect(version.workflowId).toBe(draft.workflowId);
        expect(version.versionNumber).toBe(1);
        expect(version.interfaceVersion).toBe("v1");
        expect(version.digest).toMatch(/^[0-9a-f]{64}$/);

        const retrieved = await fetch(
            `${booted.baseUrl}/api/v1/workflows/${draft.workflowId}/versions/1`,
        );
        expect(retrieved.status).toBe(200);
        const stored = (await retrieved.json()) as PublishResponse;
        expect(stored.digest).toBe(version.digest);
    });
});
