/**
 * @fileoverview Tests the static compatibility check that publication and
 * daemon preparation both run. Each issue it reports blocks a publication,
 * so each kind must appear at the right JSON Pointer and only when the
 * document is actually wrong.
 *
 * operations and configuration:
 * - An unknown operation is reported at `config/operation` with the sorted supported names.
 * - A task with no config is reported at the step as naming no operation.
 * - A non-string operation is reported at `config/operation` with the supplied value.
 * - A config member the operation doesn't declare is located at that member.
 *
 * declared schemas and defaults:
 * - Malformed input and output schemas are located at the offending keyword.
 * - A remote `$ref` and a lookbehind pattern are invalid schemas; a root `$ref: "#"` is valid.
 * - Defaults that fail their schema are reported, on workflow inputs and on catalog arguments.
 * - An explicit `null` default is checked like any other value.
 *
 * arguments and declared outputs:
 * - An unbound required argument is reported at `inputs`, or at the step when `inputs` is absent;
 *   an unbound argument with a default is not.
 * - A binding for an undeclared argument is reported at the binding.
 * - A task output its operation doesn't always return, and any result step output, is undeclared.
 * - A loop step may declare its reserved `results` output, which its operation never returns.
 *
 * literal bindings:
 * - A literal is validated against the argument's full schema.
 * - A reference binding is not checked as a literal.
 *
 * issue attribution:
 * - Step-level issues carry the step id in `stepId` and `details`; workflow-level ones carry none.
 */
import { describe, expect, test } from "bun:test";
import { Type } from "typebox";
import { createDeclaredSchemaCompiler } from "../declared-schemas/declared-schema-compiler";
import {
    OPERATION_CATALOG,
    type OperationCatalog,
    type OperationDeclaration,
} from "../operations/operation-catalog";
import type { WorkflowDocument } from "../schema";
import { buildDocument, resultStep, taskLoopStep, taskStep } from "../testing/documents";
import { checkStaticCompatibility } from "./static-compatibility-check";

/** An operation whose declared default violates its own argument schema. */
const BROKEN_DEFAULT: OperationDeclaration = {
    name: "broken-default",
    configSchema: Type.Object({}, { additionalProperties: false }),
    arguments: { count: { schema: Type.Integer(), default: 0.5 } },
    outputSchema: Type.Object({ count: Type.Integer() }, { additionalProperties: false }),
    failureCodes: [],
};

/** The release catalog plus the test-only operation above. */
const TEST_CATALOG: OperationCatalog = new Map([
    ...OPERATION_CATALOG,
    [BROKEN_DEFAULT.name, BROKEN_DEFAULT],
]);

/** Runs the check over a document and returns `[kind, path]` pairs. */
function checkDocument(document: WorkflowDocument, catalog: OperationCatalog = TEST_CATALOG) {
    return checkStaticCompatibility(document, catalog, createDeclaredSchemaCompiler()).map(
        (issue) => [issue.kind, issue.path],
    );
}

/** Builds a task followed by a result step, the smallest document a task can appear in. */
function buildSingleTaskDocument(
    task: ReturnType<typeof taskStep>,
    overrides: Partial<WorkflowDocument> = {},
) {
    const end = resultStep();
    task.successors = [end.id];
    return buildDocument({ steps: [task, end], firstNode: task.id, ...overrides });
}

