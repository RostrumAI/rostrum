import { describe, expect, test } from "bun:test";
import { deepFreeze, ownedCopy } from "./owned-values";

describe("ownedCopy", () => {
    // Proves the copy is detached, so later changes to the input never reach the holder.
    test("detaches the copy from its input", () => {
        const input = { amounts: [1, 2], nested: { name: "Ada" } };
        const copy = ownedCopy(input);

        // Changing the input afterwards leaves the copy as it was.
        input.amounts.push(3);
        input.nested.name = "Grace";
        expect(copy).toEqual({ amounts: [1, 2], nested: { name: "Ada" } });
    });

    // Proves every level of the copy is frozen, so the holder can't change it either.
    test("freezes every level", () => {
        const copy = ownedCopy({ amounts: [1, 2], nested: { name: "Ada" } });
        expect([
            Object.isFrozen(copy),
            Object.isFrozen(copy.amounts),
            Object.isFrozen(copy.nested),
        ]).toEqual([true, true, true]);
    });

    // Proves an author-chosen `__proto__` key stays an ordinary own member rather than a prototype.
    test("keeps __proto__ as an own member", () => {
        const parsed: Record<string, unknown> = JSON.parse('{"__proto__": {"polluted": true}}');
        const copy = ownedCopy(parsed);

        // The member survives the copy, and the copy's prototype is untouched.
        expect(Object.hasOwn(copy, "__proto__")).toBe(true);
        expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
        expect("polluted" in copy).toBe(false);
    });

    // Proves primitives and null pass through unchanged.
    test("returns primitives as they are", () => {
        expect([ownedCopy(1), ownedCopy("a"), ownedCopy(null), ownedCopy(true)]).toEqual([
            1,
            "a",
            null,
            true,
        ]);
    });
});

describe("deepFreeze", () => {
    // Proves nesting far deeper than the call stack allows is frozen without overflowing.
    test("freezes deeply nested values", () => {
        // Twenty thousand nested arrays would overflow a recursive walk.
        const deep: unknown[] = [];
        let innermost = deep;
        for (let depth = 0; depth < 20_000; depth++) {
            const next: unknown[] = [];
            innermost.push(next);
            innermost = next;
        }

        // The outermost and innermost levels are both frozen.
        deepFreeze(deep);
        expect(Object.isFrozen(deep)).toBe(true);
        expect(Object.isFrozen(innermost)).toBe(true);
    });

    // Proves a very wide value is frozen member by member.
    test("freezes wide values", () => {
        const wide = Array.from({ length: 200_000 }, (_, index) => ({ index }));
        deepFreeze(wide);
        expect(Object.isFrozen(wide)).toBe(true);
        expect(Object.isFrozen(wide[wide.length - 1])).toBe(true);
    });

    // Proves a value that's already frozen, and values shared between members, are handled once.
    test("handles frozen and shared members", () => {
        const shared = { name: "Ada" };
        const value = { first: shared, second: shared, done: Object.freeze({ ok: true }) };
        expect(deepFreeze(value)).toBe(value);
        expect(Object.isFrozen(shared)).toBe(true);
    });
});
