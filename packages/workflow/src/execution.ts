import { type Static, Type } from "typebox";

/**
 * Shared execution contracts for invoking a publication and observing a run.
 *
 * Both the Control API and the daemon import this entry point
 * (`@rostrum/workflow/execution`). It carries data: what a caller sends, what
 * the daemon accepts, what inspection returns, and the stable failure
 * vocabulary those shapes carry. It carries no execution behavior and no
 * transport declarations — HTTP status codes, headers, and the daemon's task
 * executor stay with the applications that own them.
 *
 * The shapes below are also the boundary contract for a daemon-local run:
 * everything here is serializable JSON, so the same values travel through an
 * HTTP body or an in-process call without reinterpretation.
 */

/** A JSON value: the only kind of data execution stores, binds, or returns. */
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | JsonObject;

/** A JSON object with arbitrary member names. */
export interface JsonObject {
    /** One member of the object. */
    readonly [name: string]: JsonValue;
}

/** Validates a JSON value of any depth, including nested objects and arrays. */
export const JsonValueSchema = Type.Cyclic(
    {
        JsonValue: Type.Union([
            Type.String(),
            Type.Number(),
            Type.Boolean(),
            Type.Null(),
            Type.Array(Type.Ref("JsonValue")),
            Type.Ref("JsonObject"),
        ]),
        JsonObject: Type.Record(Type.String(), Type.Ref("JsonValue")),
    },
    "JsonValue",
);

/** Validates a JSON object with arbitrary member names. */
export const JsonObjectSchema = Type.Record(Type.String(), JsonValueSchema);

/** The lowercase hexadecimal identifier shape run, workflow, and step ids share. */
const IDENTIFIER_PATTERN = "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";

/** The identifier of one run. */
const RunIdSchema = Type.String({ pattern: IDENTIFIER_PATTERN });

/** The identifier of one step within a workflow document. */
const StepIdSchema = Type.String({ pattern: IDENTIFIER_PATTERN });

/** The workflow identifier a publication belongs to. */
const WorkflowIdSchema = Type.String({ pattern: IDENTIFIER_PATTERN });

/** A workflow-format version token, exact-matched to a rule set. */
const WorkflowFormatVersionSchema = Type.String({ minLength: 1 });

/** The SHA-256 lowercase hexadecimal digest of one publication. */
const DigestSchema = Type.String({ pattern: "^[0-9a-f]{64}$" });

/** An ISO 8601 timestamp with offset, as produced for run and step records. */
const TimestampSchema = Type.String({ format: "date-time" });

/** The result step's terminal output, or a step's committed output. */
const OutputValueSchema = JsonValueSchema;

/**
 * The exact publication a run executes.
 *
 * A run binds this value at acceptance and never re-reads the publication, so
 * publishing a newer version cannot change an accepted run. The digest lets
 * both services and a caller name the exact published bytes.
 */
export const PublicationBindingSchema = Type.Object(
    {
        workflowId: WorkflowIdSchema,
        publicationNumber: Type.Integer({
            minimum: 1,
            description: "The per-workflow publication number.",
        }),
        workflowFormatVersion: WorkflowFormatVersionSchema,
        digest: DigestSchema,
    },
    { additionalProperties: false },
);

/** The exact publication a run executes. */
export type PublicationBinding = Static<typeof PublicationBindingSchema>;

/**
 * The body of `POST /api/runs`: the publication to run and its inputs.
 *
 * `inputs` is absent when the caller supplies none, which means the same as
 * an empty object. Input values are data, never references: only bindings
 * inside the published document are interpreted as references, so a caller
 * cannot redirect an input at another value.
 */
export const RunInvocationSchema = Type.Object(
    {
        workflowId: WorkflowIdSchema,
        publicationNumber: Type.Integer({
            minimum: 1,
            description: "The per-workflow publication number to execute.",
        }),
        inputs: Type.Optional(JsonObjectSchema),
    },
    { additionalProperties: false },
);

/** The publication to run and its inputs. */
export type RunInvocation = Static<typeof RunInvocationSchema>;

/**
 * The accepted invocation: a run exists and owns the binding.
 *
 * Acceptance reports no progress. A following inspection may already show
 * running or terminal work, because the daemon starts advancing the run
 * without waiting for the reply.
 */
export const RunAcceptanceSchema = Type.Object(
    {
        runId: RunIdSchema,
        publication: PublicationBindingSchema,
        status: Type.Literal("queued"),
    },
    { additionalProperties: false },
);

