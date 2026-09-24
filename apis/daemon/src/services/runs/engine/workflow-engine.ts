/** @fileoverview The workflow engine: the one owner of run state. */

import { escapePointerToken } from "@rostrum/workflow";
import type { ExecutionFailure, RunSnapshot } from "@rostrum/workflow/execution";
import { v7 as mintId } from "uuid";
import { deepFreeze } from "../owned-values";
import type { PreparedTaskStep, PreparedWorkflow } from "../preparation/prepared-workflow";
import type { RunInputs } from "../preparation/publication-preparer";
import type { TaskExecutor, TaskWorkResult } from "../tasks/task-executor";
import type { BindingContext } from "./bindings";
import type { ExecutionNode, SuccessorVisit } from "./nodes/execution-node";
import { ResultExecutionNode } from "./nodes/result-execution-node";
import { TaskExecutionNode } from "./nodes/task-execution-node";
import { observeRun } from "./run-observation";
import {
    claimVisit,
    completeRun,
    completeVisit,
    failRun,
    failVisit,
    getVisitKey,
    isTerminal,
    promoteVisit,
    type ReadyVisit,
    type RunningVisit,
    type RunState,
    startRun,
    stopRun,
    type VisitState,
} from "./run-state";

/** Supplies the current time, so tests can control timestamps. */
export interface EngineClock {
    /** Returns the current instant. */
    now(): Date;
}

/** Defers work to later event-loop turns and starts deadlines, so tests can control both. */
export interface EngineScheduler {
    /** Runs the callback in a later event-loop turn, never inline. */
    schedule(callback: () => void): void;
    /** Runs the callback after the delay and returns a function that cancels it. */
    startTimer(callback: () => void, delayMs: number): () => void;
}

/**
 * The process's hold on one accepted run. The engine releases it once
 * the run is terminal and its work has settled; aborting it asks the
 * run's executing work to stop.
 */
export interface RunRegistration {
    /** Aborted when the process wants the run's work to stop, such as at a forced shutdown. */
    readonly signal: AbortSignal;
    /** Marks the run's work finished. The engine calls it once. */
    release(): void;
}

/** What the engine is built from at startup. */
export interface WorkflowEngineOptions {
    /** Runs task work. */
    readonly executor: TaskExecutor;
    /** How long claimed task work may run before it is failed as `task_timeout`. */
    readonly runTaskTimeoutMs: number;
    /** The time source; defaults to the system clock. */
    readonly clock?: EngineClock;
    /** The turn and timer source; defaults to `setImmediate` and `setTimeout`. */
    readonly scheduler?: EngineScheduler;
    /** Creates run and work IDs; defaults to the server's identifier generator. */
    readonly createId?: () => string;
}

/** One task the engine handed to the executor and hasn't seen settle. */
interface Dispatch {
    /** The work's identity; its result must carry it. */
    readonly workId: string;
    /** The visit the work owns. */
    readonly visitKey: string;
    /** The prepared task step the work runs. */
    readonly step: PreparedTaskStep;
    /** Aborts the task's signal. */
    readonly controller: AbortController;
    /** Cancels the task's deadline. */
    cancelTimer: () => void;
    /** Stops forwarding the run's abort signal to this task. */
    removeAbortListener: () => void;
    /** The recorded timeout, once the deadline passed before the task settled. */
    timeoutFailure?: ExecutionFailure;
    /** True once the executor's promise has settled; later deliveries are ignored. */
    settled: boolean;
}

/** One run with the runtime machinery that never appears in its state or snapshots. */
interface RunEntry {
    /** The run's state. */
    readonly state: RunState;
    /** The process registration released when the run is done. */
    readonly registration: RunRegistration;
    /** One node per prepared step. */
    readonly nodes: ReadonlyMap<string, ExecutionNode>;
    /** Successor visits completions asked for, created at the next advancement. */
    readonly pendingSuccessors: SuccessorVisit[];
    /** The run's outstanding task, when one is executing. */
    dispatch?: Dispatch;
    /** True while an advancement turn is scheduled; merges repeated requests. */
    advanceScheduled: boolean;
    /** True while a dispatch turn is scheduled; merges repeated requests. */
    dispatchScheduled: boolean;
    /** True once the registration was released. */
    released: boolean;
}

/** The default scheduler: later turns through `setImmediate`, deadlines through `setTimeout`. */
const SYSTEM_SCHEDULER: EngineScheduler = {
    schedule: (callback) => {
        setImmediate(callback);
    },
    startTimer: (callback, delayMs) => {
        const timer = setTimeout(callback, delayMs);
        return () => clearTimeout(timer);
    },
};

