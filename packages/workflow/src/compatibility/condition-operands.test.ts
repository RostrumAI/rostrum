import { describe, expect, test } from "bun:test";
import {
    createDeclaredSchemaCompiler,
    type JsonSchema,
} from "../declared-schemas/declared-schema-compiler";
import type { WorkflowConditional } from "../schema";
import { conditional } from "../testing/documents";
import { checkConditionOperands } from "./condition-operands";
import type { SchemaProducer } from "./static-compatibility-check";

/** The reference every single-leaf case tests. */
const REF = "step.producer.value";

/** The pointer to a single-leaf conditional's only condition. */
const LEAF = "/conditionals/0/branches/0/condition";

/** Builds a conditional whose only branch tests `condition`. */
function withCondition(condition: unknown): WorkflowConditional {
    return conditional({
        branches: [
            {
                label: "only",
                priority: 0,
                // The walk accepts any condition value; the document schema is not under test here.
                condition: condition as WorkflowConditional["branches"][number]["condition"],
                next: undefined,
            },
        ],
    });
}

/** Checks one leaf against a producer of `schema` and returns `[kind, path]` pairs. */
function issuesFor(schema: JsonSchema, leaf: { op: string; value?: unknown }) {
    const producer: SchemaProducer = { schema, root: schema };
    return checkConditionOperands(
        [withCondition({ ref: REF, ...leaf })],
        createDeclaredSchemaCompiler(),
        () => producer,
    ).map((issue) => [issue.kind, issue.path]);
}

describe("ordering operators", () => {
    // Proves gt, gte, lt, and lte need both a number output and a number value.
    test("need a number output and a number value", () => {
        // Every ordering operator accepts a number output compared with a number.
        for (const op of ["gt", "gte", "lt", "lte"]) {
            expect(issuesFor({ type: "number" }, { op, value: 5 })).toEqual([]);
        }

        // A string output, or a string comparison value, can't be ordered.
        expect(issuesFor({ type: "string" }, { op: "gt", value: 5 })).toEqual([
            ["operand-mismatch", LEAF],
        ]);
        expect(issuesFor({ type: "number" }, { op: "lte", value: "5" })).toEqual([
            ["operand-mismatch", LEAF],
        ]);
    });

    // Proves an output the containment check can't compare is unprovable rather than a mismatch.
    test("an output the check can't compare is unprovable", () => {
        expect(issuesFor({ not: { type: "string" } }, { op: "gt", value: 5 })).toEqual([
            ["unprovable", LEAF],
        ]);
    });
});

describe("contains", () => {
    // Proves contains accepts a string output with a string value, or any array output.
    test("needs a string output and value, or an array output", () => {
        // A string searched for a string, and an array searched for anything, both fit.
        expect(issuesFor({ type: "string" }, { op: "contains", value: "Ada" })).toEqual([]);
        expect(issuesFor({ type: "array" }, { op: "contains", value: 1 })).toEqual([]);

        // A number output, or a string output searched for a number, can't match.
        expect(issuesFor({ type: "number" }, { op: "contains", value: 1 })).toEqual([
            ["operand-mismatch", LEAF],
        ]);
        expect(issuesFor({ type: "string" }, { op: "contains", value: 1 })).toEqual([
            ["operand-mismatch", LEAF],
        ]);
    });
});

describe("membership and equality", () => {
    // Proves in and notin need an array value with at least one element the output can equal.
    test("in and notin", () => {
        // One reachable element is enough, even beside unreachable ones.
        expect(issuesFor({ type: "number" }, { op: "in", value: ["a", 5] })).toEqual([]);

        // A non-array value, an empty array, and an array of unreachable elements fix the outcome.
        expect(issuesFor({ type: "number" }, { op: "in", value: 5 })).toEqual([
            ["operand-mismatch", LEAF],
        ]);
        expect(issuesFor({ type: "number" }, { op: "notin", value: [] })).toEqual([
            ["operand-mismatch", LEAF],
        ]);
        expect(issuesFor({ type: "number" }, { op: "notin", value: ["a"] })).toEqual([
            ["operand-mismatch", LEAF],
        ]);
    });

    // Proves eq and neq need a comparison value the output can equal.
    test("eq and neq", () => {
        // A value inside the output's schema can be equal.
        expect(issuesFor({ type: "number" }, { op: "eq", value: 5 })).toEqual([]);

        // A value outside it, or no value at all, fixes the outcome.
        expect(issuesFor({ type: "number" }, { op: "neq", value: "five" })).toEqual([
            ["operand-mismatch", LEAF],
        ]);
        expect(issuesFor({ type: "number" }, { op: "eq" })).toEqual([["operand-mismatch", LEAF]]);
    });

    // Proves an explicit null is a comparison value, distinct from an absent one.
    test("an explicit null value is compared", () => {
        expect(issuesFor({ type: "null" }, { op: "eq", value: null })).toEqual([]);
        expect(issuesFor({ type: "number" }, { op: "eq", value: null })).toEqual([
            ["operand-mismatch", LEAF],
        ]);
    });
});

describe("leaves the check doesn't judge", () => {
    // Proves truthy, falsy, and unknown operators are left to other rules.
    test("truthy, falsy, and unknown operators", () => {
        for (const op of ["truthy", "falsy", "between"]) {
            expect(issuesFor({ type: "number" }, { op })).toEqual([]);
        }
    });

    // Proves a leaf whose reference doesn't resolve to a producer is skipped.
    test("an unresolved reference is skipped", () => {
        const issues = checkConditionOperands(
            [withCondition({ ref: REF, op: "gt", value: "x" })],
            createDeclaredSchemaCompiler(),
            () => undefined,
        );
        expect(issues).toEqual([]);
    });
});

describe("locating issues", () => {
    // Proves nested all/any leaves are located by their own pointers and carry their context.
    test("nested groups locate each leaf", () => {
        // One good and one bad leaf inside `all`, and a bad leaf inside a nested `any`.
        const routing = withCondition({
            all: [
                { ref: REF, op: "gt", value: 1 },
                { ref: REF, op: "contains", value: 1 },
                { any: [{ ref: REF, op: "eq", value: "x" }] },
            ],
        });
        const producer: SchemaProducer = { schema: { type: "number" }, root: { type: "number" } };
        const issues = checkConditionOperands(
            [conditional(), routing],
            createDeclaredSchemaCompiler(),
            (ref) => (ref === REF ? producer : undefined),
        );

        // Only the two bad leaves are reported, under the second conditional's index.
        expect(issues.map((issue) => issue.path)).toEqual([
            "/conditionals/1/branches/0/condition/all/1",
            "/conditionals/1/branches/0/condition/all/2/any/0",
        ]);

        // The details name the conditional, reference, and operator an author must repair.
        expect(issues[0]?.details).toEqual({
            conditionalId: routing.id,
            ref: REF,
            operator: "contains",
        });
    });
});
