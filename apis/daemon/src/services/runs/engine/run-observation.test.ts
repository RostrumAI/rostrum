/**
 * @fileoverview Tests `observeRun`, which turns engine run state into the
 * shared inspection snapshot. Clients see runs only through this snapshot,
 * so it must match `RunSnapshotSchema`, list steps in document order, and
 * refuse to describe a state the engine can't produce. The cases use the
 * sequential-calculation fixture (add, divide, result).
 *
 * observeRun:
 * - a queued run: every step is pending in document order, with no current work; the snapshot passes the schema.
 * - a running run: a completed step shows its output and times, and the running and ready steps are
 *   current work.
 * - waiting steps name their unmet dependencies: only the incomplete dependency is listed, on the step and run.
 * - a stopping run: the snapshot is stopping and lists only running work, not ready work.
 * - a completed run: the snapshot carries the run's result and passes the schema.
 * - a failed run: the failed step keeps its start time and failure, and no work is current.
 * - an impossible state throws: a completed run with a running step, and a stopping run with no
 *   running step, are rejected with a named error.
 * - observation doesn't change the run: visits and progress are unchanged after observing.
 */
import { describe, expect, test } from "bun:test";
import { OPERATION_CATALOG } from "@rostrum/workflow";
import {
    type ExecutionFailure,
    type RunPublication,
    RunSnapshotSchema,
} from "@rostrum/workflow/execution";
import calculationJson from "@rostrum/workflow/fixtures/valid/sequential-calculation.json";
import { Value } from "typebox/value";
import type { PreparedWorkflow } from "../preparation/prepared-workflow";
import { PublicationPreparer } from "../preparation/publication-preparer";
import { observeRun } from "./run-observation";
import {
    type CompletedVisit,
    claimVisit,
    completeVisit,
    createWaitingVisit,
    failVisit,
    promoteVisit,
    type ReadyVisit,
    type RunningVisit,
    type RunProgress,
    type RunState,
    type VisitState,
} from "./run-state";

/** The calculation fixture's step IDs: the addition, the division, and the result. */
const ADD_STEP = "0192b0a0-7e1d-7000-8000-000000000101";
const DIVIDE_STEP = "0192b0a0-7e1d-7000-8000-000000000102";
const RESULT_STEP = "0192b0a0-7e1d-7000-8000-000000000103";

const RUN_ID = "0192b0a0-7e1d-7000-8000-000000000400";
const AT = "2026-09-23T12:00:00.000Z";
const LATER = "2026-09-23T12:00:05.000Z";

const publication: RunPublication = {
    workflowId: calculationJson.id,
    publicationNumber: 1,
    workflowFormatVersion: "v1",
    digest: "0".repeat(64),
};

const failure: ExecutionFailure = {
    code: "division_by_zero",
    message: "The divisor is zero",
    path: "/steps/1/inputs/divisor",
    stepId: DIVIDE_STEP,
};

/** Prepares the calculation fixture once; observation only reads its step order and links. */
function prepareCalculation(): PreparedWorkflow {
    const preparation = new PublicationPreparer(OPERATION_CATALOG).prepare(
        JSON.stringify(calculationJson),
        publication,
    );
    if (!preparation.ok) {
        throw new Error("Expected the calculation fixture to prepare");
    }
    return preparation.workflow;
}

const workflow = prepareCalculation();

/** Builds run state with the given progress and visits. */
function buildRun(progress: RunProgress, visits: VisitState[] = []): RunState {
    return {
        runId: RUN_ID,
        publication,
        workflow,
        inputs: new Map(),
        acceptedAt: AT,
        visits: new Map(visits.map((visit) => [visit.key, visit])),
        progress,
    };
}

/** Builds a ready visit of a step. */
function ready(stepId: string): ReadyVisit {
    return promoteVisit(createWaitingVisit(stepId, [], AT));
}

/** Builds a visit of a step whose work started at `AT`. */
function running(stepId: string): RunningVisit {
    return claimVisit(ready(stepId), "work-1", AT);
}

/** Builds a visit of a step that ran and committed its output at `LATER`. */
function completed(stepId: string, output = { value: 1 }): CompletedVisit {
    return completeVisit(running(stepId), output, LATER);
}