/** The longest delay a runtime timer honors; longer delays fire almost at once. */
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;

/** The default clock. */
const SYSTEM_CLOCK: EngineClock = { now: () => new Date() };

/**
 * Owns accepted runs and is the only thing that changes their state.
 *
 * Advancement decides which visits exist and which may run; a separate
 * dispatch turn claims one ready visit and hands its work to the
 * executor; completions come back through the engine, which validates and
 * commits them. Advancement and dispatch run in scheduled turns with
 * per-run flags that merge repeated requests, state changes never await,
 * and each run has at most one task executing, so no lock is needed.
 */
export class WorkflowEngine {
    private readonly executor: TaskExecutor;
    private readonly runTaskTimeoutMs: number;
    private readonly clock: EngineClock;
    private readonly scheduler: EngineScheduler;
    private readonly createId: () => string;
    private readonly runs = new Map<string, RunEntry>();
    private readonly queue = new DispatchQueue();

    /** Builds the engine from its startup dependencies. */
    constructor(options: WorkflowEngineOptions) {
        // Timers treat anything outside this range as roughly 1 ms, which would time out every task.
        if (
            !Number.isInteger(options.runTaskTimeoutMs) ||
            options.runTaskTimeoutMs < 1 ||
            options.runTaskTimeoutMs > MAX_TIMER_DELAY_MS
        ) {
            throw new RangeError(
                `The task timeout must be an integer from 1 to ${MAX_TIMER_DELAY_MS} ms`,
            );
        }
        this.executor = options.executor;
        this.runTaskTimeoutMs = options.runTaskTimeoutMs;
        this.clock = options.clock ?? SYSTEM_CLOCK;
        this.scheduler = options.scheduler ?? SYSTEM_SCHEDULER;
        this.createId = options.createId ?? (() => mintId());
    }

    /**
     * Admits a prepared run with its validated inputs: creates its state,
     * queued, and schedules its first advancement. Returns the run's ID.
     * From here the run belongs to the engine; the registration is
     * released once it is terminal and its work has settled.
     */
    admit(workflow: PreparedWorkflow, inputs: RunInputs, registration: RunRegistration): string {
        // One node per prepared step describes how each step behaves.
        const runId = this.createId();
        const nodes = new Map<string, ExecutionNode>();
        for (const step of workflow.steps.values()) {
            nodes.set(
                step.id,
                step.kind === "task" ? new TaskExecutionNode(step) : new ResultExecutionNode(step),
            );
        }

        // The run starts queued, with the entry step as its first visit to reach.
        const entry: RunEntry = {
            state: {
                runId,
                publication: workflow.publication,
                workflow,
                inputs,
                acceptedAt: this.timestamp(),
                visits: new Map(),
                progress: { status: "queued" },
            },
            registration,
            nodes,
            pendingSuccessors: [{ stepId: workflow.entryStepId, metadata: [] }],
            advanceScheduled: false,
            dispatchScheduled: false,
            released: false,
        };
        this.runs.set(runId, entry);
        this.requestAdvance(entry);
        return runId;
    }

    /** Returns a consistent snapshot of a run, or undefined for an unknown run. Never advances it. */
    inspectRun(runId: string): RunSnapshot | undefined {
        const entry = this.runs.get(runId);
        return entry ? observeRun(entry.state) : undefined;
    }

    /**
     * One synchronous advancement pass. It never awaits and never runs a
     * handler inline; repeating it changes nothing that already happened.
     */
    advanceWorkflow(runId: string): void {
        const entry = this.runs.get(runId);
        if (!entry || isTerminal(entry.state.progress)) {
            return;
        }
        const run = entry.state;

        // A stopping run starts nothing new and fails once its work has settled.
        if (run.progress.status === "running" && run.progress.stopping) {
            this.failIfIdle(entry);
            return;
        }

        // Reach the entry visit on the first pass and the successors completions asked for.
        if (run.progress.status === "queued") {
            run.progress = startRun(this.timestamp());
        }
        for (const successor of entry.pendingSuccessors.splice(0)) {
            this.reachVisit(entry, successor);
        }

        // Promote waiting visits whose dependencies have all completed.
        for (const visit of run.visits.values()) {
            if (
                visit.status === "waiting" &&
                this.getUnmetDependencies(entry, visit).length === 0
            ) {
                run.visits.set(visit.key, promoteVisit(visit));
            }
        }

        // Tell the queue about ready visits; it merges duplicates.
        let hasReadyWork = false;
        for (const visit of run.visits.values()) {
            if (visit.status === "ready") {
                this.queue.offer(runId, visit.key);
                hasReadyWork = true;
            }
        }
        if (hasReadyWork) {
            this.requestDispatch(entry);
            return;
        }

        // Nothing ready and nothing executing: the run can't make progress.
        if (!entry.dispatch) {
            this.recordFailure(entry, this.getDeadRunFailure(entry));
        }
    }

