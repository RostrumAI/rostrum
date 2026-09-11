/**
 * Behavioural tests for the automated review pipeline.
 *
 * @remarks
 * The pipeline's risk is not that it crashes; it is that it posts a finding to
 * the wrong line, repeats a finding a maintainer already resolved, or reports a
 * clean change as broken. These cases cover those outcomes directly by driving
 * the pure stages with real diff text and real thread state.
 */

import { describe, expect, test } from "bun:test";

import { findFile, parseUnifiedDiff, snapToDiff, visibleLines } from "./diff.ts";
import { COMMENT_MARKER, type ReviewThread } from "./github.ts";
import {
    applyConfidenceFloor,
    deduplicate,
    partitionThreads,
    ruleIdFromComment,
    suppressAnswered,
} from "./merge.ts";
import { extractJsonObject, normalizeFindings } from "./reviewer.ts";
import { findUncoveredSourceFiles, runRuleChecks } from "./rules.ts";
import { blankNonCode } from "./source-text.ts";
import type { FileDiff, Finding, Lens, ReviewContext } from "./types.ts";

/** Returns the single parsed file of a patch, failing loudly when parsing dropped it. */
function firstFile(patch: string): FileDiff {
    const file = parseUnifiedDiff(patch)[0];
    if (file === undefined) {
        throw new Error(`expected a parsed file in patch:\n${patch}`);
    }
    return file;
}

/** A minimal patch adding one file with two added lines. */
const ADDED_FILE_PATCH = `diff --git a/apps/control-api/src/thing.ts b/apps/control-api/src/thing.ts
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/apps/control-api/src/thing.ts
@@ -0,0 +1,4 @@
+export function thing(value: number): number {
+    if (value > 0) return value;
+    return 0;
+}
`;

/** Builds a review context around a patch, for the stages under test. */
function contextFor(
    patch: string,
    resolvedThreads: ReviewContext["resolvedThreads"] = [],
): ReviewContext {
    return {
        pullRequest: { owner: "RostrumAI", repo: "rostrum", number: 1 },
        headSha: "0".repeat(40),
        title: "Test change",
        body: "",
        author: "tester",
        files: parseUnifiedDiff(patch),
        patch,
        ruleFindings: [],
        workingDirectory: "/nonexistent",
        patchPath: "/nonexistent/change.patch",
        resolvedThreads,
    };
}

/** Builds a finding with sensible defaults for the field under test. */
function findingFor(overrides: Partial<Finding> = {}): Finding {
    return {
        ruleId: "REPO-TEST-02",
        path: "apps/control-api/src/thing.ts",
        line: 2,
        severity: "major",
        confidence: 95,
        title: "Finding",
        body: "Body",
        evidence: "code",
        lens: "tests",
        ...overrides,
    };
}

/** Builds a review thread from a comment body and its state. */
function threadFor(
    body: string,
    options: { resolved?: boolean; line?: number | null; author?: string } = {},
): ReviewThread {
    return {
        isResolved: options.resolved ?? false,
        isOutdated: false,
        path: "apps/control-api/src/thing.ts",
        line: options.line === undefined ? 2 : options.line,
        comments: [{ author: options.author ?? "github-actions", body, line: null }],
    };
}

/** Renders a pipeline comment body the way the report module does. */
function pipelineComment(ruleId: string): string {
    return `${COMMENT_MARKER}\n**\`${ruleId}\` · major** — Something is wrong.`;
}

