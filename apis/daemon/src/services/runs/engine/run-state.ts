/** @fileoverview Run state, visit states, and the pure transitions the engine applies to them. */

import type { ExecutionFailure, RunPublication } from "@rostrum/workflow/execution";
import { deepFreeze } from "../owned-values";
import type { PreparedWorkflow } from "../preparation/prepared-workflow";
import type { RunInputs } from "../preparation/publication-preparer";

/**
 * One loop iteration a visit sits inside. Frames hold identity only:
 * attempts and work IDs never go in them.
 */
export interface VisitFrame {
    /** The loop step whose iteration this is. */
    readonly loopStepId: string;
    /** The zero-based iteration number. */
    readonly iteration: number;
}

/**
 * Which loop iterations a visit sits inside, outermost first. It is part
 * of the visit's identity; every visit in this Epic has empty metadata.
 */
export type VisitMetadata = readonly VisitFrame[];

/** What every visit state records, whatever its status. */
interface VisitBase {
    /** The visit's run-local identity: its step ID plus its encoded metadata. */
    readonly key: string;
    /** The step this visit runs. */
    readonly stepId: string;
    /** The loop iterations the visit sits inside. */
    readonly metadata: VisitMetadata;
    /** When the visit was created. */
    readonly createdAt: string;
}

/** A visit with at least one dependency that hasn't completed. */
export interface WaitingVisit extends VisitBase {
    /** The visit is waiting on dependencies. */
    readonly status: "waiting";
}

/** A visit whose dependencies have all completed; it may be claimed. */
export interface ReadyVisit extends VisitBase {
    /** The visit may be dispatched. */
    readonly status: "ready";
}

/** A visit the engine has claimed for one piece of work. */
export interface RunningVisit extends VisitBase {
    /** The visit's work is executing. */
    readonly status: "running";
    /** The work that owns the visit; completions must carry it. */
    readonly workId: string;
    /** When the engine claimed the visit. */
    readonly startedAt: string;
}

/** A visit whose validated output is committed. */
export interface CompletedVisit extends VisitBase {
    /** The visit succeeded. */
    readonly status: "completed";
    /** The committed, deep-frozen output. Later steps bind to it. */
    readonly output: Readonly<Record<string, unknown>>;
    /** When work started; absent for a result step, which never runs work. */
    readonly startedAt?: string;
    /** When the output was committed. */
    readonly completedAt: string;
}

/** A visit that can't succeed. */
export interface FailedVisit extends VisitBase {
    /** The visit failed. */
    readonly status: "failed";
    /** Why, located. */
    readonly failure: ExecutionFailure;
    /** When work started; absent when the visit failed before dispatch. */
    readonly startedAt?: string;
    /** When the failure was committed. */
    readonly completedAt: string;
}

/** A visit's one current state. The engine replaces it on each transition; no history is kept. */
export type VisitState = WaitingVisit | ReadyVisit | RunningVisit | CompletedVisit | FailedVisit;

/**
 * A run's progress. Failure takes priority: once a failure is recorded,
 * the run is stopping while work is outstanding and failed once it
 * settles, and a later completion can't change that.
 */
export type RunProgress =
    | {
          /** Admitted; the first advancement hasn't happened. */
          readonly status: "queued";
      }
    | {
          /** Advancing, with no failure recorded. */
          readonly status: "running";
          /** No failure is recorded. */
          readonly stopping: false;
          /** When the first advancement happened. */
          readonly startedAt: string;
      }
    | {
          /** Failed while work was outstanding; no new work starts. */
          readonly status: "running";
          /** A failure is recorded and dispatch has stopped. */
          readonly stopping: true;
          /** When the first advancement happened. */
          readonly startedAt: string;
          /** The failure the run will end with. */
          readonly failure: ExecutionFailure;
      }
    | {
          /** Committed its result with nothing failed. */
          readonly status: "completed";
          /** When the first advancement happened. */
          readonly startedAt: string;
          /** When the result was committed. */
          readonly completedAt: string;
          /** The final result: the result step's resolved inputs, exactly. */
          readonly result: Readonly<Record<string, unknown>>;
      }
    | {
          /** Failed, with all outstanding work settled. */
          readonly status: "failed";
          /** When the first advancement happened. */
          readonly startedAt: string;
          /** When the failure was committed. */
          readonly completedAt: string;
          /** Why the run failed. */
          readonly failure: ExecutionFailure;
      };

