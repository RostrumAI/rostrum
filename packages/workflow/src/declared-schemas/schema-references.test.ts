import { describe, expect, test } from "bun:test";
import { ReferenceResolver } from "./schema-references";

describe("ReferenceResolver", () => {
    // Proves local pointers resolve to the schema they name, including the root.
    test("resolves local references", () => {
        const root = {
            type: "object",
            $defs: { name: { type: "string" }, pair: { prefixItems: [{ type: "integer" }] } },
        };
        const resolver = new ReferenceResolver(root);

        // The root, a definition, and an array member inside a definition.
        expect(resolver.resolve("#")).toBe(root);
        expect(resolver.resolve("#/$defs/name")).toEqual({ type: "string" });
        expect(resolver.resolve("#/$defs/pair/prefixItems/0")).toEqual({ type: "integer" });
    });

    // Proves escaped pointer tokens decode to the member names they encode.
    test("decodes escaped tokens", () => {
        const resolver = new ReferenceResolver({
            $defs: { "a/b": { type: "string" }, "c~d": { type: "number" }, "e f": true },
        });

        // `~1` is `/`, `~0` is `~`, and percent-encoding is decoded first.
        expect(resolver.resolve("#/$defs/a~1b")).toEqual({ type: "string" });
        expect(resolver.resolve("#/$defs/c~0d")).toEqual({ type: "number" });
        expect(resolver.resolve("#/$defs/e%20f")).toBe(true);
    });

    // Proves references the checker can't follow are refused rather than guessed.
    test("refuses external, malformed, and dangling references", () => {
        const resolver = new ReferenceResolver({ $defs: { name: { type: "string" } } });

        // Another document, a pointer without a leading slash, and a missing member.
        expect(resolver.resolve("other.json#/$defs/name")).toBeUndefined();
        expect(resolver.resolve("#$defs/name")).toBeUndefined();
        expect(resolver.resolve("#/$defs/missing")).toBeUndefined();

        // A member that isn't a schema can't be a reference target.
        expect(new ReferenceResolver({ $defs: { n: 5 } }).resolve("#/$defs/n")).toBeUndefined();
    });

    // Proves inherited members are never reachable through a pointer.
    test("follows own members only", () => {
        const resolver = new ReferenceResolver({ $defs: {} });
        expect(resolver.resolve("#/$defs/constructor")).toBeUndefined();
        expect(resolver.resolve("#/$defs/__proto__")).toBeUndefined();
    });

    // Proves a reference that can lead back to itself is refused, directly or through another.
    test("refuses recursive references", () => {
        const resolver = new ReferenceResolver({
            $defs: {
                list: { type: "array", items: { $ref: "#/$defs/list" } },
                a: { properties: { next: { $ref: "#/$defs/b" } } },
                b: { anyOf: [{ $ref: "#/$defs/a" }, { type: "null" }] },
            },
        });
        expect(resolver.resolve("#/$defs/list")).toBeUndefined();
        expect(resolver.resolve("#/$defs/a")).toBeUndefined();
        expect(resolver.resolve("#/$defs/b")).toBeUndefined();
    });

    // Proves literal values and annotations that mention a reference don't make it recursive.
    test("ignores references that can't apply", () => {
        const resolver = new ReferenceResolver({
            $defs: {
                item: {
                    type: "object",
                    const: { $ref: "#/$defs/item" },
                    examples: [{ $ref: "#/$defs/item" }],
                },
            },
        });
        expect(resolver.resolve("#/$defs/item")).toMatchObject({ type: "object" });
    });

    // Proves resolving the same reference twice gives the same answer.
    test("answers repeated lookups consistently", () => {
        const resolver = new ReferenceResolver({
            $defs: { loop: { $ref: "#/$defs/loop" }, leaf: { type: "string" } },
        });
        expect(resolver.resolve("#/$defs/loop")).toBeUndefined();
        expect(resolver.resolve("#/$defs/loop")).toBeUndefined();
        expect(resolver.resolve("#/$defs/leaf")).toEqual({ type: "string" });
        expect(resolver.resolve("#/$defs/leaf")).toEqual({ type: "string" });
    });
});
