import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ControlApiApp } from "../app";

/**
 * Boots the real server on an ephemeral port and checks the two routes
 * every deployment depends on: the health check and the OpenAPI document.
 * It also verifies that the served document equals the checked-in
 * openapi.json, so the contract artifact cannot drift from the served
 * one. CI runs this as its boot stage; no database connection is needed
 * because neither route touches one. Exits nonzero on any failure.
 */
const app = await ControlApiApp.create();
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.routes.fetch });

try {
    const health = await fetch(`http://127.0.0.1:${server.port}/api/system/health`);
    const healthBody = await health.json();
    if (health.status !== 200 || (healthBody as { status: string }).status !== "ok") {
        throw new Error(`health check failed with status ${health.status}`);
    }

    const openapi = await fetch(`http://127.0.0.1:${server.port}/openapi.json`);
    const served = await openapi.json();
    if (openapi.status !== 200 || (served as { openapi: string }).openapi !== "3.1.0") {
        throw new Error(`openapi check failed with status ${openapi.status}`);
    }

    const checkedIn = JSON.parse(
        await readFile(join(import.meta.dir, "../../openapi.json"), "utf8"),
    );
    if (JSON.stringify(served) !== JSON.stringify(checkedIn)) {
        throw new Error(
            "the served OpenAPI document differs from apps/control-api/openapi.json; run `bun run generate-openapi`",
        );
    }

    console.log(`smoke ok: health and openapi served on port ${server.port}`);
} finally {
    server.stop(true);
    await app.close();
}
