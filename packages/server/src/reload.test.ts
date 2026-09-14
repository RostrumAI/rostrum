/** @fileoverview Service configuration reload integration tests. */

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
 * Reload atomicity against the real runtime. A change that does not alter the
 * dependency fingerprint must be applied in place, and a rejected candidate must
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
            // id (a non-database change must not rebuild the pool).
            expect(await marker(origin)).toEqual({ marker: "after", dependency: 1 });
        } finally {
            fixture.signal("SIGTERM");
        }
        expect(await fixture.exited()).toBe(0);
    });

    test("rebuilds and retires resources when the candidate changes the database fingerprint", async () => {
        const fixture = await spawnFixture({
            marker: "before",
            holdMs: 0,
            shutdownTimeoutMs: 6_000,
        });
        try {
            const origin = `http://127.0.0.1:${fixture.port}`;
            expect(await marker(origin)).toEqual({ marker: "before", dependency: 1 });

            fixture.writeConfig({
                marker: "after",
                holdMs: 0,
                shutdownTimeoutMs: 6_000,
                databaseUrl: "postgres://fixture@127.0.0.1:2/other",
            });
            fixture.signal("SIGHUP");
            // The swap is announced before the previous set is retired, so wait for
            // the retirement itself rather than for the "reload applied" line.
            await fixture.waitFor((line) => line.includes("fixture dependency closed"));

            // Requests after the reload use the replacement, and the retired set is
            // closed exactly once.
            expect(await marker(origin)).toEqual({ marker: "after", dependency: 2 });
            expect(
                fixture.lines().filter((line) => line.includes("fixture dependency closed")),
            ).toHaveLength(1);
        } finally {
            fixture.signal("SIGTERM");
        }
        expect(await fixture.exited()).toBe(0);
    });

    test("keeps the original listener when a different address cannot bind", async () => {
        const fixture = await spawnFixture({
            marker: "before",
            holdMs: 0,
            shutdownTimeoutMs: 6_000,
        });
        const occupant = Bun.serve({
            hostname: "127.0.0.1",
            port: 0,
            fetch: () => new Response("occupied"),
        });
        try {
            const origin = `http://127.0.0.1:${fixture.port}`;
            fixture.writeConfig({
                marker: "after",
                holdMs: 0,
                shutdownTimeoutMs: 6_000,
                port: occupant.port,
            });
            fixture.signal("SIGHUP");
            await fixture.waitFor((line) => line.includes("listener replacement failed"));

            // A rejected listener replacement must leave the healthy process
            // serving on its original address rather than exiting.
            expect(await marker(origin)).toEqual({ marker: "before", dependency: 1 });
        } finally {
            occupant.stop(true);
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
