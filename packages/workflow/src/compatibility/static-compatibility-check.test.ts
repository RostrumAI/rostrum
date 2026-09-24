import { describe, expect, test } from "bun:test";
import { Type } from "typebox";
import { createDeclaredSchemaCompiler } from "../declared-schemas/declared-schema-compiler";
import {
    OPERATION_CATALOG,
    type OperationCatalog,
    type OperationDeclaration,
} from "../operations/operation-catalog";
import type { WorkflowDocument } from "../schema";
import {
    buildDocument,
    conditional,
    resultStep,
    taskLoopStep,
    taskStep,
} from "../testing/documents";
import { checkStaticCompatibility } from "./static-compatibility-check";

/** An operation whose argument is tighter than a plain number, for containment cases. */
const SQUARE_ROOT: OperationDeclaration = {
    name: "square-root",
    configSchema: Type.Object({}, { additionalProperties: false }),
    arguments: { radicand: { schema: Type.Number({ minimum: 0 }) } },
    outputSchema: Type.Object(
        { value: Type.Number({ minimum: 0 }) },
        { additionalProperties: false },
    ),
    failureCodes: [],
};

/** An operation whose argument uses a pattern, which only an identical pattern can prove. */
const SHOUT: OperationDeclaration = {
    name: "shout",
    configSchema: Type.Object({}, { additionalProperties: false }),
    arguments: { word: { schema: Type.String({ pattern: "^[A-Z]+$" }) } },
    outputSchema: Type.Object({ word: Type.String() }, { additionalProperties: false }),
    failureCodes: [],
};

/** An operation whose declared default violates its own argument schema. */
const BROKEN_DEFAULT: OperationDeclaration = {
    name: "broken-default",
    configSchema: Type.Object({}, { additionalProperties: false }),
    arguments: { count: { schema: Type.Integer(), default: 0.5 } },
    outputSchema: Type.Object({ count: Type.Integer() }, { additionalProperties: false }),
    failureCodes: [],
};

