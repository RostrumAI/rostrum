import { describe, expect, test } from "bun:test";
import { createDeclaredSchemaCompiler, type WorkflowDocument } from "@rostrum/workflow";
import {
    type ExecutionFailure,
    type RunSnapshot,
    RunSnapshotSchema,
} from "@rostrum/workflow/execution";
import minimumJson from "@rostrum/workflow/fixtures/valid/minimum.json";
import calculationJson from "@rostrum/workflow/fixtures/valid/sequential-calculation.json";
import { Value } from "typebox/value";
import type { PreparedInput, PreparedWorkflow } from "../preparation/prepared-workflow";
import { PublicationPreparer, type RunInputs } from "../preparation/publication-preparer";
import { createValueChecker } from "../preparation/value-checks";
import { LocalTaskExecutor } from "../tasks/local-task-executor";
import {
    createOperationRegistry,
    getRegistryCatalog,
} from "../tasks/operations/operation-registry";
import type { TaskExecutor, TaskWorkItem, TaskWorkResult } from "../tasks/task-executor";
import { type EngineScheduler, type RunRegistration, WorkflowEngine } from "./workflow-engine";

const registry = createOperationRegistry();
const preparer = new PublicationPreparer(getRegistryCatalog(registry));

/** The calculation fixture's step IDs. */
const ADD_STEP = "0192b0a0-7e1d-7000-8000-000000000101";
const DIVIDE_STEP = "0192b0a0-7e1d-7000-8000-000000000102";
const RESULT_STEP = "0192b0a0-7e1d-7000-8000-000000000103";

/** The engine's task deadline in these tests. */
const TIMEOUT_MS = 1000;

/**
 * Runs scheduled turns and timers only when a test asks, on a clock the
 * test moves. Turns queued by a turn run after it, as with `setImmediate`.
 */
class ManualScheduler implements EngineScheduler {
    /** Milliseconds since the test began. */
    now = 0;
    /** How many turns have run. */
    turnsRun = 0;
    private readonly turns: (() => void)[] = [];
    private readonly timers = new Map<number, { callback: () => void; dueAt: number }>();
    private nextTimer = 0;

    /** Queues a turn. */
    schedule(callback: () => void): void {
        this.turns.push(callback);
    }

    /** Registers a timer due `delayMs` from now. */
    startTimer(callback: () => void, delayMs: number): () => void {
        const id = this.nextTimer++;
        this.timers.set(id, { callback, dueAt: this.now + delayMs });
        return () => this.timers.delete(id);
    }

    /** Runs exactly one queued turn, if any, and says whether one ran. */
    runOneTurn(): boolean {
        const turn = this.turns.shift();
        turn?.();
        if (turn) {
            this.turnsRun++;
        }
        return turn !== undefined;
    }

    /** Runs turns, letting settled promises deliver between them, until nothing is left to do. */
    async runUntilIdle(): Promise<void> {
        for (let idle = 0; idle < 3; ) {
            if (this.runOneTurn()) {
                idle = 0;
            } else {
                idle++;
            }
            await flushPromises();
        }
    }

    /** Moves the clock and fires every timer that falls due. */
    advanceTime(ms: number): void {
        this.now += ms;
        for (const [id, timer] of [...this.timers]) {
            if (timer.dueAt <= this.now) {
                this.timers.delete(id);
                timer.callback();
            }
        }
    }

    /** The number of timers still pending. */
    get pendingTimers(): number {
        return this.timers.size;
    }
}

/** Lets already-settled promises run their callbacks. */
async function flushPromises(): Promise<void> {
    for (let index = 0; index < 5; index++) {
        await Promise.resolve();
    }
}

/** One task a held executor received and hasn't settled on its own. */
interface HeldTask {
    /** The work item the engine dispatched. */
    work: TaskWorkItem;
    /** The abort signal the engine passed with it. */
    signal: AbortSignal;
    /** Resolves the executor's promise with a result. */
    settle: (result: TaskWorkResult) => void;
    /** Rejects the executor's promise. */
    fail: (error: unknown) => void;
}

/**
 * An executor whose tasks settle only when the test says so. It records
 * every work item and signal it receives.
 */
class HeldExecutor implements TaskExecutor {
    /** Every task received, in order. */
    readonly received: HeldTask[] = [];

    /** Holds the task until the test settles it. */
    execute(work: TaskWorkItem, signal: AbortSignal): Promise<TaskWorkResult> {
        return new Promise((resolve, reject) => {
            this.received.push({ work, signal, settle: resolve, fail: reject });
        });
    }

    /** Returns the n-th received task, failing the test when it hasn't arrived. */
    task(index: number): HeldTask {
        const task = this.received[index];
        if (!task) {
            throw new Error(`Task ${index} wasn't dispatched`);
        }
        return task;
    }

