import { describe, expect, test } from "bun:test";
import { createWorkflowValidator } from "@rostrum/workflow";
import { insertWorkflowId, isJsonObject, parseWorkflow, replaceWorkflowId } from "./documents";

const MINTED_ID = "0192b0a0-7e1d-7000-8000-0000000000aa";

describe("parseWorkflow", () => {
    test("accepts a valid document and carries its text and value", () => {
        const parsed = parseWorkflow(`{"interfaceVersion":"v1","name":"x"}`);
        expect(parsed.ok).toBe(true);
        if (parsed.ok) {
            expect(parsed.document).toEqual({ interfaceVersion: "v1", name: "x" });
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

describe("replaceWorkflowId", () => {
    test("replaces an existing string id and keeps the rest of the text byte-identical", () => {
        const text = `{\n  "id": "0192b0a0-7e1d-7000-8000-000000000001",\n  "name": "x"\n}`;
        const spliced = replaceWorkflowId(text, MINTED_ID);
        expect(spliced).toBe(`{\n  "id": "${MINTED_ID}",\n  "name": "x"\n}`);
    });

    test("replaces a non-string id value", () => {
        const spliced = replaceWorkflowId(`{"id":{"nested":[1,2,3]},"name":"x"}`, MINTED_ID);
        expect(JSON.parse(spliced)).toEqual({ id: MINTED_ID, name: "x" });
    });

    test("inserts the id member when the object has none", () => {
        const spliced = replaceWorkflowId(`{"name":"x"}`, MINTED_ID);
        expect(JSON.parse(spliced)).toEqual({ id: MINTED_ID, name: "x" });
        expect(spliced.startsWith(`{"id":"${MINTED_ID}","name"`)).toBe(true);
    });

    test("inserts into an empty object without a trailing comma", () => {
        const spliced = replaceWorkflowId(`{}`, MINTED_ID);
        expect(spliced).toBe(`{"id":"${MINTED_ID}"}`);
    });

    test("inserts into an empty object with inner whitespace", () => {
        const spliced = replaceWorkflowId(`{  \n}`, MINTED_ID);
        expect(JSON.parse(spliced)).toEqual({ id: MINTED_ID });
    });

    test("splices correctly across CRLF line endings", () => {
        const text = `{\r\n  "name": "x",\r\n  "id": "old"\r\n}`;
        const spliced = replaceWorkflowId(text, MINTED_ID);
        expect(JSON.parse(spliced)).toEqual({ name: "x", id: MINTED_ID });
    });

    test("leaves a non-object root unchanged", () => {
        expect(replaceWorkflowId(`[1,2,3]`, MINTED_ID)).toBe(`[1,2,3]`);
        expect(replaceWorkflowId(`"text"`, MINTED_ID)).toBe(`"text"`);
        expect(replaceWorkflowId(`null`, MINTED_ID)).toBe(`null`);
    });

    test("never touches id members nested inside other values", () => {
        const text = `{"name":"x","steps":[{"id":"inner"}]}`;
        const spliced = replaceWorkflowId(text, MINTED_ID);
        // The root gains the injected id; the nested member stays as-is.
        expect(JSON.parse(spliced)).toEqual({
            id: MINTED_ID,
            name: "x",
            steps: [{ id: "inner" }],
        });
    });
});

describe("insertWorkflowId", () => {
    test("inserts the addressed id when the document omits it", () => {
        const spliced = insertWorkflowId(`{ "name": "x" }`, MINTED_ID);
        expect(JSON.parse(spliced)).toEqual({ id: MINTED_ID, name: "x" });
    });

    test("inserts into an empty object without a trailing comma", () => {
        const spliced = insertWorkflowId(`{}`, MINTED_ID);
        expect(spliced).toBe(`{"id":"${MINTED_ID}"}`);
    });

    test("refuses a document that already carries an id member", () => {
        expect(() => insertWorkflowId(`{"id":"x"}`, MINTED_ID)).toThrow(/already carries/);
    });

    test("leaves a non-object root unchanged", () => {
        expect(insertWorkflowId(`[]`, MINTED_ID)).toBe(`[]`);
    });
});

describe("isJsonObject", () => {
    test("accepts plain objects and rejects arrays and primitives", () => {
        expect(isJsonObject({})).toBe(true);
        expect(isJsonObject([])).toBe(false);
        expect(isJsonObject(null)).toBe(false);
        expect(isJsonObject("x")).toBe(false);
    });
});

describe("findings anchor to the spliced text", () => {
    test("a finding after the inserted id points into the stored text", () => {
        // The inserted id member shifts every later line; findings must
        // anchor to the stored (spliced) text, not the submitted one.
        const spliced = insertWorkflowId(
            `{\n  "name": "x",\n  "firstNode": "missing"\n}`,
            MINTED_ID,
        );
        const result = createWorkflowValidator().validate(spliced);
        expect(result.validForPublication).toBe(false);
        expect(result.findings.length).toBeGreaterThan(0);
        const lines = spliced.split("\n");
        for (const finding of result.findings) {
            if (finding.line === undefined) continue;
            const lineText = lines[finding.line - 1] ?? "";
            expect(lineText).not.toBe("");
        }
    });
});
