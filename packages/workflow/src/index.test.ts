import { describe, expect, test } from "bun:test";
import { Compile } from "typebox/compile";
import { WorkflowDocument } from "./index.ts";

describe("package boundary", () => {
    test("the entry exports the format v1 document schema", () => {
        const schema: unknown = WorkflowDocument;
        if (typeof schema === "object" && schema !== null && "properties" in schema) {
            const properties = schema.properties;
            if (
                typeof properties === "object" &&
                properties !== null &&
                "workflowFormatVersion" in properties
            ) {
                expect(properties.workflowFormatVersion).toEqual({
                    type: "string",
                    const: "v1",
                });
                return;
            }
        }
        throw new Error("WorkflowDocument.properties.workflowFormatVersion is missing");
    });
});

describe("toolchain seam (TypeBox proof-of-concept)", () => {
    test("TypeBox schemas validate through Compile", () => {
        const compiled = Compile(WorkflowDocument);
        expect(compiled.Check({ workflowFormatVersion: "v2" })).toBe(false);
    });

    test("native JSON Schema validates through Compile", () => {
        const schema = {
            type: "object",
            properties: { id: { type: "string" } },
            required: ["id"],
            additionalProperties: false,
        } as const;
        const compiled = Compile(schema);
        expect(compiled.Check({ id: "x" })).toBe(true);
        expect(compiled.Check({ id: 1 })).toBe(false);
        expect(compiled.Check({})).toBe(false);
    });
});
