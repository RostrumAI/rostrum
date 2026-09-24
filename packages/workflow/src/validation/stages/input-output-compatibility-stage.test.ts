import { describe, expect, test } from "bun:test";
import { Type } from "typebox";
import {
    OPERATION_CATALOG,
    type OperationCatalog,
    type OperationDeclaration,
} from "../../operations/operation-catalog";
import type { WorkflowDocument } from "../../schema";
import {
    buildDocument,
    conditional,
    resultStep,
    taskLoopStep,
    taskStep,
} from "../../testing/documents";
import { ValidationContext } from "../validation-context";
import { InputOutputCompatibilityStage } from "./input-output-compatibility-stage";

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

/** Runs stage 8 over a document and returns `[code, path]` pairs. */
function findingsOf(document: WorkflowDocument, catalog: OperationCatalog = OPERATION_CATALOG) {
    const stage = new InputOutputCompatibilityStage(catalog);
    return stage
        .run(new ValidationContext(document, null))
        .map((finding) => [finding.code, finding.path]);
}

/** Builds a task followed by a result step, the smallest document a task can appear in. */
function singleTask(task: ReturnType<typeof taskStep>, overrides: Partial<WorkflowDocument> = {}) {
    const end = resultStep();
    task.successors = [end.id];
    return buildDocument({ steps: [task, end], firstNode: task.id, ...overrides });
}

describe("operations and configuration", () => {
    // Proves a task naming an operation outside the catalog blocks publication.
    test("an unknown operation", () => {
        const document = singleTask(taskStep({ config: { operation: "threshold" }, inputs: {} }));
        expect(findingsOf(document)).toEqual([
            ["workflow.operation.unknown", "/steps/0/config/operation"],
        ]);
    });

    // Proves a task with no configuration at all names no operation.
    test("a task without an operation", () => {
        const document = singleTask(taskStep({ config: undefined, inputs: {} }));
        expect(findingsOf(document)).toEqual([["workflow.operation.unknown", "/steps/0"]]);
    });

    // Proves configuration members the operation doesn't declare are located individually.
    test("invalid configuration", () => {
        const document = singleTask(
            taskStep({ config: { operation: "add", precision: 2 }, inputs: { left: 1 } }),
        );
        expect(findingsOf(document)).toEqual([
            ["workflow.operation.invalid-config", "/steps/0/config/precision"],
        ]);
    });
});

describe("declared schemas and defaults", () => {
    // Proves malformed input and output declarations are located inside the schema.
    test("invalid declarations", () => {
        const task = taskStep({ outputs: { greeting: { type: "strng" } } });
        const document = singleTask(task, {
            inputs: { amount: { schema: { type: "number", minimum: "zero" } } },
        });
        expect(findingsOf(document)).toEqual([
            ["workflow.io.invalid-schema", "/inputs/amount/schema/minimum"],
            ["workflow.io.invalid-schema", "/steps/0/outputs/greeting/type"],
        ]);
    });

    // Proves references that leave the schema, and patterns a linear-time engine refuses, are invalid.
    test("unresolved references and unsupported patterns are invalid declarations", () => {
        const document = singleTask(taskStep(), {
            inputs: {
                remote: { schema: { $ref: "https://example.com/schema.json" } },
                lookbehind: { schema: { type: "string", pattern: "(?<=a)b" } },
            },
        });
        expect(findingsOf(document)).toEqual([
            ["workflow.io.invalid-schema", "/inputs/remote/schema"],
            ["workflow.io.invalid-schema", "/inputs/lookbehind/schema"],
        ]);
    });

    // Proves a default must satisfy its own schema, on workflow inputs and catalog arguments.
    test("invalid defaults", () => {
        const document = singleTask(
            taskStep({ config: { operation: "broken-default" }, inputs: {}, outputs: {} }),
            { inputs: { amount: { schema: { type: "number" }, default: "ten" } } },
        );
        expect(findingsOf(document, TEST_CATALOG)).toEqual([
            ["workflow.io.invalid-default", "/inputs/amount/default"],
            ["workflow.io.invalid-default", "/steps/0/config/operation"],
        ]);
    });

    // Proves an explicit null default is a value and must satisfy the schema like any other.
    test("a null default is checked like any other value", () => {
        const document = singleTask(taskStep(), {
            inputs: {
                nullable: { schema: { type: ["number", "null"] }, default: null },
                strict: { schema: { type: "number" }, default: null },
            },
        });
        expect(findingsOf(document)).toEqual([
            ["workflow.io.invalid-default", "/inputs/strict/default"],
        ]);
    });
});

