import { type Static, Type } from "typebox";
import { UUID_V7_PATTERN } from "../schema";

/**
 * The run vocabulary the daemon and the Control API must describe
 * identically: run and step statuses, the failure-code catalog and
 * failure shape, run-refusal reasons, and the acceptance and inspection
 * payloads that carry them.
 *
 * Each application still declares its own request bodies, error
 * envelopes, headers, and status codes. The inspection schemas are unions
 * of per-state variants, each closed with `additionalProperties: false`,
 * so a payload describing an impossible state — a failed run with a
 * result, a terminal run with active work, a completed step with a
 * failure — fails validation.
 */

/** A UUID v7 identifier, in the workflow format's one pattern. */
const UuidV7 = Type.String({ pattern: UUID_V7_PATTERN });

/** An instant recorded when a transition happens, as an RFC 3339 timestamp. */
const Timestamp = Type.String({ format: "date-time" });

/** An empty list: terminal and queued runs carry no active or waiting work. */
const NoStepIds = Type.Array(UuidV7, { maxItems: 0 });

/** A JSON object of named values: a step's committed output or a run's final result. */
const NamedValues = Type.Record(Type.String(), Type.Unknown());

/** Run statuses. `completed` means success; `completed` and `failed` are terminal. */
export const RunStatusSchema = Type.Union([
    Type.Literal("queued"),
    Type.Literal("running"),
    Type.Literal("completed"),
    Type.Literal("failed"),
]);

/** A run's status. */
export type RunStatus = Static<typeof RunStatusSchema>;

/** Step statuses. `pending` means no visit exists; inspection derives it from the definition. */
export const StepStatusSchema = Type.Union([
    Type.Literal("pending"),
    Type.Literal("waiting"),
    Type.Literal("ready"),
    Type.Literal("running"),
    Type.Literal("completed"),
    Type.Literal("failed"),
]);

/** A step's status within one run. */
export type StepStatus = Static<typeof StepStatusSchema>;

/**
 * Every execution failure code, for every node and operation type.
 *
 * Preparation refuses a publication with the document, capability, and
 * static-compatibility codes; invocation refuses inputs with the input
 * codes; accepted runs fail with the run, task, and operation codes.
 * Operation declarations list which of these codes they can return
 * instead of defining their own.
 */
export const FailureCodeSchema = Type.Union([
    // The stored document can't be read or doesn't match its publication.
    Type.Literal("invalid_document"),
    Type.Literal("unsupported_format"),
    Type.Literal("publication_mismatch"),
    // The document uses something this daemon release can't execute.
    Type.Literal("unsupported_step_type"),
    Type.Literal("unsupported_control_flow"),
    Type.Literal("self_dependency"),
    Type.Literal("unresolved_binding"),
    // The shared static compatibility check rejected the document.
    Type.Literal("unknown_operation"),
    Type.Literal("invalid_config"),
    Type.Literal("invalid_schema"),
    Type.Literal("invalid_default"),
    Type.Literal("missing_argument"),
    Type.Literal("undeclared_argument"),
    Type.Literal("undeclared_output"),
    Type.Literal("io_type_mismatch"),
    Type.Literal("io_unprovable"),
    // The invocation's inputs don't match the workflow's declarations.
    Type.Literal("missing_input"),
    Type.Literal("undeclared_input"),
    Type.Literal("invalid_input"),
    // An accepted run can't make progress or its work failed.
    Type.Literal("unmet_dependencies"),
    Type.Literal("missing_result"),
    Type.Literal("task_timeout"),
    Type.Literal("task_error"),
    Type.Literal("invalid_output"),
    Type.Literal("execution_error"),
    // Built-in operations report these domain failures.
    Type.Literal("numeric_overflow"),
    Type.Literal("division_by_zero"),
]);

/** One execution failure code. */
export type FailureCode = Static<typeof FailureCodeSchema>;

/** A located, sanitized execution failure. */
export const ExecutionFailureSchema = Type.Object(
    {
        code: FailureCodeSchema,
        message: Type.String(),
        path: Type.String(),
        stepId: Type.Optional(UuidV7),
    },
    { additionalProperties: false },
);

