import { describe, expect, test } from "bun:test";
import { type WorkflowDocument, WorkflowDocumentSchema } from "@rostrum/workflow";
import type { ExecutionFailure, RunPublication } from "@rostrum/workflow/execution";
import conditionalJson from "@rostrum/workflow/fixtures/valid/conditional-branching.json";
import calculationJson from "@rostrum/workflow/fixtures/valid/sequential-calculation.json";
import { Compile } from "typebox/compile";
import {
    checkIdentity,
    checkShape,
    checkStructure,
    checkSupportedSteps,
} from "./publication-checks";

/** The calculation fixture's step IDs: the addition, the division, and the result. */
const ADD_STEP = "0192b0a0-7e1d-7000-8000-000000000101";
const DIVIDE_STEP = "0192b0a0-7e1d-7000-8000-000000000102";
const RESULT_STEP = "0192b0a0-7e1d-7000-8000-000000000103";

/** Checks that a value has the workflow document shape. */
const DOCUMENT_SHAPE = Compile(WorkflowDocumentSchema);

/** Returns a deep copy of a fixture, checked as a document, to modify for one test. */
function copyFixture(fixture: unknown): WorkflowDocument {
    const copy: unknown = structuredClone(fixture);
    if (!DOCUMENT_SHAPE.Check(copy)) {
        throw new Error("The fixture isn't a workflow document");
    }
    return copy;
}

/** Reduces failures to `[code, path]` pairs, the part each case asserts. */
function summarize(failures: ExecutionFailure[]) {
    return failures.map((failure) => [failure.code, failure.path]);
}

describe("checkShape", () => {
    // Proves a valid v1 document passes the shape check.
    test("accepts a v1 document", () => {
        expect(checkShape(copyFixture(calculationJson))).toEqual([]);
    });

    // Proves another format is refused on its own, without reporting the rest of its shape.
    test("refuses another format alone", () => {
        const document = { ...copyFixture(calculationJson), workflowFormatVersion: "v2", steps: 1 };
        expect(summarize(checkShape(document))).toEqual([
            ["unsupported_format", "/workflowFormatVersion"],
        ]);
    });

    // Proves each shape error is located, including a document that isn't an object.
    test("locates shape errors", () => {
        expect(
            summarize(checkShape({ ...copyFixture(calculationJson), steps: [] })),
        ).toContainEqual(["invalid_document", "/steps"]);
        expect(summarize(checkShape(null))).toEqual([["invalid_document", ""]]);
    });
});

describe("checkIdentity", () => {
    /** The publication the calculation fixture was stored as. */
    const publication: RunPublication = {
        workflowId: calculationJson.id,
        publicationNumber: 1,
        workflowFormatVersion: "v1",
        digest: "0".repeat(64),
    };

    // Proves the document the run recorded passes.
    test("accepts the recorded workflow", () => {
        expect(checkIdentity(copyFixture(calculationJson), publication)).toEqual([]);
    });

    // Proves a different workflow or format than the run recorded is a mismatch.
    test("reports a different workflow and format", () => {
        const failures = checkIdentity(copyFixture(conditionalJson), {
            ...publication,
            workflowFormatVersion: "v2",
        });
        expect(summarize(failures)).toEqual([
            ["publication_mismatch", "/id"],
            ["publication_mismatch", "/workflowFormatVersion"],
        ]);
    });
});

describe("checkStructure", () => {
    // Proves a well-linked document passes.
    test("accepts consistent links", () => {
        expect(checkStructure(copyFixture(calculationJson))).toEqual([]);
    });

    // Proves duplicate IDs, a missing entry step, and dangling links are each located.
    test("reports every broken link", () => {
        // Repeat the add step's ID, point the entry nowhere, and link to a missing step.
        const document = copyFixture(calculationJson);
        const [first, second] = document.steps;
        const missing = "0192b0a0-7e1d-7000-8000-0000000001ff";
        if (!first || !second) {
            throw new Error("The calculation fixture has three steps");
        }
        second.id = ADD_STEP;
        first.dependencies = [missing];
        document.firstNode = missing;

        // The add step's successor was the renamed division, so that link dangles too.
        expect(summarize(checkStructure(document))).toEqual([
            ["invalid_document", "/steps/1/id"],
            ["invalid_document", "/firstNode"],
            ["invalid_document", "/steps/0/successors/0"],
            ["invalid_document", "/steps/0/dependencies/0"],
        ]);
    });
});

describe("checkSupportedSteps", () => {
    // Proves a sequential task-and-result workflow is supported.
    test("accepts a sequential workflow", () => {
        expect(checkSupportedSteps(copyFixture(calculationJson))).toEqual([]);
    });

    // Proves conditionals are refused at the document and at the routed step.
    test("refuses conditionals", () => {
        expect(summarize(checkSupportedSteps(copyFixture(conditionalJson)))).toEqual([
            ["unsupported_control_flow", "/conditionals"],
            ["unsupported_control_flow", "/steps/0/conditional"],
        ]);
    });

    // Proves loops and two distinct successors are refused at the member responsible.
    test("refuses loops and parallel successors", () => {
        const document = copyFixture(calculationJson);
        const [first, second] = document.steps;
        if (!first || !second) {
            throw new Error("The calculation fixture has three steps");
        }
        first.successors = [DIVIDE_STEP, RESULT_STEP];
        second.loop = {
            collection: { ref: "inputs.people" },
            maxIterations: 2,
            variable: "person",
            body: DIVIDE_STEP,
        };
        expect(summarize(checkSupportedSteps(document))).toEqual([
            ["unsupported_control_flow", "/steps/0/successors"],
            ["unsupported_control_flow", "/steps/1/loop"],
        ]);
    });

    // Proves repeating the same successor is still one path, not parallel work.
    test("accepts a repeated successor", () => {
        const document = copyFixture(calculationJson);
        const [first] = document.steps;
        if (first) {
            first.successors = [DIVIDE_STEP, DIVIDE_STEP];
        }
        expect(checkSupportedSteps(document)).toEqual([]);
    });

    // Proves unknown step types, a configured result step, and self-dependency are refused.
    test("refuses unsupported steps", () => {
        const document = copyFixture(calculationJson);
        const [first, second, third] = document.steps;
        if (!first || !second || !third) {
            throw new Error("The calculation fixture has three steps");
        }
        first.dependencies = [ADD_STEP];
        second.type = "approval";
        third.config = { format: "table" };

        // Each failure names the step it belongs to.
        const failures = checkSupportedSteps(document);
        expect(summarize(failures)).toEqual([
            ["self_dependency", "/steps/0/dependencies/0"],
            ["unsupported_step_type", "/steps/1/type"],
            ["invalid_config", "/steps/2/config"],
        ]);
        expect(failures.map((failure) => failure.stepId)).toEqual([
            ADD_STEP,
            DIVIDE_STEP,
            RESULT_STEP,
        ]);
    });
});
