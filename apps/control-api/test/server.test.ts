import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { workflowDigest } from "@rostrum/workflow-lib";
import { loadConfig } from "../src/config";
import { createDb } from "../src/db/client";
import { migrateToLatest } from "../src/db/migrate";
import { makeApp, validWorkflow } from "./app.test";

/**
 * Row 4b: boots the real Control API process over HTTP and runs the same
 * assertions as the socket-free harness. Requires the local Postgres
 * (docker compose up -d --wait postgres; bun run migrate).
 */
const config = loadConfig();
const db = createDb(config.databaseUrl);

interface BootedServer {
  baseUrl: string;
  proc: ReturnType<typeof Bun.spawn>;
  output: string[];
  /** Resolves when the process stdout closes (after exit). */
  drained: Promise<void>;
}

async function bootServer(): Promise<BootedServer> {
  const proc = Bun.spawn(["bun", "run", "src/index.ts"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...process.env, PORT: "0" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const output: string[] = [];
  let port: number | undefined;
  const deadline = Date.now() + 15_000;
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    for (const line of decoder.decode(value).split("\n")) {
      output.push(line);
      if (!line) continue;
      try {
        const entry = JSON.parse(line) as { msg?: string; port?: number };
        if (entry.msg === "listening" && typeof entry.port === "number") port = entry.port;
      } catch {
        // non-JSON stdout line
      }
    }
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
        for (const line of decoder.decode(value).split("\n")) {
          if (line) output.push(line);
        }
      }
    } catch {
      // stream already closed
    }
  })();
  return { baseUrl: `http://127.0.0.1:${port}`, proc, output, drained };
}

let server: BootedServer;

beforeAll(async () => {
  await migrateToLatest(db);
  server = await bootServer();
});

afterAll(async () => {
  if (server?.proc) {
    server.proc.kill("SIGTERM");
    const exited = await server.proc.exited.catch(() => undefined);
    if (exited !== 0) {
      throw new Error(`server exited with ${exited}`);
    }
  }
  await db.end();
});

describe("real process over HTTP", () => {
  test("same assertions as the socket-free harness", async () => {
    const health = await fetch(`${server.baseUrl}/api/v1/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });

    const version = await fetch(`${server.baseUrl}/api/v1/version`);
    expect(version.status).toBe(200);
    const versionBody = (await version.json()) as Record<string, unknown>;
    expect(versionBody.service).toBe("rostrum-control-api");

    const post = await fetch(`${server.baseUrl}/api/v1/workflows`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validWorkflow),
    });
    expect(post.status).toBe(201);
    const published = (await post.json()) as {
      id: string;
      version: number;
      digest: string;
      workflow: unknown;
    };
    expect(published.digest).toBe(workflowDigest(validWorkflow));
    expect(published.workflow).toEqual(validWorkflow);

    const get = await fetch(`${server.baseUrl}/api/v1/workflows/wf-hello/versions/1`);
    expect(get.status).toBe(200);
    const retrieved = (await get.json()) as { workflow: unknown; digest: string };
    expect(retrieved.workflow).toEqual(validWorkflow);
    expect(retrieved.digest).toBe(workflowDigest(retrieved.workflow));

    const bad = await fetch(`${server.baseUrl}/api/v1/workflows`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ interfaceVersion: "v1" }),
    });
    expect(bad.status).toBe(400);
    const badBody = (await bad.json()) as { code: string; findings: Array<{ code: string }> };
    expect(badBody.code).toBe("validation_failed");
    expect(badBody.findings.map((f) => f.code)).toContain("typebox.required");

    const doc = await fetch(`${server.baseUrl}/openapi.json`);
    expect(doc.status).toBe(200);
    expect(((await doc.json()) as { openapi: string }).openapi).toBe("3.1.0");

    // The socket-free harness itself (row 4a) passes the same assertions:
    const app = makeApp();
    const appHealth = await app.fetch(new Request("http://localhost/api/v1/health"));
    expect(appHealth.status).toBe(200);
    expect(await appHealth.json()).toEqual({ status: "ok" });
  });

  test("graceful shutdown on SIGTERM", async () => {
    // Boot a second server so the shared one keeps serving the suite.
    const second = await bootServer();
    const health = await fetch(`${second.baseUrl}/api/v1/health`);
    expect(health.status).toBe(200);
    second.proc.kill("SIGTERM");
    const exitCode = await second.proc.exited;
    expect(exitCode).toBe(0);
    await second.drained;
    const shutdownLines = second.output.filter((l) => l.includes("shutdown"));
    expect(shutdownLines.some((l) => l.includes("shutdown started"))).toBe(true);
    expect(shutdownLines.some((l) => l.includes("shutdown complete"))).toBe(true);
  });
});