    /** Schedules an advancement turn unless one is already scheduled. */
    private requestAdvance(entry: RunEntry): void {
        if (entry.advanceScheduled) {
            return;
        }
        entry.advanceScheduled = true;
        this.scheduler.schedule(() => {
            entry.advanceScheduled = false;
            this.guarded(entry, () => this.advanceWorkflow(entry.state.runId));
        });
    }

    /** Schedules a dispatch turn unless one is already scheduled. */
    private requestDispatch(entry: RunEntry): void {
        if (entry.dispatchScheduled) {
            return;
        }
        entry.dispatchScheduled = true;
        this.scheduler.schedule(() => {
            entry.dispatchScheduled = false;
            this.guarded(entry, () => this.dispatchNext(entry));
        });
    }

    /**
     * The queue consumer's turn for one run: claims at most one ready
     * visit. Queue entries are only candidates; the visit is re-read and
     * the run re-checked, so a stale or duplicate entry does nothing.
     */
    private dispatchNext(entry: RunEntry): void {
        const run = entry.state;
        const progress = run.progress;
        if (progress.status !== "running" || progress.stopping) {
            this.queue.clear(run.runId);
            return;
        }
        // One task at a time per run; its completion schedules the next turn.
        if (entry.dispatch) {
            return;
        }
        for (
            let key = this.queue.next(run.runId);
            key !== undefined;
            key = this.queue.next(run.runId)
        ) {
            const visit = run.visits.get(key);
            if (visit?.status === "ready") {
                this.claim(entry, visit);
                break;
            }
        }
        if (this.queue.has(run.runId)) {
            this.requestDispatch(entry);
        }
    }

    /** Prepares a ready visit and applies the node's decision: fail it, commit it locally, or start its task. */
    private claim(entry: RunEntry, visit: ReadyVisit): void {
        const node = this.nodeFor(entry, visit.stepId);
        const preparation = node.prepareExecution(visit, this.createBindingContext(entry, visit));
        switch (preparation.kind) {
            case "failure":
                entry.state.visits.set(
                    visit.key,
                    failVisit(visit, preparation.failure, this.timestamp()),
                );
                this.recordFailure(entry, preparation.failure);
                return;
            case "local":
                this.commitOutput(entry, visit, preparation.output);
                return;
            case "task":
                this.startTask(entry, visit, preparation.step, preparation.inputs);
                return;
        }
    }

    /**
     * Records the claim — the work ID and the running state — before the
     * executor is called, then starts the deadline and hands the work
     * over. The executor's promise is always observed, so a rejecting
     * executor can't leave the run stuck.
     */
    private startTask(
        entry: RunEntry,
        visit: ReadyVisit,
        step: PreparedTaskStep,
        inputs: Readonly<Record<string, unknown>>,
    ): void {
        // Claim the visit for new work before anything can run.
        const run = entry.state;
        const workId = this.createId();
        run.visits.set(visit.key, claimVisit(visit, workId, this.timestamp()));

        // The run's abort signal and the deadline both reach the task through its own controller.
        const controller = new AbortController();
        const forwardAbort = () => controller.abort();
        const dispatch: Dispatch = {
            workId,
            visitKey: visit.key,
            step,
            controller,
            cancelTimer: () => {},
            removeAbortListener: () =>
                entry.registration.signal.removeEventListener("abort", forwardAbort),
            settled: false,
        };
        entry.dispatch = dispatch;
        if (entry.registration.signal.aborted) {
            controller.abort();
        } else {
            entry.registration.signal.addEventListener("abort", forwardAbort, { once: true });
        }
        dispatch.cancelTimer = this.scheduler.startTimer(
            () => this.guarded(entry, () => this.expireTask(entry, dispatch)),
            this.runTaskTimeoutMs,
        );

        // Hand the work over; a synchronous throw is treated like a rejection.
        let pending: Promise<TaskWorkResult>;
        try {
            pending = this.executor.execute(
                {
                    runId: run.runId,
                    workId,
                    stepId: step.id,
                    workflowFormatVersion: run.publication.workflowFormatVersion,
                    config: step.config,
                    inputs,
                },
                controller.signal,
            );
        } catch (error) {
            pending = Promise.reject(error);
        }
        // Deliberately not awaited: settlement comes back through `settleTask`, which handles both outcomes.
        void pending.then(
            (result) => this.guarded(entry, () => this.settleTask(entry, dispatch, result)),
            () => this.guarded(entry, () => this.settleTask(entry, dispatch, undefined)),
        );
    }

