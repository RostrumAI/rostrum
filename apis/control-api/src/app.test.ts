/** @fileoverview Control API liveness and generated-contract integration tests. */

import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ControlApiApp } from "./app";

/**
 * Boots the real application and checks the two routes every deployment depends
 * on: the health check and the OpenAPI document. The served document must equal
 * the checked-in `openapi.json`, so the contract artifact cannot drift from the
 * one the process answers with.
 *
 * The process reads its configuration from the environment, so the test supplies
 * a local configuration before creating the app. No connection is opened: health
 * and the contract touch neither the database nor the daemon.
 */
const environment: Record<string, string> = {
    NODE_ENV: "test",
    DATABASE_URL: "postgres://rostrum:rostrum@127.0.0.1:5432/rostrum",
    DATABASE_TLS: "false",
    ALLOW_INSECURE_LOCAL: "true",
    DAEMON_URL: "http://127.0.0.1:3001",
    DAEMON_TOKEN: "ab".repeat(32),
};

let app: ControlApiApp;
let server: Bun.Server<undefined>;
let restore: Record<string, string | undefined>;

beforeAll(async () => {
    restore = Object.fromEntries(Object.keys(environment).map((name) => [name, process.env[name]]));
    Object.assign(process.env, environment);
    // Imported after the environment is in place: the configuration source is
    // fixed on the app's first load.
    const { ControlApiApp } = await import("./app");
    app = await ControlApiApp.create();
    server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.routes.fetch });
});

afterAll(async () => {
    server.stop(true);
    await app.close(1_000);
    for (const [name, value] of Object.entries(restore)) {
        if (value === undefined) {
            delete process.env[name];
        } else {
            process.env[name] = value;
        }
    }
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
