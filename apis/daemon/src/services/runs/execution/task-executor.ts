import type { ExecutionFailureCode, JsonObject } from "@rostrum/workflow/execution";
import type { TaskOperationConfig } from "./operation-contracts";

/**
 * The boundary between the daemon and one task execution.
 *
 * The daemon selects work, records it, and commits outcomes; an executor
 * receives one work item and returns one result. M2 runs the executor inside
 * the daemon process, but everything crossing this boundary is serializable
 * JSON and identifies its run and work item, so a later worker implementation
 * can take the same responsibility without taking ownership of the workflow.
 *
 * A work item carries everything one operation needs: the resolved inputs,
 * the validated configuration, and the identifiers an outcome has to name. It
 * carries no database handle, request context, engine callback, prepared
 * graph, or reference into run state.
 */

/** One task execution handed to an executor. */
export interface TaskWorkItem {
    /** The run this work belongs to. */
    readonly runId: string;
    /** The identifier of this execution, unique within the run. */
    readonly workId: string;
    /** The step this execution advances. */
    readonly stepId: string;
    /** The workflow-format version the step's configuration was validated under. */
    readonly workflowFormatVersion: string;
    /** The validated configuration of the task step. */
    readonly config: TaskOperationConfig;
    /** The fully resolved input object for this one execution. */
    readonly inputs: JsonObject;
}

/**
 * The failures a task executor reports.
 *
 * Each name is part of the shared execution failure vocabulary, so an
 * inspection can present a task failure without translating it.
 */
export type TaskFailureCode = Extract<
    ExecutionFailureCode,
    "division_by_zero" | "numeric_overflow" | "task_error"
>;

/**
 * A typed reason one execution produced no output.
 *
 * `path` locates the failure inside the operation's inputs or outputs, and
 * `message` is a sanitized explanation: an unexpected exception is described,
 * never copied, so internal detail cannot reach stored run state.
 */
export interface TaskFailure {
    /** The stable code for this failure. */
    readonly code: TaskFailureCode;
    /** JSON Pointer to the failing location in the operation's input or output object. */
    readonly path: string;
    /** A sanitized, caller-readable explanation. */
    readonly message: string;
}

/** The outcome of one task execution: a complete output, or a typed failure. */
export type TaskWorkResult =
    | {
          /** The execution produced an output. */
          readonly outcome: "succeeded";
          /** The run this result belongs to. */
          readonly runId: string;
          /** The execution this result settles. */
          readonly workId: string;
          /** The operation's whole output object, before the daemon validates it. */
          readonly output: JsonObject;
      }
    | {
          /** The execution produced no output. */
          readonly outcome: "failed";
          /** The run this result belongs to. */
          readonly runId: string;
          /** The execution this result settles. */
          readonly workId: string;
          /** Why the execution produced no output. */
          readonly failure: TaskFailure;
      };

/** Executes one unit of task work. */
export interface TaskExecutor {
    /**
     * Executes one work item and returns its outcome.
     *
     * The executor performs the work of this step only: it never selects
     * further work, never commits an output, and never decides that a run is
     * complete. An unexpected throw or rejection is reported as a sanitized
     * `task_error` result rather than escaping to the caller.
     *
     * `signal` aborts with the process that owns the run. It is not the
     * initiating caller's signal: a caller disconnecting never cancels
     * accepted work.
     */
    execute(work: TaskWorkItem, signal: AbortSignal): Promise<TaskWorkResult>;
}