describe("observeRun", () => {
    // Proves a queued run lists every step as pending, in document order, with no work.
    test("a queued run", () => {
        const snapshot = observeRun(buildRun({ status: "queued" }));
        expect(snapshot.steps).toEqual([
            { stepId: ADD_STEP, status: "pending" },
            { stepId: DIVIDE_STEP, status: "pending" },
            { stepId: RESULT_STEP, status: "pending" },
        ]);
        expect(snapshot.currentSteps).toEqual([]);
        expect(Value.Check(RunSnapshotSchema, snapshot)).toBe(true);
    });

    // Proves a running run reports its running and ready steps as current work.
    test("a running run", () => {
        const run = buildRun({ status: "running", stopping: false, startedAt: AT }, [
            completed(ADD_STEP),
            running(DIVIDE_STEP),
            ready(RESULT_STEP),
        ]);
        const snapshot = observeRun(run);

        // The completed step shows its output and times; the running and ready ones are current.
        expect(snapshot.steps[0]).toEqual({
            stepId: ADD_STEP,
            status: "completed",
            startedAt: AT,
            completedAt: LATER,
            output: { value: 1 },
        });
        expect(snapshot.currentSteps).toEqual([DIVIDE_STEP, RESULT_STEP]);
        expect(Value.Check(RunSnapshotSchema, snapshot)).toBe(true);
    });

    // Proves a waiting step names only the dependencies that haven't completed, once each.
    test("waiting steps name their unmet dependencies", () => {
        // Make the result wait on both tasks; only the addition has completed.
        const dependent: PreparedWorkflow = {
            ...workflow,
            steps: new Map(
                [...workflow.steps].map(([id, step]) => [
                    id,
                    id === RESULT_STEP ? { ...step, dependencies: [ADD_STEP, DIVIDE_STEP] } : step,
                ]),
            ),
        };
        const run = {
            ...buildRun({ status: "running", stopping: false, startedAt: AT }, [
                completed(ADD_STEP),
                createWaitingVisit(RESULT_STEP, [], AT),
            ]),
            workflow: dependent,
        };
        const snapshot = observeRun(run);
        expect(snapshot.steps[2]).toEqual({
            stepId: RESULT_STEP,
            status: "waiting",
            waitingFor: [DIVIDE_STEP],
        });
        expect(snapshot.waitingFor).toEqual([DIVIDE_STEP]);
    });

    // Proves a stopping run shows its failure and only running work, not ready work.
    test("a stopping run", () => {
        const run = buildRun({ status: "running", stopping: true, startedAt: AT, failure }, [
            running(ADD_STEP),
            ready(DIVIDE_STEP),
        ]);
        const snapshot = observeRun(run);
        expect(snapshot.stopping).toBe(true);
        expect(snapshot.currentSteps).toEqual([ADD_STEP]);
        expect(Value.Check(RunSnapshotSchema, snapshot)).toBe(true);
    });

    // Proves a completed run carries its result and no current work.
    test("a completed run", () => {
        const run = buildRun(
            { status: "completed", startedAt: AT, completedAt: LATER, result: { total: 1 } },
            [completed(ADD_STEP), completed(DIVIDE_STEP), completed(RESULT_STEP, { value: 2 })],
        );
        const snapshot = observeRun(run);
        expect(snapshot.status === "completed" && snapshot.result).toEqual({ total: 1 });
        expect(Value.Check(RunSnapshotSchema, snapshot)).toBe(true);
    });

    // Proves a failed run carries its failure and the failed step keeps its start time.
    test("a failed run", () => {
        const run = buildRun({ status: "failed", startedAt: AT, completedAt: LATER, failure }, [
            completed(ADD_STEP),
            failVisit(running(DIVIDE_STEP), failure, LATER),
        ]);
        const snapshot = observeRun(run);
        expect(snapshot.steps[1]).toEqual({
            stepId: DIVIDE_STEP,
            status: "failed",
            startedAt: AT,
            completedAt: LATER,
            failure,
        });
        expect(snapshot.currentSteps).toEqual([]);
        expect(Value.Check(RunSnapshotSchema, snapshot)).toBe(true);
    });

    // Proves inspection refuses to describe a state the engine can't produce.
    test("an impossible state throws", () => {
        // A completed run can't still have work running.
        const run = buildRun(
            { status: "completed", startedAt: AT, completedAt: LATER, result: {} },
            [running(ADD_STEP)],
        );
        expect(() => observeRun(run)).toThrow("A completed run can't have a running step");

        // A stopping run with nothing running would already have failed.
        const idle = buildRun({ status: "running", stopping: true, startedAt: AT, failure }, [
            ready(ADD_STEP),
        ]);
        expect(() => observeRun(idle)).toThrow("A stopping run can't have no running step");
    });

    // Proves observing a run doesn't change it.
    test("observation doesn't change the run", () => {
        const run = buildRun({ status: "running", stopping: false, startedAt: AT }, [
            ready(ADD_STEP),
        ]);
        const before = [...run.visits.values()];
        observeRun(run);
        expect([...run.visits.values()]).toEqual(before);
        expect(run.progress.status).toBe("running");
    });
});