    /** Returns a run's task for one step, failing the test when it hasn't arrived. */
    taskFor(runId: string, stepId: string): HeldTask {
        const task = this.received.find(
            (candidate) => candidate.work.runId === runId && candidate.work.stepId === stepId,
        );
        if (!task) {
            throw new Error(`No task for step ${stepId} of run ${runId}`);
        }
        return task;
    }
}

/** Counts the tasks a real executor runs, per step. */
class CountingExecutor implements TaskExecutor {
    /** How many times each step's work was dispatched. */
    readonly calls = new Map<string, number>();
    private readonly inner = new LocalTaskExecutor(registry);

    /** Counts the dispatch and delegates to the local executor. */
    execute(work: TaskWorkItem, signal: AbortSignal): Promise<TaskWorkResult> {
        this.calls.set(work.stepId, (this.calls.get(work.stepId) ?? 0) + 1);
        return this.inner.execute(work, signal);
    }
}

/** A registration that records its release and can be aborted by the test. */
function registration(): RunRegistration & { releases: number; controller: AbortController } {
    const controller = new AbortController();
    const held = {
        releases: 0,
        controller,
        signal: controller.signal,
        release: () => {
            held.releases++;
        },
    };
    return held;
}

/** Builds an engine over the manual scheduler and clock with the given executor. */
function engineWith(executor: TaskExecutor, scheduler = new ManualScheduler()) {
    let ids = 0;
    const engine = new WorkflowEngine({
        executor,
        runTaskTimeoutMs: TIMEOUT_MS,
        scheduler,
        clock: { now: () => new Date(Date.UTC(2026, 8, 23) + scheduler.now) },
        createId: () => `0192b0a0-7e1d-7000-8000-${(0x900 + ids++).toString(16).padStart(12, "0")}`,
    });
    return { engine, scheduler };
}

/** Prepares a document for a run, failing the test if preparation refuses it. */
function prepare(document: object & { id: string }): PreparedWorkflow {
    const preparation = preparer.prepare(JSON.stringify(document), {
        workflowId: document.id,
        publicationNumber: 1,
        workflowFormatVersion: "v1",
        digest: "0".repeat(64),
    });
    if (!preparation.ok) {
        throw new Error(`Preparation refused: ${JSON.stringify(preparation.refusal)}`);
    }
    return preparation.workflow;
}

/** Validates inputs for a prepared workflow, failing the test if they're refused. */
function inputs(workflow: PreparedWorkflow, supplied: Record<string, unknown>): RunInputs {
    const validation = preparer.validateInputs(workflow, supplied);
    if (!validation.ok) {
        throw new Error(`Inputs refused: ${JSON.stringify(validation.refusal)}`);
    }
    return validation.inputs;
}

/** Inspects a run and checks the snapshot against the shared inspection schema. */
function inspect(engine: WorkflowEngine, runId: string): RunSnapshot {
    const snapshot = engine.inspectRun(runId);
    if (!snapshot) {
        throw new Error(`Run ${runId} is unknown`);
    }
    expect(Value.Check(RunSnapshotSchema, snapshot)).toBe(true);
    return snapshot;
}

/** Returns one step's snapshot from a run snapshot. */
function stepOf(snapshot: RunSnapshot, stepId: string) {
    return snapshot.steps.find((step) => step.stepId === stepId);
}

/** Returns a copy of the calculation fixture to modify. */
function calculation(): WorkflowDocument {
    // The fixture is a valid v1 document; the validator suite proves it against the document schema.
    return structuredClone(calculationJson) as WorkflowDocument;
}

/** Replacement links or inputs for one prepared step. */
interface StepRelink {
    /** The step's new successors. */
    successors?: string[];
    /** The step's new dependencies. */
    dependencies?: string[];
    /** The step's new inputs. */
    inputs?: Map<string, PreparedInput>;
}

/** Returns a prepared workflow whose steps have different links or inputs than preparation allows. */
function relinked(workflow: PreparedWorkflow, links: Record<string, StepRelink>): PreparedWorkflow {
    const steps = new Map(workflow.steps);
    for (const [stepId, change] of Object.entries(links)) {
        const step = steps.get(stepId);
        if (step) {
            steps.set(stepId, { ...step, ...change });
        }
    }
    return { ...workflow, steps };
}