    /**
     * Records a timeout for work that is still executing. Dispatch stops
     * and the task is asked to abort, but the visit stays running until
     * the executor's promise actually settles.
     */
    private expireTask(entry: RunEntry, dispatch: Dispatch): void {
        if (dispatch.settled || dispatch.timeoutFailure) {
            return;
        }
        const failure: ExecutionFailure = {
            code: "task_timeout",
            message: `The task didn't finish within ${this.runTaskTimeoutMs} ms`,
            path: dispatch.step.path,
            stepId: dispatch.step.id,
        };
        dispatch.timeoutFailure = failure;
        this.recordFailure(entry, failure);
        dispatch.controller.abort();
    }

    /**
     * Applies the settlement of one dispatch exactly once. A timed-out
     * task ends with its timeout and its late output is discarded; a
     * rejection or a result for different work is an `execution_error`;
     * a task failure is committed with its step; an output is validated
     * and committed.
     */
    private settleTask(
        entry: RunEntry,
        dispatch: Dispatch,
        result: TaskWorkResult | undefined,
    ): void {
        // Settle each dispatch once, releasing its deadline and abort forwarding.
        if (dispatch.settled) {
            return;
        }
        dispatch.settled = true;
        dispatch.cancelTimer();
        dispatch.removeAbortListener();
        if (entry.dispatch === dispatch) {
            entry.dispatch = undefined;
        }

        // Only the visit this work claimed can be settled by it.
        const run = entry.state;
        const visit = run.visits.get(dispatch.visitKey);
        if (visit?.status !== "running" || visit.workId !== dispatch.workId) {
            this.requestAdvance(entry);
            return;
        }

        const failure = dispatch.timeoutFailure ?? this.getTaskFailure(dispatch, run.runId, result);
        if (failure) {
            run.visits.set(visit.key, failVisit(visit, failure, this.timestamp()));
            this.recordFailure(entry, failure);
        } else if (result?.ok) {
            this.commitTaskOutput(entry, dispatch, visit, result.output);
        }
        this.requestAdvance(entry);
    }

    /** Returns why a settled task failed, or undefined when it returned output. */
    private getTaskFailure(
        dispatch: Dispatch,
        runId: string,
        result: TaskWorkResult | undefined,
    ): ExecutionFailure | undefined {
        const step = dispatch.step;
        if (!result) {
            return {
                code: "execution_error",
                message: "The task executor failed",
                path: step.path,
                stepId: step.id,
            };
        }
        if (result.runId !== runId || result.workId !== dispatch.workId) {
            return {
                code: "execution_error",
                message: "The task's result doesn't identify the dispatched work",
                path: step.path,
                stepId: step.id,
            };
        }
        if (result.ok) {
            return undefined;
        }

        // Only codes the operation declares, and pointers relative to the step, are trusted.
        const { code, message, path } = result.failure;
        const declared = code === "task_error" || step.operation.failureCodes.includes(code);
        if (!declared || (path !== "" && !path.startsWith("/"))) {
            return {
                code: "execution_error",
                message: "The task reported a failure its operation doesn't declare",
                path: step.path,
                stepId: step.id,
            };
        }
        return { code, message, path: `${step.path}${path}`, stepId: step.id };
    }

