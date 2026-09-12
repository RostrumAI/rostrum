/** @fileoverview Executable daemon boundary smoke check. */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DaemonApp } from "../app";
import { DaemonProcess } from "./process";

const daemon = await DaemonProcess.spawn();
try {
    const origin = await daemon.listening();
    const headers = { authorization: `Bearer ${daemon.tokens[0]}` };
    const health = await fetch(`${origin}/api/system/health`, { headers });
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok" });
    assert.equal(health.headers.get("cache-control"), "no-store");
    const response = await fetch(`${origin}/openapi.json`, { headers });
    assert.equal(response.status, 200);
    const served = await response.json();
    const app = await DaemonApp.create();
    assert.deepEqual(
        served,
        await app.openApi(),
        "served and resource-free generated OpenAPI must agree",
    );
    const checkedIn = JSON.parse(
        await readFile(join(import.meta.dir, "../../openapi.json"), "utf8"),
    );
    assert.deepEqual(
        served,
        checkedIn,
        "run daemon generate-openapi to update the checked-in contract",
    );
    daemon.child.kill("SIGTERM");
    assert.equal(await daemon.exited(5000), 0, "SIGTERM must complete within the shutdown bound");
    console.log(
        `smoke ok: executable daemon authenticated health and OpenAPI on port ${daemon.port}; SIGTERM exited 0`,
    );
} finally {
    await daemon.dispose();
}
