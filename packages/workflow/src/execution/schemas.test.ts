import { describe, expect, test } from "bun:test";
import { Value } from "typebox/value";
import {
    type ExecutionFailure,
    type RunPublication,
    RunSnapshotSchema,
    type StepSnapshot,
    StepSnapshotSchema,
} from "./schemas";

const RUN_ID = "0192b0a0-7e1d-7000-8000-000000000200";
const FIRST_STEP = "0192b0a0-7e1d-7000-8000-000000000201";
const SECOND_STEP = "0192b0a0-7e1d-7000-8000-000000000202";
const AT = "2026-09-23T12:00:00.000Z";

const publication: RunPublication = {
    workflowId: "0192b0a0-7e1d-7000-8000-000000000100",
    publicationNumber: 1,
    workflowFormatVersion: "v1",
    digest: "0".repeat(64),
};

const failure: ExecutionFailure = {
    code: "division_by_zero",
    message: "The divisor is zero",
    path: "/steps/1/inputs/divisor",
    stepId: SECOND_STEP,
};

/** Builds a run snapshot around a status-specific core, sharing the run's identity. */
function runSnapshot(
    core: Record<string, unknown>,
    steps: StepSnapshot[],
): Record<string, unknown> {
    return { runId: RUN_ID, publication, acceptedAt: AT, steps, ...core };
}

describe("step snapshots", () => {
    // Proves a waiting step must say which dependencies it is waiting for.
    test("a waiting step names its unmet dependencies", () => {
        // A waiting step with one unmet dependency is well formed.
        const waiting = { stepId: SECOND_STEP, status: "waiting", waitingFor: [FIRST_STEP] };
        expect(Value.Check(StepSnapshotSchema, waiting)).toBe(true);

        // Without any named dependency, or without the list, it isn't.
        expect(Value.Check(StepSnapshotSchema, { ...waiting, waitingFor: [] })).toBe(false);
        expect(Value.Check(StepSnapshotSchema, { stepId: SECOND_STEP, status: "waiting" })).toBe(
            false,
        );
    });

    // Proves only a completed step can carry output, and a completed step can't carry a failure.
    test("output and failure can't appear on the wrong step state", () => {
        // A completed step carries its output; a failed step carries its failure.
        const completed = {
            stepId: FIRST_STEP,
            status: "completed",
            completedAt: AT,
            output: { value: 1 },
        };
        const failed = { stepId: FIRST_STEP, status: "failed", completedAt: AT, failure };
        expect(Value.Check(StepSnapshotSchema, completed)).toBe(true);
        expect(Value.Check(StepSnapshotSchema, failed)).toBe(true);

        // Mixing them, or giving output to unfinished work, is rejected.
        expect(Value.Check(StepSnapshotSchema, { ...completed, failure })).toBe(false);
        expect(Value.Check(StepSnapshotSchema, { ...failed, output: { value: 1 } })).toBe(false);
        expect(
            Value.Check(StepSnapshotSchema, {
                stepId: FIRST_STEP,
                status: "running",
                startedAt: AT,
                output: { value: 1 },
            }),
        ).toBe(false);
    });
});

