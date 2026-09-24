import { describe, expect, test } from "bun:test";
import { OPERATION_CATALOG, type WorkflowDocument } from "@rostrum/workflow";
import type { RunPublication } from "@rostrum/workflow/execution";
import digestVectors from "@rostrum/workflow/fixtures/digest-vectors.json";
import conditionalJson from "@rostrum/workflow/fixtures/valid/conditional-branching.json";
import sequentialJson from "@rostrum/workflow/fixtures/valid/sequential.json";
import calculationJson from "@rostrum/workflow/fixtures/valid/sequential-calculation.json";
import { resolveBindings } from "../engine/bindings";
import type { PreparedWorkflow } from "./prepared-workflow";
import { PublicationPreparer } from "./publication-preparer";
import { createValueChecker } from "./value-checks";

const preparer = new PublicationPreparer(OPERATION_CATALOG);

/** The calculation fixture's step IDs: the addition, the division, and the result. */
const ADD_STEP = "0192b0a0-7e1d-7000-8000-000000000101";
const DIVIDE_STEP = "0192b0a0-7e1d-7000-8000-000000000102";
const RESULT_STEP = "0192b0a0-7e1d-7000-8000-000000000103";

/** Builds the publication a stored copy of the document would have. */
function publicationOf(document: { id: string }, digest = "0".repeat(64)): RunPublication {
    return { workflowId: document.id, publicationNumber: 1, workflowFormatVersion: "v1", digest };
}

/** Returns a deep copy of the calculation fixture to modify for one test. */
function calculation(): WorkflowDocument {
    return structuredClone(calculationJson) as WorkflowDocument;
}

/** Prepares a document and fails the test when preparation refuses it. */
function prepared(document: object): PreparedWorkflow {
    const preparation = preparer.prepare(JSON.stringify(document), publicationOf(calculationJson));
    if (!preparation.ok) {
        throw new Error(`Expected preparation to succeed: ${JSON.stringify(preparation.refusal)}`);
    }
    return preparation.workflow;
}

/** Prepares a document and returns its refusal as `[reason, [code, path][]]`. */
function refusalOf(document: object, publication = publicationOf(calculationJson)) {
    const preparation = preparer.prepare(JSON.stringify(document), publication);
    if (preparation.ok) {
        throw new Error("Expected preparation to refuse the document");
    }
    return [
        preparation.refusal.reason,
        preparation.refusal.failures.map((failure) => [failure.code, failure.path]),
    ];
}

describe("the worked example", () => {
    const workflow = prepared(calculationJson);

    // Proves the calculation prepares and binds the add step to the run's inputs, defaults included.
    test("prepares the calculation and resolves the first step's bindings", () => {
        // The prepared workflow keeps the publication, entry, and document order.
        expect(workflow.publication).toEqual(publicationOf(calculationJson));
        expect(workflow.entryStepId).toBe(ADD_STEP);
        expect(workflow.stepOrder).toHaveLength(3);

        // With no surcharge supplied, add receives the declared default of 0.
        const accepted = preparer.validateInputs(workflow, { amount: 90, people: 4 });
        if (!accepted.ok) {
            throw new Error("Expected the inputs to be accepted");
        }
        const add = workflow.steps.get(ADD_STEP);
        const resolved = add
            ? resolveBindings(
                  add.inputs,
                  { inputs: accepted.inputs, getCompletedOutput: () => undefined },
                  ADD_STEP,
              )
            : undefined;
        expect(resolved).toEqual({ ok: true, values: { left: 90, right: 0 } });
    });

    // Proves each kind of bad invocation input is refused with its own code and location.
    test("refuses a string amount, a missing input, and an undeclared input", () => {
        const refusal = preparer.validateInputs(workflow, { amount: "90", tip: 5 });
        expect(refusal.ok).toBe(false);
        if (refusal.ok) {
            return;
        }
        // All three problems are reported together, in pointer order.
        expect(refusal.refusal.reason).toBe("invalid_inputs");
        expect(refusal.refusal.failures.map((failure) => [failure.code, failure.path])).toEqual([
            ["invalid_input", "/inputs/amount"],
            ["missing_input", "/inputs/people"],
            ["undeclared_input", "/inputs/tip"],
        ]);
    });

    // Proves an operation outside this release's catalog refuses the publication before any run.
    test("refuses an unknown operation", () => {
        const document = calculation();
        const [first] = document.steps;
        if (first) {
            first.config = { operation: "multiply" };
        }
        expect(refusalOf(document)).toEqual([
            "unsupported_execution",
            [["unknown_operation", "/steps/0/config/operation"]],
        ]);
    });
});

