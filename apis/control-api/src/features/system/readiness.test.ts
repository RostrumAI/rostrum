/** @fileoverview Control API readiness status and response tests. */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { ControlApiConfig } from "@rostrum/server/config";
import type { Readiness } from "@rostrum/server/protocol";
import { createDependencies, type Dependencies } from "../../services";

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

beforeAll(async () => {
    dependencies = await createDependencies(config);
});

afterAll(async () => {
    await dependencies.close({ timeoutMs: 1_000 });
});

/** Requests readiness with a controlled aggregate result. */
async function requestReadiness(result: Readiness): Promise<Response> {
    return dependencies.app.fetch(new Request("http://localhost/api/system/readiness"), {
        workflows: dependencies.workflows,
        readiness: async () => result,
    });
}

describe("Control API readiness route", () => {
    test("maps ready dependencies to 200", async () => {
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
