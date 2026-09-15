/** @fileoverview Named-schema tests: the pairing a service documents by. */

import { describe, expect, test } from "bun:test";
import { Type } from "typebox";
import { defineSchema, isDefinedSchema, schemaOf } from "./schema";

const itemSchema = Type.Object({ value: Type.String() });

describe("named schemas", () => {
    test("pairs a schema with the component name it is documented under", () => {
        const item = defineSchema("Item", itemSchema);

        expect(item.name).toBe("Item");
        expect(item.schema).toBe(itemSchema);
    });

    test("distinguishes a named schema from a schema declared inline", () => {
        expect(isDefinedSchema(defineSchema("Item", itemSchema))).toBe(true);
        expect(isDefinedSchema(itemSchema)).toBe(false);
        // A schema is not mistaken for a name binding, and neither is a non-object.
        expect(isDefinedSchema({ name: "Item" })).toBe(false);
        expect(isDefinedSchema({ name: 1, schema: itemSchema })).toBe(false);
        expect(isDefinedSchema(null)).toBe(false);
    });

    test("stands for the schema itself wherever a schema is required", () => {
        expect(schemaOf(defineSchema("Item", itemSchema))).toBe(itemSchema);
        expect(schemaOf(itemSchema)).toBe(itemSchema);
    });
});
