/** @fileoverview Control API liveness and generated-contract integration tests. */

import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ControlApiConfig } from "./config";
import { ControlApi } from "./control-api";

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

let api: ControlApi;

beforeAll(async () => {
    api = await ControlApi.open(config);
});

afterAll(async () => {
    await api.close({ timeoutMs: 1_000 });
});

test("serves liveness and the checked-in OpenAPI document", async () => {
    const signal = new AbortController().signal;
    const health = await api.fetch(new Request("http://127.0.0.1/api/system/health"), signal);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });

    const openapi = await api.fetch(new Request("http://127.0.0.1/openapi.json"), signal);
    const served = await openapi.json();
    expect(openapi.status).toBe(200);
    expect(served).toMatchObject({ openapi: "3.1.0" });

    const checkedIn = JSON.parse(await readFile(join(import.meta.dir, "../openapi.json"), "utf8"));
    expect(served).toEqual(checkedIn);
});

test("serves aggregated readiness through the production service", async () => {
    // The service owns this wiring: it builds the readiness probe from its own
    // database and the configured daemon, under the caller's signal.
    const response = await api.fetch(
        new Request("http://127.0.0.1/api/system/readiness"),
        new AbortController().signal,
    );

    expect(response.status).toBe(503);
    const body = (await response.json()) as {
        status: string;
        checks: Record<string, { status: string }>;
    };
    expect(body.status).toBe("not_ready");
    // Either dependency may report first; a not_ready body names at least one failure.
    expect(Object.values(body.checks).some((check) => check.status === "failed")).toBe(true);
});

test("answers readiness when the caller's signal is already aborted", async () => {
    // An aborted caller must still receive an answer, not a rejection or a wait.
    const started = performance.now();
    const response = await api.fetch(
        new Request("http://127.0.0.1/api/system/readiness"),
        AbortSignal.abort(),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: "not_ready" });
    expect(performance.now() - started).toBeLessThan(500);
});
