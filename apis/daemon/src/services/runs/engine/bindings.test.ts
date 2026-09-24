import { describe, expect, test } from "bun:test";
import type { PreparedInput } from "../preparation/prepared-workflow";
import { type BindingContext, resolveBindings } from "./bindings";

const STEP = "0192b0a0-7e1d-7000-8000-000000000301";
const PRODUCER = "0192b0a0-7e1d-7000-8000-000000000302";

/** Builds a context over accepted inputs and a stub map of completed outputs. */
function contextOf(
    inputs: Record<string, unknown>,
    completed: Record<string, Record<string, unknown>> = {},
): BindingContext {
    const outputs = new Map(Object.entries(completed));
    return { inputs: new Map(Object.entries(inputs)), getCompletedOutput: (id) => outputs.get(id) };
}

/** Builds prepared inputs from `[name, binding]` pairs, each located at its own input pointer. */
function inputsOf(bindings: [string, PreparedInput["binding"]][]): Map<string, PreparedInput> {
    return new Map(
        bindings.map(([name, binding]) => [name, { binding, path: `/steps/0/inputs/${name}` }]),
    );
}

describe("resolveBindings", () => {
    // Proves each binding kind resolves from its own source.
    test("resolves literals, workflow inputs, and completed step outputs", () => {
        const inputs = inputsOf([
            ["fixed", { kind: "literal", value: 1 }],
            ["amount", { kind: "workflow-input", inputName: "amount" }],
            ["sum", { kind: "step-output", stepId: PRODUCER, outputName: "value" }],
        ]);
        const context = contextOf({ amount: 90 }, { [PRODUCER]: { value: 100 } });
        expect(resolveBindings(inputs, context, STEP)).toEqual({
            ok: true,
            values: { fixed: 1, amount: 90, sum: 100 },
        });
    });

    // Proves a step output is read only once its producer has completed, and never defaulted.
    test("an output of a step that hasn't completed is unresolved", () => {
        const inputs = inputsOf([
            ["right", { kind: "step-output", stepId: PRODUCER, outputName: "value" }],
        ]);
        expect(resolveBindings(inputs, contextOf({}), STEP)).toEqual({
            ok: false,
            failure: {
                code: "unresolved_binding",
                message: "The value bound to 'right' isn't available",
                path: "/steps/0/inputs/right",
                stepId: STEP,
            },
        });
    });

    // Proves lookups use own members, so a prototype member can't stand in for a missing output.
    test("a prototype member never satisfies a missing output or input", () => {
        const output = inputsOf([
            ["x", { kind: "step-output", stepId: PRODUCER, outputName: "constructor" }],
        ]);
        const completed = contextOf({}, { [PRODUCER]: { value: 1 } });
        expect(resolveBindings(output, completed, STEP).ok).toBe(false);

        // A dotted name is one member name, not a path.
        const dotted = inputsOf([
            ["x", { kind: "step-output", stepId: PRODUCER, outputName: "a.b" }],
        ]);
        const withDotted = contextOf({}, { [PRODUCER]: { "a.b": "one", a: { b: "two" } } });
        expect(resolveBindings(dotted, withDotted, STEP)).toEqual({
            ok: true,
            values: { x: "one" },
        });
    });

    // Proves null and false are resolved values, not missing ones.
    test("falsy values resolve", () => {
        const inputs = inputsOf([
            ["nothing", { kind: "workflow-input", inputName: "nothing" }],
            ["no", { kind: "step-output", stepId: PRODUCER, outputName: "flag" }],
        ]);
        const context = contextOf({ nothing: null }, { [PRODUCER]: { flag: false } });
        expect(resolveBindings(inputs, context, STEP)).toEqual({
            ok: true,
            values: { nothing: null, no: false },
        });
    });

    // Proves an input named __proto__ becomes an own member instead of replacing the prototype.
    test("an input named __proto__ is an own member", () => {
        const inputs = inputsOf([["__proto__", { kind: "literal", value: { polluted: true } }]]);
        const resolved = resolveBindings(inputs, contextOf({}), STEP);
        if (!resolved.ok) {
            throw new Error("Expected the literal to resolve");
        }
        expect(Object.getPrototypeOf(resolved.values)).toBe(Object.prototype);
        expect(Object.getOwnPropertyDescriptor(resolved.values, "__proto__")?.value).toEqual({
            polluted: true,
        });
    });

    // Proves a step with no inputs resolves to an empty object, which a result step returns as is.
    test("no inputs resolve to an empty object", () => {
        expect(resolveBindings(new Map(), contextOf({}), STEP)).toEqual({ ok: true, values: {} });
    });
});
