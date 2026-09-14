/** @fileoverview Concurrent readiness aggregation and cancellation tests. */

import { describe, expect, test } from "bun:test";
import type { CheckResult } from "./protocol";
import { checkReadiness } from "./readiness";

/** Resolves only when readiness cancellation reaches the probe. */
function waitForAbort(signal: AbortSignal, onAbort?: () => void): Promise<CheckResult> {
    const { promise, resolve } = Promise.withResolvers<CheckResult>();
    signal.addEventListener(
        "abort",
        () => {
            onAbort?.();
            resolve({ status: "failed", code: "daemon_timeout" });
        },
        { once: true },
    );
    return promise;
}

describe("readiness aggregation", () => {
    test("reports ready only after every dependency succeeds", async () => {
        const result = await checkReadiness(
            {
                database: {
                    check: async () => ({ status: "ok" }),
                    timeoutCode: "database_timeout",
                    failureCode: "database_unavailable",
                },
                daemon: {
                    check: async () => ({ status: "ok" }),
                    timeoutCode: "daemon_timeout",
                    failureCode: "daemon_unavailable",
                },
            },
            100,
        );

        expect(result).toEqual({
            status: "ready",
            checks: { database: { status: "ok" }, daemon: { status: "ok" } },
        });
    });

    test("returns the first known failure and cancels unfinished checks", async () => {
        let siblingAborted = false;
        const result = await checkReadiness(
            {
                database: {
                    check: async () => ({ status: "failed", code: "database_unavailable" }),
                    timeoutCode: "database_timeout",
                    failureCode: "database_unavailable",
                },
                daemon: {
                    check: (signal) =>
                        waitForAbort(signal, () => {
                            siblingAborted = true;
                        }),
                    timeoutCode: "daemon_timeout",
                    failureCode: "daemon_unavailable",
                },
            },
            1_000,
        );

        expect(result).toEqual({
            status: "not_ready",
            checks: { database: { status: "failed", code: "database_unavailable" } },
        });
        expect(siblingAborted).toBe(true);
    });

    test("reports every unfinished dependency when the deadline expires", async () => {
        const pending = (signal: AbortSignal) => waitForAbort(signal);
        const result = await checkReadiness(
            {
                database: {
                    check: pending,
                    timeoutCode: "database_timeout",
                    failureCode: "database_unavailable",
                },
                daemon: {
                    check: pending,
                    timeoutCode: "daemon_timeout",
                    failureCode: "daemon_unavailable",
                },
            },
            10,
        );

        expect(result).toEqual({
            status: "not_ready",
            checks: {
                database: { status: "failed", code: "database_timeout" },
                daemon: { status: "failed", code: "daemon_timeout" },
            },
        });
    });
});
