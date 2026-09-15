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