    /**
     * Validates a task's output against the operation's output schema and
     * the step's declared outputs, on an owned copy, and commits it only if
     * every check passes. Invalid output fails the visit and never reaches
     * a successor.
     */
    private commitTaskOutput(
        entry: RunEntry,
        dispatch: Dispatch,
        visit: RunningVisit,
        output: unknown,
    ): void {
        const step = dispatch.step;
        const invalid = (message: string, path: string): ExecutionFailure => ({
            code: "invalid_output",
            message,
            path,
            stepId: step.id,
        });

        // Copy first, so later changes to the returned object can't reach what was checked.
        let owned: unknown;
        try {
            owned = structuredClone(output);
        } catch {
            owned = undefined;
        }
        const outputPath = `${step.path}/outputs`;
        const failures = step.outputCheck(owned, {
            path: outputPath,
            code: "invalid_output",
            stepId: step.id,
        });
        if (failures.length === 0 && isRecord(owned)) {
            for (const [name, check] of step.declaredOutputs) {
                const value = Object.getOwnPropertyDescriptor(owned, name)?.value;
                failures.push(
                    ...check(value, {
                        path: `${outputPath}/${escapePointerToken(name)}`,
                        code: "invalid_output",
                        stepId: step.id,
                    }),
                );
            }
        }
        const [first] = failures;
        if (first || !isRecord(owned)) {
            const failure = first ?? invalid("The task's output isn't an object", outputPath);
            entry.state.visits.set(visit.key, failVisit(visit, failure, this.timestamp()));
            this.recordFailure(entry, failure);
            return;
        }
        this.commitOutput(entry, visit, deepFreeze(owned));
    }

    /**
     * Commits a visit's output and applies the node's decision in the same
     * synchronous step: a result step's completed visit and the run's
     * final result are committed together, and successors are queued for
     * the next advancement. A stopping run keeps the output inspectable but
     * starts nothing and keeps its recorded failure.
     */
    private commitOutput(
        entry: RunEntry,
        visit: ReadyVisit | RunningVisit,
        output: Readonly<Record<string, unknown>>,
    ): void {
        const run = entry.state;
        const at = this.timestamp();
        // Commit the frozen output and ask the node what it means for the run.
        const committed = deepFreeze(output);
        const decision = this.nodeFor(entry, visit.stepId).completeExecution(visit, committed);
        run.visits.set(visit.key, completeVisit(visit, committed, at));

        // A stopping run keeps the output visible, starts nothing, and fails once idle.
        const progress = run.progress;
        if (progress.status !== "running" || progress.stopping) {
            this.failIfIdle(entry);
            return;
        }
        // Finish with the result, or queue the successors for the next advancement.
        if (decision.kind === "finish") {
            // A result can only end a run that has nothing else reached and unfinished.
            if (this.hasUnfinishedVisits(entry)) {
                this.recordFailure(entry, {
                    code: "execution_error",
                    message: "The result was reached while other steps were unfinished",
                    path: this.nodeStepPath(entry, visit.stepId),
                    stepId: visit.stepId,
                });
                return;
            }
            run.progress = completeRun(progress, decision.result, at);
            this.finish(entry);
            return;
        }
        entry.pendingSuccessors.push(...decision.successors);
        this.requestAdvance(entry);
    }

    /**
     * Records a failure: dispatch stops at once, the first failure is
     * kept, and the run fails as soon as no work is outstanding.
     */
    private recordFailure(entry: RunEntry, failure: ExecutionFailure): void {
        const progress = entry.state.progress;
        if (progress.status !== "running") {
            return;
        }
        entry.state.progress = stopRun(progress, deepFreeze(failure));
        this.queue.clear(entry.state.runId);
        this.failIfIdle(entry);
    }

    /** Ends a stopping run once no work is outstanding. */
    private failIfIdle(entry: RunEntry): void {
        const progress = entry.state.progress;
        if (entry.dispatch || progress.status !== "running" || !progress.stopping) {
            return;
        }
        entry.state.progress = failRun(progress, this.timestamp());
        this.finish(entry);
    }

    /**
     * Explains a run with nothing ready and nothing executing: waiting
     * visits whose dependencies can't complete, located at the first
     * unmet dependency, or no result at all.
     */
    private getDeadRunFailure(entry: RunEntry): ExecutionFailure {
        const run = entry.state;
        for (const stepId of run.workflow.stepOrder) {
            const visit = run.visits.get(getVisitKey(stepId, []));
            const step = run.workflow.steps.get(stepId);
            if (visit?.status !== "waiting" || !step) {
                continue;
            }
            const [unmet] = this.getUnmetDependencies(entry, visit);
            const index = unmet === undefined ? -1 : step.dependencies.indexOf(unmet);
            return {
                code: "unmet_dependencies",
                message: `The step waits for '${unmet}', which can't complete`,
                path: index === -1 ? step.path : `${step.path}/dependencies/${index}`,
                stepId,
            };
        }
        return {
            code: "missing_result",
            message: "The run stopped without reaching a result",
            path: "",
        };
    }

    /** True when some visit is waiting, ready, or running. */
    private hasUnfinishedVisits(entry: RunEntry): boolean {
        for (const visit of entry.state.visits.values()) {
            if (
                visit.status === "waiting" ||
                visit.status === "ready" ||
                visit.status === "running"
            ) {
                return true;
            }
        }
        return false;
    }