describe("declared schemas", () => {
    // Proves a number declaration rejects a numeric string instead of converting it.
    test("a number declaration rejects a string without coercion", () => {
        const refusal = preparer.validateInputs(prepared(calculationJson), {
            amount: "90",
            people: 4,
        });
        expect(refusal.ok ? [] : refusal.refusal.failures.map((failure) => failure.code)).toEqual([
            "invalid_input",
        ]);
    });

    // Proves malformed declarations and references outside the schema refuse the publication.
    test("a malformed schema and an unresolved external reference are refused", () => {
        const document = calculation();
        document.inputs = {
            ...document.inputs,
            amount: { schema: { type: "strng" } },
            people: { schema: { $ref: "https://example.com/people.json" } },
        };
        const [reason, failures] = refusalOf(document);
        expect(reason).toBe("unsupported_execution");
        expect(failures).toContainEqual(["invalid_schema", "/inputs/amount/schema/type"]);
        expect(failures).toContainEqual(["invalid_schema", "/inputs/people/schema"]);
    });

    // Proves local references work and `format` is an annotation, not a constraint.
    test("local references resolve and formats don't reject values", () => {
        const document = calculation();
        document.inputs = {
            ...document.inputs,
            amount: {
                schema: { $defs: { money: { type: "number", minimum: 0 } }, $ref: "#/$defs/money" },
            },
            note: { schema: { type: "string", format: "email" }, default: "none" },
        };
        const workflow = prepared(document);

        // The referenced definition applies, and a non-email string passes.
        expect(
            preparer.validateInputs(workflow, { amount: 90, people: 4, note: "not an email" }).ok,
        ).toBe(true);
        expect(preparer.validateInputs(workflow, { amount: -1, people: 4 }).ok).toBe(false);
    });
});

describe("defaults and literals", () => {
    // Proves only an omitted input receives its default; an explicit null is a supplied value.
    test("defaults apply to omitted inputs, not to explicit null", () => {
        const document = calculation();
        document.inputs = {
            ...document.inputs,
            label: { schema: { type: ["string", "null"] }, default: "none" },
        };
        const workflow = prepared(document);

        // Omitted: the default. Explicit null: kept as null.
        const omitted = preparer.validateInputs(workflow, { amount: 1, people: 1 });
        const explicit = preparer.validateInputs(workflow, { amount: 1, people: 1, label: null });
        expect(omitted.ok && omitted.inputs.get("label")).toBe("none");
        expect(
            explicit.ok && explicit.inputs.has("label") && explicit.inputs.get("label"),
        ).toBeNull();
    });

    // Proves prototype-sensitive and dotted literal names keep the values the author wrote.
    test("literal keys named constructor, __proto__, and a.b keep their values", () => {
        const document = JSON.parse(
            JSON.stringify(calculationJson).replace(
                '"inputs":{"total"',
                '"inputs":{"constructor":1,"__proto__":{"polluted":true},"a.b":"dotted","total"',
            ),
        );
        const workflow = prepared(document);
        const result = workflow.steps.get(RESULT_STEP);
        const outputs = new Map([
            [ADD_STEP, { value: 100 }],
            [DIVIDE_STEP, { value: 25 }],
        ]);
        const resolved = result
            ? resolveBindings(
                  result.inputs,
                  {
                      inputs: new Map(),
                      getCompletedOutput: (stepId) => outputs.get(stepId),
                  },
                  RESULT_STEP,
              )
            : undefined;
        if (!resolved?.ok) {
            throw new Error("Expected the result bindings to resolve");
        }

        // Each name is an own member with the literal value; nothing reached the prototype.
        expect(Object.getOwnPropertyDescriptor(resolved.values, "constructor")?.value).toBe(1);
        expect(Object.hasOwn(resolved.values, "__proto__")).toBe(true);
        expect(Object.getPrototypeOf(resolved.values)).toBe(Object.prototype);
        expect(Object.getOwnPropertyDescriptor(resolved.values, "__proto__")?.value).toEqual({
            polluted: true,
        });
        expect(resolved.values["a.b"]).toBe("dotted");
        expect(resolved.values.total).toBe(100);
    });

    // Proves a prepared literal can't be changed by anyone holding the prepared workflow.
    test("prepared literals are deep-frozen copies", () => {
        const document = calculation();
        const result = document.steps[2];
        if (result) {
            result.inputs = { summary: { rows: [{ total: 1 }] } };
        }
        const binding = prepared(document).steps.get(RESULT_STEP)?.inputs.get("summary")?.binding;
        const value = binding?.kind === "literal" ? binding.value : undefined;

        // The literal and everything inside it are frozen, and detached from the parsed document.
        expect(value).toEqual({ rows: [{ total: 1 }] });
        expect(Object.isFrozen(value)).toBe(true);
        const rows =
            typeof value === "object" && value !== null && "rows" in value ? value.rows : [];
        expect(Array.isArray(rows) && Object.isFrozen(rows[0])).toBe(true);
    });
});