describe("arguments and declared outputs", () => {
    // Proves a required argument must be bound, and optional ones may be left out.
    test("a missing argument", () => {
        const withoutLeft = singleTask(
            taskStep({ config: { operation: "add" }, inputs: { right: 2 } }),
        );
        expect(findingsOf(withoutLeft)).toEqual([
            ["workflow.io.missing-argument", "/steps/0/inputs"],
        ]);

        // `right` has a default, so binding only `left` is complete.
        const withoutRight = singleTask(
            taskStep({ config: { operation: "add" }, inputs: { left: 2 } }),
        );
        expect(findingsOf(withoutRight)).toEqual([]);
    });

    // Proves a binding for an argument the operation doesn't declare is reported at the binding.
    test("an undeclared argument", () => {
        const document = singleTask(taskStep({ inputs: { name: "Ada", nickname: "A" } }));
        expect(findingsOf(document)).toEqual([
            ["workflow.io.undeclared-argument", "/steps/0/inputs/nickname"],
        ]);
    });

    // Proves a step can only declare outputs its operation always returns.
    test("an undeclared output", () => {
        const document = singleTask(
            taskStep({
                config: { operation: "add" },
                inputs: { left: 1 },
                outputs: { sum: { type: "number" } },
            }),
        );
        expect(findingsOf(document)).toEqual([
            ["workflow.io.undeclared-output", "/steps/0/outputs/sum"],
        ]);
    });

    // Proves an output declaration must admit every value the operation can return for it.
    test("divide declaring value as a string", () => {
        const document = singleTask(
            taskStep({
                config: { operation: "divide" },
                inputs: { dividend: 1, divisor: 2 },
                outputs: { value: { type: "string" } },
            }),
        );
        expect(findingsOf(document)).toEqual([
            ["workflow.io.type-mismatch", "/steps/0/outputs/value"],
        ]);
    });
});

describe("bindings", () => {
    // Proves a literal is validated against the argument's full schema.
    test("a string literal bound to add's left", () => {
        const document = singleTask(
            taskStep({ config: { operation: "add" }, inputs: { left: "1" } }),
        );
        expect(findingsOf(document)).toEqual([
            ["workflow.io.type-mismatch", "/steps/0/inputs/left"],
        ]);
    });

    // Proves a workflow input must be declared at least as tightly as the argument it feeds.
    test("a number input bound to a minimum-0 argument", () => {
        const task = taskStep({
            config: { operation: "square-root" },
            inputs: { radicand: { ref: "inputs.amount" } },
        });
        const loose = singleTask(task, { inputs: { amount: { schema: { type: "number" } } } });
        expect(findingsOf(loose, TEST_CATALOG)).toEqual([
            ["workflow.io.type-mismatch", "/steps/0/inputs/radicand"],
        ]);

        // Declaring the input with minimum 1 proves every value fits.
        const tight = singleTask(task, {
            inputs: { amount: { schema: { type: "number", minimum: 1 } } },
        });
        expect(findingsOf(tight, TEST_CATALOG)).toEqual([]);
    });

    // Proves a binding the check can't compare is blocked, not deferred to the runtime.
    test("an unprovable binding", () => {
        const document = singleTask(
            taskStep({ config: { operation: "shout" }, inputs: { word: { ref: "inputs.word" } } }),
            { inputs: { word: { schema: { type: "string", pattern: "^[A-Z]{2,}$" } } } },
        );
        const stage = new InputOutputCompatibilityStage(TEST_CATALOG);
        const [finding] = stage.run(new ValidationContext(document, null));
        expect(finding?.code).toBe("workflow.io.unprovable");
        expect(finding?.path).toBe("/steps/0/inputs/word");
        expect(finding?.details?.keyword).toBe("pattern");
    });

    // Proves a step output's producer is the operation's output schema, not the step's declaration.
    test("a step output feeds the next step through the operation's schema", () => {
        const end = resultStep();
        const root = taskStep({ config: { operation: "square-root" }, inputs: { radicand: 4 } });
        const add = taskStep({
            config: { operation: "add" },
            inputs: { left: { ref: `step.${root.id}.value` } },
            successors: [end.id],
        });
        const greet = taskStep({ inputs: { name: { ref: `step.${root.id}.value` } } });
        root.successors = [add.id];
        add.successors = [greet.id];
        greet.successors = [end.id];
        root.outputs = { value: { type: "number" } };
        const document = buildDocument({ steps: [root, add, greet, end], firstNode: root.id });

        // A non-negative number fits add's left but not greet's string name.
        expect(findingsOf(document, TEST_CATALOG)).toEqual([
            ["workflow.io.type-mismatch", "/steps/2/inputs/name"],
        ]);
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
        expect(findingsOf(numbers)).toEqual([]);

        // Strings in the collection can't feed add's left.
        const strings = {
            ...numbers,
            inputs: { items: { schema: { type: "array", items: { type: "string" } } } },
        };
        expect(findingsOf(strings)).toEqual([
            ["workflow.io.type-mismatch", "/steps/1/inputs/left"],
        ]);
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
        expect(findingsOf(document)).toEqual([]);
    });
});

