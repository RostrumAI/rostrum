/**
 * @fileoverview Unit tests for the schema keyword vocabulary that the
 * containment check reads JSON Schemas with. The checker relies on these
 * helpers to classify values, read keyword values without throwing, and
 * compare JSON literals, so a wrong answer here changes every binding verdict.
 *
 * value kinds:
 * - classifies each JSON value: null, boolean, string, array, and object map
 *   to their kinds; whole numbers (including `3.0`) are `integer`, others `fraction`.
 * - maps type names to the kinds they allow: `number` spans both numeric
 *   kinds, and an unknown name such as `decimal` allows none.
 * - names a type that allows each kind: every kind round-trips to a type name
 *   whose kinds include it.
 *
 * keyword readers:
 * - read malformed values as empty: a non-list, non-object, or wrong-shaped
 *   keyword value reads as an empty list or record.
 * - drop members of the wrong kind: list readers keep only schemas or strings.
 * - read a type as a list of names: a single name and a list read the same way.
 * - keep property names exactly: `__proto__` stays an ordinary named member
 *   and non-schema members are dropped.
 *
 * JSON helpers:
 * - isObject rejects arrays and null.
 * - isSameJson compares canonical forms: member order is ignored, array order
 *   and value types are not.
 */
import { describe, expect, test } from "bun:test";
import {
    ALL_KINDS,
    getKindTypeName,
    getTypeKinds,
    getValueKind,
    isObject,
    isSameJson,
    readSchemaList,
    readSchemaRecord,
    readStringList,
    readTypeList,
} from "./schema-keywords";

describe("value kinds", () => {
    // Proves every JSON value lands in exactly the kind `type` would test it against.
    test("classifies each JSON value", () => {
        expect(getValueKind(null)).toBe("null");
        expect(getValueKind(true)).toBe("boolean");
        expect(getValueKind("")).toBe("string");
        expect(getValueKind([])).toBe("array");
        expect(getValueKind({})).toBe("object");

        // Whole numbers are integers even when written with a fraction part.
        expect(getValueKind(3)).toBe("integer");
        expect(getValueKind(3.0)).toBe("integer");
        expect(getValueKind(3.5)).toBe("fraction");
    });

    // Proves `number` spans both numeric kinds and an unknown type name allows nothing.
    test("maps type names to the kinds they allow", () => {
        expect(getTypeKinds("number")).toEqual(["integer", "fraction"]);
        expect(getTypeKinds("integer")).toEqual(["integer"]);
        expect(getTypeKinds("string")).toEqual(["string"]);
        expect(getTypeKinds("decimal")).toEqual([]);
    });

    // Proves each kind maps back to a type name that allows it.
    test("names a type that allows each kind", () => {
        for (const kind of ALL_KINDS) {
            expect(getTypeKinds(getKindTypeName(kind))).toContain(kind);
        }
    });
});

describe("keyword readers", () => {
    // Proves malformed keyword values read as absent instead of throwing.
    test("read malformed values as empty", () => {
        expect(readSchemaList("not a list")).toEqual([]);
        expect(readSchemaRecord([{ type: "string" }]).size).toBe(0);
        expect(readStringList({ a: "b" })).toEqual([]);
        expect(readTypeList(7)).toEqual([]);
    });

    // Proves list readers keep only members of the expected kind.
    test("drop members of the wrong kind", () => {
        expect(readSchemaList([{ type: "string" }, true, 1, null])).toEqual([
            { type: "string" },
            true,
        ]);
        expect(readStringList(["a", 1, "b"])).toEqual(["a", "b"]);
    });

    // Proves a single type name and a list of names read the same way.
    test("read a type as a list of names", () => {
        expect(readTypeList("string")).toEqual(["string"]);
        expect(readTypeList(["string", "null"])).toEqual(["string", "null"]);
    });

    // Proves author-chosen member names, including prototype names, are kept as ordinary keys.
    test("keep property names exactly", () => {
        const properties = JSON.parse('{"__proto__": {"type": "string"}, "a": 1}');
        const record = readSchemaRecord(properties);

        // The non-schema member is dropped; `__proto__` stays a named member.
        expect([...record.keys()]).toEqual(["__proto__"]);
        expect(record.get("__proto__")).toEqual({ type: "string" });
    });
});

describe("JSON helpers", () => {
    // Proves only plain objects count as objects.
    test("isObject rejects arrays and null", () => {
        expect(isObject({})).toBe(true);
        expect(isObject([])).toBe(false);
        expect(isObject(null)).toBe(false);
    });

    // Proves equality ignores member order but not values or types.
    test("isSameJson compares canonical forms", () => {
        expect(isSameJson({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
        expect(isSameJson([1, 2], [2, 1])).toBe(false);
        expect(isSameJson(1, "1")).toBe(false);
    });
});