/**
 * One accepted run: its fixed publication, prepared workflow, and inputs,
 * plus the visit map and progress that only the engine changes.
 */
export interface RunState {
    /** The run's ID. */
    readonly runId: string;
    /** The exact publication the run executes. */
    readonly publication: RunPublication;
    /** The prepared publication. */
    readonly workflow: PreparedWorkflow;
    /** The accepted inputs. */
    readonly inputs: RunInputs;
    /** When the run was admitted. */
    readonly acceptedAt: string;
    /** Every reached visit by key. A step with no visit is pending. */
    readonly visits: Map<string, VisitState>;
    /** The run's progress; the engine replaces it through the transitions below. */
    progress: RunProgress;
}

/**
 * Encodes a visit's identity. With no frames the key is the step ID
 * itself; frames append `@loopStepId:iteration` segments, which can't
 * collide with a UUID.
 */
export function getVisitKey(stepId: string, metadata: VisitMetadata): string {
    return metadata.reduce((key, frame) => `${key}@${frame.loopStepId}:${frame.iteration}`, stepId);
}

/** True for the terminal run states, whose outcome never changes. */
export function isTerminal(progress: RunProgress): boolean {
    return progress.status === "completed" || progress.status === "failed";
}

/** Creates a visit in the waiting state. */
export function createWaitingVisit(
    stepId: string,
    metadata: VisitMetadata,
    at: string,
): WaitingVisit {
    return {
        key: getVisitKey(stepId, metadata),
        stepId,
        metadata,
        createdAt: at,
        status: "waiting",
    };
}

/** Promotes a waiting visit whose dependencies have all completed. */
export function promoteVisit(visit: WaitingVisit): ReadyVisit {
    return { ...identityOf(visit), status: "ready" };
}

/** Claims a ready visit for one piece of work. */
export function claimVisit(visit: ReadyVisit, workId: string, at: string): RunningVisit {
    return { ...identityOf(visit), status: "running", workId, startedAt: at };
}

/** Commits a visit's validated output. */
export function completeVisit(
    visit: ReadyVisit | RunningVisit,
    output: Readonly<Record<string, unknown>>,
    at: string,
): CompletedVisit {
    const completed: CompletedVisit = {
        ...identityOf(visit),
        status: "completed",
        output,
        completedAt: at,
    };
    return visit.status === "running" ? { ...completed, startedAt: visit.startedAt } : completed;
}

/** Commits a visit's failure; it keeps its start time only if work actually started. */
export function failVisit(
    visit: ReadyVisit | RunningVisit,
    failure: ExecutionFailure,
    at: string,
): FailedVisit {
    const failed: FailedVisit = {
        ...identityOf(visit),
        status: "failed",
        failure: deepFreeze(failure),
        completedAt: at,
    };
    return visit.status === "running" ? { ...failed, startedAt: visit.startedAt } : failed;
}

/** Starts a queued run on its first advancement. */
export function startRun(at: string): RunProgress {
    return { status: "running", stopping: false, startedAt: at };
}

/**
 * Records a failure on a running run. The first failure wins: a run that
 * is already stopping keeps its recorded failure.
 */
export function stopRun(
    progress: RunProgress & { status: "running" },
    failure: ExecutionFailure,
): RunProgress {
    if (progress.stopping) {
        return progress;
    }
    return { status: "running", stopping: true, startedAt: progress.startedAt, failure };
}

/** Ends a stopping run once its outstanding work has settled. */
export function failRun(
    progress: RunProgress & { status: "running"; stopping: true },
    at: string,
): RunProgress {
    return {
        status: "failed",
        startedAt: progress.startedAt,
        completedAt: at,
        failure: progress.failure,
    };
}

/** Commits a running run's final result. */
export function completeRun(
    progress: RunProgress & { status: "running"; stopping: false },
    result: Readonly<Record<string, unknown>>,
    at: string,
): RunProgress {
    return { status: "completed", startedAt: progress.startedAt, completedAt: at, result };
}

/** Copies a visit's identity members, which every state keeps unchanged. */
function identityOf(visit: VisitState): VisitBase {
    return {
        key: visit.key,
        stepId: visit.stepId,
        metadata: visit.metadata,
        createdAt: visit.createdAt,
    };
}