/** The accepted invocation. */
export type RunAcceptance = Static<typeof RunAcceptanceSchema>;

/** The stable failure codes an execution outcome carries. */
export const EXECUTION_FAILURE_CODES = [
    "invalid_document",
    "unsupported_step_type",
    "unsupported_step_config",
    "unsupported_control_flow",
    "unsupported_binding",
    "invalid_schema",
    "value_depth",
    "unsupported_schema",
    "missing_input",
    "undeclared_input",
    "invalid_input",
    "unresolved_binding",
    "invalid_output",
    "task_error",
    "numeric_overflow",
    "division_by_zero",
    "run_snapshot_limit",
] as const;

/**
 * A code identifying why the daemon refused or failed a unit of work.
 *
 * Preparation uses the document and input codes; execution uses the binding,
 * output, task, arithmetic, and limit codes. Later Epics extend this list
 * rather than reinterpreting an existing code.
 */
export type ExecutionFailureCode = (typeof EXECUTION_FAILURE_CODES)[number];

const ExecutionFailureCodeSchema = Type.Unsafe<ExecutionFailureCode>({
    type: "string",
    enum: [...EXECUTION_FAILURE_CODES],
});

/**
 * One reason the daemon refused an invocation or failed a step.
 *
 * `path` locates the failure in the subject the code belongs to: the workflow
 * document for document-level codes, the invocation inputs for input codes,
 * and the operation's input or output object for task codes. It is an empty
 * string when the failure is about that subject as a whole. `message` is a
 * sanitized explanation: it never carries raw exceptions, connection details,
 * or input values.
 */
export const ExecutionFailureSchema = Type.Object(
    {
        code: ExecutionFailureCodeSchema,
        path: Type.String({
            description:
                "JSON Pointer to the failing location within the subject the code belongs to.",
        }),
        message: Type.String({ minLength: 1, maxLength: 512 }),
        stepId: Type.Optional(
            Type.String({
                description: "The step the failure belongs to, when it belongs to one.",
            }),
        ),
    },
    { additionalProperties: false },
);

/** One reason the daemon refused an invocation or failed a step. */
export type ExecutionFailure = Static<typeof ExecutionFailureSchema>;

/** A step that has not become eligible to execute. */
const StepPendingSchema = Type.Object(
    { stepId: StepIdSchema, status: Type.Literal("pending") },
    { additionalProperties: false },
);

/** A step that can execute but has not started. */
const StepReadySchema = Type.Object(
    { stepId: StepIdSchema, status: Type.Literal("ready") },
    { additionalProperties: false },
);

/** A step whose task work has started and not settled. */
const StepRunningSchema = Type.Object(
    { stepId: StepIdSchema, status: Type.Literal("running"), startedAt: TimestampSchema },
    { additionalProperties: false },
);

/** A step whose whole output passed validation and was committed. */
const StepSucceededSchema = Type.Object(
    {
        stepId: StepIdSchema,
        status: Type.Literal("succeeded"),
        startedAt: TimestampSchema,
        completedAt: TimestampSchema,
        output: OutputValueSchema,
    },
    { additionalProperties: false },
);

/**
 * A step that failed.
 *
 * `startedAt` is absent when the failure happened before any task work
 * started, such as a binding that could not be resolved.
 */
const StepFailedSchema = Type.Object(
    {
        stepId: StepIdSchema,
        status: Type.Literal("failed"),
        startedAt: Type.Optional(TimestampSchema),
        completedAt: TimestampSchema,
        failure: ExecutionFailureSchema,
    },
    { additionalProperties: false },
);

/** The active-work entries an inspection lists: steps that are ready or running. */
export const CurrentStepSchema = Type.Union([StepReadySchema, StepRunningSchema]);

/** One step's state within a run. */
export const StepObservationSchema = Type.Union([
    StepPendingSchema,
    StepReadySchema,
    StepRunningSchema,
    StepSucceededSchema,
    StepFailedSchema,
]);

/** One step's state within a run. */
export type StepObservation = Static<typeof StepObservationSchema>;

/** The members every run observation carries, whatever its status. */
const runObservationBase = {
    runId: RunIdSchema,
    publication: PublicationBindingSchema,
    createdAt: TimestampSchema,
    steps: Type.Array(StepObservationSchema, {
        description:
            "Every step the run knows about, in the workflow's declared order, whether or not it executed.",
    }),
};

