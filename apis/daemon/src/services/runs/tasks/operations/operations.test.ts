import { describe, expect, test } from "bun:test";
import { ADD } from "./add";
import { DIVIDE } from "./divide";
import { GREET } from "./greet";
import { createOperationRegistry, getRegistryCatalog } from "./operation-registry";

const signal = new AbortController().signal;

describe("greet", () => {
    // Proves the greeting wraps the name exactly, even when the name is empty.
    test("greets by name", async () => {
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
        const max = Number.MAX_VALUE;
        for (const [left, right] of [
            [max, max],
            [-max, -max],
        ] as const) {
            const outcome = await ADD.execute({ config: {}, inputs: { left, right }, signal });
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
        expect(
            await DIVIDE.execute({ config: {}, inputs: { dividend: 90, divisor: 4 }, signal }),
        ).toEqual({ ok: true, output: { value: 22.5 } });
    });

    // Proves both signs of zero are a division by zero located at the divisor.
    test("reports division by zero and by negative zero", async () => {
        for (const divisor of [0, -0]) {
            const outcome = await DIVIDE.execute({
                config: {},
                inputs: { dividend: 100, divisor },
                signal,
            });
            expect(outcome.ok ? undefined : [outcome.failure.code, outcome.failure.path]).toEqual([
                "division_by_zero",
                "/inputs/divisor",
            ]);
        }
    });

    // Proves a quotient beyond the largest finite number is an overflow, not infinity.
    test("reports numeric overflow", async () => {
        const outcome = await DIVIDE.execute({
            config: {},
            inputs: { dividend: Number.MAX_VALUE, divisor: 0.5 },
            signal,
        });
        expect(outcome.ok ? undefined : [outcome.failure.code, outcome.failure.path]).toEqual([
            "numeric_overflow",
            "/outputs/value",
        ]);
    });
});

describe("the registry", () => {
    // Proves the registry pairs each implementation with its declaration, under that name.
    test("each implementation is registered under its declaration's name", () => {
        const registry = createOperationRegistry();
        expect([...registry.keys()].sort()).toEqual(["add", "divide", "greet"]);
        expect([...getRegistryCatalog(registry).values()]).toEqual(
            [...registry.values()].map((operation) => operation.declaration),
        );
    });
});
