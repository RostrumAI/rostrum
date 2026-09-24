import { describe, expect, test } from "bun:test";
import { OPERATION_CATALOG } from "../../operations/operation-catalog";
import type { WorkflowDocument } from "../../schema";
import { buildDocument, conditional, resultStep, taskStep } from "../../testing/documents";
import { ValidationContext } from "../validation-context";
import { InputOutputCompatibilityStage } from "./input-output-compatibility-stage";

/** Runs stage 8 over a document with the release catalog. */
function findingsOf(document: WorkflowDocument) {
    return new InputOutputCompatibilityStage(OPERATION_CATALOG).run(
        new ValidationContext(document, null),
    );
}

describe("InputOutputCompatibilityStage", () => {
    // Proves a publication whose bindings all fit their operations passes stage 8.
    test("a compatible document has no findings", () => {
        const end = resultStep();
        const task = taskStep({ successors: [end.id] });
        expect(findingsOf(buildDocument({ steps: [task, end], firstNode: task.id }))).toEqual([]);
    });

    // Proves each static compatibility issue blocks publication under its own finding code.
    test("reports every issue with its finding code and location", () => {
        // One document with an unknown operation, a bad default, an undeclared output, and bad bindings.
        const end = resultStep();
        const unknown = taskStep({ config: { operation: "threshold" }, inputs: {} });
        const add = taskStep({
            config: { operation: "add" },
            inputs: { left: "1", extra: 2 },
            outputs: { sum: { type: "number" } },
        });
        const divide = taskStep({ config: { operation: "divide" }, inputs: { dividend: 1 } });
        const greet = taskStep({ outputs: { greeting: { type: "string" } } });
        const routing = conditional({
            dependencies: [greet.id],
            branches: [
                {
                    label: "only",
                    priority: 0,
                    condition: { ref: `step.${greet.id}.greeting`, op: "gt", value: 5 },
                    next: end.id,
                },
            ],
            default: { label: "fallback", next: end.id },
        });
        unknown.successors = [add.id];
        add.successors = [divide.id];
        divide.successors = [greet.id];
        greet.conditional = routing.id;
        const document = buildDocument({
            steps: [unknown, add, divide, greet, end],
            firstNode: unknown.id,
            conditionals: [routing],
            inputs: { amount: { schema: { type: "number" }, default: "ten" } },
        });

        // Each issue kind surfaces as its publication finding code, at the issue's pointer.
        expect(findingsOf(document).map((finding) => [finding.code, finding.path])).toEqual([
            ["workflow.io.invalid-default", "/inputs/amount/default"],
            ["workflow.operation.unknown", "/steps/0/config/operation"],
            ["workflow.io.undeclared-output", "/steps/1/outputs/sum"],
            ["workflow.io.type-mismatch", "/steps/1/inputs/left"],
            ["workflow.io.undeclared-argument", "/steps/1/inputs/extra"],
            ["workflow.io.missing-argument", "/steps/2/inputs"],
            ["workflow.condition.operand-mismatch", "/conditionals/0/branches/0/condition"],
        ]);
    });

    // Proves the structured details an automated author repairs from reach the finding.
    test("carries the issue's details onto the finding", () => {
        const end = resultStep();
        const task = taskStep({ inputs: { name: 1 }, successors: [end.id] });
        const [finding] = findingsOf(buildDocument({ steps: [task, end], firstNode: task.id }));
        expect(finding?.details).toEqual({ stepId: task.id, argument: "name", keyword: "type" });
    });
});
