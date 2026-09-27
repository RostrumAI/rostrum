/**
 * @fileoverview Tests the daemon's built-in operation implementations and
 * the registry that pairs them with their catalog declarations. Tasks rely
 * on these implementations for their outputs and domain failures, and the
 * preparer checks publications against the catalog the registry derives.
 *
 * greet:
 * - greets by name: wraps the name in `Hello, <name>!`, including an empty name.
 *
 * add:
 * - adds two numbers: whole and fractional sums use plain number arithmetic.
 * - reports numeric overflow instead of returning infinity: sums beyond the
 *   largest finite number, positive or negative, fail with
 *   `numeric_overflow` at `/outputs/value`.
 *
 * divide:
 * - divides: returns an ordinary quotient unchanged.
 * - reports division by zero and by negative zero: both fail with
 *   `division_by_zero` at `/inputs/divisor`.
 * - reports numeric overflow: a quotient beyond the largest finite number
 *   fails with `numeric_overflow` at `/outputs/value`.
 *
 * the registry:
 * - each implementation is registered under its declaration's name: the
 *   registry holds exactly greet, add, and divide, and the derived catalog
 *   lists their declarations.
 */

import { describe, expect, test } from "bun:test";
import { ADD } from "./add";
import { DIVIDE } from "./divide";
import { GREET } from "./greet";
import { createOperationRegistry, getRegistryCatalog } from "./operation-registry";

const signal = new AbortController().signal;

describe("greet", () => {
    // Proves the greeting wraps the name exactly, even when the name is empty.
    test("greets by name", async () => {
        // An ordinary name and an empty name both produce the full greeting.
        expect(await GREET.execute({ config: {}, inputs: { name: "Ada" }, signal })).toEqual({
            ok: true,
            output: { greeting: "Hello, Ada!" },
        });
        expect(await GREET.execute({ config: {}, inputs: { name: "" }, signal })).toEqual({
            ok: true,
            output: { greeting: "Hello, !" },
        });
    });
});

describe("add", () => {
    // Proves ordinary sums, including fractions, use plain JSON-number arithmetic.
    test("adds two numbers", async () => {
        // Whole numbers and fractions sum exactly as JavaScript numbers do.
        expect(await ADD.execute({ config: {}, inputs: { left: 90, right: 10 }, signal })).toEqual({
            ok: true,
            output: { value: 100 },
        });
        expect(
            await ADD.execute({ config: {}, inputs: { left: 0.1, right: 0.2 }, signal }),
        ).toEqual({
            ok: true,
            output: { value: 0.1 + 0.2 },
        });
    });

    // Proves a sum beyond the largest finite number is a located overflow, in both directions.
    test("reports numeric overflow instead of returning infinity", async () => {
        // The largest finite number added to itself overflows, positively and negatively.
        const max = Number.MAX_VALUE;
        for (const [left, right] of [
            [max, max],
            [-max, -max],
        ] as const) {
            const outcome = await ADD.execute({ config: {}, inputs: { left, right }, signal });

            // Each is a numeric overflow located at the output, not an infinite value.
            expect(outcome.ok ? undefined : [outcome.failure.code, outcome.failure.path]).toEqual([
                "numeric_overflow",
                "/outputs/value",
            ]);
        }
    });
});

describe("divide", () => {
    // Proves an ordinary quotient is returned as is.
    test("divides", async () => {
        // A fractional quotient comes back unchanged.
        expect(
            await DIVIDE.execute({ config: {}, inputs: { dividend: 90, divisor: 4 }, signal }),
        ).toEqual({ ok: true, output: { value: 22.5 } });
    });

    // Proves both signs of zero are a division by zero located at the divisor.
    test("reports division by zero and by negative zero", async () => {
        // Both zeros are tried as the divisor.
        for (const divisor of [0, -0]) {
            const outcome = await DIVIDE.execute({
                config: {},
                inputs: { dividend: 100, divisor },
                signal,
            });

            // Each is a division by zero located at the divisor.
            expect(outcome.ok ? undefined : [outcome.failure.code, outcome.failure.path]).toEqual([
                "division_by_zero",
                "/inputs/divisor",
            ]);
        }
    });

    // Proves a quotient beyond the largest finite number is an overflow, not infinity.
    test("reports numeric overflow", async () => {
        // Halving the divisor below one doubles the largest finite number past the limit.
        const outcome = await DIVIDE.execute({
            config: {},
            inputs: { dividend: Number.MAX_VALUE, divisor: 0.5 },
            signal,
        });

        // The overflow is reported at the output rather than returning infinity.
        expect(outcome.ok ? undefined : [outcome.failure.code, outcome.failure.path]).toEqual([
            "numeric_overflow",
            "/outputs/value",
        ]);
    });
});

describe("the registry", () => {
    // Proves the registry pairs each implementation with its declaration, under that name.
    test("each implementation is registered under its declaration's name", () => {
        // The release registry holds exactly the three operations.
        const registry = createOperationRegistry();
        expect([...registry.keys()].sort()).toEqual(["add", "divide", "greet"]);

        // The catalog it derives lists the same declarations the implementations carry.
        expect([...getRegistryCatalog(registry).values()]).toEqual(
            [...registry.values()].map((operation) => operation.declaration),
        );
    });
});
