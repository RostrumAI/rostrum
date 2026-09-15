/** @fileoverview Startup-only configuration and response-body lifecycle tests. */

import { describe, expect, test } from "bun:test";
import { spawnFixture } from "./testing/service-process";

interface Marker {
    marker: string;
    dependency: number;
}

/** Reads the serving configuration's marker and the id of its owned resources. */
async function marker(origin: string): Promise<Marker> {
    const response = await fetch(`${origin}/marker`);
    return (await response.json()) as Marker;
}

/**
 * Configuration is read once, so nothing an operator writes after boot can
 * change a running process. These assert the observable outcome: a rewritten
 * configuration file plus SIGHUP leaves the boot configuration serving, and no
 * owned resource is replaced.
 */
describe("startup-only configuration", () => {
    test("SIGHUP reports that a restart is required without changing the serving configuration", async () => {
        const fixture = await spawnFixture({
            marker: "before",
            holdMs: 0,
            shutdownTimeoutMs: 6_000,
        });
        try {
            const origin = `http://127.0.0.1:${fixture.port}`;
            expect(await marker(origin)).toEqual({ marker: "before", dependency: 1 });

            fixture.writeConfig({ marker: "after", holdMs: 0, shutdownTimeoutMs: 6_000 });
            fixture.signal("SIGHUP");
            await fixture.waitFor((line) => line.includes("restart required"));

            // Same configuration, same owned resource, and a process still running.
            expect(await marker(origin)).toEqual({ marker: "before", dependency: 1 });
            expect(
                fixture.lines().filter((line) => line.includes("fixture dependency closed")),
            ).toHaveLength(0);

            fixture.signal("SIGTERM");
            expect(await fixture.exited()).toBe(0);
        } finally {
            fixture.signal("SIGTERM");
        }
    });

    test("drains a response body that is still streaming when shutdown starts", async () => {
        const fixture = await spawnFixture({
            marker: "streaming",
            holdMs: 0,
            streamChunks: 5,
            streamDelayMs: 80,
            shutdownTimeoutMs: 8_000,
        });
        try {
            const origin = `http://127.0.0.1:${fixture.port}`;
            const pending = fetch(`${origin}/stream`);
            // Wait until the handler has returned its streaming response, so
            // shutdown starts while the body is still being written.
            await fixture.waitFor((line) => line.includes("fixture stream started"));
            fixture.signal("SIGTERM");

            const response = await pending;
            expect(response.status).toBe(200);
            expect(await response.text()).toBe("chunk-1\nchunk-2\nchunk-3\nchunk-4\nchunk-5\n");
            expect(await fixture.exited()).toBe(0);
        } finally {
            fixture.signal("SIGTERM");
        }
    });
});
