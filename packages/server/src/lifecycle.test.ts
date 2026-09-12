/** @fileoverview Service draining and bounded-shutdown tests. */

import { describe, expect, test } from "bun:test";
import { spawnFixture } from "./testing/service-process";

/**
 * Draining and shutdown against the real runtime in a child process. These
 * assert observable outcomes — a completed response, an exit code, and
 * single resource closure — rather than log prose alone.
 */
describe("service lifecycle", () => {
    test("drains an outstanding request within the deadline and exits zero", async () => {
        const fixture = await spawnFixture({
            marker: "a",
            holdMs: 1_200,
            shutdownTimeoutMs: 6_000,
        });
        try {
            // The response outlives Bun's idle window, so only the shutdown
            // deadline can govern it.
            const pending = fetch(`http://127.0.0.1:${fixture.port}/hold`);
            await fixture.waitFor((line) => line.includes("fixture hold started"));
            fixture.signal("SIGTERM");

            const response = await pending;
            expect(response.status).toBe(200);
            expect(await response.json()).toEqual({ held: 1_200 });
            expect(await fixture.exited()).toBe(0);
        } finally {
            fixture.signal("SIGTERM");
        }
    });

    test("forces a bounded nonzero exit when a request outlives the deadline", async () => {
        const fixture = await spawnFixture({
            marker: "a",
            holdMs: 60_000,
            shutdownTimeoutMs: 800,
        });
        try {
            const pending = fetch(`http://127.0.0.1:${fixture.port}/hold`).catch(() => undefined);
            await fixture.waitFor((line) => line.includes("fixture hold started"));

            const started = Date.now();
            fixture.signal("SIGTERM");
            const code = await fixture.exited();
            const elapsed = Date.now() - started;

            expect(code).not.toBe(0);
            // Bounded: the deadline plus slack, not the 60s handler.
            expect(elapsed).toBeLessThan(8_000);
            await pending;
        } finally {
            fixture.signal("SIGTERM");
        }
    });

    test("closes owned resources exactly once across repeated signals", async () => {
        const fixture = await spawnFixture({
            marker: "a",
            holdMs: 300,
            shutdownTimeoutMs: 6_000,
        });
        try {
            const pending = fetch(`http://127.0.0.1:${fixture.port}/hold`);
            await fixture.waitFor((line) => line.includes("fixture hold started"));
            fixture.signal("SIGTERM");
            fixture.signal("SIGTERM");
            fixture.signal("SIGINT");

            expect((await pending).status).toBe(200);
            expect(await fixture.exited()).toBe(0);
            const closures = fixture
                .lines()
                .filter((line) => line.includes("fixture dependency closed"));
            expect(closures).toHaveLength(1);
        } finally {
            fixture.signal("SIGTERM");
        }
    });
});
