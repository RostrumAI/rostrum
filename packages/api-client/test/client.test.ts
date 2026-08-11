import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { loadConfig } from "@rostrum/control-api/src/config.ts";
import { createDb } from "@rostrum/control-api/src/db/client.ts";
import { migrateToLatest } from "@rostrum/control-api/src/db/migrate.ts";
import { workflowDigest } from "@rostrum/workflow-lib";
import { ControlApiClient } from "../src/client";
import type { components } from "../src/generated";

/**
 * Row 12: the typed client calls the real service. The same fixtures that
 * prove wrong paths/parameters/bodies fail typechecking live in
 * src/typecheck-fixtures.ts (checked by `tsc --noEmit`).
 */
const config = loadConfig();
const db = createDb(config.databaseUrl);

const validWorkflow: components["schemas"]["Workflow"] = {
  interfaceVersion: "v1",
  id: `wf-client-${Date.now()}`,
  name: "Client hello",
  createdAt: "2026-08-10T12:00:00.000Z",
  start: "say",
  steps: [
    { id: "say", type: "task", next: "done" },
    { id: "done", type: "result" },
  ],
};

interface BootedServer {
  baseUrl: string;
  proc: ReturnType<typeof Bun.spawn>;
}

async function bootServer(): Promise<BootedServer> {
  const proc = Bun.spawn(["bun", "run", "src/index.ts"], {
    cwd: new URL("../../../apps/control-api", import.meta.url).pathname,
    env: { ...process.env, PORT: "0" },
    stdout: "pipe",
    stderr: "pipe",
  });
  let port: number | undefined;
  const deadline = Date.now() + 15_000;
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    for (const line of decoder.decode(value).split("\n")) {
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
    throw new Error("server did not report a listening port");
  }
  return { baseUrl: `http://127.0.0.1:${port}`, proc };
}

let server: BootedServer;
let client: ControlApiClient;

beforeAll(async () => {
  await migrateToLatest(db);
  server = await bootServer();
  client = new ControlApiClient(server.baseUrl);
});

afterAll(async () => {
  if (server?.proc) {
    server.proc.kill("SIGTERM");
    await server.proc.exited;
  }
  await db.end();
});

describe("typed client against the running service", () => {
  test("health call returns the documented shape", async () => {
    expect(await client.getHealth()).toEqual({ status: "ok" });
  });

  test("publish and retrieve round-trip with a reproducible digest", async () => {
    const published = await client.publishWorkflow(validWorkflow);
    expect(published.id).toBe(validWorkflow.id);
    expect(published.version).toBe(1);
    expect(published.digest).toBe(workflowDigest(validWorkflow));
    expect(published.workflow).toEqual(validWorkflow);

    const retrieved = await client.getPublishedWorkflow(validWorkflow.id, 1);
    expect(retrieved.workflow).toEqual(validWorkflow);
    expect(retrieved.digest).toBe(workflowDigest(retrieved.workflow));
  });
});
