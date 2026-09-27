/** @fileoverview Runs tasks in this process with the registered operations. */

import type { OperationRegistry } from "./operations/operation-registry";
import type { TaskExecutor, TaskWorkItem, TaskWorkResult } from "./task-executor";

/**
 * Runs a task by looking up its operation and calling it. An unexpected
 * throw or rejection becomes a sanitized `task_error`: the exception may
 * repeat the inputs, so its text is never reported.
 */
export class LocalTaskExecutor implements TaskExecutor {
    private readonly registry: OperationRegistry;

    /** Binds the executor to the operations built at startup. */
    constructor(registry: OperationRegistry) {
        this.registry = registry;
    }

    /** Runs one task and returns its identified result. */
    async execute(work: TaskWorkItem, signal: AbortSignal): Promise<TaskWorkResult> {
        const identity = { runId: work.runId, workId: work.workId };
        const name = work.config.operation;
        const operation = typeof name === "string" ? this.registry.get(name) : undefined;
        if (!operation) {
            return {
                ...identity,
                ok: false,
                failure: {
                    code: "task_error",
                    message: "The operation isn't registered",
                    path: "/config/operation",
                },
            };
        }

        try {
            const outcome = await operation.execute({
                config: work.config,
                inputs: work.inputs,
                signal,
            });
            return outcome.ok
                ? { ...identity, ok: true, output: outcome.output }
                : { ...identity, ok: false, failure: outcome.failure };
        } catch {
            // The error is dropped deliberately: its message may echo the task's inputs.
            return {
                ...identity,
                ok: false,
                failure: {
                    code: "task_error",
                    message: "The operation failed unexpectedly",
                    path: "",
                },
            };
        }
    }
}