describe("the worked example", () => {
    // Proves the calculation runs to its exact result through real preparation, operations, and bindings.
    test("90 plus 10, split 4 ways, is total 100 and 25 each", async () => {
        const { engine, scheduler } = engineWith(new LocalTaskExecutor(registry));
        const workflow = prepare(calculationJson);
        const held = registration();
        const runId = engine.admit(
            workflow,
            inputs(workflow, { amount: 90, surcharge: 10, people: 4 }),
            held,
        );

        // Admission only queues the run; nothing runs inline.
        expect(inspect(engine, runId).status).toBe("queued");

        await scheduler.runUntilIdle();
        const snapshot = inspect(engine, runId);
        expect(snapshot.status).toBe("completed");
        expect(snapshot.status === "completed" && snapshot.result).toEqual({
            total: 100,
            perPerson: 25,
        });
        expect(held.releases).toBe(1);
    });

    // Proves an omitted optional input runs with its declared default.
    test("without a surcharge the default of 0 applies", async () => {
        const { engine, scheduler } = engineWith(new LocalTaskExecutor(registry));
        const workflow = prepare(calculationJson);
        const runId = engine.admit(
            workflow,
            inputs(workflow, { amount: 90, people: 4 }),
            registration(),
        );
        await scheduler.runUntilIdle();
        const snapshot = inspect(engine, runId);
        expect(snapshot.status === "completed" && snapshot.result).toEqual({
            total: 90,
            perPerson: 22.5,
        });
    });

    // Proves a failing division is located, keeps the addition inspectable, and produces no result.
    test("people 0 fails the division without a result", async () => {
        const { engine, scheduler } = engineWith(new LocalTaskExecutor(registry));
        const workflow = prepare(calculationJson);
        const runId = engine.admit(
            workflow,
            inputs(workflow, { amount: 90, people: 0 }),
            registration(),
        );
        await scheduler.runUntilIdle();

        // The run failed with the division's own failure, at the divisor.
        const snapshot = inspect(engine, runId);
        const failure: ExecutionFailure = {
            code: "division_by_zero",
            message: "The divisor is zero",
            path: "/steps/1/inputs/divisor",
            stepId: DIVIDE_STEP,
        };
        expect(snapshot.status === "failed" && snapshot.failure).toEqual(failure);
        expect(snapshot).not.toHaveProperty("result");

        // The addition's output stays visible, and the result step was never reached.
        expect(stepOf(snapshot, ADD_STEP)).toMatchObject({
            status: "completed",
            output: { value: 90 },
        });
        expect(stepOf(snapshot, DIVIDE_STEP)).toMatchObject({ status: "failed", failure });
        expect(stepOf(snapshot, RESULT_STEP)).toEqual({ stepId: RESULT_STEP, status: "pending" });
    });

    // Proves a result step with no inputs returns an empty object as the final result.
    test("the minimum workflow returns an empty result", async () => {
        const { engine, scheduler } = engineWith(new LocalTaskExecutor(registry));
        const workflow = prepare(minimumJson);
        const runId = engine.admit(workflow, new Map(), registration());
        await scheduler.runUntilIdle();
        const snapshot = inspect(engine, runId);
        expect(snapshot.status === "completed" && snapshot.result).toEqual({});
    });
});

describe("traversal", () => {
    // Proves execution follows the graph, not the step array, and each reached task runs once.
    test("reversed step order and repeated advancement still run each task once", async () => {
        const executor = new CountingExecutor();
        const { engine, scheduler } = engineWith(executor);
        const document = calculation();
        document.steps.reverse();
        const workflow = prepare(document);
        const runId = engine.admit(
            workflow,
            inputs(workflow, { amount: 90, surcharge: 10, people: 4 }),
            registration(),
        );

        // Advancement requested far more often than needed changes nothing.
        for (let turn = 0; turn < 20; turn++) {
            engine.advanceWorkflow(runId);
            scheduler.runOneTurn();
            engine.advanceWorkflow(runId);
            await flushPromises();
        }
        await scheduler.runUntilIdle();

        const snapshot = inspect(engine, runId);
        expect(snapshot.status === "completed" && snapshot.result).toEqual({
            total: 100,
            perPerson: 25,
        });
        expect([...executor.calls.values()]).toEqual([1, 1]);
        // Inspection lists steps in document order, which is now reversed.
        expect(snapshot.steps.map((step) => step.stepId)).toEqual([
            RESULT_STEP,
            DIVIDE_STEP,
            ADD_STEP,
        ]);
    });

    // Proves an immediately resolved task still yields: no turn starts more than one task.
    test("immediate results don't recurse or skip scheduling", async () => {
        const executor = new CountingExecutor();
        const { engine, scheduler } = engineWith(executor);
        const workflow = prepare(calculationJson);
        const runId = engine.admit(
            workflow,
            inputs(workflow, { amount: 1, people: 1 }),
            registration(),
        );

        // Run turn by turn, letting results arrive between turns; each turn starts at most one task.
        let started = 0;
        for (let idle = 0; idle < 3; ) {
            const ran = scheduler.runOneTurn();
            const now = [...executor.calls.values()].reduce((sum, count) => sum + count, 0);
            expect(now - started).toBeLessThanOrEqual(1);
            started = now;
            idle = ran ? 0 : idle + 1;
            await flushPromises();
        }
        expect(inspect(engine, runId).status).toBe("completed");
        // Admission, then advance and dispatch per step: the chain took several separate turns.
        expect(scheduler.turnsRun).toBeGreaterThanOrEqual(6);
    });

    // Proves a successor binds only to committed output, never to the object the task returned.
    test("mutating a returned output doesn't change what later steps see", async () => {
        const executor = new HeldExecutor();
        const { engine, scheduler } = engineWith(executor);
        const workflow = prepare(calculationJson);
        const runId = engine.admit(
            workflow,
            inputs(workflow, { amount: 90, people: 4 }),
            registration(),
        );
        await scheduler.runUntilIdle();

        // The addition returns an object the test keeps and changes after settling.
        const returned = { value: 90 };
        executor
            .task(0)
            .settle({ runId, workId: executor.task(0).work.workId, ok: true, output: returned });
        await scheduler.runUntilIdle();
        returned.value = -1;

        // The division received the committed 90, and the snapshot still shows it.
        expect(executor.task(1).work.inputs).toEqual({ dividend: 90, divisor: 4 });
        expect(stepOf(inspect(engine, runId), ADD_STEP)).toMatchObject({ output: { value: 90 } });
    });
});