/**
 * A located, sanitized execution failure. `path` is a JSON Pointer into
 * the publication, the invocation, or the operation's inputs or output;
 * the empty pointer means no narrower location applies. The message never
 * includes supplied data or a raw exception.
 */
export type ExecutionFailure = Static<typeof ExecutionFailureSchema>;

/**
 * Why the daemon refused an invocation before any run existed:
 * `publication_not_found` (no such publication), `corrupt_publication`
 * (the stored publication can't be trusted), `unsupported_execution`
 * (this release can't run it), and `invalid_inputs` (the invocation's
 * inputs don't match the declarations).
 */
export const RunRefusalReasonSchema = Type.Union([
    Type.Literal("publication_not_found"),
    Type.Literal("corrupt_publication"),
    Type.Literal("unsupported_execution"),
    Type.Literal("invalid_inputs"),
]);

/** Why an invocation was refused. */
export type RunRefusalReason = Static<typeof RunRefusalReasonSchema>;

/** A refused invocation: one reason and every failure found. */
export const RunRefusalSchema = Type.Object(
    {
        reason: RunRefusalReasonSchema,
        failures: Type.Array(ExecutionFailureSchema),
    },
    { additionalProperties: false },
);

/** A refused invocation: its reason and every located failure found, not just the first. */
export type RunRefusal = Static<typeof RunRefusalSchema>;

/** The exact publication a run executes, recorded at acceptance and never read again. */
export const RunPublicationSchema = Type.Object(
    {
        workflowId: UuidV7,
        publicationNumber: Type.Integer({ minimum: 1 }),
        workflowFormatVersion: Type.String(),
        digest: Type.String({ pattern: "^[0-9a-f]{64}$" }),
    },
    { additionalProperties: false },
);

/** The workflow ID, publication number, format version, and digest a run executes. */
export type RunPublication = Static<typeof RunPublicationSchema>;

/** The acceptance payload: the run's ID and publication, queued. */
export const RunAcceptanceSchema = Type.Object(
    {
        runId: UuidV7,
        publication: RunPublicationSchema,
        status: Type.Literal("queued"),
    },
    { additionalProperties: false },
);

/** What an accepted invocation returns. Execution continues independently of the response. */
export type RunAcceptance = Static<typeof RunAcceptanceSchema>;

/** A step that has no visit yet. */
const PendingStepSnapshot = Type.Object(
    { stepId: UuidV7, status: Type.Literal("pending") },
    { additionalProperties: false },
);

/** A step whose visit exists but has at least one dependency that hasn't completed. */
const WaitingStepSnapshot = Type.Object(
    {
        stepId: UuidV7,
        status: Type.Literal("waiting"),
        waitingFor: Type.Array(UuidV7, { minItems: 1 }),
    },
    { additionalProperties: false },
);

/** A step whose dependencies are satisfied and which may be dispatched. */
const ReadyStepSnapshot = Type.Object(
    { stepId: UuidV7, status: Type.Literal("ready") },
    { additionalProperties: false },
);

/** A step the engine has claimed and handed to the executor. */
const RunningStepSnapshot = Type.Object(
    { stepId: UuidV7, status: Type.Literal("running"), startedAt: Timestamp },
    { additionalProperties: false },
);

/** A step whose full output passed validation and was committed. */
const CompletedStepSnapshot = Type.Object(
    {
        stepId: UuidV7,
        status: Type.Literal("completed"),
        startedAt: Type.Optional(Timestamp),
        completedAt: Timestamp,
        output: NamedValues,
    },
    { additionalProperties: false },
);

/** A step that can't succeed. `startedAt` appears only when execution actually started. */
const FailedStepSnapshot = Type.Object(
    {
        stepId: UuidV7,
        status: Type.Literal("failed"),
        startedAt: Type.Optional(Timestamp),
        completedAt: Timestamp,
        failure: ExecutionFailureSchema,
    },
    { additionalProperties: false },
);

/** One step's current state within a run. Only a completed step carries output. */
export const StepSnapshotSchema = Type.Union([
    PendingStepSnapshot,
    WaitingStepSnapshot,
    ReadyStepSnapshot,
    RunningStepSnapshot,
    CompletedStepSnapshot,
    FailedStepSnapshot,
]);

/** One step's current state within a run. */
export type StepSnapshot = Static<typeof StepSnapshotSchema>;