describe("diff parsing", () => {
    test("numbers added lines by their position in the new file", () => {
        const files = parseUnifiedDiff(ADDED_FILE_PATCH);
        expect(files).toHaveLength(1);
        const file = firstFile(ADDED_FILE_PATCH);
        expect(file.path).toBe("apps/control-api/src/thing.ts");
        expect(file.added).toBe(true);
        expect(visibleLines(file, "added")).toEqual([1, 2, 3, 4]);
    });

    test("keeps removed lines out of the new-file numbering", () => {
        const patch = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,3 +1,3 @@
 const first = 1;
-const second = 2;
+const second = 3;
 const third = 4;
`;
        const file = firstFile(patch);
        expect(visibleLines(file, "added")).toEqual([2]);
        expect(visibleLines(file)).toEqual([1, 2, 3]);
    });

    test("skips lockfiles and binary artifacts", () => {
        const patch = `diff --git a/bun.lock b/bun.lock
--- a/bun.lock
+++ b/bun.lock
@@ -1 +1 @@
-a
+b
diff --git a/logo.png b/logo.png
--- a/logo.png
+++ b/logo.png
`;
        expect(parseUnifiedDiff(patch)).toHaveLength(0);
    });

    test("snaps a near-miss line onto the diff and rejects a distant one", () => {
        const file = firstFile(ADDED_FILE_PATCH);
        expect(snapToDiff(file, 2)).toBe(2);
        expect(snapToDiff(file, 3)).toBe(3);
        expect(snapToDiff(file, 40)).toBeNull();
    });

    test("resolves a path through Git's a/ and b/ prefixes", () => {
        const files = parseUnifiedDiff(ADDED_FILE_PATCH);
        expect(findFile(files, "b/apps/control-api/src/thing.ts")?.path).toBe(
            "apps/control-api/src/thing.ts",
        );
        expect(findFile(files, "apps/control-api/src/other.ts")).toBeNull();
    });
});

describe("mechanical rules", () => {
    test("reports banned constructs on added lines only", () => {
        const patch = `diff --git a/apps/control-api/src/bad.ts b/apps/control-api/src/bad.ts
new file mode 100644
--- /dev/null
+++ b/apps/control-api/src/bad.ts
@@ -0,0 +1,3 @@
+export default function bad(value: any) {
+    return value;
+}
`;
        const ruleIds = runRuleChecks(contextFor(patch)).map((finding) => finding.ruleId);
        expect(ruleIds).toContain("GTS-EXPORTS-01");
        expect(ruleIds).toContain("REPO-TS-01");
    });

    test("ignores a banned construct that only appears inside a string", () => {
        const patch = `diff --git a/apps/control-api/src/message.ts b/apps/control-api/src/message.ts
--- a/apps/control-api/src/message.ts
+++ b/apps/control-api/src/message.ts
@@ -1 +1 @@
-old
+const rejection = "value must not be any of the allowed types";
`;
        expect(runRuleChecks(contextFor(patch))).toHaveLength(0);
    });

    test("treats a backticked term in prose as a mention, not a use", () => {
        // The backtick is built at runtime so the patch text can live in a template literal.
        const tick = String.fromCharCode(96);
        const patch = [
            "diff --git a/rules/notes.md b/rules/notes.md",
            "--- a/rules/notes.md",
            "+++ b/rules/notes.md",
            "@@ -1 +1 @@",
            "-old",
            `+Do not use the term ${tick}backstop${tick} in source or documentation.`,
        ].join("\n");
        expect(runRuleChecks(contextFor(patch))).toHaveLength(0);
    });

    test("flags a single-line unbraced conditional", () => {
        const ruleIds = runRuleChecks(contextFor(ADDED_FILE_PATCH)).map(
            (finding) => finding.ruleId,
        );
        expect(ruleIds).toContain("REPO-TS-02");
    });

    test("leaves console output alone in scripts and tests", () => {
        const patch = `diff --git a/scripts/tool.ts b/scripts/tool.ts
--- a/scripts/tool.ts
+++ b/scripts/tool.ts
@@ -1 +1 @@
-old
+console.log("progress");
`;
        expect(runRuleChecks(contextFor(patch))).toHaveLength(0);
    });

    test("requires a test beside a new source module", () => {
        const withoutTest = findUncoveredSourceFiles(contextFor(ADDED_FILE_PATCH));
        expect(withoutTest.map((finding) => finding.ruleId)).toEqual(["REPO-TEST-03"]);

        const withTest = `${ADDED_FILE_PATCH}diff --git a/apps/control-api/src/thing.test.ts b/apps/control-api/src/thing.test.ts
new file mode 100644
--- /dev/null
+++ b/apps/control-api/src/thing.test.ts
@@ -0,0 +1,1 @@
+test("thing", () => {});
`;
        expect(findUncoveredSourceFiles(contextFor(withTest))).toHaveLength(0);
    });
});

describe("source scanning", () => {
    test("blanks comments without shifting the columns that follow", () => {
        const line = 'const value = 1; // console.log("noisy")';
        const blanked = blankNonCode(line);
        expect(blanked).toHaveLength(line.length);
        expect(blanked.startsWith("const value = 1;")).toBe(true);
        expect(blanked).not.toContain("console");
    });

    test("blanks string, template, and regex contents", () => {
        expect(blankNonCode('const name = "console.log";')).not.toContain("console");
        expect(blankNonCode("const pattern = /console.log/g;")).not.toContain("console");
        expect(blankNonCode("const text = `value: any`;")).not.toContain("any");
        expect(blankNonCode("const division = total / count / 2;")).toBe(
            "const division = total / count / 2;",
        );
    });

    test("leaves real code intact so the check still fires", () => {
        expect(blankNonCode("const value: any = read();")).toContain("any");
    });
});

describe("suppression", () => {
    test("reads the rule id out of a pipeline comment", () => {
        expect(ruleIdFromComment(pipelineComment("REPO-ARCH-01"))).toBe("REPO-ARCH-01");
        expect(ruleIdFromComment("Looks good to me")).toBeNull();
    });

    test("never repeats a finding whose thread is resolved", () => {
        const threads = [threadFor(pipelineComment("REPO-TEST-02"), { resolved: true, line: 99 })];
        const result = suppressAnswered([findingFor()], threads);
        expect(result.kept).toHaveLength(0);
        expect(result.suppressed).toBe(1);
    });

    test("stays silent about an open finding on the same line", () => {
        const threads = [threadFor(pipelineComment("REPO-TEST-02"), { line: 3 })];
        expect(suppressAnswered([findingFor({ line: 4 })], threads).kept).toHaveLength(0);
    });

    test("reports a new occurrence elsewhere in the same file", () => {
        const threads = [threadFor(pipelineComment("REPO-TEST-02"), { line: 2 })];
        expect(suppressAnswered([findingFor({ line: 40 })], threads).kept).toHaveLength(1);
    });

    test("ignores human discussion about the same code", () => {
        const threads = [threadFor("I already looked at this line", { resolved: true, line: 2 })];
        expect(suppressAnswered([findingFor()], threads).kept).toHaveLength(1);
    });

    test("partitions pipeline threads by resolution state", () => {
        const threads = [
            threadFor(pipelineComment("REPO-A-01"), { resolved: true }),
            threadFor(pipelineComment("REPO-B-01")),
            threadFor("human note"),
        ];
        const partition = partitionThreads(threads);
        expect(partition.resolved.map((entry) => entry.ruleId)).toEqual(["REPO-A-01"]);
        expect(partition.open.map((entry) => entry.ruleId)).toEqual(["REPO-B-01"]);
    });
});

describe("merge", () => {
    test("collapses the same finding from two lenses, preferring the deterministic pass", () => {
        const result = deduplicate([
            findingFor({ lens: "tests", confidence: 94 }),
            findingFor({ lens: "rules", confidence: 100 }),
        ]);
        expect(result.kept).toHaveLength(1);
        expect(result.kept[0]?.lens).toBe("rules");
        expect(result.duplicates).toBe(1);
    });

    test("filters model guesses but never filters the deterministic pass", () => {
        const kept = applyConfidenceFloor(
            [
                findingFor({ lens: "correctness", confidence: 55 }),
                findingFor({ line: 3, lens: "correctness", confidence: 88 }),
                findingFor({ line: 4, lens: "rules", confidence: 0 }),
            ],
            80,
        );
        expect(kept.map((finding) => finding.line)).toEqual([3, 4]);
    });
});

describe("reviewer output handling", () => {
    test("extracts a JSON object from fenced or chatty output", () => {
        expect(extractJsonObject('Here you go:\n```json\n{"findings":[]}\n```')).toEqual({
            findings: [],
        });
        expect(extractJsonObject('{"findings":[{"title":"a { brace } inside"}]}')).toEqual({
            findings: [{ title: "a { brace } inside" }],
        });
        expect(extractJsonObject("no object here")).toBeNull();
    });

    test("drops a finding anchored to a file outside the change", () => {
        const context = contextFor(ADDED_FILE_PATCH);
        const lens: Lens = {
            id: "tests",
            label: "Tests",
            promptPath: "lenses/03-tests.md",
            rulePaths: ["rules/repository-conventions.md"],
            applies: () => true,
        };
        const findings = normalizeFindings(
            {
                findings: [
                    {
                        ruleId: "REPO-TEST-02",
                        path: "apps/control-api/src/thing.ts",
                        line: 2,
                        severity: "major",
                        confidence: 90,
                        title: "Real",
                        body: "Body",
                        evidence: "code",
                    },
                    {
                        ruleId: "REPO-TEST-02",
                        path: "apps/control-api/src/imaginary.ts",
                        line: 2,
                        severity: "major",
                        confidence: 90,
                        title: "Hallucinated",
                        body: "Body",
                        evidence: "code",
                    },
                ],
            },
            lens,
            context,
        );
        expect(findings.map((finding) => finding.title)).toEqual(["Real"]);
        expect(findings[0]?.lens).toBe("tests");
    });
});
