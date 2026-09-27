/**
 * @fileoverview Tests the shape validation stage, which checks a document
 * against the v1 workflow document schema and maps each schema error to a
 * stable `workflow.shape.*` finding code. Later stages rely on this stage to
 * prove the document's structure, including the `{ schema, default? }` form
 * of workflow input declarations.
 *
 * ShapeStage:
 * - accepts a shape-valid document: no findings.
 * - maps a missing required field to a blocking
 *   `workflow.shape.required-field` with keyword and schema path details.
 * - maps an unknown top-level member to `workflow.shape.unknown-field`.
 * - maps a malformed UUID in `firstNode` to `workflow.shape.format`.
 * - maps an empty `steps` array to `workflow.shape.constraint`.
 * - maps a wrong value type to `workflow.shape.type`.
 * - maps `maxIterations` below one to `workflow.shape.constraint` at the
 *   loop's `maxIterations` pointer.
 */
import { describe, expect, test } from "bun:test";
import { V1_WORKFLOW_FORMAT_RULE_SET } from "../../rules/v1";
import { buildDocument, resultStep, taskStep } from "../../testing/documents";
import { ValidationContext } from "../validation-context";
import { ShapeStage } from "./shape-stage";

const stage = new ShapeStage(V1_WORKFLOW_FORMAT_RULE_SET.documentSchema);

function run(document: unknown) {
    return stage.run(new ValidationContext(document, null));
}

describe("ShapeStage", () => {
    test("accepts a shape-valid document", () => {
        expect(run(buildDocument())).toEqual([]);
    });

    test("maps a missing required field to workflow.shape.required-field", () => {
        const document = buildDocument() as Record<string, unknown>;
        delete document.firstNode;
        const findings = run(document);
        const finding = findings.find((candidate) => candidate.path === "/firstNode");
        expect(finding?.code).toBe("workflow.shape.required-field");
        expect(finding?.blocking).toBe(true);
        expect(finding?.details?.keyword).toBe("required");
        expect(finding?.details?.schemaPath).toBeTypeOf("string");
    });

    test("maps an unknown member to workflow.shape.unknown-field", () => {
        const document = { ...buildDocument(), revisions: 3 };
        const findings = run(document);
        expect(findings.some((finding) => finding.code === "workflow.shape.unknown-field")).toBe(
            true,
        );
    });

    test("maps a malformed UUID to workflow.shape.format", () => {
        const document = buildDocument({ firstNode: "not-a-uuid" });
        const findings = run(document);
        expect(
            findings.some(
                (finding) =>
                    finding.code === "workflow.shape.format" && finding.path === "/firstNode",
            ),
        ).toBe(true);
    });

    test("maps an empty steps array to workflow.shape.constraint", () => {
        const findings = run(buildDocument({ steps: [] }));
        expect(
            findings.some(
                (finding) =>
                    finding.code === "workflow.shape.constraint" && finding.path === "/steps",
            ),
        ).toBe(true);
    });

    test("maps a wrong value type to workflow.shape.type", () => {
        const document = buildDocument({ steps: [taskStep({ id: 7 as unknown as string })] });
        expect(run(document).some((finding) => finding.code === "workflow.shape.type")).toBe(true);
    });

    test("maps maxIterations below one to workflow.shape.constraint", () => {
        const step = resultStep();
        const looper = taskStep({
            loop: {
                collection: { ref: "inputs.files" },
                maxIterations: 0,
                variable: "f",
                body: step.id,
            },
        });
        const document = buildDocument({
            steps: [looper, step],
            inputs: { files: { schema: { type: "array" } } },
        });
        const findings = run(document);
        expect(
            findings.some(
                (finding) =>
                    finding.code === "workflow.shape.constraint" &&
                    finding.path === "/steps/0/loop/maxIterations",
            ),
        ).toBe(true);
    });
});
