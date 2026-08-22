import { describe, expect, test } from "bun:test";
import { Compile } from "typebox/compile";
import { type WorkflowInterfaceVersion, workflowInterfaceVersionSchema } from "./index.ts";

describe("package boundary", () => {
    test("the entry exports the interface version type", () => {
        const version: WorkflowInterfaceVersion = "v1";
        expect(version).toBe("v1");
    });
});

describe("toolchain seam (E1-S0 proof-of-concept row 1)", () => {
    test("TypeBox schemas validate through Compile", () => {
        const compiled = Compile(workflowInterfaceVersionSchema);
        expect(compiled.Check("v1")).toBe(true);
        expect(compiled.Check("v2")).toBe(false);
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
