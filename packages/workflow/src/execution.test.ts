import { describe, expect, test } from "bun:test";
import { Compile } from "typebox/compile";
import {
    EXECUTION_FAILURE_CODES,
    ExecutionFailureSchema,
    RUN_INVOCATION_REJECTION_REASONS,
    RunAcceptanceSchema,
    RunInvocationRejectionSchema,
    RunInvocationSchema,
    RunObservationSchema,
    StepObservationSchema,
} from "./execution";

const invocationValidator = Compile(RunInvocationSchema);
const acceptanceValidator = Compile(RunAcceptanceSchema);
const observationValidator = Compile(RunObservationSchema);
const stepValidator = Compile(StepObservationSchema);
const failureValidator = Compile(ExecutionFailureSchema);
const rejectionValidator = Compile(RunInvocationRejectionSchema);

const WORKFLOW_ID = "0192b0a0-7e1d-7000-8000-000000000001";
const RUN_ID = "0192b0a0-7e1d-7000-8000-000000000010";
const STEP_ID = "0192b0a0-7e1d-7000-8000-000000000011";
const DIGEST = "a".repeat(64);
const TIMESTAMP = "2026-09-17T00:00:00.000Z";

const BINDING = {
    workflowId: WORKFLOW_ID,
    publicationNumber: 1,
    workflowFormatVersion: "v1",
    digest: DIGEST,
};

/** A failure entry as every producer writes it. */
const FAILURE = {
    code: "division_by_zero",
    path: "/divisor",
    message: "The divisor is zero",
    stepId: STEP_ID,
};

/** A run observation whose status, active work, failures, and output agree. */
function observation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        runId: RUN_ID,
        publication: BINDING,
        createdAt: TIMESTAMP,
        status: "queued",
        steps: [{ stepId: STEP_ID, status: "pending" }],
        currentSteps: [],
        failures: [],
        ...overrides,
    };
}

describe("run invocation contract", () => {
    test("accepts an invocation with or without inputs and rejects unknown or malformed members", () => {
        // The publication is addressed exactly, and absent inputs mean an empty object.
        expect(invocationValidator.Check({ workflowId: WORKFLOW_ID, publicationNumber: 1 })).toBe(
            true,
        );
        expect(
            invocationValidator.Check({
                workflowId: WORKFLOW_ID,
                publicationNumber: 1,
                inputs: { amount: 90 },
            }),
        ).toBe(true);

        // A caller cannot widen the request: unknown members, a non-positive or
        // fractional publication number, a malformed id, and a non-object inputs
        // value are all refused.
        expect(invocationValidator.Check({ workflowId: WORKFLOW_ID })).toBe(false);
        expect(invocationValidator.Check({ workflowId: WORKFLOW_ID, publicationNumber: 0 })).toBe(
            false,
        );
        expect(invocationValidator.Check({ workflowId: WORKFLOW_ID, publicationNumber: 1.5 })).toBe(
            false,
        );
        expect(
            invocationValidator.Check({ workflowId: WORKFLOW_ID, publicationNumber: 1, run: "x" }),
        ).toBe(false);
        expect(
            invocationValidator.Check({
                workflowId: WORKFLOW_ID.toUpperCase(),
                publicationNumber: 1,
            }),
        ).toBe(false);
        expect(
            invocationValidator.Check({
                workflowId: WORKFLOW_ID,
                publicationNumber: 1,
                inputs: [1],
            }),
        ).toBe(false);
    });

    test("accepts the queued acceptance and rejects a missing or disagreed binding", () => {
        // Acceptance reports the run id, the exact publication, and no progress.
        expect(
            acceptanceValidator.Check({ runId: RUN_ID, publication: BINDING, status: "queued" }),
        ).toBe(true);
        expect(acceptanceValidator.Check({ runId: RUN_ID, publication: BINDING })).toBe(false);
        expect(
            acceptanceValidator.Check({
                runId: RUN_ID,
                publication: { ...BINDING, digest: "not-a-digest" },
                status: "queued",
            }),
        ).toBe(false);
    });
});

