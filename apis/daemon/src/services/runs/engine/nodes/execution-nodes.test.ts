/**
 * @fileoverview Tests the execution nodes: the decisions task and result steps
 * hand the workflow engine. The engine applies these decisions without
 * re-checking them, so a wrong decision here dispatches bad arguments, stalls
 * a run, or commits the wrong result. Nodes are built from the prepared
 * sequential-calculation fixture (add, divide, result).
 *
 * TaskExecutionNode:
 * - prepares task work: resolved bound arguments, and an unbound optional
 *   argument's operation default.
 * - fails with a located `unresolved_binding` when a producer hasn't completed.
 * - fails with a located `io_type_mismatch` when a resolved value fails its
 *   argument's check.
 * - continues to each successor, carrying the visit's loop metadata unchanged.
 *
 * ResultExecutionNode:
 * - prepares a local output from its resolved inputs, with no executor.
 * - fails with `unresolved_binding` when a bound output isn't available.
 * - finishes the run with the committed output as the result.
 *
 * ExecutionNode:
 * - gives the same visit key for the same step and metadata at any time, and
 *   creates the visit as waiting.
 * - lists only the dependencies the lookup doesn't report as completed.
 */

import { describe, expect, test } from "bun:test";
import { OPERATION_CATALOG } from "@rostrum/workflow";
import calculationJson from "@rostrum/workflow/fixtures/valid/sequential-calculation.json";
import type {
    PreparedResultStep,
    PreparedTaskStep,
    PreparedWorkflow,
} from "../../preparation/prepared-workflow";
import { PublicationPreparer } from "../../preparation/publication-preparer";
import type { BindingContext } from "../bindings";
import { createWaitingVisit, promoteVisit, type ReadyVisit } from "../run-state";
import { ResultExecutionNode } from "./result-execution-node";
import { TaskExecutionNode } from "./task-execution-node";

/** The calculation fixture's step IDs: the addition, the division, and the result. */
const ADD_STEP = "0192b0a0-7e1d-7000-8000-000000000101";
const DIVIDE_STEP = "0192b0a0-7e1d-7000-8000-000000000102";
const RESULT_STEP = "0192b0a0-7e1d-7000-8000-000000000103";
const AT = "2026-09-23T12:00:00.000Z";

/** Prepares a variant of the calculation fixture, whose steps the nodes are built from. */
function prepareCalculation(document: object = calculationJson): PreparedWorkflow {
    const preparation = new PublicationPreparer(OPERATION_CATALOG).prepare(
        JSON.stringify(document),
        {
            workflowId: calculationJson.id,
            publicationNumber: 1,
            workflowFormatVersion: "v1",
            digest: "0".repeat(64),
        },
    );
    if (!preparation.ok) {
        throw new Error("Expected the calculation fixture to prepare");
    }
    return preparation.workflow;
}

const workflow = prepareCalculation();

/** Returns a prepared task step of the calculation, or of the given variant. */
function getTaskStep(stepId: string, preparedWorkflow = workflow): PreparedTaskStep {
    const step = preparedWorkflow.steps.get(stepId);
    if (step?.kind !== "task") {
        throw new Error(`Expected ${stepId} to be a task step`);
    }
    return step;
}

/** Returns the calculation's prepared result step. */
function getResultStep(): PreparedResultStep {
    const step = workflow.steps.get(RESULT_STEP);
    if (step?.kind !== "result") {
        throw new Error("Expected the result step");
    }
    return step;
}

/** Builds a binding context over run inputs and the outputs of completed steps. */
function buildContext(
    inputs: Record<string, unknown>,
    outputs: Record<string, Record<string, unknown>> = {},
): BindingContext {
    return {
        inputs: new Map(Object.entries(inputs)),
        getCompletedOutput: (stepId) => outputs[stepId],
    };
}

/** Builds a ready visit of the given step with no loop metadata. */
function createReadyVisit(stepId: string): ReadyVisit {
    return promoteVisit(createWaitingVisit(stepId, [], AT));
}

