import { describe, expect, test } from "bun:test";
import { JsonSourceParser } from "./json-source-parser";

describe("valid JSON", () => {
    test("parses scalars, arrays, and objects", () => {
        const result = new JsonSourceParser('{"a": [1, -2.5e+3, true, false, null, "s"]}').parse();
        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }
        expect(result.value).toEqual({ a: [1, -2500, true, false, null, "s"] });
    });

    test("records a source pointer for every value, one-based", () => {
        const result = new JsonSourceParser('{\n  "a": {\n    "b": 1\n  }\n}').parse();
        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }
        expect(result.sourceMap[""]?.value).toEqual({ line: 1, column: 1 });
        expect(result.sourceMap["/a"]?.value).toEqual({ line: 2, column: 8 });
        expect(result.sourceMap["/a/b"]?.value).toEqual({ line: 3, column: 10 });
        expect(result.sourceMap["/a/b"]?.valueEnd).toEqual({ line: 3, column: 11 });
    });

    test("escapes reference tokens in pointers", () => {
        const result = new JsonSourceParser('{"a/b": 1, "c~d": 2}').parse();
        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }
        expect(Object.keys(result.sourceMap)).toContain("/a~1b");
        expect(Object.keys(result.sourceMap)).toContain("/c~0d");
    });

    test("decodes unicode escapes and surrogate pairs", () => {
        const result = new JsonSourceParser('["\\u0041", "\\ud83d\\ude00", "\\ud800"]').parse();
        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }
        expect(result.value).toEqual(["A", "😀", "\ud800"]);
    });

    test("strips a UTF-8 byte order mark from byte input", () => {
        const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('{"a":1}')]);
        const result = new JsonSourceParser(bytes).parse();
        expect(result.ok).toBe(true);
    });
});

describe("duplicate keys", () => {
    test("are errors with the location of the second occurrence", () => {
        const result = new JsonSourceParser('{"a": 1,\n  "a": 2}').parse();
        expect(result.ok).toBe(false);
        if (result.ok) {
            return;
        }
        expect(result.issues).toHaveLength(1);
        const issue = result.issues[0];
        expect(issue?.code).toBe("workflow.parse.duplicate-key");
        expect(issue?.path).toBe("/a");
        expect(issue?.line).toBe(2);
        expect(issue?.column).toBe(3);
        expect(issue?.details).toEqual({ key: "a", firstOccurrence: { line: 1, column: 2 } });
    });

    test("are reported for every duplicated key, including nested objects", () => {
        const result = new JsonSourceParser('{"steps": [{"id": 1, "id": 2}], "steps": []}').parse();
        expect(result.ok).toBe(false);
        if (result.ok) {
            return;
        }
        expect(result.issues.map((issue) => issue.path).sort()).toEqual(["/steps", "/steps/0/id"]);
    });
});

describe("syntax errors", () => {
    const cases: Array<[string, string]> = [
        ["NaN", "NaN literal"],
        ["Infinity", "Infinity literal"],
        ["-Infinity", "-Infinity literal"],
        ["{not json", "garbage token"],
        ["{'a': 1}", "single quotes"],
        ['{"a" 1}', "missing colon"],
        ["[1,]", "trailing comma"],
        ['{"a": 01}', "leading zero"],
        ['{"a": +1}', "plus sign"],
        ['{"a": .5}', "bare fraction"],
        ['{"a": 1.}', "trailing point"],
        ['{"a": "b}', "unterminated string"],
        ['{"a": "b\\x"}', "invalid escape"],
        ['{"a": "\u0001"}', "raw control character"],
        ['{"a": 1} extra', "trailing content"],
        ["", "empty input"],
        ["  \n  ", "whitespace-only input"],
    ];

    for (const [input, name] of cases) {
        test(`rejects ${name}`, () => {
            const result = new JsonSourceParser(input).parse();
            expect(result.ok).toBe(false);
            if (result.ok) {
                return;
            }
            expect(result.issues).toHaveLength(1);
            expect(result.issues[0]?.code).toBe("workflow.parse.json-invalid");
            expect(result.issues[0]?.line).toBeGreaterThan(0);
            expect(result.issues[0]?.column).toBeGreaterThan(0);
        });
    }

    test("reports the position of the offending character", () => {
        const result = new JsonSourceParser('{\n  "a": NaN\n}').parse();
        expect(result.ok).toBe(false);
        if (result.ok) {
            return;
        }
        expect(result.issues[0]?.line).toBe(2);
        expect(result.issues[0]?.column).toBe(8);
    });
});

describe("byte input", () => {
    test("rejects invalid UTF-8", () => {
        const result = new JsonSourceParser(new Uint8Array([0x22, 0xc0, 0x80, 0x22])).parse();
        expect(result.ok).toBe(false);
        if (result.ok) {
            return;
        }
        expect(result.issues[0]?.code).toBe("workflow.parse.invalid-utf8");
    });
});
