/** @fileoverview Control API liveness and generated-contract integration tests. */

import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ControlApiConfig } from "@rostrum/server/config";
import { createDependencies, type Dependencies, readiness } from "./services";

const config: ControlApiConfig = {
    host: "127.0.0.1",
    port: 0,
    nodeEnv: "test",
    logLevel: "info",
    databaseUrl: "postgres://control_api_test@127.0.0.1:1/control_api_test",
    databaseTls: false,
    allowInsecureLocal: true,
    tokens: ["ab".repeat(32)],
    dependencyTimeoutMs: 100,
    shutdownTimeoutMs: 1_000,
    daemonUrl: "http://127.0.0.1:1",
};

let dependencies: Dependencies;
let server: Bun.Server<undefined>;

beforeAll(async () => {
    dependencies = await createDependencies(config);
    server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch: (request) =>
            dependencies.app.fetch(request, {
                workflows: dependencies.workflows,
                readiness: (signal) => readiness(config, dependencies, signal),
            }),
    });
});

afterAll(async () => {
    server.stop(true);
    await dependencies.close({ timeoutMs: 1_000 });
});

test("serves liveness and the checked-in OpenAPI document", async () => {
    const health = await fetch(`http://127.0.0.1:${server.port}/api/system/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });

    const openapi = await fetch(`http://127.0.0.1:${server.port}/openapi.json`);
    const served = await openapi.json();
    expect(openapi.status).toBe(200);
    expect(served).toMatchObject({ openapi: "3.1.0" });

    const checkedIn = JSON.parse(await readFile(join(import.meta.dir, "../openapi.json"), "utf8"));
    expect(served).toEqual(checkedIn);
});