describe("dependency gating and dead runs", () => {
    // Proves a visit with an unmet dependency waits, then is dispatched exactly once when it's met.
    test("a waiting visit is dispatched once its dependency completes", async () => {
        const executor = new HeldExecutor();
        const { engine, scheduler } = engineWith(executor);
        // The addition leads to both the division and the result; the result also waits for the division.
        const workflow = relinked(prepare(calculationJson), {
            [ADD_STEP]: { successors: [RESULT_STEP, DIVIDE_STEP] },
            [RESULT_STEP]: { dependencies: [DIVIDE_STEP] },
        });
        const runId = engine.admit(
            workflow,
            inputs(workflow, { amount: 90, people: 4 }),
            registration(),
        );
        await scheduler.runUntilIdle();
        executor.task(0).settle({
            runId,
            workId: executor.task(0).work.workId,
            ok: true,
            output: { value: 90 },
        });
        await scheduler.runUntilIdle();

        // The result waits on the division, which is now running.
        const waiting = inspect(engine, runId);
        expect(stepOf(waiting, RESULT_STEP)).toEqual({
            stepId: RESULT_STEP,
            status: "waiting",
            waitingFor: [DIVIDE_STEP],
        });
        expect(waiting.waitingFor).toEqual([DIVIDE_STEP]);
        expect(waiting.currentSteps).toEqual([DIVIDE_STEP]);

        // Once the division completes, the result commits; only two tasks ever ran.
        executor.task(1).settle({
            runId,
            workId: executor.task(1).work.workId,
            ok: true,
            output: { value: 22.5 },
        });
        await scheduler.runUntilIdle();
        const done = inspect(engine, runId);
        expect(done.status === "completed" && done.result).toEqual({ total: 90, perPerson: 22.5 });
        expect(executor.received).toHaveLength(2);
    });

    // Proves a run whose waiting visit can never be satisfied fails at the unmet dependency.
    test("an unmet dependency with nothing left to run fails with its location", async () => {
        const { engine, scheduler } = engineWith(new LocalTaskExecutor(registry));
        // The division waits for the result step, which only it leads to.
        const workflow = relinked(prepare(calculationJson), {
            [DIVIDE_STEP]: { dependencies: [ADD_STEP, RESULT_STEP] },
        });
        const runId = engine.admit(
            workflow,
            inputs(workflow, { amount: 1, people: 1 }),
            registration(),
        );
        await scheduler.runUntilIdle();
        const snapshot = inspect(engine, runId);
        expect(snapshot.status === "failed" && snapshot.failure).toEqual({
            code: "unmet_dependencies",
            message: `The step waits for '${RESULT_STEP}', which can't complete`,
            path: "/steps/1/dependencies/1",
            stepId: DIVIDE_STEP,
        });
    });

    // Proves a run that stops without reaching a result fails as missing_result, not as success.
    test("no continuation and no result fails as missing_result", async () => {
        const { engine, scheduler } = engineWith(new LocalTaskExecutor(registry));
        const workflow = relinked(prepare(calculationJson), { [DIVIDE_STEP]: { successors: [] } });
        const runId = engine.admit(
            workflow,
            inputs(workflow, { amount: 1, people: 1 }),
            registration(),
        );
        await scheduler.runUntilIdle();
        const snapshot = inspect(engine, runId);
        expect(snapshot.status === "failed" && snapshot.failure).toEqual({
            code: "missing_result",
            message: "The run stopped without reaching a result",
            path: "",
        });
    });

    // Proves a declared but unreachable step stays pending and doesn't fail a successful run.
    test("a pending disconnected step doesn't fail the run", async () => {
        const { engine, scheduler } = engineWith(new LocalTaskExecutor(registry));
        const document = calculation();
        document.steps.push({
            id: "0192b0a0-7e1d-7000-8000-0000000001ff",
            type: "task",
            config: { operation: "greet" },
            inputs: { name: "nobody" },
        });
        const workflow = prepare(document);
        const runId = engine.admit(
            workflow,
            inputs(workflow, { amount: 1, people: 1 }),
            registration(),
        );
        await scheduler.runUntilIdle();
        const snapshot = inspect(engine, runId);
        expect(snapshot.status).toBe("completed");
        expect(stepOf(snapshot, "0192b0a0-7e1d-7000-8000-0000000001ff")?.status).toBe("pending");
    });
});