/** The members a run observation carries once execution started. */
const startedRunBase = {
    ...runObservationBase,
    startedAt: TimestampSchema,
};

/** No work has started. */
const QueuedObservationSchema = Type.Object(
    {
        ...runObservationBase,
        status: Type.Literal("queued"),
        currentSteps: Type.Tuple([]),
        failures: Type.Tuple([]),
    },
    { additionalProperties: false },
);

/** Work is advancing, and nothing has failed. */
const AdvancingObservationSchema = Type.Object(
    {
        ...startedRunBase,
        status: Type.Literal("running"),
        stopping: Type.Optional(Type.Literal(false)),
        currentSteps: Type.Array(CurrentStepSchema),
        failures: Type.Tuple([]),
    },
    { additionalProperties: false },
);

/** A failure stopped new dispatch while started work settles. */
const StoppingObservationSchema = Type.Object(
    {
        ...startedRunBase,
        status: Type.Literal("running"),
        stopping: Type.Literal(true),
        currentSteps: Type.Array(CurrentStepSchema),
        failures: Type.Array(ExecutionFailureSchema, { minItems: 1 }),
    },
    { additionalProperties: false },
);

/** The run produced its final result. */
const SucceededObservationSchema = Type.Object(
    {
        ...startedRunBase,
        status: Type.Literal("succeeded"),
        completedAt: TimestampSchema,
        currentSteps: Type.Tuple([]),
        failures: Type.Tuple([]),
        output: OutputValueSchema,
    },
    { additionalProperties: false },
);

/** An unhandled failure ended the run. */
const FailedObservationSchema = Type.Object(
    {
        ...startedRunBase,
        status: Type.Literal("failed"),
        completedAt: TimestampSchema,
        currentSteps: Type.Tuple([]),
        failures: Type.Array(ExecutionFailureSchema, { minItems: 1 }),
    },
    { additionalProperties: false },
);

/**
 * What `GET /api/runs/:runId` returns: the current state of one run.
 *
 * The variants keep state and data consistent: a terminal run lists no active
 * work, a failed run carries at least one failure and no final output, and
 * only a succeeded run carries `output`. A terminal observation never
 * changes, and a run that failed keeps its earlier successful step outputs.
 */
export const RunObservationSchema = Type.Union([
    QueuedObservationSchema,
    AdvancingObservationSchema,
    StoppingObservationSchema,
    SucceededObservationSchema,
    FailedObservationSchema,
]);

/** The current state of one run. */
export type RunObservation = Static<typeof RunObservationSchema>;

/** The distinct reasons the daemon refuses to start a run. */
export const RUN_INVOCATION_REJECTION_REASONS = [
    "publication_not_found",
    "corrupt_publication",
    "unsupported_execution",
    "invalid_inputs",
    "run_snapshot_limit",
] as const;

/** One reason the daemon refuses to start a run. */
export type RunInvocationRejectionReason = (typeof RUN_INVOCATION_REJECTION_REASONS)[number];

const RunInvocationRejectionReasonSchema = Type.Unsafe<RunInvocationRejectionReason>({
    type: "string",
    enum: [...RUN_INVOCATION_REJECTION_REASONS],
});

/**
 * Why the daemon refused an invocation.
 *
 * `publication_not_found` means no such publication exists;
 * `corrupt_publication` means stored content failed integrity or format
 * verification; `unsupported_execution` means this release cannot execute
 * every declared step; `invalid_inputs` means the invocation inputs do not
 * satisfy the workflow's declared inputs; `run_snapshot_limit` means the
 * publication could not be retained inspectably within the configured
 * snapshot budget. The reasons stay distinguishable because a caller reacts
 * differently to each: a missing publication is a caller mistake, an
 * unsupported publication needs a different daemon release, and invalid
 * inputs need corrected values.
 */
export const RunInvocationRejectionSchema = Type.Object(
    {
        outcome: Type.Literal("rejected"),
        reason: RunInvocationRejectionReasonSchema,
        failures: Type.Array(ExecutionFailureSchema, {
            description: "The detail behind the reason; empty when the reason is self-explanatory.",
        }),
    },
    { additionalProperties: false },
);

/** Why the daemon refused an invocation. */
export type RunInvocationRejection = Static<typeof RunInvocationRejectionSchema>;
