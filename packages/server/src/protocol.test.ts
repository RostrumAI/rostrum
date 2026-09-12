import { describe, expect, test } from "bun:test";
import { Value } from "typebox/value";
import { BoundaryErrorSchema, ControlApiReadinessSchema, DaemonReadinessSchema } from "./protocol";

describe("boundary readiness schema", () => {
    test("a ready response requires every successful dependency and no extra fields", () => {
        expect(
            Value.Check(DaemonReadinessSchema, {
                status: "ready",
                checks: { database: { status: "ok" } },
            }),
        ).toBe(true);
        expect(
            Value.Check(ControlApiReadinessSchema, {
                status: "ready",
                checks: { database: { status: "ok" }, daemon: { status: "ok" } },
            }),
        ).toBe(true);
        for (const checks of [
            {},
            { database: { status: "ok" } },
            {
                database: { status: "ok" },
                daemon: { status: "failed", code: "daemon_unavailable" },
            },
            { database: { status: "ok", code: "database_unavailable" }, daemon: { status: "ok" } },
        ]) {
            expect(Value.Check(ControlApiReadinessSchema, { status: "ready", checks })).toBe(false);
        }
        expect(
            Value.Check(DaemonReadinessSchema, {
                status: "ready",
                checks: { database: { status: "ok" }, daemon: { status: "ok" } },
            }),
        ).toBe(false);
    });

    test("early failures may omit unfinished work but must report a correctly classified failure", () => {
        for (const checks of [
            { database: { status: "failed", code: "database_timeout" } },
            { daemon: { status: "failed", code: "daemon_tls_error" } },
            { database: { status: "ok" }, daemon: { status: "failed", code: "daemon_not_ready" } },
            {
                database: { status: "failed", code: "database_schema_unavailable" },
                daemon: { status: "failed", code: "daemon_timeout" },
            },
        ])
            expect(Value.Check(ControlApiReadinessSchema, { status: "not_ready", checks })).toBe(
                true,
            );
        for (const checks of [
            {},
            { database: { status: "ok" } },
            { database: { status: "ok" }, daemon: { status: "ok" } },
            { database: { status: "failed", code: "daemon_timeout" } },
            { daemon: { status: "failed", code: "database_timeout" } },
            { daemon: { status: "failed", code: "daemon_unknown" } },
        ])
            expect(Value.Check(ControlApiReadinessSchema, { status: "not_ready", checks })).toBe(
                false,
            );
        expect(
            Value.Check(DaemonReadinessSchema, {
                status: "not_ready",
                checks: { database: { status: "ok" } },
            }),
        ).toBe(false);
        expect(
            Value.Check(DaemonReadinessSchema, {
                status: "not_ready",
                checks: { database: { status: "failed", code: "database_unavailable" } },
            }),
        ).toBe(true);
    });

    test("boundary error envelopes cannot carry upstream findings or extra fields", () => {
        const body = {
            code: "service_draining",
            message: "Service is shutting down",
            findings: [],
        };
        expect(Value.Check(BoundaryErrorSchema, body)).toBe(true);
        expect(
            Value.Check(BoundaryErrorSchema, {
                ...body,
                findings: [{ message: "upstream detail" }],
            }),
        ).toBe(false);
        expect(Value.Check(BoundaryErrorSchema, { ...body, stack: "internal detail" })).toBe(false);
    });
});