describe("condition operands", () => {
    /** Builds a document whose single conditional leaf tests a task output. */
    function conditionOn(
        operation: "greet" | "add",
        leaf: { op: string; value?: unknown },
    ): WorkflowDocument {
        const end = resultStep();
        const task = taskStep(
            operation === "greet"
                ? { outputs: { greeting: { type: "string" } } }
                : {
                      config: { operation: "add" },
                      inputs: { left: 1 },
                      outputs: { value: { type: "number" } },
                  },
        );
        const output = operation === "greet" ? "greeting" : "value";
        const routing = conditional({
            dependencies: [task.id],
            branches: [
                {
                    label: "only",
                    priority: 0,
                    condition: { ref: `step.${task.id}.${output}`, ...leaf },
                    next: end.id,
                },
            ],
            default: { label: "fallback", next: end.id },
        });
        task.conditional = routing.id;
        return buildDocument({ steps: [task, end], firstNode: task.id, conditionals: [routing] });
    }

    const LEAF = "/conditionals/0/branches/0/condition";

    // Proves ordering operators need a number output.
    test("gt on a string output", () => {
        expect(findingsOf(conditionOn("greet", { op: "gt", value: 5 }))).toEqual([
            ["workflow.condition.operand-mismatch", LEAF],
        ]);
        expect(findingsOf(conditionOn("add", { op: "gt", value: 5 }))).toEqual([]);
    });

    // Proves an equality test must be able to succeed.
    test("eq with a value the output can't equal", () => {
        expect(findingsOf(conditionOn("add", { op: "eq", value: "five" }))).toEqual([
            ["workflow.condition.operand-mismatch", LEAF],
        ]);
        // A greeting always starts with "Hello, ", so comparing it with "hi" is fixed.
        expect(findingsOf(conditionOn("greet", { op: "neq", value: "hi" }))).toEqual([
            ["workflow.condition.operand-mismatch", LEAF],
        ]);
        expect(findingsOf(conditionOn("greet", { op: "eq", value: "Hello, Ada!" }))).toEqual([]);
    });

    // Proves membership needs an array value with at least one possible element.
    test("in and notin", () => {
        expect(findingsOf(conditionOn("add", { op: "in", value: 5 }))).toEqual([
            ["workflow.condition.operand-mismatch", LEAF],
        ]);
        expect(findingsOf(conditionOn("add", { op: "notin", value: ["a", 5] }))).toEqual([]);
    });

    // Proves contains needs a string with a string value, and truthy accepts anything.
    test("contains and truthy", () => {
        expect(findingsOf(conditionOn("greet", { op: "contains", value: "Ada" }))).toEqual([]);
        expect(findingsOf(conditionOn("add", { op: "contains", value: 1 }))).toEqual([
            ["workflow.condition.operand-mismatch", LEAF],
        ]);
        expect(findingsOf(conditionOn("add", { op: "truthy" }))).toEqual([]);
    });
});

describe("the operation catalog", () => {
    /** Values for each catalog operation's required arguments, leaving defaulted ones unbound. */
    const REQUIRED_BINDINGS: Record<string, Record<string, unknown>> = {
        greet: { name: "Ada" },
        add: { left: 1 },
        divide: { dividend: 1, divisor: 2 },
    };

    // Proves every catalog argument default satisfies its own schema.
    test("catalog defaults are valid", () => {
        // Every operation must have bindings above, so a new operation can't skip this check.
        expect([...OPERATION_CATALOG.keys()].sort()).toEqual(Object.keys(REQUIRED_BINDINGS).sort());

        // Leaving the defaulted arguments unbound checks each default against its schema.
        for (const [operation, inputs] of Object.entries(REQUIRED_BINDINGS)) {
            const document = singleTask(taskStep({ config: { operation }, inputs }));
            expect({ operation, findings: findingsOf(document) }).toEqual({
                operation,
                findings: [],
            });
        }
    });
});