    /** The publication pointer of a prepared step. */
    private nodeStepPath(entry: RunEntry, stepId: string): string {
        return entry.state.workflow.steps.get(stepId)?.path ?? "";
    }

    /**
     * Runs one engine turn, settlement, or deadline. An unexpected throw
     * can't escape into the event loop or leave the run stuck: the run
     * records an `execution_error`, a visit left running without its
     * work is failed, and the run fails once idle.
     */
    private guarded(entry: RunEntry, action: () => void): void {
        try {
            action();
        } catch {
            // The thrown error is dropped: it may describe run data, and the failure below reports it.
            const failure: ExecutionFailure = {
                code: "execution_error",
                message: "The engine couldn't apply a run transition",
                path: "",
            };
            if (entry.dispatch?.settled) {
                entry.dispatch = undefined;
            }
            for (const visit of entry.state.visits.values()) {
                if (visit.status === "running" && visit.workId !== entry.dispatch?.workId) {
                    entry.state.visits.set(visit.key, failVisit(visit, failure, this.timestamp()));
                }
            }
            try {
                this.recordFailure(entry, failure);
            } catch {
                // Recording failed too, for example in the registration's release. Nothing more can
                // be done for this run, and throwing would only crash the process.
            }
        }
    }

    /** Creates a visit unless one with the same identity exists. */
    private reachVisit(entry: RunEntry, successor: SuccessorVisit): void {
        const visit = this.nodeFor(entry, successor.stepId).createVisit(
            successor.metadata,
            this.timestamp(),
        );
        if (!entry.state.visits.has(visit.key)) {
            entry.state.visits.set(visit.key, visit);
        }
    }

    /** Lists a visit's dependencies without a completed visit in the same metadata. */
    private getUnmetDependencies(entry: RunEntry, visit: VisitState): string[] {
        return this.nodeFor(entry, visit.stepId).getUnmetDependencies(
            (stepId) =>
                entry.state.visits.get(getVisitKey(stepId, visit.metadata))?.status === "completed",
        );
    }

    /** Creates the context that binds a visit's inputs to the run's inputs and its completed visits' committed outputs. */
    private createBindingContext(entry: RunEntry, visit: VisitState): BindingContext {
        return {
            inputs: entry.state.inputs,
            getCompletedOutput: (stepId) => {
                const producer = entry.state.visits.get(getVisitKey(stepId, visit.metadata));
                return producer?.status === "completed" ? producer.output : undefined;
            },
        };
    }

    /** Returns the node for a prepared step; preparation guarantees one exists. */
    private nodeFor(entry: RunEntry, stepId: string): ExecutionNode {
        const node = entry.nodes.get(stepId);
        if (!node) {
            throw new Error(
                `Run '${entry.state.runId}' reached step '${stepId}', which wasn't prepared`,
            );
        }
        return node;
    }

    /** Releases a terminal run's registration once. */
    private finish(entry: RunEntry): void {
        this.queue.clear(entry.state.runId);
        if (!entry.released) {
            entry.released = true;
            entry.registration.release();
        }
    }

    /** The current instant as an RFC 3339 timestamp. */
    private timestamp(): string {
        return this.clock.now().toISOString();
    }
}

/**
 * The in-memory index of ready work, per run and in the order it became
 * ready. It is not the source of truth: an entry only suggests that a
 * visit may be claimable, and duplicate offers are merged.
 */
class DispatchQueue {
    private readonly candidates = new Map<string, Set<string>>();

    /** Offers a visit as a candidate; offering it again changes nothing. */
    offer(runId: string, visitKey: string): void {
        const keys = this.candidates.get(runId) ?? new Set<string>();
        keys.add(visitKey);
        this.candidates.set(runId, keys);
    }

    /** Removes and returns the run's oldest candidate, if any. */
    next(runId: string): string | undefined {
        const keys = this.candidates.get(runId);
        const [first] = keys ?? [];
        if (keys && first !== undefined) {
            keys.delete(first);
            if (keys.size === 0) {
                this.candidates.delete(runId);
            }
        }
        return first;
    }

    /** True when the run has candidates left. */
    has(runId: string): boolean {
        return this.candidates.has(runId);
    }

    /** Drops every candidate of a run that can no longer dispatch. */
    clear(runId: string): void {
        this.candidates.delete(runId);
    }
}

/** True for a JSON object. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