describe("completions", () => {
    // Proves a result carrying another run's identity fails that dispatch instead of committing.
    test("a result for different work is an execution error and can't touch the other run", async () => {
        const executor = new HeldExecutor();
        const { engine, scheduler } = engineWith(executor);
        const workflow = prepare(calculationJson);
        const first = engine.admit(
            workflow,
            inputs(workflow, { amount: 1, people: 1 }),
            registration(),
        );
        const second = engine.admit(
            workflow,
            inputs(workflow, { amount: 2, people: 1 }),
            registration(),
        );
        await scheduler.runUntilIdle();

        // The first run's task answers with the second run's identity.
        const secondWork = executor.received.find((task) => task.work.runId === second)?.work;
        const firstTask = executor.received.find((task) => task.work.runId === first);
        firstTask?.settle({
            runId: second,
            workId: secondWork?.workId ?? "",
            ok: true,
            output: { value: 999 },
        });
        await scheduler.runUntilIdle();

        // The first run fails as an execution error; the second run's visit is still running and unchanged.
        const failed = inspect(engine, first);
        expect(failed.status === "failed" && failed.failure.code).toBe("execution_error");
        const other = inspect(engine, second);
        expect(stepOf(other, ADD_STEP)?.status).toBe("running");
        expect(other.status).toBe("running");
    });

    // Proves an executor that rejects or throws can't leave a run stuck.
    test("a rejecting or throwing executor fails the run", async () => {
        const rejecting: TaskExecutor = { execute: () => Promise.reject(new Error("boom")) };
        const throwing: TaskExecutor = {
            execute: () => {
                throw new Error("boom");
            },
        };
        for (const executor of [rejecting, throwing]) {
            const { engine, scheduler } = engineWith(executor);
            const workflow = prepare(calculationJson);
            const held = registration();
            const runId = engine.admit(workflow, inputs(workflow, { amount: 1, people: 1 }), held);
            await scheduler.runUntilIdle();
            const snapshot = inspect(engine, runId);
            expect(snapshot.status === "failed" && snapshot.failure).toEqual({
                code: "execution_error",
                message: "The task executor failed",
                path: "/steps/0",
                stepId: ADD_STEP,
            });
            expect(held.releases).toBe(1);
        }
    });

    // Proves invalid output never reaches a successor: wrong type, missing member, or a non-finite number.
    test("invalid outputs fail the step and stop the run", async () => {
        const outputs = [
            { value: "90" },
            {},
            { value: Number.POSITIVE_INFINITY },
            { value: 1, extra: true },
        ];
        for (const output of outputs) {
            const executor = new HeldExecutor();
            const { engine, scheduler } = engineWith(executor);
            const workflow = prepare(calculationJson);
            const runId = engine.admit(
                workflow,
                inputs(workflow, { amount: 1, people: 1 }),
                registration(),
            );
            await scheduler.runUntilIdle();
            executor
                .task(0)
                .settle({ runId, workId: executor.task(0).work.workId, ok: true, output });
            await scheduler.runUntilIdle();

            const snapshot = inspect(engine, runId);
            expect(snapshot.status === "failed" && snapshot.failure.code).toBe("invalid_output");
            expect(stepOf(snapshot, ADD_STEP)?.status).toBe("failed");
            expect(executor.received).toHaveLength(1);
        }
    });

    // Proves a step's own output declaration is checked at run time, not only the operation's schema.
    test("an output that breaks the step's declaration is invalid", async () => {
        // Preparation would refuse a declaration narrower than the operation's output, so the
        // prepared step gets one directly, standing in for an operation that breaks its declaration.
        const executor = new HeldExecutor();
        const { engine, scheduler } = engineWith(executor);
        const workflow = prepare(calculationJson);
        const add = workflow.steps.get(ADD_STEP);
        const compiled = createDeclaredSchemaCompiler().compile({ type: "number", maximum: 10 });
        if (add?.kind !== "task" || !compiled.ok) {
            throw new Error("Expected the addition task and a compiled declaration");
        }
        const narrowed: PreparedWorkflow = {
            ...workflow,
            steps: new Map([
                ...workflow.steps,
                [
                    ADD_STEP,
                    {
                        ...add,
                        declaredOutputs: new Map([["value", createValueChecker(compiled.check)]]),
                    },
                ],
            ]),
        };
        const runId = engine.admit(
            narrowed,
            inputs(narrowed, { amount: 1, people: 1 }),
            registration(),
        );
        await scheduler.runUntilIdle();
        executor.task(0).settle({
            runId,
            workId: executor.task(0).work.workId,
            ok: true,
            output: { value: 11 },
        });
        await scheduler.runUntilIdle();

        // The value fits the operation's schema but not the declaration, so it's never committed.
        const snapshot = inspect(engine, runId);
        expect(snapshot.status === "failed" && snapshot.failure).toMatchObject({
            code: "invalid_output",
            path: "/steps/0/outputs/value",
        });
        expect(executor.received).toHaveLength(1);
    });

    // Proves a terminal run never changes, however often it's advanced or inspected.
    test("terminal state is stable under repeated advancement and inspection", async () => {
        const { engine, scheduler } = engineWith(new LocalTaskExecutor(registry));
        const workflow = prepare(calculationJson);
        const held = registration();
        const runId = engine.admit(workflow, inputs(workflow, { amount: 1, people: 0 }), held);
        await scheduler.runUntilIdle();
        const first = inspect(engine, runId);
        for (let index = 0; index < 5; index++) {
            engine.advanceWorkflow(runId);
        }
        await scheduler.runUntilIdle();
        expect(inspect(engine, runId)).toEqual(first);
        expect(held.releases).toBe(1);
    });
});

