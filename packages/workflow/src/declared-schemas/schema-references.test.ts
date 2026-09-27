/**
 * @fileoverview Unit tests for ReferenceResolver, which resolves local `$ref`
 * pointers for the containment check. The checker inlines whatever the
 * resolver returns, so the resolver must refuse references it can't follow
 * safely: external, malformed, dangling, inherited, or recursive ones.
 *
 * ReferenceResolver:
 * - resolves local references: `#` returns the root, and pointers reach a
 *   definition and an array member inside one.
 * - decodes escaped tokens: `~1` becomes `/`, `~0` becomes `~`, and
 *   percent-encoding is decoded.
 * - refuses external, malformed, and dangling references: another document, a
 *   pointer without a leading slash, a missing member, and a non-schema target
 *   all resolve to undefined.
 * - follows own members only: `constructor` and `__proto__` are unreachable.
 * - refuses malformed percent-encoding: a bad escape resolves to undefined
 *   instead of throwing.
 * - refuses recursive references: direct self-reference and a cycle through
 *   another definition both resolve to undefined.
 * - finds recursion through properties named like keywords: a member called
 *   `title` or matching `^const$` is still walked as a schema.
 * - ignores references that can't apply: a `$ref` inside `const` or `examples`
 *   doesn't make a definition recursive.
 * - answers repeated lookups consistently: cached recursion answers match the
 *   first lookup for recursive and plain definitions.
 */
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

    // Proves a malformed percent-escape is a dangling reference, not a thrown URIError.
    test("refuses malformed percent-encoding", () => {
        const resolver = new ReferenceResolver({ $defs: { name: { type: "string" } } });
        expect(resolver.resolve("#/%E0%A4%A")).toBeUndefined();
    });

    // Proves a cycle through a property named like an annotation keyword is still found.
    test("finds recursion through properties named like keywords", () => {
        const resolver = new ReferenceResolver({
            $defs: {
                node: { type: "object", properties: { title: { $ref: "#/$defs/node" } } },
                leaf: { patternProperties: { "^const$": { $ref: "#/$defs/leaf" } } },
            },
        });
        expect(resolver.resolve("#/$defs/node")).toBeUndefined();
        expect(resolver.resolve("#/$defs/leaf")).toBeUndefined();
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
