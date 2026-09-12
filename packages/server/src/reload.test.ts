import { describe, expect, test } from "bun:test";
import { spawnFixture } from "./testing/service-process";

interface Marker {
    marker: string;
    dependency: number;
}

/** Reads the serving snapshot's marker and the identity of its owned resources. */
async function marker(origin: string): Promise<Marker> {
    const response = await fetch(`${origin}/marker`);
    return (await response.json()) as Marker;
}

/**
 * Reload atomicity against the real runtime. A change that does not alter the
 * dependency identity must be applied in place, and a rejected candidate must
 * leave the live configuration entirely untouched.
 */
describe("SIGHUP configuration reload", () => {
    test("applies a valid candidate in place without rebuilding resources", async () => {
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
            await fixture.waitFor((line) => line.includes("reload applied"));

            // Same port (the listener was not replaced) and the same resource
            // identity (a non-database change must not rebuild the pool).
            expect(await marker(origin)).toEqual({ marker: "after", dependency: 1 });
        } finally {
            fixture.signal("SIGTERM");
        }
        expect(await fixture.exited()).toBe(0);
    });

    test("retains the previous configuration entirely when a candidate is invalid", async () => {
        const fixture = await spawnFixture({
            marker: "before",
            holdMs: 0,
            shutdownTimeoutMs: 6_000,
        });
        try {
            const origin = `http://127.0.0.1:${fixture.port}`;
            // An empty candidate is invalid, so the reload must be rejected and
            // must not partially apply.
            fixture.writeConfig({});
            fixture.signal("SIGHUP");
            await fixture.waitFor((line) => line.includes("reload rejected"));

            expect(await marker(origin)).toEqual({ marker: "before", dependency: 1 });
        } finally {
            fixture.signal("SIGTERM");
        }
        expect(await fixture.exited()).toBe(0);
    });
});
