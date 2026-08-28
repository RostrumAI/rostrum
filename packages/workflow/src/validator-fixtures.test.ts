import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { compareFindings, type Finding } from "./findings";
import { JsonSourceParser } from "./parse/json-source-parser";
import { createWorkflowValidator } from "./workflow-validator";

/**
 * The shared validator fixture suite: every non-valid fixture asserts its
 * full expected validator output from a committed manifest, so the
 * workflow library, the Control API, and any future consumer prove
 * their behavior against the same input files and expected results.
 *
 * Each expected finding records `code`, `blocking`, `path`,
 * `relatedLocations`, `details`, and — because fixtures are text — the
 * `line` and `column` the source map assigns. Message text is not part
 * of the contract and is not asserted.
 */

const FIXTURES_DIR = join(import.meta.dir, "fixtures");
const CATEGORIES = ["incomplete", "invalid-shape", "invalid-parse"] as const;
const validator = createWorkflowValidator();

for (const category of CATEGORIES) {
    const files = readdirSync(join(FIXTURES_DIR, category))
        .filter((file) => file.endsWith(".json"))
        .sort();

    for (const file of files) {
        test(`${category}/${file}`, () => {
            const text = readFileSync(join(FIXTURES_DIR, category, file), "utf8");
            const result = validator.validate(text);
            const expected = JSON.parse(
                readFileSync(join(FIXTURES_DIR, "expected", category, file), "utf8"),
            ) as { validForPublication: boolean; findings: Omit<Finding, "message">[] };

            expect(result.findings.map(({ message: _message, ...finding }) => finding)).toEqual(
                expected.findings,
            );
            expect(result.validForPublication).toBe(expected.validForPublication);
            expect([...result.findings].sort(compareFindings)).toEqual(result.findings);

            // Line and column come from the parse-time source map; verify each
            // finding's location against the map entry for its pointer so a
            // stale manifest cannot survive an edit to the fixture text.
            const parsed = new JsonSourceParser(text).parse();
            if (parsed.ok) {
                for (const finding of result.findings) {
                    const location = parsed.sourceMap[finding.path];
                    if (location) {
                        expect(finding.line).toBe(location.value.line);
                        expect(finding.column).toBe(location.value.column);
                    }
                }
            }
        });
    }
}

describe("parse failures are errors, never drafts", () => {
    test("duplicate-key.json parses leniently but the pipeline rejects it", () => {
        const text = readFileSync(join(FIXTURES_DIR, "invalid-parse/duplicate-key.json"), "utf8");
        expect(() => JSON.parse(text)).not.toThrow();
        const result = validator.validate(text);
        expect(result.validForPublication).toBe(false);
        expect(result.findings.map((finding) => finding.code)).toEqual([
            "workflow.parse.duplicate-key",
        ]);
    });

    test("malformed-syntax.json is invalid JSON with one parse finding", () => {
        const result = validator.validate(
            readFileSync(join(FIXTURES_DIR, "invalid-parse/malformed-syntax.json"), "utf8"),
        );
        expect(result.findings.map((finding) => finding.code)).toEqual([
            "workflow.parse.json-invalid",
        ]);
    });
});

describe("interface versions", () => {
    test("a supported version validates cleanly (valid/minimum.json)", () => {
        const result = validator.validate(
            readFileSync(join(FIXTURES_DIR, "valid/minimum.json"), "utf8"),
        );
        expect(result.validForPublication).toBe(true);
        expect(result.findings).toEqual([]);
    });

    test("an unsupported version is blocking with no fallback", () => {
        const result = validator.validate(
            readFileSync(
                join(FIXTURES_DIR, "invalid-shape/unknown-interface-version.json"),
                "utf8",
            ),
        );
        expect(result.findings).toHaveLength(1);
        expect(result.findings[0]?.code).toBe("workflow.version.unknown");
        expect(result.findings[0]?.details?.supported).toEqual(["v1"]);
    });

    test("a missing version is blocking before shape runs", () => {
        const result = validator.validate(
            readFileSync(
                join(FIXTURES_DIR, "invalid-shape/missing-interface-version.json"),
                "utf8",
            ),
        );
        expect(result.findings.map((finding) => finding.code)).toEqual([
            "workflow.version.missing",
        ]);
    });
});