describe("run snapshots", () => {
    // Proves a stopping run carries its failure and the work that is still outstanding.
    test("a stopping run carries the failure and its outstanding work", () => {
        // The first step failed while the second is still running.
        const steps: StepSnapshot[] = [
            { stepId: FIRST_STEP, status: "failed", completedAt: AT, failure },
            { stepId: SECOND_STEP, status: "running", startedAt: AT },
        ];
        const stopping = runSnapshot(
            {
                status: "running",
                stopping: true,
                startedAt: AT,
                currentSteps: [SECOND_STEP],
                waitingFor: [],
                failure,
            },
            steps,
        );
        expect(Value.Check(RunSnapshotSchema, stopping)).toBe(true);

        // A stopping run without its failure, or with no outstanding work, is rejected.
        const { failure: _failure, ...withoutFailure } = stopping;
        expect(Value.Check(RunSnapshotSchema, withoutFailure)).toBe(false);
        expect(Value.Check(RunSnapshotSchema, { ...stopping, currentSteps: [] })).toBe(false);
    });

    // Proves a failed run can't also report a successful result or active work.
    test("a failed run carries no result and no active work", () => {
        // A settled failure with no current work is well formed.
        const steps: StepSnapshot[] = [
            { stepId: FIRST_STEP, status: "completed", completedAt: AT, output: { value: 100 } },
            { stepId: SECOND_STEP, status: "failed", startedAt: AT, completedAt: AT, failure },
        ];
        const failed = runSnapshot(
            {
                status: "failed",
                stopping: false,
                startedAt: AT,
                completedAt: AT,
                currentSteps: [],
                waitingFor: [],
                failure,
            },
            steps,
        );
        expect(Value.Check(RunSnapshotSchema, failed)).toBe(true);

        // Adding a result, current work, waiting work, or a stopping flag is rejected.
        expect(Value.Check(RunSnapshotSchema, { ...failed, result: { total: 100 } })).toBe(false);
        expect(Value.Check(RunSnapshotSchema, { ...failed, currentSteps: [SECOND_STEP] })).toBe(
            false,
        );
        expect(Value.Check(RunSnapshotSchema, { ...failed, waitingFor: [FIRST_STEP] })).toBe(false);
        expect(Value.Check(RunSnapshotSchema, { ...failed, stopping: true })).toBe(false);
    });

    // Proves a completed run reports its result and can't also report a failure.
    test("a completed run carries its result and no failure", () => {
        // An empty result object is still a result.
        const completed = runSnapshot(
            {
                status: "completed",
                stopping: false,
                startedAt: AT,
                completedAt: AT,
                currentSteps: [],
                waitingFor: [],
                result: {},
            },
            [{ stepId: FIRST_STEP, status: "completed", completedAt: AT, output: {} }],
        );
        expect(Value.Check(RunSnapshotSchema, completed)).toBe(true);

        // Without the result, or with a failure beside it, the snapshot is rejected.
        const { result: _result, ...withoutResult } = completed;
        expect(Value.Check(RunSnapshotSchema, withoutResult)).toBe(false);
        expect(Value.Check(RunSnapshotSchema, { ...completed, failure })).toBe(false);
    });

    // Proves a queued run hasn't started and has no current work yet.
    test("a queued run has no start time and no current work", () => {
        // Before the first advancement every step is pending.
        const queued = runSnapshot(
            { status: "queued", stopping: false, currentSteps: [], waitingFor: [] },
            [{ stepId: FIRST_STEP, status: "pending" }],
        );
        expect(Value.Check(RunSnapshotSchema, queued)).toBe(true);

        // A start time or current work contradicts the queued state.
        expect(Value.Check(RunSnapshotSchema, { ...queued, startedAt: AT })).toBe(false);
        expect(Value.Check(RunSnapshotSchema, { ...queued, currentSteps: [FIRST_STEP] })).toBe(
            false,
        );
    });

    // Proves the step list can't contradict the run's status.
    test("step states must agree with the run's status", () => {
        const running: StepSnapshot = { stepId: FIRST_STEP, status: "running", startedAt: AT };
        const failed: StepSnapshot = {
            stepId: FIRST_STEP,
            status: "failed",
            completedAt: AT,
            failure,
        };
        const completed: StepSnapshot = {
            stepId: FIRST_STEP,
            status: "completed",
            completedAt: AT,
            output: {},
        };

        // A completed run can't still have running or failed steps.
        const completedRun = runSnapshot(
            {
                status: "completed",
                stopping: false,
                startedAt: AT,
                completedAt: AT,
                currentSteps: [],
                waitingFor: [],
                result: {},
            },
            [completed],
        );
        expect(Value.Check(RunSnapshotSchema, completedRun)).toBe(true);
        expect(Value.Check(RunSnapshotSchema, { ...completedRun, steps: [running] })).toBe(false);
        expect(Value.Check(RunSnapshotSchema, { ...completedRun, steps: [failed] })).toBe(false);

        // A queued run has reached nothing, and a run that isn't stopping has no failed step.
        const queued = runSnapshot(
            { status: "queued", stopping: false, currentSteps: [], waitingFor: [] },
            [completed],
        );
        expect(Value.Check(RunSnapshotSchema, queued)).toBe(false);
        const runningRun = runSnapshot(
            { status: "running", stopping: false, startedAt: AT, currentSteps: [], waitingFor: [] },
            [failed],
        );
        expect(Value.Check(RunSnapshotSchema, runningRun)).toBe(false);

        // A failed run has settled, so no step is still running.
        const failedRun = runSnapshot(
            {
                status: "failed",
                stopping: false,
                startedAt: AT,
                completedAt: AT,
                currentSteps: [],
                waitingFor: [],
                failure,
            },
            [running],
        );
        expect(Value.Check(RunSnapshotSchema, failedRun)).toBe(false);
    });
});