/**
 * Every step of the publication in document order, which is display order,
 * not execution order, limited to the step states the run's status allows.
 */
function stepSnapshots(...allowed: (typeof StepSnapshotSchema.anyOf)[number][]) {
    return Type.Array(Type.Union(allowed), { minItems: 1 });
}

/** An accepted run whose first advancement hasn't happened. */
const QueuedRunSnapshot = Type.Object(
    {
        runId: UuidV7,
        publication: RunPublicationSchema,
        status: Type.Literal("queued"),
        stopping: Type.Literal(false),
        acceptedAt: Timestamp,
        // Nothing has been reached before the first advancement.
        steps: stepSnapshots(PendingStepSnapshot),
        currentSteps: NoStepIds,
        waitingFor: NoStepIds,
    },
    { additionalProperties: false },
);

/** A run that is making progress: `currentSteps` lists ready and running work. */
const RunningRunSnapshot = Type.Object(
    {
        runId: UuidV7,
        publication: RunPublicationSchema,
        status: Type.Literal("running"),
        stopping: Type.Literal(false),
        acceptedAt: Timestamp,
        startedAt: Timestamp,
        // A failed step would have stopped the run.
        steps: stepSnapshots(
            PendingStepSnapshot,
            WaitingStepSnapshot,
            ReadyStepSnapshot,
            RunningStepSnapshot,
            CompletedStepSnapshot,
        ),
        currentSteps: Type.Array(UuidV7),
        waitingFor: Type.Array(UuidV7),
    },
    { additionalProperties: false },
);

/**
 * A run that has failed while work is still executing. Dispatch has
 * stopped: `currentSteps` lists only running work, which must exist, and
 * the run becomes `failed` when it settles.
 */
const StoppingRunSnapshot = Type.Object(
    {
        runId: UuidV7,
        publication: RunPublicationSchema,
        status: Type.Literal("running"),
        stopping: Type.Literal(true),
        acceptedAt: Timestamp,
        startedAt: Timestamp,
        steps: stepSnapshots(...StepSnapshotSchema.anyOf),
        currentSteps: Type.Array(UuidV7, { minItems: 1 }),
        waitingFor: Type.Array(UuidV7),
        failure: ExecutionFailureSchema,
    },
    { additionalProperties: false },
);

/** A run that committed its result with nothing failed. The result never changes. */
const CompletedRunSnapshot = Type.Object(
    {
        runId: UuidV7,
        publication: RunPublicationSchema,
        status: Type.Literal("completed"),
        stopping: Type.Literal(false),
        acceptedAt: Timestamp,
        startedAt: Timestamp,
        completedAt: Timestamp,
        // Success leaves every reached step completed and unreached ones pending.
        steps: stepSnapshots(PendingStepSnapshot, CompletedStepSnapshot),
        currentSteps: NoStepIds,
        waitingFor: NoStepIds,
        result: NamedValues,
    },
    { additionalProperties: false },
);

/** A run that failed and whose outstanding work has settled. It has no result. */
const FailedRunSnapshot = Type.Object(
    {
        runId: UuidV7,
        publication: RunPublicationSchema,
        status: Type.Literal("failed"),
        stopping: Type.Literal(false),
        acceptedAt: Timestamp,
        startedAt: Timestamp,
        completedAt: Timestamp,
        // Settled: work abandoned by the failure may be waiting or ready, but none is running.
        steps: stepSnapshots(
            PendingStepSnapshot,
            WaitingStepSnapshot,
            ReadyStepSnapshot,
            CompletedStepSnapshot,
            FailedStepSnapshot,
        ),
        currentSteps: NoStepIds,
        waitingFor: NoStepIds,
        failure: ExecutionFailureSchema,
    },
    { additionalProperties: false },
);

/**
 * The inspection snapshot of one run. `waitingFor` lists the dependency
 * step IDs that waiting visits still need; each waiting step also names
 * its own.
 */
export const RunSnapshotSchema = Type.Union([
    QueuedRunSnapshot,
    RunningRunSnapshot,
    StoppingRunSnapshot,
    CompletedRunSnapshot,
    FailedRunSnapshot,
]);

/** The inspection snapshot of one run. */
export type RunSnapshot = Static<typeof RunSnapshotSchema>;