describe("operations and configuration", () => {
    // Proves a task naming an operation outside the catalog is reported with the supported names.
    test("an unknown operation", () => {
        const task = taskStep({ config: { operation: "threshold" }, inputs: {} });
        const [issue] = checkStaticCompatibility(
            buildSingleTaskDocument(task),
            OPERATION_CATALOG,
            createDeclaredSchemaCompiler(),
        );

        // The issue sits at the operation name and lists what the author could use instead.
        expect(issue?.kind).toBe("unknown-operation");
        expect(issue?.path).toBe("/steps/0/config/operation");
        expect(issue?.details).toEqual({
            stepId: task.id,
            operation: "threshold",
            supported: ["add", "divide", "greet"],
        });
    });

    // Proves a task with no configuration at all names no operation.
    test("a task without an operation", () => {
        const document = buildSingleTaskDocument(taskStep({ config: undefined, inputs: {} }));
        expect(checkDocument(document)).toEqual([["unknown-operation", "/steps/0"]]);
    });

    // Proves a present but non-string operation is located at the member and keeps its value.
    test("a non-string operation", () => {
        const task = taskStep({ config: { operation: 42 }, inputs: {} });
        const [issue] = checkStaticCompatibility(
            buildSingleTaskDocument(task),
            OPERATION_CATALOG,
            createDeclaredSchemaCompiler(),
        );

        // The issue points at the member the author wrote and echoes what was supplied.
        expect(issue?.kind).toBe("unknown-operation");
        expect(issue?.path).toBe("/steps/0/config/operation");
        expect(issue?.message).toBe("The task's operation must be a string");
        expect(issue?.details).toEqual({
            stepId: task.id,
            operation: 42,
            supported: ["add", "divide", "greet"],
        });
    });

    // Proves an explicit null operation is a present member, not an absent one.
    test("a null operation", () => {
        const document = buildSingleTaskDocument(
            taskStep({ config: { operation: null }, inputs: {} }),
        );
        expect(checkDocument(document)).toEqual([
            ["unknown-operation", "/steps/0/config/operation"],
        ]);
    });

    // Proves configuration members the operation doesn't declare are located individually.
    test("invalid configuration", () => {
        const document = buildSingleTaskDocument(
            taskStep({ config: { operation: "add", precision: 2 }, inputs: { left: 1 } }),
        );
        expect(checkDocument(document)).toEqual([["invalid-config", "/steps/0/config/precision"]]);
    });
});

describe("declared schemas and defaults", () => {
    // Proves malformed input and output declarations are located inside the schema.
    test("invalid declarations", () => {
        const task = taskStep({ outputs: { greeting: { type: "strng" } } });
        const document = buildSingleTaskDocument(task, {
            inputs: { amount: { schema: { type: "number", minimum: "zero" } } },
        });
        expect(checkDocument(document)).toEqual([
            ["invalid-schema", "/inputs/amount/schema/minimum"],
            ["invalid-schema", "/steps/0/outputs/greeting/type"],
        ]);
    });

    // Proves references that leave the schema, and patterns a linear-time engine refuses, are invalid.
    test("unresolved references and unsupported patterns are invalid declarations", () => {
        const document = buildSingleTaskDocument(taskStep(), {
            inputs: {
                remote: { schema: { $ref: "https://example.com/schema.json" } },
                lookbehind: { schema: { type: "string", pattern: "(?<=a)b" } },
            },
        });
        expect(checkDocument(document)).toEqual([
            ["invalid-schema", "/inputs/remote/schema"],
            ["invalid-schema", "/inputs/lookbehind/schema"],
        ]);
    });

    // Proves a schema may refer to its own root, which makes recursive declarations possible.
    test("a recursive reference to the schema's root is valid", () => {
        const document = buildSingleTaskDocument(taskStep(), {
            inputs: { tree: { schema: { type: "array", items: { $ref: "#" } } } },
        });
        expect(checkDocument(document)).toEqual([]);
    });

    // Proves a default must satisfy its own schema, on workflow inputs and catalog arguments.
    test("invalid defaults", () => {
        const document = buildSingleTaskDocument(
            taskStep({ config: { operation: "broken-default" }, inputs: {}, outputs: {} }),
            { inputs: { amount: { schema: { type: "number" }, default: "ten" } } },
        );
        expect(checkDocument(document)).toEqual([
            ["invalid-default", "/inputs/amount/default"],
            ["invalid-default", "/steps/0/config/operation"],
        ]);
    });

    // Proves an explicit null default is a value and must satisfy the schema like any other.
    test("a null default is checked like any other value", () => {
        const document = buildSingleTaskDocument(taskStep(), {
            inputs: {
                nullable: { schema: { type: ["number", "null"] }, default: null },
                strict: { schema: { type: "number" }, default: null },
            },
        });
        expect(checkDocument(document)).toEqual([["invalid-default", "/inputs/strict/default"]]);
    });
});

