import { describe, expect, test } from "bun:test";
import type { ExecutionFailure } from "@rostrum/workflow/execution";
import {
    claimVisit,
    completeRun,
    completeVisit,
    createWaitingVisit,
    failRun,
    failVisit,
    getVisitKey,
    isTerminal,
    promoteVisit,
    type RunProgress,
    startRun,
    stopRun,
} from "./run-state";

const STEP = "0192b0a0-7e1d-7000-8000-000000000301";
const LOOP = "0192b0a0-7e1d-7000-8000-000000000302";
const CREATED = "2026-09-23T12:00:00.000Z";
const STARTED = "2026-09-23T12:00:01.000Z";
const ENDED = "2026-09-23T12:00:02.000Z";

const failure: ExecutionFailure = {
    code: "division_by_zero",
    message: "The divisor is zero",
    path: "/steps/0/inputs/divisor",
    stepId: STEP,
};

describe("visit keys", () => {
    // Proves a visit outside any loop is keyed by its step ID alone.
    test("empty metadata is the step ID", () => {
        expect(getVisitKey(STEP, [])).toBe(STEP);
    });

    // Proves each loop frame changes the key, so iterations of one step never share a visit.
    test("frames append in order", () => {
        const first = getVisitKey(STEP, [{ loopStepId: LOOP, iteration: 0 }]);
        const second = getVisitKey(STEP, [{ loopStepId: LOOP, iteration: 1 }]);
        expect(first).toBe(`${STEP}@${LOOP}:0`);
        expect(second).not.toBe(first);
    });
});

describe("visit transitions", () => {
    // Proves a visit moves waiting → ready → running → completed, keeping its identity.
    test("a task visit's successful path", () => {
        const waiting = createWaitingVisit(STEP, [], CREATED);
        const ready = promoteVisit(waiting);
        const running = claimVisit(ready, "work-1", STARTED);
        const completed = completeVisit(running, { value: 1 }, ENDED);

        // Identity carries through every state; each state adds only its own members.
        expect(waiting).toEqual({
            key: STEP,
            stepId: STEP,
            metadata: [],
            createdAt: CREATED,
            status: "waiting",
        });
        expect(ready.status).toBe("ready");
        expect(running).toMatchObject({ status: "running", workId: "work-1", startedAt: STARTED });
        expect(completed).toEqual({
            key: STEP,
            stepId: STEP,
            metadata: [],
            createdAt: CREATED,
            status: "completed",
            output: { value: 1 },
            startedAt: STARTED,
            completedAt: ENDED,
        });
    });

    // Proves a visit completed without work, such as a result step, records no start time.
    test("completing a ready visit has no start time", () => {
        const completed = completeVisit(
            promoteVisit(createWaitingVisit(STEP, [], CREATED)),
            {},
            ENDED,
        );
        expect(Object.hasOwn(completed, "startedAt")).toBe(false);
        expect(Object.hasOwn(completed, "workId")).toBe(false);
    });

    // Proves a failed visit keeps a start time only when work had started, and freezes its failure.
    test("failing before and after dispatch", () => {
        const ready = promoteVisit(createWaitingVisit(STEP, [], CREATED));
        const beforeDispatch = failVisit(ready, { ...failure }, ENDED);
        const afterDispatch = failVisit(claimVisit(ready, "work-1", STARTED), failure, ENDED);

        // Only the dispatched visit started, and neither keeps its work ID.
        expect(Object.hasOwn(beforeDispatch, "startedAt")).toBe(false);
        expect(afterDispatch.startedAt).toBe(STARTED);
        expect(Object.hasOwn(afterDispatch, "workId")).toBe(false);
        expect(Object.isFrozen(beforeDispatch.failure)).toBe(true);
    });

    // Proves transitions return new states and leave the one they came from unchanged.
    test("transitions don't mutate their input", () => {
        const waiting = createWaitingVisit(STEP, [], CREATED);
        promoteVisit(waiting);
        expect(waiting.status).toBe("waiting");
    });
});

describe("run progress", () => {
    // Proves only completed and failed runs are terminal.
    test("terminal states", () => {
        const running = startRun(STARTED);
        expect(isTerminal({ status: "queued" })).toBe(false);
        expect(isTerminal(running)).toBe(false);
        expect(isTerminal(stopRun(assertRunning(running), failure))).toBe(false);
        expect(
            isTerminal(failRun(assertStopping(stopRun(assertRunning(running), failure)), ENDED)),
        ).toBe(true);
        expect(isTerminal(completeRun(assertHealthy(running), {}, ENDED))).toBe(true);
    });

    // Proves the first recorded failure wins over any later one.
    test("stopping keeps the first failure", () => {
        const stopping = stopRun(assertRunning(startRun(STARTED)), failure);
        const later: ExecutionFailure = { code: "task_timeout", message: "late", path: "" };
        expect(stopRun(assertRunning(stopping), later)).toBe(stopping);
    });

    // Proves a failed run ends with the failure recorded while it was stopping.
    test("failing carries the stopping failure and times", () => {
        const stopping = assertStopping(stopRun(assertRunning(startRun(STARTED)), failure));
        expect(failRun(stopping, ENDED)).toEqual({
            status: "failed",
            startedAt: STARTED,
            completedAt: ENDED,
            failure,
        });
    });

    // Proves a completed run holds exactly the result it was given.
    test("completing records the result", () => {
        const result = { total: 100 };
        expect(completeRun(assertHealthy(startRun(STARTED)), result, ENDED)).toEqual({
            status: "completed",
            startedAt: STARTED,
            completedAt: ENDED,
            result,
        });
    });
});

/** Narrows progress to a running run, failing the test otherwise. */
function assertRunning(progress: RunProgress): RunProgress & { status: "running" } {
    if (progress.status !== "running") {
        throw new Error(`Expected a running run, got ${progress.status}`);
    }
    return progress;
}

/** Narrows progress to a running run with no failure recorded. */
function assertHealthy(
    progress: RunProgress,
): RunProgress & { status: "running"; stopping: false } {
    const running = assertRunning(progress);
    if (running.stopping) {
        throw new Error("Expected a run with no failure recorded");
    }
    return running;
}

/** Narrows progress to a running run with a failure recorded. */
function assertStopping(
    progress: RunProgress,
): RunProgress & { status: "running"; stopping: true } {
    const running = assertRunning(progress);
    if (!running.stopping) {
        throw new Error("Expected a stopping run");
    }
    return running;
}
