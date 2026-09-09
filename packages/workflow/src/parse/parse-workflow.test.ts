import { describe, expect, test } from "bun:test";
import { parseWorkflow } from "./parse-workflow";

describe("parseWorkflow", () => {
    test("accepts a valid document and carries its text and value", () => {
        const parsed = parseWorkflow(`{"workflowFormatVersion":"v1","name":"x"}`);
        expect(parsed.ok).toBe(true);
        if (parsed.ok) {
            expect(parsed.document).toEqual({ workflowFormatVersion: "v1", name: "x" });
        }
    });

    test("decodes UTF-8 bytes and rejects invalid ones", () => {
        const bytes = new TextEncoder().encode(`{"name":"café"}`);
        const parsed = parseWorkflow(bytes);
        expect(parsed.ok).toBe(true);
        const invalid = parseWorkflow(new Uint8Array([0x7b, 0xff, 0x7d]));
        expect(invalid.ok).toBe(false);
        if (!invalid.ok) {
            expect(invalid.findings[0]?.code).toBe("workflow.parse.invalid-utf8");
            expect(invalid.findings[0]?.blocking).toBe(true);
        }
    });

    test("maps invalid JSON to a blocking finding with a location", () => {
        const parsed = parseWorkflow(`{\n  "name": "x",,\n}`);
        expect(parsed.ok).toBe(false);
        if (!parsed.ok) {
            expect(parsed.findings).toHaveLength(1);
            expect(parsed.findings[0]?.code).toBe("workflow.parse.json-invalid");
            expect(parsed.findings[0]?.blocking).toBe(true);
            expect(parsed.findings[0]?.line).toBe(2);
        }
    });

    test("maps duplicate keys to a blocking finding and preserves details", () => {
        const parsed = parseWorkflow(`{"name":"a","name":"b"}`);
        expect(parsed.ok).toBe(false);
        if (!parsed.ok) {
            const finding = parsed.findings[0];
            expect(finding?.code).toBe("workflow.parse.duplicate-key");
            expect(finding?.details).toEqual({
                key: "name",
                firstOccurrence: { line: 1, column: 2 },
            });
        }
    });

    test("rejects the JSON-incompatible NaN and Infinity literals", () => {
        const parsed = parseWorkflow(`{"name":NaN}`);
        expect(parsed.ok).toBe(false);
        if (!parsed.ok) {
            expect(parsed.findings[0]?.code).toBe("workflow.parse.json-invalid");
        }
    });
});
