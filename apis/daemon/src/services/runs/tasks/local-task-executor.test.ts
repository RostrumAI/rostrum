import { describe, expect, test } from "bun:test";
import { DIVIDE_OPERATION } from "@rostrum/workflow";
import { LocalTaskExecutor } from "./local-task-executor";
import { createOperationRegistry, type OperationRegistry } from "./operations/operation-registry";
import type { TaskWorkItem } from "./task-executor";

/** Builds a work item for an operation with the given inputs. */
function work(operation: string, inputs: Record<string, unknown>): TaskWorkItem {
    return {
        runId: "0192b0a0-7e1d-7000-8000-000000000401",
        workId: "0192b0a0-7e1d-7000-8000-000000000402",
        stepId: "0192b0a0-7e1d-7000-8000-000000000403",
        workflowFormatVersion: "v1",
        config: { operation },
        inputs,
    };
}

const signal = new AbortController().signal;
const identity = {
    runId: "0192b0a0-7e1d-7000-8000-000000000401",
    workId: "0192b0a0-7e1d-7000-8000-000000000402",
};

describe("LocalTaskExecutor", () => {
    // Proves a registered operation's output comes back identified by its run and work.
    test("returns the operation's output with the work's identity", async () => {
        // Run the real divide operation through the daemon's registry.
        const executor = new LocalTaskExecutor(createOperationRegistry());

        // The quotient comes back tagged with the run and work it answers.
        expect(
            await executor.execute(work("divide", { dividend: 90, divisor: 4 }), signal),
        ).toEqual({
            ...identity,
            ok: true,
            output: { value: 22.5 },
        });
    });

    // Proves an operation's domain failures pass through with their specific codes.
    test("reports division by zero of either sign as the operation's own failure", async () => {
        const executor = new LocalTaskExecutor(createOperationRegistry());

        // Positive and negative zero both keep divide's own code, located at the divisor.
        for (const divisor of [0, -0]) {
            expect(
                await executor.execute(work("divide", { dividend: 1, divisor }), signal),
            ).toEqual({
                ...identity,
                ok: false,
                failure: {
                    code: "division_by_zero",
                    message: "The divisor is zero",
                    path: "/inputs/divisor",
                },
            });
        }
    });

    // Proves an unexpected throw becomes a sanitized task error that doesn't repeat the exception.
    test("turns a throwing operation into a sanitized task error", async () => {
        // Replace divide with an implementation whose exception carries a sensitive detail.
        const registry: OperationRegistry = new Map([
            [
                "divide",
                {
                    declaration: DIVIDE_OPERATION,
                    execute: () => Promise.reject(new Error("secret input 42")),
                },
            ],
        ]);
        const result = await new LocalTaskExecutor(registry).execute(
            work("divide", { dividend: 1, divisor: 1 }),
            signal,
        );

        // The failure is the generic task error, and nothing from the exception leaks into it.
        expect(result).toEqual({
            ...identity,
            ok: false,
            failure: { code: "task_error", message: "The operation failed unexpectedly", path: "" },
        });
        expect(JSON.stringify(result)).not.toContain("secret");
    });

    // Proves work for an operation this daemon doesn't have fails instead of throwing.
    test("reports an unregistered operation as a task error", async () => {
        // The release registry has no multiply operation.
        const result = await new LocalTaskExecutor(createOperationRegistry()).execute(
            work("multiply", {}),
            signal,
        );

        // The executor resolves with a task error rather than rejecting.
        expect(result.ok ? undefined : result.failure.code).toBe("task_error");
    });
});