/** The release catalog plus the test-only operations above. */
const TEST_CATALOG: OperationCatalog = new Map([
    ...OPERATION_CATALOG,
    ...[SQUARE_ROOT, SHOUT, BROKEN_DEFAULT].map(
        (operation) => [operation.name, operation] as const,
    ),
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

    // Proves an output declaration must admit every value the operation can return for it.
    test("divide declaring value as a string", () => {
        const document = buildSingleTaskDocument(
            taskStep({
                config: { operation: "divide" },
                inputs: { dividend: 1, divisor: 2 },
                outputs: { value: { type: "string" } },
            }),
        );
        expect(checkDocument(document)).toEqual([["type-mismatch", "/steps/0/outputs/value"]]);
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

describe("bindings", () => {
    // Proves a literal is validated against the argument's full schema.
    test("a string literal bound to add's left", () => {
        const document = buildSingleTaskDocument(
            taskStep({ config: { operation: "add" }, inputs: { left: "1" } }),
        );
        expect(checkDocument(document)).toEqual([["type-mismatch", "/steps/0/inputs/left"]]);
    });

    // Proves a workflow input must be declared at least as tightly as the argument it feeds.
    test("a number input bound to a minimum-0 argument", () => {
        const task = taskStep({
            config: { operation: "square-root" },
            inputs: { radicand: { ref: "inputs.amount" } },
        });
        const loose = buildSingleTaskDocument(task, {
            inputs: { amount: { schema: { type: "number" } } },
        });
        expect(checkDocument(loose)).toEqual([["type-mismatch", "/steps/0/inputs/radicand"]]);

        // Declaring the input with minimum 1 proves every value fits.
        const tight = buildSingleTaskDocument(task, {
            inputs: { amount: { schema: { type: "number", minimum: 1 } } },
        });
        expect(checkDocument(tight)).toEqual([]);
    });

    // Proves a binding the check can't compare is unprovable and names the keyword responsible.
    test("an unprovable binding", () => {
        const document = buildSingleTaskDocument(
            taskStep({ config: { operation: "shout" }, inputs: { word: { ref: "inputs.word" } } }),
            { inputs: { word: { schema: { type: "string", pattern: "^[A-Z]{2,}$" } } } },
        );
        const [issue] = checkStaticCompatibility(
            document,
            TEST_CATALOG,
            createDeclaredSchemaCompiler(),
        );
        expect(issue?.kind).toBe("unprovable");
        expect(issue?.path).toBe("/steps/0/inputs/word");
        expect(issue?.details.keyword).toBe("pattern");
    });

    // Proves references that don't resolve are left to the references stage.
    test("an unresolved reference is skipped", () => {
        const document = buildSingleTaskDocument(
            taskStep({ inputs: { name: { ref: "inputs.missing" } } }),
        );
        expect(checkDocument(document)).toEqual([]);
    });

    // Proves a step output's producer is the operation's output schema, not the step's declaration.
    test("a step output feeds the next step through the operation's schema", () => {
        const end = resultStep();
        const root = taskStep({ config: { operation: "square-root" }, inputs: { radicand: 4 } });
        const add = taskStep({
            config: { operation: "add" },
            inputs: { left: { ref: `step.${root.id}.value` } },
        });
        const greet = taskStep({ inputs: { name: { ref: `step.${root.id}.value` } } });
        root.successors = [add.id];
        add.successors = [greet.id];
        greet.successors = [end.id];
        root.outputs = { value: { type: "number" } };
        const document = buildDocument({ steps: [root, add, greet, end], firstNode: root.id });

        // A non-negative number fits add's left but not greet's string name.
        expect(checkDocument(document)).toEqual([["type-mismatch", "/steps/2/inputs/name"]]);
    });

    // Proves a loop variable's producer is the element schema of its collection.
    test("a loop variable is described by its collection's items", () => {
        const end = resultStep();
        const body = taskStep({
            config: { operation: "add" },
            inputs: { left: { ref: "loop.item" } },
        });
        const loop = taskLoopStep(
            {
                collection: { ref: "inputs.items" },
                maxIterations: 5,
                variable: "item",
                body: body.id,
            },
            { config: { operation: "add" }, inputs: { left: 0 }, successors: [end.id] },
        );
        const numbers = buildDocument({
            steps: [loop, body, end],
            firstNode: loop.id,
            inputs: { items: { schema: { type: "array", items: { type: "number" } } } },
        });
        expect(checkDocument(numbers)).toEqual([]);

        // Strings in the collection can't feed add's left.
        const strings = {
            ...numbers,
            inputs: { items: { schema: { type: "array", items: { type: "string" } } } },
        };
        expect(checkDocument(strings)).toEqual([["type-mismatch", "/steps/1/inputs/left"]]);

        // A string among the tuple's leading items is a possible element too.
        const tuple = {
            ...numbers,
            inputs: {
                items: {
                    schema: {
                        type: "array",
                        prefixItems: [{ type: "string" }],
                        items: { type: "number" },
                    },
                },
            },
        };
        expect(checkDocument(tuple)).toEqual([["type-mismatch", "/steps/1/inputs/left"]]);
    });

    // Proves result steps have no consumer, so any binding fits them.
    test("result bindings are not compared", () => {
        const task = taskStep();
        const end = resultStep({
            inputs: { anything: { ref: "inputs.whatever" }, literal: [1, "two"] },
        });
        task.successors = [end.id];
        const document = buildDocument({
            steps: [task, end],
            firstNode: task.id,
            inputs: { whatever: { schema: true } },
        });
        expect(checkDocument(document)).toEqual([]);
    });
});

describe("condition operands", () => {
    // Proves condition leaves are checked against the producing operation's output schema.
    test("a leaf on a task output is judged by the operation's schema", () => {
        // Build a greet step whose output a single conditional leaf tests.
        const end = resultStep();
        const task = taskStep({ outputs: { greeting: { type: "string" } } });
        const buildLeafDocument = (leaf: { op: string; value?: unknown }) => {
            const routing = conditional({
                dependencies: [task.id],
                branches: [
                    {
                        label: "only",
                        priority: 0,
                        condition: { ref: `step.${task.id}.greeting`, ...leaf },
                        next: end.id,
                    },
                ],
                default: { label: "fallback", next: end.id },
            });
            task.conditional = routing.id;
            return buildDocument({
                steps: [task, end],
                firstNode: task.id,
                conditionals: [routing],
            });
        };

        // A greeting always starts with "Hello, ", so only a matching value can be equal.
        expect(checkDocument(buildLeafDocument({ op: "neq", value: "hi" }))).toEqual([
            ["operand-mismatch", "/conditionals/0/branches/0/condition"],
        ]);
        expect(checkDocument(buildLeafDocument({ op: "eq", value: "Hello, Ada!" }))).toEqual([]);
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
