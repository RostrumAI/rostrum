/** @fileoverview The contract between the engine and whatever runs one task. */

import type { FailureCode } from "@rostrum/workflow/execution";

/**
 * One task's work: which run, work, and step it belongs to, the format
 * version, the operation configuration, and the fully resolved inputs.
 * It carries no database handle, HTTP context, engine callback, or
 * prepared workflow, so a later remote worker can receive the same data.
 */
export interface TaskWorkItem {
    /** The run the work belongs to. */
    readonly runId: string;
    /** The work's identity; the result must carry it back. */
    readonly workId: string;
    /** The step the work runs. */
    readonly stepId: string;
    /** The publication's workflow format version. */
    readonly workflowFormatVersion: string;
    /** The task's validated `config`, including `operation`. */
    readonly config: Readonly<Record<string, unknown>>;
    /** Every argument, bound or defaulted, already checked against the operation. */
    readonly inputs: Readonly<Record<string, unknown>>;
}

/** A task failure, located relative to its step, for example `/inputs/divisor`. */
export interface TaskFailure {
    /** A catalog failure code: the operation's own, or `task_error`. */
    readonly code: FailureCode;
    /** A sanitized explanation. */
    readonly message: string;
    /** JSON Pointer relative to the step, or `""` when nothing narrower applies. */
    readonly path: string;
}

/** A task's outcome, identified by the run and work it answers. */
export type TaskWorkResult =
    | {
          /** The run the work belongs to. */
          readonly runId: string;
          /** The work this result answers. */
          readonly workId: string;
          /** The operation returned output. */
          readonly ok: true;
          /** The output, not yet validated; the engine checks it before anything uses it. */
          readonly output: unknown;
      }
    | {
          /** The run the work belongs to. */
          readonly runId: string;
          /** The work this result answers. */
          readonly workId: string;
          /** The operation failed. */
          readonly ok: false;
          /** Why. */
          readonly failure: TaskFailure;
      };

/** Runs one task. Cancellation is a separate signal, not part of the work item. */
export interface TaskExecutor {
    /**
     * Runs the work and resolves with its identified result. The signal
     * asks the work to stop; it can't force synchronous code to.
     */
    execute(work: TaskWorkItem, signal: AbortSignal): Promise<TaskWorkResult>;
}
