import { describe, expect, test } from "bun:test";
import { OPERATION_CATALOG } from "@rostrum/workflow";
import type { FailureCode } from "@rostrum/workflow/execution";
import calculationJson from "@rostrum/workflow/fixtures/valid/sequential-calculation.json";
import type { PreparedTaskStep } from "../preparation/prepared-workflow";
import { PublicationPreparer } from "../preparation/publication-preparer";
import type { TaskWorkResult } from "../tasks/task-executor";
import { checkTaskOutput, getTaskFailure } from "./task-results";

/** The calculation fixture's division step, which declares `value` as a number. */
const DIVIDE_STEP = "0192b0a0-7e1d-7000-8000-000000000102";

/** The run and work a dispatched division belongs to. */
const DISPATCHED = { runId: "run-1", workId: "work-1" };

/** Prepares the calculation fixture and returns its division step. */
function getDivideStep(): PreparedTaskStep {
    const preparation = new PublicationPreparer(OPERATION_CATALOG).prepare(
        JSON.stringify(calculationJson),
        {
            workflowId: calculationJson.id,
            publicationNumber: 1,
            workflowFormatVersion: "v1",
            digest: "0".repeat(64),
        },
    );
    const step = preparation.ok ? preparation.workflow.steps.get(DIVIDE_STEP) : undefined;
    if (step?.kind !== "task") {
        throw new Error("Expected the calculation's division step");
    }
    return step;
}

const step = getDivideStep();

/** Builds a failed result for the dispatched work. */
function buildFailedResult(code: FailureCode, path: string): TaskWorkResult {
    return { ...DISPATCHED, ok: false, failure: { code, message: "m", path } };
}

describe("getTaskFailure", () => {
    // Proves an output result for the dispatched work isn't a failure.
    test("accepts output for the dispatched work", () => {
        expect(getTaskFailure(step, DISPATCHED, { ...DISPATCHED, ok: true, output: {} })).toBe(
            undefined,
        );
    });

    // Proves a rejected executor and a result for other work are execution errors at the step.
    test("rejects a missing or misidentified result", () => {
        const other: TaskWorkResult = { runId: "run-1", workId: "work-2", ok: true, output: {} };
        for (const result of [undefined, other]) {
            expect(getTaskFailure(step, DISPATCHED, result)).toMatchObject({
                code: "execution_error",
                path: "/steps/1",
                stepId: DIVIDE_STEP,
            });
        }
    });

    // Proves a declared failure is located under the step, and task_error is always allowed.
    test("locates a declared failure under the step", () => {
        expect(
            getTaskFailure(
                step,
                DISPATCHED,
                buildFailedResult("division_by_zero", "/inputs/divisor"),
            ),
        ).toEqual({
            code: "division_by_zero",
            message: "m",
            path: "/steps/1/inputs/divisor",
            stepId: DIVIDE_STEP,
        });
        expect(getTaskFailure(step, DISPATCHED, buildFailedResult("task_error", ""))?.path).toBe(
            "/steps/1",
        );
    });

    // Proves a catalog code divide doesn't declare, or a pointer that isn't relative, isn't trusted.
    test("distrusts undeclared codes and malformed pointers", () => {
        expect(
            getTaskFailure(step, DISPATCHED, buildFailedResult("unknown_operation", ""))?.code,
        ).toBe("execution_error");
        expect(
            getTaskFailure(step, DISPATCHED, buildFailedResult("division_by_zero", "inputs"))?.code,
        ).toBe("execution_error");
    });
});

describe("checkTaskOutput", () => {
    // Proves valid output is committed as a frozen copy detached from the executor's object.
    test("accepts a valid output as an owned frozen copy", () => {
        const returned = { value: 2 };
        const checked = checkTaskOutput(step, returned);
        expect(checked).toEqual({ ok: true, output: { value: 2 } });

        // Changing the returned object later can't reach the committed copy.
        returned.value = 3;
        expect(checked.ok && checked.output.value).toBe(2);
        expect(checked.ok && Object.isFrozen(checked.output)).toBe(true);
    });

    // Proves output that breaks the operation's schema is located at the step's outputs.
    test("rejects output that breaks the operation's schema", () => {
        const checked = checkTaskOutput(step, { value: "2" });
        expect(checked.ok ? undefined : checked.failure).toMatchObject({
            code: "invalid_output",
            path: "/steps/1/outputs/value",
            stepId: DIVIDE_STEP,
        });
    });

    // Proves each declared output is checked against the step's own declaration.
    test("rejects output that breaks a declared output", () => {
        const strict: PreparedTaskStep = {
            ...step,
            declaredOutputs: new Map([
                [
                    "value",
                    (_value, location) => [
                        { code: location.code, message: "m", path: location.path },
                    ],
                ],
            ]),
        };
        const checked = checkTaskOutput(strict, { value: 2 });
        expect(checked.ok ? undefined : checked.failure.path).toBe("/steps/1/outputs/value");
    });

    // Proves output that can't be copied, or isn't an object, fails instead of throwing.
    test("rejects uncopyable and non-object output", () => {
        const uncopyable = { value: () => 1 };
        for (const output of [uncopyable, [1], null]) {
            const checked = checkTaskOutput(step, output);
            expect(checked.ok ? undefined : checked.failure.code).toBe("invalid_output");
        }
    });
});