describe("run observation contract", () => {
    test("keeps an observation coherent with the status it reports", () => {
        // A queued run has no active work, no failures, and no output.
        expect(observationValidator.Check(observation())).toBe(true);

        // Contradictory states are refused: queued work that is already active,
        // a terminal run that still lists active work, a success without an
        // output, a success carrying failures, a failure carrying an output,
        // and a failure with nothing to explain it.
        expect(
            observationValidator.Check(
                observation({ currentSteps: [{ stepId: STEP_ID, status: "ready" }] }),
            ),
        ).toBe(false);
        expect(
            observationValidator.Check(
                observation({
                    status: "failed",
                    startedAt: TIMESTAMP,
                    completedAt: TIMESTAMP,
                    failures: [FAILURE],
                    output: {},
                }),
            ),
        ).toBe(false);
        expect(
            observationValidator.Check({
                ...observation(),
                status: "succeeded",
                startedAt: TIMESTAMP,
                completedAt: TIMESTAMP,
                steps: [
                    {
                        stepId: STEP_ID,
                        status: "succeeded",
                        startedAt: TIMESTAMP,
                        completedAt: TIMESTAMP,
                        output: {},
                    },
                ],
            }),
        ).toBe(false);
        expect(
            observationValidator.Check(
                observation({
                    status: "succeeded",
                    startedAt: TIMESTAMP,
                    completedAt: TIMESTAMP,
                    output: {},
                    failures: [FAILURE],
                }),
            ),
        ).toBe(false);
        expect(
            observationValidator.Check(
                observation({ status: "failed", startedAt: TIMESTAMP, completedAt: TIMESTAMP }),
            ),
        ).toBe(false);
        expect(observationValidator.Check(observation({ status: "cancelled" }))).toBe(false);
    });

    test("reports stopped dispatch as running with failures, and a draining run keeps its active work", () => {
        // While an unhandled failure drains started work, the run is still
        // running, still lists what is executing, and carries the failure.
        expect(
            observationValidator.Check(
                observation({
                    status: "running",
                    startedAt: TIMESTAMP,
                    currentSteps: [{ stepId: STEP_ID, status: "running", startedAt: TIMESTAMP }],
                    failures: [FAILURE],
                    stopping: true,
                }),
            ),
        ).toBe(true);

        // A run that stops with no failure to explain it is refused.
        expect(
            observationValidator.Check(
                observation({ status: "running", startedAt: TIMESTAMP, stopping: true }),
            ),
        ).toBe(false);

        // Advancing work reports no failures and its terminal output stays absent.
        expect(
            observationValidator.Check(
                observation({
                    status: "running",
                    startedAt: TIMESTAMP,
                    currentSteps: [{ stepId: STEP_ID, status: "ready" }],
                }),
            ),
        ).toBe(true);
    });

    test("accepts a step observation only when its state and data match", () => {
        // Pending and ready steps carry no timing or data.
        expect(stepValidator.Check({ stepId: STEP_ID, status: "pending" })).toBe(true);
        expect(stepValidator.Check({ stepId: STEP_ID, status: "ready" })).toBe(true);
        expect(
            stepValidator.Check({ stepId: STEP_ID, status: "pending", startedAt: TIMESTAMP }),
        ).toBe(false);

        // A running step has started, a succeeded step carries its whole output,
        // and a failed step carries its failure — with a start time only when
        // work had started.
        expect(stepValidator.Check({ stepId: STEP_ID, status: "running" })).toBe(false);
        expect(
            stepValidator.Check({ stepId: STEP_ID, status: "succeeded", startedAt: TIMESTAMP }),
        ).toBe(false);
        expect(
            stepValidator.Check({
                stepId: STEP_ID,
                status: "succeeded",
                startedAt: TIMESTAMP,
                completedAt: TIMESTAMP,
                output: { value: 100 },
            }),
        ).toBe(true);
        expect(
            stepValidator.Check({
                stepId: STEP_ID,
                status: "failed",
                completedAt: TIMESTAMP,
                failure: FAILURE,
            }),
        ).toBe(true);
        expect(
            stepValidator.Check({ stepId: STEP_ID, status: "failed", completedAt: TIMESTAMP }),
        ).toBe(false);
    });
});

describe("execution failure contract", () => {
    test("accepts every documented code and rejects unknown, oversized, or extra members", () => {
        // The schema and the exported code list stay in lockstep: every code the
        // daemon can produce validates, and nothing else does.
        for (const code of EXECUTION_FAILURE_CODES) {
            expect(failureValidator.Check({ code, path: "", message: "x" })).toBe(true);
        }
        expect(failureValidator.Check({ code: "unknown_code", path: "", message: "x" })).toBe(
            false,
        );

        // A message is bounded, and a failure cannot carry undeclared detail.
        expect(
            failureValidator.Check({ code: "task_error", path: "", message: "x".repeat(513) }),
        ).toBe(false);
        expect(
            failureValidator.Check({ code: "task_error", path: "", message: "x", detail: "y" }),
        ).toBe(false);
    });

    test("accepts every refusal reason and rejects an unknown one", () => {
        // Each reason a caller branches on is part of the contract.
        for (const reason of RUN_INVOCATION_REJECTION_REASONS) {
            expect(rejectionValidator.Check({ outcome: "rejected", reason, failures: [] })).toBe(
                true,
            );
        }
        expect(
            rejectionValidator.Check({ outcome: "rejected", reason: "too_busy", failures: [] }),
        ).toBe(false);
    });
});
