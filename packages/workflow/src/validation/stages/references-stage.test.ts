import { describe, expect, test } from "bun:test";
import {
    buildDocument,
    resultStep,
    taskLoopStep,
    taskStep,
} from "../../../tests/helpers/documents";
import { V1_RULE_SET } from "../../rules/v1";
import { ValidationContext } from "../validation-context";
import { ReferencesStage } from "./references-stage";

const stage = new ReferencesStage();

function run(document: unknown) {
    const context = new ValidationContext(document, null);
    context.selectRuleSet(V1_RULE_SET);
    return stage.run(context);
}

function codesFor(document: unknown): string[] {
    return run(document).map((finding) => finding.code);
}

describe("ReferencesStage", () => {
    test("accepts the sequential reference pattern", () => {
        const task = taskStep({
            inputs: { name: { ref: "inputs.name" } },
            outputs: { greeting: { type: "string" } },
        });
        const end = resultStep({ inputs: { greeting: { ref: `step.${task.id}.greeting` } } });
        task.successors = [end.id];
        const document = buildDocument({
            steps: [task, end],
            firstNode: task.id,
            inputs: { name: { type: "string" } },
        });
        expect(run(document)).toEqual([]);
    });

    test("reports an unknown workflow input", () => {
        const task = taskStep({ inputs: { name: { ref: "inputs.missing" } } });
        const document = buildDocument({ steps: [task, resultStep()], firstNode: task.id });
        const finding = run(document).find(
            (candidate) => candidate.code === "workflow.reference.unknown-input",
        );
        expect(finding?.path).toBe("/steps/0/inputs/name");
        expect(finding?.details).toEqual({
            stepId: task.id,
            ref: "inputs.missing",
            input: "missing",
        });
    });

    test("reports unknown steps and bad syntax", () => {
        const missing = "0192b0a0-7e1d-7000-8000-000000000099";
        const consumer = taskStep({
            inputs: {
                a: { ref: `step.${missing}.out` },
                b: { ref: "step.not-a-uuid.out" },
                c: { ref: "workflow.name" },
                d: { ref: "inputs" },
            },
        });
        const document = buildDocument({ steps: [consumer, resultStep()], firstNode: consumer.id });
        const codes = codesFor(document);
        expect(codes).toContain("workflow.reference.unknown-step");
        expect(codes).toContain("workflow.reference.invalid-syntax");
    });

    test("reports an undeclared output but resolves the reserved loop results output", () => {
        const bodyTerminal = taskStep({ successors: [] });
        const consumer = taskStep({
            inputs: {
                good: { ref: "step.LOOP.results" },
                bad: { ref: "step.LOOP.resultz" },
            },
            successors: [],
        });
        const loop = taskLoopStep(
            {
                collection: { ref: "inputs.f" },
                maxIterations: 5,
                variable: "v",
                body: bodyTerminal.id,
            },
            { successors: [consumer.id] },
        );
        consumer.inputs = {
            good: { ref: `step.${loop.id}.results` },
            bad: { ref: `step.${loop.id}.resultz` },
        };
        const document = buildDocument({
            steps: [loop, bodyTerminal, consumer],
            firstNode: loop.id,
            inputs: { f: { type: "array" } },
        });
        const findings = run(document);
        const undeclared = findings.find(
            (candidate) => candidate.code === "workflow.reference.unknown-output",
        );
        expect(undeclared?.details).toEqual({
            stepId: consumer.id,
            ref: `step.${loop.id}.resultz`,
            targetStep: loop.id,
            output: "resultz",
        });
        expect(findings.every((finding) => finding.details?.output !== "results")).toBe(true);
    });

    test("reports a self-reference in step inputs", () => {
        const id = "0192b0a0-7e1d-7000-8000-000000000001";
        const step = taskStep({ id, inputs: { own: { ref: `step.${id}.out` } } });
        const document = buildDocument({ steps: [step, resultStep()], firstNode: step.id });
        expect(codesFor(document)).toContain("workflow.reference.not-upstream");
    });

    test("reports a reference to a downstream step", () => {
        const upstream = taskStep();
        const downstream = taskStep({
            inputs: { back: { ref: `step.${upstream.id}.out` } },
            successors: [],
        });
        const document = buildDocument({
            steps: [downstream, upstream],
            firstNode: downstream.id,
        });
        expect(codesFor(document)).toContain("workflow.reference.not-upstream");
    });

    test("accepts transitive upstream references and dependency joins", () => {
        const a = taskStep();
        const b = taskStep({ successors: [] });
        const c = taskStep({ inputs: { fromA: { ref: `step.${a.id}.out` } }, successors: [] });
        a.successors = [b.id];
        b.successors = [c.id];
        const join = taskStep({
            dependencies: [a.id],
            inputs: { alsoFromA: { ref: `step.${a.id}.out` } },
            successors: [],
        });
        const document = buildDocument({
            steps: [join, a, b, c, resultStep()],
            firstNode: a.id,
        });
        expect(
            run(document).every((finding) => finding.code !== "workflow.reference.not-upstream"),
        ).toBe(true);
    });

    test("accepts a post-loop successor consuming a body member output", () => {
        const bodyTerminal = taskStep({ successors: [] });
        const after = taskStep({ successors: [] });
        const loop = taskLoopStep(
            {
                collection: { ref: "inputs.f" },
                maxIterations: 5,
                variable: "v",
                body: bodyTerminal.id,
            },
            { successors: [after.id] },
        );
        after.inputs = { collected: { ref: `step.${loop.id}.results` } };
        const document = buildDocument({
            steps: [loop, bodyTerminal, after, resultStep()],
            firstNode: loop.id,
            inputs: { f: { type: "array" } },
        });
        expect(codesFor(document)).toEqual([]);
    });

    test("rejects a loop step consuming its own body member output in inputs", () => {
        const bodyTerminal = taskStep({ successors: [] });
        const after = resultStep();
        const loop = taskLoopStep(
            {
                collection: { ref: "inputs.f" },
                maxIterations: 5,
                variable: "v",
                body: bodyTerminal.id,
            },
            { inputs: { stolen: { ref: `step.${bodyTerminal.id}.out` } }, successors: [after.id] },
        );
        const document = buildDocument({
            steps: [loop, bodyTerminal, after],
            firstNode: loop.id,
            inputs: { f: { type: "array" } },
        });
        expect(codesFor(document)).toContain("workflow.reference.not-upstream");
    });

    test("allows the collection to name the loop step itself but not a body member", () => {
        const bodyTerminal = taskStep({ successors: [] });
        const after = resultStep();
        const loop = taskLoopStep(
            {
                collection: { ref: "inputs.f" },
                maxIterations: 5,
                variable: "v",
                body: bodyTerminal.id,
            },
            { successors: [after.id] },
        );
        const document = buildDocument({
            steps: [loop, bodyTerminal, after],
            firstNode: loop.id,
            inputs: { f: { type: "array" } },
        });
        expect(codesFor(document)).toEqual([]);

        const loopField = loop.loop;
        if (loopField) loopField.collection = { ref: `step.${bodyTerminal.id}.out` };
        expect(codesFor(document)).toContain("workflow.reference.not-upstream");
    });

    test("checks loop variable scope", () => {
        const bodyStep = taskStep({ inputs: { good: { ref: "loop.file" } }, successors: [] });
        const after = taskStep({ inputs: { bad: { ref: "loop.file" } }, successors: [] });
        const loop = taskLoopStep(
            {
                collection: { ref: "inputs.f" },
                maxIterations: 5,
                variable: "file",
                body: bodyStep.id,
            },
            { successors: [after.id] },
        );
        const document = buildDocument({
            steps: [loop, bodyStep, after, resultStep()],
            firstNode: loop.id,
            inputs: { f: { type: "array" } },
        });
        const finding = run(document).find(
            (candidate) => candidate.code === "workflow.reference.loop-out-of-scope",
        );
        expect(finding?.path).toBe("/steps/2/inputs/bad");
        expect(finding?.details).toEqual({ stepId: after.id, ref: "loop.file", available: null });
    });

    test("treats objects with more than a ref key as literals", () => {
        const step = taskStep({ inputs: { literal: { ref: "not/a/ref", extra: 1 } } });
        const document = buildDocument({ steps: [step, resultStep()], firstNode: step.id });
        expect(codesFor(document)).toEqual([]);
    });
});
