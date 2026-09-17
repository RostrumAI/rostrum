import { describe, expect, test } from "bun:test";
import { PublicationCanonicalizer, V1_WORKFLOW_FORMAT_RULE_SET } from "@rostrum/workflow";
import type { JsonObject } from "@rostrum/workflow/execution";
import boundedLoopJson from "@rostrum/workflow/fixtures/valid/bounded-loop.json";
import conditionalBranchingJson from "@rostrum/workflow/fixtures/valid/conditional-branching.json";
import fanOutFanInJson from "@rostrum/workflow/fixtures/valid/fan-out-fan-in.json";
import minimumJson from "@rostrum/workflow/fixtures/valid/minimum.json";
import sequentialJson from "@rostrum/workflow/fixtures/valid/sequential.json";
import {
    type PreparedTaskStep,
    type PublicationContent,
    type WorkflowPreparationResult,
    WorkflowPreparer,
} from "./workflow-preparer";

const WORKFLOW_ID = "0192b0a0-7e1d-7000-8000-000000000001";
const ADD_STEP_ID = "0192b0a0-7e1d-7000-8000-000000000101";
const DIVIDE_STEP_ID = "0192b0a0-7e1d-7000-8000-000000000102";
const RESULT_STEP_ID = "0192b0a0-7e1d-7000-8000-000000000103";

/** The worked example: add amount and surcharge, divide by people, return the total and share. */
const WORKED_EXAMPLE = {
    workflowFormatVersion: "v1",
    id: WORKFLOW_ID,
    name: "Split a total",
    firstNode: ADD_STEP_ID,
    inputs: {
        amount: { type: "number" },
        surcharge: { type: "number" },
        people: { type: "number" },
    },
    steps: [
        {
            id: ADD_STEP_ID,
            type: "task",
            config: { operation: "add" },
            inputs: { left: { ref: "inputs.amount" }, right: { ref: "inputs.surcharge" } },
            outputs: { value: { type: "number" } },
            successors: [DIVIDE_STEP_ID],
        },
        {
            id: DIVIDE_STEP_ID,
            type: "task",
            config: { operation: "divide" },
            inputs: {
                dividend: { ref: `step.${ADD_STEP_ID}.value` },
                divisor: { ref: "inputs.people" },
            },
            outputs: { value: { type: "number" } },
            successors: [RESULT_STEP_ID],
        },
        {
            id: RESULT_STEP_ID,
            type: "result",
            inputs: {
                total: { ref: `step.${ADD_STEP_ID}.value` },
                perPerson: { ref: `step.${DIVIDE_STEP_ID}.value` },
            },
        },
    ],
};

const WORKED_INPUTS: JsonObject = { amount: 90, surcharge: 10, people: 4 };

/** The preparer is stateless once constructed, so one instance serves every case. */
const preparer = new WorkflowPreparer();

/** Canonicalizes a document the way publishing would, and binds it as the selected publication. */
async function publicationOf(document: object, publicationNumber = 1): Promise<PublicationContent> {
    const canonical = await new PublicationCanonicalizer(V1_WORKFLOW_FORMAT_RULE_SET).canonicalize(
        document,
    );
    return {
        binding: {
            workflowId: WORKFLOW_ID,
            publicationNumber,
            workflowFormatVersion: "v1",
            digest: canonical.digest,
        },
        canonicalText: canonical.canonicalText,
    };
}

/** Fails the test unless preparation produced a prepared graph, and narrows to it. */
function expectPrepared(result: WorkflowPreparationResult): {
    prepared: Extract<WorkflowPreparationResult, { ok: true }>["prepared"];
    inputs: JsonObject;
} {
    if (!result.ok) {
        throw new Error(`Expected a prepared workflow but preparation refused: ${result.reason}`);
    }
    return { prepared: result.prepared, inputs: result.inputs };
}

/** Fails the test unless preparation refused, and narrows to the refusal. */
function expectRefused(
    result: WorkflowPreparationResult,
): Extract<WorkflowPreparationResult, { ok: false }> {
    if (result.ok) {
        throw new Error("Expected preparation to refuse the invocation");
    }
    return result;
}

/** Builds a single-task publication whose task step is overridden per case. */
function singleTaskDocument(task: Record<string, unknown>): object {
    return {
        workflowFormatVersion: "v1",
        id: WORKFLOW_ID,
        name: "Single task",
        firstNode: ADD_STEP_ID,
        steps: [
            { id: ADD_STEP_ID, type: "task", ...task, successors: [RESULT_STEP_ID] },
            { id: RESULT_STEP_ID, type: "result", inputs: {} },
        ],
    };
}