describe("independent runs", () => {
    // Proves a held run doesn't block or leak into another run of the same publication.
    test("one run completes and another fails while a third is held", async () => {
        const executor = new HeldExecutor();
        const { engine, scheduler } = engineWith(executor);
        const workflow = prepare(calculationJson);
        const held = engine.admit(
            workflow,
            inputs(workflow, { amount: 5, people: 5 }),
            registration(),
        );
        const succeeds = engine.admit(
            workflow,
            inputs(workflow, { amount: 90, people: 4 }),
            registration(),
        );
        const fails = engine.admit(
            workflow,
            inputs(workflow, { amount: 90, people: 0 }),
            registration(),
        );
        await scheduler.runUntilIdle();

        // Settle only the second and third runs' tasks, checking each saw its own run's values.
        const answer = async (runId: string, stepId: string, value: number) => {
            const task = executor.taskFor(runId, stepId);
            task.settle({ runId, workId: task.work.workId, ok: true, output: { value } });
            await scheduler.runUntilIdle();
            return task.work.inputs;
        };
        expect(await answer(succeeds, ADD_STEP, 90)).toEqual({ left: 90, right: 0 });
        expect(await answer(succeeds, DIVIDE_STEP, 22.5)).toEqual({ dividend: 90, divisor: 4 });
        expect(await answer(fails, ADD_STEP, 90)).toEqual({ left: 90, right: 0 });
        const failedDivision = executor.taskFor(fails, DIVIDE_STEP);
        failedDivision.settle({
            runId: fails,
            workId: failedDivision.work.workId,
            ok: false,
            failure: {
                code: "division_by_zero",
                message: "The divisor is zero",
                path: "/inputs/divisor",
            },
        });
        await scheduler.runUntilIdle();

        // Each outcome follows its own inputs; the held run is still on its first task.
        const completed = inspect(engine, succeeds);
        expect(completed.status === "completed" && completed.result).toEqual({
            total: 90,
            perPerson: 22.5,
        });
        expect(inspect(engine, fails).status).toBe("failed");
        const stillHeld = inspect(engine, held);
        expect(stillHeld.status).toBe("running");
        expect(stillHeld.currentSteps).toEqual([ADD_STEP]);
    });
});