describe("refusals", () => {
    // Proves a refusal reports every failure found, not only the first.
    test("a refusal lists every failure", () => {
        const document = calculation();
        const [first, second] = document.steps;
        if (first && second) {
            first.config = { operation: "multiply" };
            second.inputs = { dividend: "ten", divisor: { ref: "inputs.people" }, extra: 1 };
        }
        expect(refusalOf(document)).toEqual([
            "unsupported_execution",
            [
                ["unknown_operation", "/steps/0/config/operation"],
                ["io_type_mismatch", "/steps/1/inputs/dividend"],
                ["undeclared_argument", "/steps/1/inputs/extra"],
            ],
        ]);
    });

    // Proves a reference naming no declared input or declared step output is refused, not left for the run.
    test("unresolved bindings", () => {
        // Bind divide to an undeclared input and to an output the add step doesn't declare.
        const document = calculation();
        const [, second] = document.steps;
        if (second) {
            second.inputs = {
                dividend: { ref: `step.${ADD_STEP}.unknown` },
                divisor: { ref: "inputs.missing" },
            };
        }

        // Each dangling reference is reported at its own binding.
        expect(refusalOf(document)).toEqual([
            "unsupported_execution",
            [
                ["unresolved_binding", "/steps/1/inputs/dividend"],
                ["unresolved_binding", "/steps/1/inputs/divisor"],
            ],
        ]);
    });

    // Proves conditionals, loops, and parallel successors are refused with located control-flow failures.
    test("unsupported control flow", () => {
        const [reason, failures] = refusalOf(conditionalJson, publicationOf(conditionalJson));
        expect(reason).toBe("unsupported_execution");
        expect(failures).toEqual([
            ["unsupported_control_flow", "/conditionals"],
            ["unsupported_control_flow", "/steps/0/conditional"],
        ]);

        // Two distinct successors are parallel paths, which this release doesn't run.
        const parallel = calculation();
        const [first] = parallel.steps;
        if (first) {
            first.successors = [
                "0192b0a0-7e1d-7000-8000-000000000102",
                "0192b0a0-7e1d-7000-8000-000000000103",
            ];
        }
        expect(refusalOf(parallel)).toEqual([
            "unsupported_execution",
            [["unsupported_control_flow", "/steps/0/successors"]],
        ]);
    });

    // Proves step types other than task and result, and a configured result step, are refused.
    test("unsupported step types and result configuration", () => {
        // Turn the division into an unknown step type and give the result step a configuration.
        const document = calculation();
        const [, second, third] = document.steps;
        if (second && third) {
            second.type = "approval";
            third.config = { format: "table" };
        }

        // Each problem is located at the member responsible.
        expect(refusalOf(document)).toEqual([
            "unsupported_execution",
            [
                ["unsupported_step_type", "/steps/1/type"],
                ["invalid_config", "/steps/2/config"],
            ],
        ]);
    });

    // Proves a loop is refused with a located control-flow failure, since this release doesn't run loops.
    test("loops", () => {
        // Make the division iterate over the people input, with itself as the body.
        const document = calculation();
        const [, second] = document.steps;
        if (second) {
            second.loop = {
                collection: { ref: "inputs.people" },
                maxIterations: 2,
                variable: "person",
                body: DIVIDE_STEP,
            };
        }

        // The loop is refused at its own member, whatever else it gets wrong.
        const [reason, failures] = refusalOf(document);
        expect(reason).toBe("unsupported_execution");
        expect(failures).toContainEqual(["unsupported_control_flow", "/steps/1/loop"]);
    });

    // Proves a document whose step links the engine can't follow is refused before any run.
    test("duplicate step IDs, a missing entry step, and dangling links", () => {
        // Repeat the add step's ID on the division, point the entry nowhere, and link to a missing step.
        const document = calculation();
        const [first, second] = document.steps;
        const missing = "0192b0a0-7e1d-7000-8000-000000000199";
        if (first && second) {
            second.id = ADD_STEP;
            first.dependencies = [missing];
        }
        document.firstNode = missing;

        // Every broken link is reported where it sits.
        const [reason, failures] = refusalOf(document);
        expect(reason).toBe("unsupported_execution");
        expect(failures).toContainEqual(["invalid_document", "/firstNode"]);
        expect(failures).toContainEqual(["invalid_document", "/steps/1/id"]);
        expect(failures).toContainEqual(["invalid_document", "/steps/0/dependencies/0"]);
    });

    // Proves a publication made before the validator fix still can't start a run that would hang.
    test("self-dependency", () => {
        const document = calculation();
        const [first] = document.steps;
        if (first) {
            first.dependencies = [ADD_STEP];
        }
        expect(refusalOf(document)).toEqual([
            "unsupported_execution",
            [["self_dependency", "/steps/0/dependencies/0"]],
        ]);
    });

    // Proves a stored document that can't be trusted is corrupt, not merely unsupported.
    test("invalid stored JSON and a mismatched identity are corrupt", () => {
        const invalid = preparer.prepare("{", publicationOf(calculationJson));
        expect(invalid.ok ? undefined : invalid.refusal.reason).toBe("corrupt_publication");

        // The stored document is a different workflow than the run recorded.
        expect(refusalOf(sequentialJson, publicationOf(calculationJson))).toEqual([
            "corrupt_publication",
            [["publication_mismatch", "/id"]],
        ]);
    });

    // Proves another format or a malformed document is unsupported by this release.
    test("an unsupported format and an invalid shape", () => {
        expect(refusalOf({ ...calculation(), workflowFormatVersion: "v2" })).toEqual([
            "unsupported_execution",
            [["unsupported_format", "/workflowFormatVersion"]],
        ]);
        const [reason, failures] = refusalOf({ ...calculation(), steps: [] });
        expect(reason).toBe("unsupported_execution");
        expect(failures).toContainEqual(["invalid_document", "/steps"]);
    });

    // Proves the digest-vector fixture publication prepares with its real digest recorded.
    test("the greeting publication prepares with its recorded digest", () => {
        const digest = digestVectors["valid/sequential.json"];
        const preparation = preparer.prepare(
            JSON.stringify(sequentialJson),
            publicationOf(sequentialJson, digest),
        );
        expect(preparation.ok && preparation.workflow.publication.digest).toBe(digest);
    });

    // Proves a deeply nested input is copied and frozen without overflowing the stack.
    test("deeply nested inputs don't escape as exceptions", () => {
        // Nesting far deeper than a recursive freeze could follow, against a recursive schema.
        const deep = JSON.parse(`${"[".repeat(20_000)}${"]".repeat(20_000)}`);
        const document = calculation();
        document.inputs = {
            ...document.inputs,
            payload: { schema: { type: "array", items: { $ref: "#" } }, default: [] },
        };
        const accepted = preparer.validateInputs(prepared(document), {
            amount: 1,
            people: 1,
            payload: deep,
        });
        expect(accepted.ok && Object.isFrozen(accepted.inputs.get("payload"))).toBe(true);
    });

    // Proves a check that can't be evaluated refuses the run as unsupported, not as bad input.
    test("an evaluator that throws is unsupported execution", () => {
        // A prepared input whose check throws, as an evaluator exhausting its stack would.
        const workflow = prepared(calculationJson);
        const throwing = createValueChecker(() => {
            throw new RangeError("Maximum call stack size exceeded");
        });
        const broken: PreparedWorkflow = {
            ...workflow,
            inputs: new Map([["payload", { check: throwing }]]),
        };

        // The failure is sanitized and the reason blames the release, not the caller.
        expect(preparer.validateInputs(broken, { payload: [] })).toEqual({
            ok: false,
            refusal: {
                reason: "unsupported_execution",
                failures: [
                    {
                        code: "execution_error",
                        message: "The value couldn't be checked",
                        path: "/inputs/payload",
                    },
                ],
            },
        });
    });
});
