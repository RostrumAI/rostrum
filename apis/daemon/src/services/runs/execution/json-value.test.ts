import { describe, expect, test } from "bun:test";
import type { JsonObject } from "@rostrum/workflow/execution";
import { checkJsonValue, copyJsonValue, freezeJsonValue, MAX_VALUE_DEPTH } from "./json-value";

describe("JSON value checks", () => {
    test("accepts JSON of every kind within the depth bound", () => {
        const value = { text: "a", count: 1, flag: true, missing: null, list: [1, {}] };

        // Every JSON kind is accepted and returned as the same value.
        const result = checkJsonValue(value, MAX_VALUE_DEPTH);
        expect(result.ok).toBe(true);
        expect(result.ok && result.value).toBe(value);
    });

    test("rejects values JSON cannot represent, locating each failure", () => {
        const cyclic: Record<string, unknown> = { name: "x" };
        cyclic.self = cyclic;

        // A cycle, a hole, a non-finite number, an accessor, an exotic object,
        // and a function are each refused at the member that carries them.
        expect(checkJsonValue(cyclic, MAX_VALUE_DEPTH)).toMatchObject({
            ok: false,
            code: "invalid_json",
            path: "/self",
        });
        const sparse: unknown[] = [1, 3];
        delete sparse[1];
        expect(checkJsonValue(sparse, MAX_VALUE_DEPTH)).toMatchObject({
            ok: false,
            code: "invalid_json",
            path: "/1",
        });
        expect(checkJsonValue({ list: [1, 3, 5] }, MAX_VALUE_DEPTH).ok).toBe(true);
        expect(
            checkJsonValue(
                { list: [1, 2, 3].map((n) => (n === 2 ? undefined : n)) },
                MAX_VALUE_DEPTH,
            ),
        ).toMatchObject({
            ok: false,
            code: "invalid_json",
            path: "/list/1",
        });
        expect(checkJsonValue({ n: Number.NaN }, MAX_VALUE_DEPTH)).toMatchObject({
            ok: false,
            code: "invalid_json",
            path: "/n",
        });
        expect(
            checkJsonValue(
                Object.defineProperty({}, "n", { enumerable: true, get: () => 1 }),
                MAX_VALUE_DEPTH,
            ),
        ).toMatchObject({ ok: false, code: "invalid_json", path: "/n" });
        expect(checkJsonValue({ d: new Map() }, MAX_VALUE_DEPTH)).toMatchObject({
            ok: false,
            code: "invalid_json",
            path: "/d",
        });
        expect(checkJsonValue({ f: () => 1 }, MAX_VALUE_DEPTH)).toMatchObject({
            ok: false,
            code: "invalid_json",
            path: "/f",
        });
    });

    test("accepts the same object twice in different positions but not inside itself", () => {
        const shared = { id: 1 };

        // Repeated data is representable; only a reference back to an ancestor is a cycle.
        expect(checkJsonValue({ first: shared, second: shared }, MAX_VALUE_DEPTH).ok).toBe(true);
        expect(
            checkJsonValue({ outer: { inner: shared }, again: shared }, MAX_VALUE_DEPTH).ok,
        ).toBe(true);
    });

    test("counts the root container as level one and names the depth it refused", () => {
        // Level one is the root, so a value nested to the limit is accepted and
        // one level more is refused at the container that crossed the limit.
        expect(checkJsonValue({ child: { child: 1 } }, 3).ok).toBe(true);
        expect(checkJsonValue({ child: { child: { child: { child: 1 } } } }, 3)).toMatchObject({
            ok: false,
            code: "value_depth",
            path: "/child/child/child",
        });
    });
});

describe("owned JSON copies", () => {
    test("copies a value so later mutation of the source is not observable", () => {
        const source = { nested: { count: 1 }, list: [1, 2] };
        const copy = copyJsonValue(source as JsonObject);

        // The copy owns its own containers and is frozen at every level.
        source.nested.count = 2;
        source.list.push(3);
        expect(copy).toEqual({ nested: { count: 1 }, list: [1, 2] });
        expect(Object.isFrozen(copy)).toBe(true);
        expect(Object.isFrozen((copy as JsonObject).nested)).toBe(true);
        expect(Object.isFrozen((copy as JsonObject).list)).toBe(true);
    });

    test("copies prototype-sensitive and dotted names as ordinary own members", () => {
        const source = JSON.parse('{"__proto__":{"polluted":true},"a.b":{"c":1}}') as JsonObject;

        // Names such as `__proto__` and dotted names stay flat own members, so a
        // copy can neither pollute a prototype nor be read as a nested path.
        const copy = copyJsonValue(source) as JsonObject;
        expect(Object.hasOwn(copy, "__proto__")).toBe(true);
        expect(Object.hasOwn(copy, "a.b")).toBe(true);
        expect(Object.getPrototypeOf(copy)).toBeNull();
        expect((copy["a.b"] as JsonObject).c).toBe(1);
        expect((Object.prototype as unknown as JsonObject).polluted).toBeUndefined();
    });

    test("freezes a value the daemon already owns without replacing it", () => {
        const value = { nested: { count: 1 } };
        const frozen = freezeJsonValue(value as JsonObject);

        // The same value comes back frozen in place, so an owned document is not copied again.
        expect(frozen).toBe(value);
        expect(Object.isFrozen(frozen)).toBe(true);
        expect(Object.isFrozen(value.nested)).toBe(true);
    });
});