describe("TaskExecutionNode", () => {
    // Proves a ready task resolves its bound arguments from the run for the executor.
    test("prepares task work with resolved inputs", () => {
        // The addition binds both arguments to run inputs, so no producer is needed.
        const step = getTaskStep(ADD_STEP);
        const node = new TaskExecutionNode(step);
        const preparation = node.prepareExecution(
            createReadyVisit(ADD_STEP),
            buildContext({ amount: 90, surcharge: 5, people: 3 }),
        );

        // The executor receives this node's own step and the resolved arguments.
        expect(preparation).toEqual({ kind: "task", step, inputs: { left: 90, right: 5 } });
        expect(preparation.kind === "task" && preparation.step).toBe(step);
    });

    // Proves an unbound optional argument receives its operation default without a run value.
    test("prepares task work with a defaulted argument", () => {
        // The addition leaves its optional `right` argument unbound.
        const document = {
            ...calculationJson,
            steps: calculationJson.steps.map((step) =>
                step.id === ADD_STEP ? { ...step, inputs: { left: step.inputs.left } } : step,
            ),
        };
        const step = getTaskStep(ADD_STEP, prepareCalculation(document));
        const node = new TaskExecutionNode(step);

        // The run supplies only the bound argument's value.
        const preparation = node.prepareExecution(
            createReadyVisit(ADD_STEP),
            buildContext({ amount: 90, people: 3 }),
        );

        // `right` takes `add`'s declared default of 0.
        expect(preparation).toEqual({ kind: "task", step, inputs: { left: 90, right: 0 } });
    });

    // Proves a binding to output no completed visit holds fails the visit before dispatch.
    test("fails when a producer hasn't completed", () => {
        // The division's dividend comes from the addition, which hasn't completed.
        const node = new TaskExecutionNode(getTaskStep(DIVIDE_STEP));
        const preparation = node.prepareExecution(
            createReadyVisit(DIVIDE_STEP),
            buildContext({ people: 3 }),
        );

        // The failure names the unbound argument and its location in the document.
        expect(preparation).toEqual({
            kind: "failure",
            failure: {
                code: "unresolved_binding",
                message: "The value bound to 'dividend' isn't available",
                path: "/steps/1/inputs/dividend",
                stepId: DIVIDE_STEP,
            },
        });
    });

    // Proves a resolved value that fails its argument's check is a located type mismatch.
    test("fails when a resolved value doesn't fit its argument", () => {
        // The divisor resolves to a string where the operation expects a number.
        const node = new TaskExecutionNode(getTaskStep(DIVIDE_STEP));
        const preparation = node.prepareExecution(
            createReadyVisit(DIVIDE_STEP),
            buildContext({ people: "three" }, { [ADD_STEP]: { value: 90 } }),
        );

        // The failure is a type mismatch located at the divisor.
        expect(preparation.kind === "failure" && preparation.failure).toMatchObject({
            code: "io_type_mismatch",
            path: "/steps/1/inputs/divisor",
            stepId: DIVIDE_STEP,
        });
    });

    // Proves completion continues to each successor, carrying the visit's metadata.
    test("continues to its successors", () => {
        // The visit carries loop metadata that successors must inherit.
        const node = new TaskExecutionNode(getTaskStep(ADD_STEP));
        const frames = [{ loopStepId: ADD_STEP, iteration: 2 }];
        const visit = promoteVisit(createWaitingVisit(ADD_STEP, frames, AT));

        // The division is the only successor, and it receives the same frames.
        expect(node.completeExecution(visit)).toEqual({
            kind: "continue",
            successors: [{ stepId: DIVIDE_STEP, metadata: frames }],
        });
    });
});

describe("ResultExecutionNode", () => {
    // Proves a result step commits its resolved inputs locally, without an executor.
    test("prepares a local output", () => {
        // Both producers have completed, so every result input resolves.
        const node = new ResultExecutionNode(getResultStep());
        const preparation = node.prepareExecution(
            createReadyVisit(RESULT_STEP),
            buildContext({}, { [ADD_STEP]: { value: 90 }, [DIVIDE_STEP]: { value: 30 } }),
        );

        // The output is committed locally from the resolved values.
        expect(preparation).toEqual({ kind: "local", output: { total: 90, perPerson: 30 } });
    });

    // Proves a result whose producer hasn't completed fails before anything is committed.
    test("fails when a bound output isn't available", () => {
        // Only the addition has completed, so the division's output can't be bound.
        const node = new ResultExecutionNode(getResultStep());
        const preparation = node.prepareExecution(
            createReadyVisit(RESULT_STEP),
            buildContext({}, { [ADD_STEP]: { value: 90 } }),
        );

        // The failure names the unbound result input.
        expect(preparation).toEqual({
            kind: "failure",
            failure: {
                code: "unresolved_binding",
                message: "The value bound to 'perPerson' isn't available",
                path: "/steps/2/inputs/perPerson",
                stepId: RESULT_STEP,
            },
        });
    });

    // Proves the committed output becomes the run's result exactly.
    test("finishes the run with its output", () => {
        // The result step has committed its output.
        const node = new ResultExecutionNode(getResultStep());
        const output = { total: 90, perPerson: 30 };

        // Completion finishes the run with that output as the result.
        expect(node.completeExecution(createReadyVisit(RESULT_STEP), output)).toEqual({
            kind: "finish",
            result: output,
        });
    });
});

describe("ExecutionNode", () => {
    // Proves a visit's identity depends only on the step and its metadata.
    test("creates the same visit identity for every request", () => {
        // Two visits of the same step and metadata are requested at different times.
        const node = new TaskExecutionNode(getTaskStep(ADD_STEP));
        const first = node.createVisit([], AT);
        const second = node.createVisit([], "2026-09-24T00:00:00.000Z");

        // Both share one key, and a new visit starts waiting.
        expect(first.key).toBe(second.key);
        expect(first.status).toBe("waiting");
    });

    // Proves only dependencies the lookup reports as completed are met.
    test("lists unmet dependencies", () => {
        // The result step depends on both calculation steps.
        const node = new ResultExecutionNode({
            ...getResultStep(),
            dependencies: [ADD_STEP, DIVIDE_STEP],
        });

        // Only the division is unmet when the addition alone has completed.
        expect(node.getUnmetDependencies((stepId) => stepId === ADD_STEP)).toEqual([DIVIDE_STEP]);

        // Nothing is unmet once every dependency has completed.
        expect(node.getUnmetDependencies(() => true)).toEqual([]);
    });
});
