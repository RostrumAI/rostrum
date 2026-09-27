/**
 * @fileoverview Tests the local task executor, which runs a work item's
 * operation from the registry and returns a result tagged with the run and
 * work it answers. The engine relies on every outcome, including failures
 * and unexpected throws, arriving as a resolved result that leaks nothing
 * from an exception.
 *
 * LocalTaskExecutor:
 * - returns the operation's output with the work's identity: divide's
 *   quotient comes back with the work item's run and work IDs.
 * - forwards the work to its operation: the operation is called once with
 *   the work item's config, inputs, and the caller's abort signal.
 * - reports division by zero of either sign as the operation's own failure:
 *   `0` and `-0` keep divide's `division_by_zero` code at `/inputs/divisor`.
 * - turns a throwing operation into a sanitized task error: a rejecting
 *   implementation yields the generic `task_error`, and the exception's
 *   text appears nowhere in the result.
 * - reports an unregistered operation as a task error: an unknown operation
 *   name resolves with `task_error` instead of rejecting, and no registered
 *   operation runs.
 */

import { describe, expect, mock, test } from "bun:test";
import { DIVIDE_OPERATION, type OperationDeclaration } from "@rostrum/workflow";
import { LocalTaskExecutor } from "./local-task-executor";
import {
    createOperationRegistry,
    type OperationRegistry,
    type OperationRequest,
} from "./operations/operation-registry";
import type { TaskWorkItem } from "./task-executor";

/** Builds a work item for an operation with the given inputs. */
function createWorkItem(operation: string, inputs: Record<string, unknown>): TaskWorkItem {
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
            await executor.execute(createWorkItem("divide", { dividend: 90, divisor: 4 }), signal),
        ).toEqual({
            ...identity,
            ok: true,
            output: { value: 22.5 },
        });
    });

    // Proves the executor hands the operation the work's config, inputs, and abort signal.
    test("forwards the work to its operation", async () => {
        // Replace divide with a recording implementation so the forwarded request is observable.
        const execute = mock((_request: OperationRequest<OperationDeclaration>) =>
            Promise.resolve({ ok: true as const, output: { value: 3 } }),
        );
        const registry: OperationRegistry = new Map([
            ["divide", { declaration: DIVIDE_OPERATION, execute }],
        ]);
        const abortController = new AbortController();
        const work = createWorkItem("divide", { dividend: 6, divisor: 2 });
        await new LocalTaskExecutor(registry).execute(work, abortController.signal);

        // The operation runs once with the work's config and inputs and the caller's own signal.
        expect(execute).toHaveBeenCalledTimes(1);
        expect(execute).toHaveBeenCalledWith({
            config: { operation: "divide" },
            inputs: { dividend: 6, divisor: 2 },
            signal: abortController.signal,
        });
        expect(execute.mock.calls[0]?.[0].signal).toBe(abortController.signal);
    });

    // Proves an operation's domain failures pass through with their specific codes.
    test("reports division by zero of either sign as the operation's own failure", async () => {
        // Run the real divide operation, whose zero-divisor check is under test.
        const executor = new LocalTaskExecutor(createOperationRegistry());

        // Positive and negative zero both keep divide's own code, located at the divisor.
        for (const divisor of [0, -0]) {
            expect(
                await executor.execute(createWorkItem("divide", { dividend: 1, divisor }), signal),
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
        const execute = mock(() => Promise.reject(new Error("secret input 42")));
        const registry: OperationRegistry = new Map([
            ["divide", { declaration: DIVIDE_OPERATION, execute }],
        ]);
        const result = await new LocalTaskExecutor(registry).execute(
            createWorkItem("divide", { dividend: 1, divisor: 1 }),
            signal,
        );

        // The operation was reached once, and its throw became the generic task error without leaking.
        expect(execute).toHaveBeenCalledTimes(1);
        expect(result).toEqual({
            ...identity,
            ok: false,
            failure: { code: "task_error", message: "The operation failed unexpectedly", path: "" },
        });
        expect(JSON.stringify(result)).not.toContain("secret");
    });

    // Proves work for an operation this daemon doesn't have fails instead of throwing.
    test("reports an unregistered operation as a task error", async () => {
        // Register only a recording divide, so a request for multiply has no match.
        const execute = mock(() => Promise.resolve({ ok: true as const, output: { value: 1 } }));
        const registry: OperationRegistry = new Map([
            ["divide", { declaration: DIVIDE_OPERATION, execute }],
        ]);
        const result = await new LocalTaskExecutor(registry).execute(
            createWorkItem("multiply", {}),
            signal,
        );

        // The executor resolves with a task error at the operation name, and no operation runs.
        expect(result.ok ? undefined : result.failure).toEqual({
            code: "task_error",
            message: "The operation isn't registered",
            path: "/config/operation",
        });
        expect(execute).not.toHaveBeenCalled();
    });
});