describe("task deadlines", () => {
    // Proves a timeout stops dispatch, waits for the task to settle, and discards its late output.
    test("a timed-out task keeps the run stopping until it settles, then fails it", async () => {
        const executor = new HeldExecutor();
        const { engine, scheduler } = engineWith(executor);
        const workflow = prepare(calculationJson);
        const held = registration();
        const runId = engine.admit(workflow, inputs(workflow, { amount: 1, people: 1 }), held);
        await scheduler.runUntilIdle();

        // The deadline passes while the task is still executing.
        scheduler.advanceTime(TIMEOUT_MS);
        await scheduler.runUntilIdle();
        const timeout: ExecutionFailure = {
            code: "task_timeout",
            message: `The task didn't finish within ${TIMEOUT_MS} ms`,
            path: "/steps/0",
            stepId: ADD_STEP,
        };
        const stopping = inspect(engine, runId);
        expect(stopping).toMatchObject({
            status: "running",
            stopping: true,
            failure: timeout,
            currentSteps: [ADD_STEP],
        });
        expect(stepOf(stopping, ADD_STEP)?.status).toBe("running");
        expect(executor.task(0).signal.aborted).toBe(true);
        expect(held.releases).toBe(0);

        // The task finally returns output; it's discarded and the visit ends with the timeout.
        executor.task(0).settle({
            runId,
            workId: executor.task(0).work.workId,
            ok: true,
            output: { value: 1 },
        });
        await scheduler.runUntilIdle();
        const failed = inspect(engine, runId);
        expect(failed.status === "failed" && failed.failure).toEqual(timeout);
        expect(stepOf(failed, ADD_STEP)).toMatchObject({ status: "failed", failure: timeout });
        expect(executor.received).toHaveLength(1);
        expect(held.releases).toBe(1);
        expect(scheduler.pendingTimers).toBe(0);
    });

    // Proves the deadline starts at the claim, not at admission, and is cancelled when the task settles.
    test("a task that settles in time clears its deadline and abort forwarding", async () => {
        const executor = new HeldExecutor();
        const { engine, scheduler } = engineWith(executor);
        const workflow = prepare(calculationJson);
        const held = registration();
        const runId = engine.admit(workflow, inputs(workflow, { amount: 1, people: 1 }), held);

        // Time spent queued before the claim doesn't count against the task.
        scheduler.advanceTime(TIMEOUT_MS * 5);
        await scheduler.runUntilIdle();
        scheduler.advanceTime(TIMEOUT_MS - 1);
        await scheduler.runUntilIdle();
        expect(inspect(engine, runId).status).toBe("running");

        // Settling in time cancels the deadline before any later claim starts another.
        const first = executor.task(0);
        first.settle({ runId, workId: first.work.workId, ok: true, output: { value: 1 } });
        await flushPromises();
        expect(scheduler.pendingTimers).toBe(0);

        // The settled task no longer hears the run's abort; the next task does.
        await scheduler.runUntilIdle();
        held.controller.abort();
        expect(first.signal.aborted).toBe(false);
        expect(executor.task(1).signal.aborted).toBe(true);
    });

    // Proves a failure reported after the deadline doesn't replace the timeout.
    test("the timeout wins over a later failure or rejection", async () => {
        for (const late of ["failure", "rejection"] as const) {
            const executor = new HeldExecutor();
            const { engine, scheduler } = engineWith(executor);
            const workflow = prepare(calculationJson);
            const runId = engine.admit(
                workflow,
                inputs(workflow, { amount: 1, people: 1 }),
                registration(),
            );
            await scheduler.runUntilIdle();
            scheduler.advanceTime(TIMEOUT_MS);
            const task = executor.task(0);
            if (late === "failure") {
                task.settle({
                    runId,
                    workId: task.work.workId,
                    ok: false,
                    failure: { code: "numeric_overflow", message: "late", path: "/outputs/value" },
                });
            } else {
                task.fail(new Error("late"));
            }
            await scheduler.runUntilIdle();
            const snapshot = inspect(engine, runId);
            expect(snapshot.status === "failed" && snapshot.failure.code).toBe("task_timeout");
        }
    });

    // Proves the process's abort reaches executing work without releasing the run.
    test("aborting the registration aborts the executing task", async () => {
        const executor = new HeldExecutor();
        const { engine, scheduler } = engineWith(executor);
        const workflow = prepare(calculationJson);
        const held = registration();
        engine.admit(workflow, inputs(workflow, { amount: 1, people: 1 }), held);
        await scheduler.runUntilIdle();
        held.controller.abort();
        expect(executor.task(0).signal.aborted).toBe(true);
        expect(held.releases).toBe(0);
    });
});

