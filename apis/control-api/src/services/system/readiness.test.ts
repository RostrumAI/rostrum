/** @fileoverview Control API readiness status and response tests. */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDatabase, type DatabaseHandle } from "@rostrum/database";
import type { Readiness } from "@rostrum/server/protocol";
import { createControlApiApp } from "../../app";
import type { ControlApiConfig } from "../../config";
import type { ControlApiContext } from "../../control-api";
import { WorkflowService } from "../../workflows/service";

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

const app = createControlApiApp();
let database: DatabaseHandle;
let workflows: WorkflowService;

beforeAll(() => {
    // The route answers the aggregate result it is handed, so this handle never connects.
    database = createDatabase({
        url: config.databaseUrl,
        tls: config.databaseTls,
        allowInsecureLocal: config.allowInsecureLocal,
        nodeEnv: config.nodeEnv,
        applicationName: "control-api",
        connectTimeoutMs: config.dependencyTimeoutMs,
    });
    workflows = WorkflowService.create(database);
});

afterAll(async () => {
    await workflows.close({ timeoutMs: 1_000 });
});

/** Requests readiness with a controlled aggregate result. */
function requestReadiness(result: Readiness): Response | Promise<Response> {
    const context: ControlApiContext = {
        config,
        database,
        workflows,
        readiness: async () => result,
        abortSignal: new AbortController().signal,
    };
    return app.fetch(new Request("http://localhost/api/system/readiness"), context);
}

describe("Control API readiness route", () => {
    test("maps ready resources to 200", async () => {
        const body: Readiness = {
            status: "ready",
            checks: { database: { status: "ok" }, daemon: { status: "ok" } },
        };

        const response = await requestReadiness(body);

        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(await response.json()).toEqual(body);
    });

    test("maps a failed dependency to 503", async () => {
        const body: Readiness = {
            status: "not_ready",
            checks: {
                database: { status: "ok" },
                daemon: { status: "failed", code: "daemon_unavailable" },
            },
        };

        const response = await requestReadiness(body);

        expect(response.status).toBe(503);
        expect(await response.json()).toEqual(body);
    });
});