describe("arguments and declared outputs", () => {
    // Proves a required argument must be bound, and optional ones may be left out.
    test("a missing argument", () => {
        const withoutLeft = buildSingleTaskDocument(
            taskStep({ config: { operation: "add" }, inputs: { right: 2 } }),
        );
        expect(checkDocument(withoutLeft)).toEqual([["missing-argument", "/steps/0/inputs"]]);

        // A task without an `inputs` member is located at the step itself.
        const withoutInputs = buildSingleTaskDocument(taskStep({ config: { operation: "add" } }));
        delete withoutInputs.steps[0]?.inputs;
        expect(checkDocument(withoutInputs)).toEqual([["missing-argument", "/steps/0"]]);

        // `right` has a default, so binding only `left` is complete.
        const withoutRight = buildSingleTaskDocument(
            taskStep({ config: { operation: "add" }, inputs: { left: 2 } }),
        );
        expect(checkDocument(withoutRight)).toEqual([]);
    });

    // Proves a binding for an argument the operation doesn't declare is reported at the binding.
    test("an undeclared argument", () => {
        const document = buildSingleTaskDocument(
            taskStep({ inputs: { name: "Ada", nickname: "A" } }),
        );
        expect(checkDocument(document)).toEqual([
            ["undeclared-argument", "/steps/0/inputs/nickname"],
        ]);
    });

    // Proves a step can only declare outputs its operation always returns.
    test("an undeclared output", () => {
        const document = buildSingleTaskDocument(
            taskStep({
                config: { operation: "add" },
                inputs: { left: 1 },
                outputs: { sum: { type: "number" } },
            }),
        );
        expect(checkDocument(document)).toEqual([["undeclared-output", "/steps/0/outputs/sum"]]);
    });

    // Proves a loop step's reserved results output is exempt from the undeclared-output rule.
    test("a loop step may declare its results output", () => {
        // greet never returns `results`, but the loop step exposes it as its iteration results.
        const end = resultStep();
        const body = taskStep();
        const loop = taskLoopStep(
            {
                collection: { ref: "inputs.items" },
                maxIterations: 2,
                variable: "item",
                body: body.id,
            },
            { outputs: { results: { type: "array" } }, successors: [end.id] },
        );
        const document = buildDocument({
            steps: [loop, body, end],
            firstNode: loop.id,
            inputs: { items: { schema: { type: "array" } } },
        });
        expect(checkDocument(document)).toEqual([]);
    });

    // Proves a result step can't declare outputs, so nothing can bind to one unchecked.
    test("a result step's declared output", () => {
        const task = taskStep();
        const end = resultStep({ outputs: { total: { type: "number" } } });
        task.successors = [end.id];
        const document = buildDocument({ steps: [task, end], firstNode: task.id });
        expect(checkDocument(document)).toEqual([["undeclared-output", "/steps/1/outputs/total"]]);
    });
});

describe("literal bindings", () => {
    // Proves a literal is validated against the argument's full schema.
    test("a string literal bound to add's left", () => {
        const document = buildSingleTaskDocument(
            taskStep({ config: { operation: "add" }, inputs: { left: "1" } }),
        );
        expect(checkDocument(document)).toEqual([["type-mismatch", "/steps/0/inputs/left"]]);
    });

    // Proves a reference binding is left to the binding check rather than validated as a literal.
    test("a reference bound to add's left", () => {
        // The reference object itself isn't a number, so checking it as a literal would mismatch.
        const document = buildSingleTaskDocument(
            taskStep({ config: { operation: "add" }, inputs: { left: { ref: "inputs.amount" } } }),
            { inputs: { amount: { schema: { type: "number" } } } },
        );
        expect(checkDocument(document)).toEqual([]);
    });
});

describe("issue attribution", () => {
    // Proves step-level issues carry the responsible step, and workflow-level ones don't.
    test("issues name the responsible step", () => {
        const task = taskStep({ inputs: { name: 1 } });
        const document = buildSingleTaskDocument(task, {
            inputs: { amount: { schema: { type: "number" }, default: "ten" } },
        });
        const issues = checkStaticCompatibility(
            document,
            OPERATION_CATALOG,
            createDeclaredSchemaCompiler(),
        );

        // The invalid input default belongs to no step; the literal belongs to the task.
        expect(issues.map((issue) => [issue.kind, issue.stepId])).toEqual([
            ["invalid-default", undefined],
            ["type-mismatch", task.id],
        ]);
        expect(issues[1]?.details.stepId).toBe(task.id);
    });
});