describe("guarded state", () => {
    // Proves a binding that can't resolve fails its visit before any work starts.
    test("an unresolved binding fails the visit without dispatching it", async () => {
        const executor = new CountingExecutor();
        const { engine, scheduler } = engineWith(executor);
        const workflow = prepare(calculationJson);
        // The run's inputs lack `people`, which only a broken admission could allow.
        const runId = engine.admit(
            workflow,
            new Map<string, unknown>([
                ["amount", 1],
                ["surcharge", 0],
            ]),
            registration(),
        );
        await scheduler.runUntilIdle();

        const snapshot = inspect(engine, runId);
        expect(snapshot.status === "failed" && snapshot.failure).toEqual({
            code: "unresolved_binding",
            message: "The value bound to 'divisor' isn't available",
            path: "/steps/1/inputs/divisor",
            stepId: DIVIDE_STEP,
        });
        expect(stepOf(snapshot, DIVIDE_STEP)).not.toHaveProperty("startedAt");
        expect(executor.calls.get(DIVIDE_STEP)).toBeUndefined();
    });

    // Proves a result can't complete a run while other reached work is unfinished.
    test("a result reached beside unfinished work fails the run instead of completing it", async () => {
        // The result binds nothing, so it's ready as soon as the addition completes, beside the division.
        const executor = new HeldExecutor();
        const { engine, scheduler } = engineWith(executor);
        const workflow = relinked(prepare(calculationJson), {
            [ADD_STEP]: { successors: [RESULT_STEP, DIVIDE_STEP] },
            [RESULT_STEP]: { inputs: new Map() },
        });
        const runId = engine.admit(
            workflow,
            inputs(workflow, { amount: 1, people: 1 }),
            registration(),
        );
        await scheduler.runUntilIdle();
        executor.task(0).settle({
            runId,
            workId: executor.task(0).work.workId,
            ok: true,
            output: { value: 1 },
        });
        await scheduler.runUntilIdle();

        // Inspection still describes the run: failed, with the division left ready.
        const snapshot = inspect(engine, runId);
        expect(snapshot.status === "failed" && snapshot.failure.code).toBe("execution_error");
        expect(stepOf(snapshot, DIVIDE_STEP)?.status).toBe("ready");
    });

    // Proves nothing a caller does with a snapshot can change the run.
    test("snapshots can't change committed results or failures", async () => {
        const { engine, scheduler } = engineWith(new LocalTaskExecutor(registry));
        const workflow = prepare(calculationJson);
        const completed = engine.admit(
            workflow,
            inputs(workflow, { amount: 90, people: 4 }),
            registration(),
        );
        const failed = engine.admit(
            workflow,
            inputs(workflow, { amount: 90, people: 0 }),
            registration(),
        );
        await scheduler.runUntilIdle();

        // Writing into the returned objects throws, and later snapshots are unchanged.
        const result = inspect(engine, completed);
        const failure = inspect(engine, failed);
        expect(() => {
            if (result.status === "completed") {
                result.result.total = 0;
            }
        }).toThrow();
        expect(() => {
            if (failure.status === "failed") {
                failure.failure.code = "task_error";
            }
        }).toThrow();
        const again = inspect(engine, completed);
        expect(again.status === "completed" && again.result).toEqual({
            total: 90,
            perPerson: 22.5,
        });
        const againFailed = inspect(engine, failed);
        expect(againFailed.status === "failed" && againFailed.failure.code).toBe(
            "division_by_zero",
        );
    });

    // Proves an executor result the engine can't interpret fails the run instead of stranding it.
    test("a malformed or undeclared task failure fails the run with an execution error", async () => {
        const malformed = { ok: false } as const;
        const undeclared = {
            ok: false,
            failure: { code: "division_by_zero", message: "nope", path: "/inputs/left" },
        } as const;
        for (const shape of [malformed, undeclared]) {
            const executor = new HeldExecutor();
            const { engine, scheduler } = engineWith(executor);
            const workflow = prepare(calculationJson);
            const held = registration();
            const runId = engine.admit(workflow, inputs(workflow, { amount: 1, people: 1 }), held);
            await scheduler.runUntilIdle();
            // The malformed result breaks the executor contract on purpose.
            const task = executor.task(0);
            task.settle({ runId, workId: task.work.workId, ...shape } as unknown as TaskWorkResult);
            await scheduler.runUntilIdle();

            const snapshot = inspect(engine, runId);
            expect(snapshot.status === "failed" && snapshot.failure.code).toBe("execution_error");
            expect(stepOf(snapshot, ADD_STEP)?.status).toBe("failed");
            expect(held.releases).toBe(1);
        }
    });

    // Proves a task timeout outside the range timers honor is refused at construction.
    test("an unusable task timeout is refused", () => {
        const executor = new LocalTaskExecutor(registry);
        for (const runTaskTimeoutMs of [0, -1, 1.5, Number.NaN, 2 ** 31]) {
            expect(() => new WorkflowEngine({ executor, runTaskTimeoutMs })).toThrow(RangeError);
        }
    });
});