describe("workflow preparation", () => {
    test("prepares the worked example into steps, bindings, and accepted inputs", async () => {
        const result = await preparer.prepare(await publicationOf(WORKED_EXAMPLE), WORKED_INPUTS);
        const { prepared, inputs } = expectPrepared(result);

        // The prepared graph names the entry step and keeps every declared step.
        expect(prepared.entryStepId).toBe(ADD_STEP_ID);
        expect([...prepared.steps.keys()]).toEqual([ADD_STEP_ID, DIVIDE_STEP_ID, RESULT_STEP_ID]);
        expect(inputs).toEqual(WORKED_INPUTS);

        // The first step binds its inputs from workflow inputs.
        const addStep = prepared.steps.get(ADD_STEP_ID);
        expect(addStep?.kind).toBe("task");
        expect([...(addStep?.inputs.keys() ?? [])].sort()).toEqual(["left", "right"]);
        expect(addStep?.inputs.get("left")).toEqual({ source: "workflow_input", name: "amount" });
        expect(addStep?.inputs.get("right")).toEqual({
            source: "workflow_input",
            name: "surcharge",
        });
        expect((addStep as PreparedTaskStep).config).toEqual({ operation: "add" });
        expect((addStep as PreparedTaskStep).successors).toEqual([DIVIDE_STEP_ID]);

        // The second step binds one input from an earlier step output and one from a workflow input.
        const divideStep = prepared.steps.get(DIVIDE_STEP_ID);
        expect(divideStep?.inputs.get("dividend")).toEqual({
            source: "step_output",
            stepId: ADD_STEP_ID,
            outputName: "value",
        });
        expect(divideStep?.inputs.get("divisor")).toEqual({
            source: "workflow_input",
            name: "people",
        });

        // The terminal step consumes both task outputs and declares no successors.
        const resultStep = prepared.steps.get(RESULT_STEP_ID);
        expect(resultStep?.kind).toBe("result");
        expect(resultStep?.inputs.get("total")).toEqual({
            source: "step_output",
            stepId: ADD_STEP_ID,
            outputName: "value",
        });
        expect(resultStep?.inputs.get("perPerson")).toEqual({
            source: "step_output",
            stepId: DIVIDE_STEP_ID,
            outputName: "value",
        });
    });

    test("prepares the same graph whatever order the document declares its steps in", async () => {
        const reordered = { ...WORKED_EXAMPLE, steps: [...WORKED_EXAMPLE.steps].reverse() };
        const first = expectPrepared(
            await preparer.prepare(await publicationOf(WORKED_EXAMPLE), WORKED_INPUTS),
        );
        const second = expectPrepared(
            await preparer.prepare(await publicationOf(reordered), WORKED_INPUTS),
        );

        // Execution follows the graph, so declared order changes no binding or successor.
        expect(second.prepared.entryStepId).toBe(first.prepared.entryStepId);
        for (const stepId of first.prepared.steps.keys()) {
            const firstStep = first.prepared.steps.get(stepId);
            const secondStep = second.prepared.steps.get(stepId);
            expect([...(secondStep?.inputs ?? [])]).toEqual([...(firstStep?.inputs ?? [])]);
            expect([...(secondStep?.declaredOutputs.keys() ?? [])]).toEqual([
                ...(firstStep?.declaredOutputs.keys() ?? []),
            ]);
        }
    });

    test("accepts the minimum result-only publication and the greeting publication", async () => {
        const minimum = expectPrepared(
            await preparer.prepare(await publicationOf(minimumJson as object)),
        );
        const greeting = expectPrepared(
            await preparer.prepare(await publicationOf(sequentialJson as object), { name: "Ada" }),
        );

        // The minimum publication has one terminal step and no inputs.
        expect([...minimum.prepared.steps.keys()]).toEqual([minimumJson.firstNode]);
        expect(minimum.prepared.inputChecks.size).toBe(0);
        // The greeting publication prepares its task step against the greet contract.
        const greetStep = greeting.prepared.steps.get(sequentialJson.firstNode) as PreparedTaskStep;
        expect(greetStep.operation.name).toBe("greet");
    });

    test("validates a step's declared output schema against the whole handler output", async () => {
        const { prepared } = expectPrepared(
            await preparer.prepare(await publicationOf(sequentialJson as object), { name: "Ada" }),
        );
        const greetStep = prepared.steps.get(sequentialJson.firstNode) as PreparedTaskStep;
        const declaredOutput = greetStep.declaredOutputs.get("greeting");

        // A declared output accepts the value the operation returns, and rejects a wrong type
        // or an undeclared member, so a handler cannot widen its own contract.
        expect(declaredOutput?.validate("Hello, Ada!").ok).toBe(true);
        expect(declaredOutput?.validate(7)).toMatchObject({ ok: false, code: "invalid_value" });
        expect(greetStep.operation.outputCheck.validate({ greeting: "Hello, Ada!" }).ok).toBe(true);
        expect(greetStep.operation.outputCheck.validate({ greeting: 7 })).toMatchObject({
            ok: false,
            code: "invalid_value",
            path: "/greeting",
        });
        expect(greetStep.operation.outputCheck.validate({ other: "x" })).toMatchObject({
            ok: false,
            code: "invalid_value",
        });
    });

    test("accepts an optional operation input that is omitted and validates every declared input", async () => {
        const { prepared } = expectPrepared(
            await preparer.prepare(await publicationOf(WORKED_EXAMPLE), WORKED_INPUTS),
        );
        const addStep = prepared.steps.get(ADD_STEP_ID) as PreparedTaskStep;

        // `add` requires `left` but accepts an omitted `right`; unknown members stay rejected.
        expect(addStep.operation.inputCheck.validate({ left: 1 }).ok).toBe(true);
        expect(addStep.operation.inputCheck.validate({ right: 1 })).toMatchObject({ ok: false });
        expect(addStep.operation.inputCheck.validate({ left: 1, extra: 2 })).toMatchObject({
            ok: false,
        });
    });

    test("owns the accepted inputs so a caller cannot change an accepted run", async () => {
        const supplied: JsonObject = { amount: 90, surcharge: 10, people: 4, note: "x" };
        const document = {
            ...WORKED_EXAMPLE,
            inputs: { ...WORKED_EXAMPLE.inputs, note: { type: "string" } },
        };
        const { inputs } = expectPrepared(
            await preparer.prepare(await publicationOf(document), supplied),
        );

        // The run keeps its own frozen copy: later caller mutation is not observable.
        expect(Object.isFrozen(inputs)).toBe(true);
        expect(inputs).not.toBe(supplied);
    });

    test("refuses a publication whose declared steps this release cannot execute", async () => {
        const boundedLoop = expectRefused(
            await preparer.prepare(await publicationOf(boundedLoopJson as object)),
        );
        const conditional = expectRefused(
            await preparer.prepare(await publicationOf(conditionalBranchingJson as object)),
        );
        const fanOut = expectRefused(
            await preparer.prepare(await publicationOf(fanOutFanInJson as object)),
        );

        // Loops and conditionals are later Epics; fan-out has no sequential meaning.
        const codes = (result: typeof boundedLoop) =>
            result.failures.map((failure) => failure.code);
        expect(boundedLoop.reason).toBe("unsupported_execution");
        expect(codes(boundedLoop)).toContain("unsupported_control_flow");
        expect(codes(conditional)).toContain("unsupported_control_flow");
        expect(codes(fanOut)).toContain("unsupported_control_flow");
        // Every refusal names the step it belongs to.
        expect(boundedLoop.failures.some((failure) => failure.path.startsWith("/steps/"))).toBe(
            true,
        );
    });

    test("refuses a task step whose configuration this release does not declare", async () => {
        const unknownOperation = expectRefused(
            await preparer.prepare(
                await publicationOf(singleTaskDocument({ config: { operation: "noop" } })),
            ),
        );
        const extraConfig = expectRefused(
            await preparer.prepare(
                await publicationOf(
                    singleTaskDocument({ config: { operation: "add", retries: 2 } }),
                ),
            ),
        );
        const inheritedName = expectRefused(
            await preparer.prepare(
                await publicationOf(singleTaskDocument({ config: { operation: "constructor" } })),
            ),
        );

        // An unknown operation, an undeclared configuration member, and a
        // prototype-sensitive name all refuse, each at the member at fault.
        expect(unknownOperation.reason).toBe("unsupported_execution");
        expect(unknownOperation.failures[0]).toMatchObject({
            code: "unsupported_step_config",
            path: "/steps/0/config/operation",
        });
        expect(extraConfig.failures[0]).toMatchObject({
            code: "unsupported_step_config",
            path: "/steps/0/config/retries",
        });
        expect(inheritedName.failures[0]).toMatchObject({
            code: "unsupported_step_config",
            path: "/steps/0/config/operation",
        });
    });

    test("refuses a result step that declares successors or configuration", async () => {
        const withSuccessor = expectRefused(
            await preparer.prepare(
                await publicationOf({
                    workflowFormatVersion: "v1",
                    id: WORKFLOW_ID,
                    name: "Result with successor",
                    firstNode: RESULT_STEP_ID,
                    steps: [
                        {
                            id: RESULT_STEP_ID,
                            type: "result",
                            inputs: {},
                            successors: [ADD_STEP_ID],
                        },
                        { id: ADD_STEP_ID, type: "result", inputs: {} },
                    ],
                }),
            ),
        );
        const withConfig = expectRefused(
            await preparer.prepare(
                await publicationOf({
                    workflowFormatVersion: "v1",
                    id: WORKFLOW_ID,
                    name: "Result with config",
                    firstNode: RESULT_STEP_ID,
                    steps: [{ id: RESULT_STEP_ID, type: "result", config: { mode: "x" } }],
                }),
            ),
        );

        // The daemon completes the result step itself, so it cannot route onward or take configuration.
        expect(withSuccessor.failures[0]?.code).toBe("unsupported_control_flow");
        expect(withConfig.failures[0]?.code).toBe("unsupported_step_config");
    });

    test("refuses an invocation whose inputs do not satisfy the declared inputs", async () => {
        const publication = await publicationOf(WORKED_EXAMPLE);
        const missing = expectRefused(await preparer.prepare(publication, { amount: 90 }));
        const undeclared = expectRefused(
            await preparer.prepare(publication, { ...WORKED_INPUTS, extra: 1 }),
        );
        const wrongType = expectRefused(
            await preparer.prepare(publication, { amount: "90", surcharge: 10, people: 4 }),
        );

        // Each input problem keeps its own code and its own location in the supplied inputs.
        expect(missing.reason).toBe("invalid_inputs");
        expect(missing.failures.map((failure) => [failure.code, failure.path]).sort()).toEqual([
            ["missing_input", "/people"],
            ["missing_input", "/surcharge"],
        ]);
        expect(undeclared.failures).toEqual([
            expect.objectContaining({ code: "undeclared_input", path: "/extra" }),
        ]);
        expect(wrongType.failures).toEqual([
            expect.objectContaining({ code: "invalid_input", path: "/amount" }),
        ]);
    });

    test("treats an absent input and a null input differently", async () => {
        const document = {
            ...WORKED_EXAMPLE,
            inputs: { ...WORKED_EXAMPLE.inputs, note: { type: "string" } },
        };
        const publication = await publicationOf(document);
        const absent = expectRefused(
            await preparer.prepare(publication, { ...WORKED_INPUTS, note: null }),
        );
        const present = expectPrepared(
            await preparer.prepare(publication, { ...WORKED_INPUTS, note: "x" }),
        );

        // `null` is a supplied value that must satisfy the schema; absence is a missing input.
        expect(absent.failures[0]).toMatchObject({ code: "invalid_input", path: "/note" });
        expect(present.inputs.note).toBe("x");
    });

    test("refuses stored content that does not parse or does not validate", async () => {
        const binding = (await publicationOf(WORKED_EXAMPLE)).binding;
        const unparseable = expectRefused(await preparer.prepare({ binding, canonicalText: "{" }));
        const invalid = expectRefused(
            await preparer.prepare({
                binding,
                canonicalText: JSON.stringify({ workflowFormatVersion: "v1" }),
            }),
        );

        // Corrupt storage is reported as such, and no run state is created from it.
        expect(unparseable.reason).toBe("corrupt_publication");
        expect(unparseable.failures[0]?.code).toBe("invalid_document");
        expect(invalid.reason).toBe("corrupt_publication");
    });

    test("bounds the failures one refusal reports", async () => {
        // Every step names a successor that does not exist, which reports one
        // finding per step rather than a capped batch of shape findings.
        const steps = Array.from({ length: 40 }, (_, index) => ({
            id: `0192b0a0-7e1d-7000-8000-${String(index + 200).padStart(12, "0")}`,
            type: "task",
            config: { operation: "add" },
            successors: ["0192b0a0-7e1d-7000-8000-000000009999"],
        }));
        const refused = expectRefused(
            await preparer.prepare(
                await publicationOf({
                    workflowFormatVersion: "v1",
                    id: WORKFLOW_ID,
                    name: "Dangling successors",
                    firstNode: steps[0]?.id,
                    steps,
                }),
            ),
        );

        // A document with far more findings than the cap reports a bounded list
        // and says that further failures were omitted.
        expect(refused.reason).toBe("corrupt_publication");
        expect(refused.failures.length).toBeLessThanOrEqual(33);
        expect(refused.failures.at(-1)?.message).toMatch(/further failures omitted$/);
    });

    test("refuses a declared schema this release cannot prepare", async () => {
        const refused = expectRefused(
            await preparer.prepare(
                await publicationOf({
                    workflowFormatVersion: "v1",
                    id: WORKFLOW_ID,
                    name: "Unusable schema",
                    firstNode: ADD_STEP_ID,
                    steps: [
                        {
                            id: ADD_STEP_ID,
                            type: "task",
                            config: { operation: "add" },
                            inputs: {},
                            outputs: { value: { type: 5 } },
                            successors: [RESULT_STEP_ID],
                        },
                        { id: RESULT_STEP_ID, type: "result", inputs: {} },
                    ],
                }),
            ),
        );

        // A published document may carry a malformed value schema; execution refuses it
        // and names the declared output instead of running with weaker validation.
        expect(refused.reason).toBe("unsupported_execution");
        expect(refused.failures[0]).toMatchObject({
            code: "invalid_schema",
            path: "/steps/0/outputs/value/type",
        });
    });
});
