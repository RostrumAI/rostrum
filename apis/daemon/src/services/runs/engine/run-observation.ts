/** @fileoverview Builds inspection snapshots from run state without advancing it. */

import type { RunSnapshot, StepSnapshot } from "@rostrum/workflow/execution";
import { getVisitKey, type RunState, type VisitState } from "./run-state";

/**
 * Describes a run as the shared inspection schema defines it: every step
 * in document order, with `pending` for steps that have no visit; the
 * current work; the dependencies waiting visits still need; and the
 * run's outcome. It reads the state and never changes it.
 */
export function observeRun(run: RunState): RunSnapshot {
    // Visits in this Epic carry empty metadata, so each step has at most one.
    const visits = run.workflow.stepOrder.map((stepId) => ({
        stepId,
        visit: run.visits.get(getVisitKey(stepId, [])),
    }));
    const isCompleted = (stepId: string) =>
        run.visits.get(getVisitKey(stepId, []))?.status === "completed";
    const unmetDependencies = (stepId: string) =>
        (run.workflow.steps.get(stepId)?.dependencies ?? []).filter(
            (dependency) => !isCompleted(dependency),
        );

    // Every step in document order.
    const steps = visits.map(({ stepId, visit }) => observeStep(stepId, visit, unmetDependencies));

    // Current work: ready and running visits, or only running work while stopping.
    const progress = run.progress;
    const stopping = progress.status === "running" && progress.stopping;
    const currentSteps = visits
        .filter(
            ({ visit }) => visit?.status === "running" || (!stopping && visit?.status === "ready"),
        )
        .map(({ stepId }) => stepId);

    // What waiting visits still need, each dependency listed once.
    const waitingFor = [
        ...new Set(
            visits
                .filter(({ visit }) => visit?.status === "waiting")
                .flatMap(({ stepId }) => unmetDependencies(stepId)),
        ),
    ];

    const identity = { runId: run.runId, publication: run.publication, acceptedAt: run.acceptedAt };
    switch (progress.status) {
        case "queued":
            return {
                ...identity,
                status: "queued",
                stopping: false,
                steps: onlyStates(steps, ["pending"], progress.status),
                currentSteps: [],
                waitingFor: [],
            };
        case "running":
            return progress.stopping
                ? {
                      ...identity,
                      status: "running",
                      stopping: true,
                      startedAt: progress.startedAt,
                      steps,
                      currentSteps,
                      waitingFor,
                      failure: progress.failure,
                  }
                : {
                      ...identity,
                      status: "running",
                      stopping: false,
                      startedAt: progress.startedAt,
                      steps: onlyStates(
                          steps,
                          ["pending", "waiting", "ready", "running", "completed"],
                          progress.status,
                      ),
                      currentSteps,
                      waitingFor,
                  };
        case "completed":
            return {
                ...identity,
                status: "completed",
                stopping: false,
                startedAt: progress.startedAt,
                completedAt: progress.completedAt,
                steps: onlyStates(steps, ["pending", "completed"], progress.status),
                currentSteps: [],
                waitingFor: [],
                result: progress.result,
            };
        case "failed":
            return {
                ...identity,
                status: "failed",
                stopping: false,
                startedAt: progress.startedAt,
                completedAt: progress.completedAt,
                steps: onlyStates(
                    steps,
                    ["pending", "waiting", "ready", "completed", "failed"],
                    progress.status,
                ),
                currentSteps: [],
                waitingFor: [],
                failure: progress.failure,
            };
    }
}

/**
 * Narrows a run's step list to the states its status allows. The engine's
 * transitions guarantee this, so a step in any other state means run
 * state was corrupted, and inspection refuses to describe it.
 */
function onlyStates<Status extends StepSnapshot["status"]>(
    steps: readonly StepSnapshot[],
    allowed: readonly Status[],
    runStatus: string,
): Extract<StepSnapshot, { status: Status }>[] {
    const isAllowed = (step: StepSnapshot): step is Extract<StepSnapshot, { status: Status }> =>
        allowed.some((status) => status === step.status);
    return steps.map((step) => {
        if (!isAllowed(step)) {
            throw new Error(`A ${runStatus} run can't have a ${step.status} step`);
        }
        return step;
    });
}

/** Describes one step from its visit, or as pending when it has none. */
function observeStep(
    stepId: string,
    visit: VisitState | undefined,
    unmetDependencies: (stepId: string) => string[],
): StepSnapshot {
    if (!visit) {
        return { stepId, status: "pending" };
    }
    switch (visit.status) {
        case "waiting":
            return { stepId, status: "waiting", waitingFor: unmetDependencies(stepId) };
        case "ready":
            return { stepId, status: "ready" };
        case "running":
            return { stepId, status: "running", startedAt: visit.startedAt };
        case "completed": {
            const completed: StepSnapshot = {
                stepId,
                status: "completed",
                completedAt: visit.completedAt,
                output: visit.output,
            };
            if (visit.startedAt !== undefined) {
                completed.startedAt = visit.startedAt;
            }
            return completed;
        }
        case "failed": {
            const failed: StepSnapshot = {
                stepId,
                status: "failed",
                completedAt: visit.completedAt,
                failure: visit.failure,
            };
            if (visit.startedAt !== undefined) {
                failed.startedAt = visit.startedAt;
            }
            return failed;
        }
    }
}
