/** @fileoverview Automated review pipeline behavior tests. */

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
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findFile, parseUnifiedDiff, snapToDiff, visibleLines } from "./diff.ts";
import { COMMENT_MARKER, type ReviewThread } from "./github.ts";
import {
    applyConfidenceFloor,
    applyPerRuleCap,
    deduplicate,
    partitionThreads,
    ruleIdFromComment,
    suppressAnswered,
} from "./merge.ts";
import { renderComment } from "./report.ts";
import { buildLensPrompt, extractJsonObject, normalizeFindings } from "./reviewer.ts";
import { findUncoveredSourceFiles, runRuleChecks } from "./rules.ts";
import { blankInlineCode, newScanState, scanSourceLine } from "./source-text.ts";
import type { FileDiff, Finding, Lens, ReviewContext } from "./types.ts";
import { renderVerdictMarker } from "./verdicts.ts";

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

/**
 * Builds a review context around a patch, for the stages under test.
 *
 * The default working directory does not exist, which exercises the fallback
 * that scans only the diff's own lines. Tests that need the head checkout pass
 * one in.
 */
function contextFor(
    patch: string,
    options: {
        workingDirectory?: string;
        resolvedThreads?: ReviewContext["resolvedThreads"];
    } = {},
): ReviewContext {
    return {
        pullRequest: { owner: "RostrumAI", repo: "rostrum", number: 1 },
        headSha: "0".repeat(40),
        title: "Test change",
        body: "",
        author: "tester",
        files: parseUnifiedDiff(patch),
        ruleFindings: [],
        workingDirectory: options.workingDirectory ?? "/nonexistent",
        patchPath: "/nonexistent/change.patch",
        resolvedThreads: options.resolvedThreads ?? [],
    };
}

/** Builds a finding with sensible defaults for the field under test. */
function findingFor(overrides: Partial<Finding> = {}): Finding {
    return {
        ruleId: "REPO-TEST-02",
        path: "apps/control-api/src/thing.ts",
        line: 2,
        severity: "medium",
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
    options: {
        resolved?: boolean;
        line?: number | null;
        author?: string;
        association?: string;
    } = {},
): ReviewThread {
    return {
        id: `thread-${options.line ?? 2}-${options.resolved ?? false}`,
        isResolved: options.resolved ?? false,
        isOutdated: false,
        path: "apps/control-api/src/thing.ts",
        line: options.line === undefined ? 2 : options.line,
        comments: [
            {
                id: 1,
                author: options.author ?? "github-actions",
                authorAssociation: options.association ?? "MEMBER",
                body,
                line: null,
            },
        ],
    };
}

/**
 * Renders the comment the pipeline would actually post for a finding.
 *
 * Suppression reads the rule id back out of posted comment text, so the tests
 * drive the real renderer rather than a hand-built lookalike: a format change
 * that broke the reader would otherwise leave every case green while rescans
 * re-posted answered findings.
 */
function pipelineComment(ruleId: string, evidence = "code"): string {
    return renderComment(findingFor({ ruleId, evidence }));
}

/** Builds a thread holding a pipeline finding and the reviewer's verdict reply. */
function adjudicatedThread(ruleId: string, verdict: string): ReviewThread {
    const thread = threadFor(pipelineComment(ruleId));
    thread.comments.push({
        id: 2,
        author: "github-actions[bot]",
        authorAssociation: "NONE",
        body: verdict,
        line: null,
    });
    return thread;
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

    test("rejects a mailbox patch rather than anchoring findings to the wrong lines", () => {
        // `gh pr diff --patch` returns one of these per commit; their hunk numbers
        // are relative to each commit's parent, which is not what a comment on the
        // head commit is validated against.
        const mailbox = [
            "From 1a2b3c4d5e6f7890abcdef1234567890abcdef12 Mon Sep 17 00:00:00 2001",
            "From: Someone <someone@example.com>",
            "Subject: [PATCH] a change",
            "",
            "diff --git a/a.ts b/a.ts",
            "--- a/a.ts",
            "+++ b/a.ts",
            "@@ -1 +1 @@",
            "-old",
            "+new",
        ].join("\n");
        expect(() => parseUnifiedDiff(mailbox)).toThrow(/mailbox-formatted patch/);
    });

    test("accepts a source line that reads like a mailbox header", () => {
        // Inside a patch every content line carries a diff marker, so an added
        // line that looks like a header cannot be mistaken for one.
        const patch = [
            "diff --git a/log.ts b/log.ts",
            "--- a/log.ts",
            "+++ b/log.ts",
            "@@ -1,1 +1,2 @@",
            " const first = 1;",
            "+const header = 'From 1a2b3c4d5e6f7890abcdef1234567890abcdef12 Mon Sep 17';",
        ].join("\n");
        expect(parseUnifiedDiff(patch)).toHaveLength(1);
    });

    test("treats an added line beginning with `++ ` as content, not a file header", () => {
        const patch = [
            "diff --git a/notes.ts b/notes.ts",
            "--- a/notes.ts",
            "+++ b/notes.ts",
            "@@ -1,1 +1,3 @@",
            " const existing = 1;",
            "++ counter increment",
            "+const added = 2;",
        ].join("\n");
        const files = parseUnifiedDiff(patch);
        expect(files).toHaveLength(1);
        expect(files[0]?.path).toBe("notes.ts");
        expect(visibleLines(firstFile(patch), "added")).toEqual([2, 3]);
    });

    test("snaps a near-miss line onto the diff and rejects a distant one", () => {
        const file = firstFile(ADDED_FILE_PATCH);
        expect(snapToDiff(file, 2)).toBe(2);
        expect(snapToDiff(file, 3)).toBe(3);
        expect(snapToDiff(file, 40)).toBeNull();
    });

    test("re-anchors an invisible line that lands within tolerance", () => {
        const file = firstFile(ADDED_FILE_PATCH);
        // Lines 1 to 4 are added; a reviewer naming a neighbouring line the hunk
        // does not contain must still land on code the author can see.
        expect(snapToDiff(file, 5)).toBe(4);
        expect(snapToDiff(file, 6, 1)).toBeNull();
    });

    test("prefers an added line over a nearer context line", () => {
        const patch = [
            "diff --git a/a.ts b/a.ts",
            "--- a/a.ts",
            "+++ b/a.ts",
            "@@ -10,5 +10,5 @@",
            " context nine",
            " context ten",
            "-old",
            "+added eleven",
            " context twelve",
            " context thirteen",
        ].join("\n");
        const file = firstFile(patch);
        expect(snapToDiff(file, 12)).toBe(12);
        // Line 9 is not shown by the hunk. The added line is 12 and the nearest
        // visible context line is 10, so a result of 12 proves the added line
        // was preferred to a nearer context line.
        expect(snapToDiff(file, 9, 3)).toBe(12);
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
    test("reports banned constructs on added lines only", async () => {
        const patch = `diff --git a/apps/control-api/src/bad.ts b/apps/control-api/src/bad.ts
new file mode 100644
--- /dev/null
+++ b/apps/control-api/src/bad.ts
@@ -0,0 +1,3 @@
+export default function bad(value: any) {
+    return value;
+}
`;
        const ruleIds = (await runRuleChecks(contextFor(patch))).map((finding) => finding.ruleId);
        expect(ruleIds).toContain("GTS-EXPORTS-01");
        expect(ruleIds).toContain("REPO-TS-01");
    });

    test("ignores a banned construct that only appears inside a string", async () => {
        const patch = `diff --git a/apps/control-api/src/message.ts b/apps/control-api/src/message.ts
--- a/apps/control-api/src/message.ts
+++ b/apps/control-api/src/message.ts
@@ -1 +1 @@
-old
+const rejection = "value must not be any of the allowed types";
`;
        expect(await runRuleChecks(contextFor(patch))).toHaveLength(0);
    });

    test("reads an added line inside a template opened on an unchanged line as content", async () => {
        const patch = `diff --git a/apps/control-api/src/embed.ts b/apps/control-api/src/embed.ts
--- a/apps/control-api/src/embed.ts
+++ b/apps/control-api/src/embed.ts
@@ -1,3 +1,4 @@
 const sample = \`;
+value: any
 \`;
 const other = 1;
`;
        expect(await runRuleChecks(contextFor(patch))).toHaveLength(0);
    });

    test("still sees code after an added line closes a template", async () => {
        const patch = `diff --git a/apps/control-api/src/embed.ts b/apps/control-api/src/embed.ts
--- a/apps/control-api/src/embed.ts
+++ b/apps/control-api/src/embed.ts
@@ -1,2 +1,4 @@
 const sample = \`;
+value: any
+\`;
+export default function bad(): any { return 1; }
`;
        const findings = await runRuleChecks(contextFor(patch));
        const exported = findings.filter((finding) => finding.ruleId === "GTS-EXPORTS-01");
        expect(exported).toHaveLength(1);
        expect(exported[0]?.line).toBe(4);
        const anyFindings = findings.filter((finding) => finding.ruleId === "REPO-TS-01");
        expect(anyFindings.map((finding) => finding.line)).toEqual([4]);
    });

    test("fires the comment-scoped checks the code surface cannot see", async () => {
        const patch = `diff --git a/apps/control-api/src/legacy.ts b/apps/control-api/src/legacy.ts
new file mode 100644
--- /dev/null
+++ b/apps/control-api/src/legacy.ts
@@ -0,0 +1,3 @@
+// @ts-expect-error the upstream type is wrong
+const legacy = 1;
+// TODO: remove once the legacy path is gone
`;
        const ruleIds = (await runRuleChecks(contextFor(patch))).map((finding) => finding.ruleId);
        expect(ruleIds).toContain("REPO-TS-04");
        expect(ruleIds).toContain("REPO-TS-05");
    });

    test("does not fire a comment-scoped check on a backticked mention", async () => {
        // Built at runtime so the fixture's backticks survive the template literal.
        const tick = String.fromCharCode(96);
        const patch = [
            "diff --git a/apps/control-api/src/notes.ts b/apps/control-api/src/notes.ts",
            "--- a/apps/control-api/src/notes.ts",
            "+++ b/apps/control-api/src/notes.ts",
            "@@ -1 +1,2 @@",
            "-old",
            `+// A directive like ${tick}@ts-expect-error${tick} is honored by the compiler.`,
            "+export const note = 1;",
        ].join("\n");
        expect(await runRuleChecks(contextFor(patch))).toHaveLength(0);
    });

    test("does not fire the comment-scoped checks on a non-comment mention", async () => {
        const patch = `diff --git a/apps/control-api/src/note.ts b/apps/control-api/src/note.ts
--- a/apps/control-api/src/note.ts
+++ b/apps/control-api/src/note.ts
@@ -1 +1 @@
-old
+const message = "@ts-expect-error is how you suppress a type error";
`;
        expect(await runRuleChecks(contextFor(patch))).toHaveLength(0);
    });

    test("treats a backticked term in prose as a mention, not a use", async () => {
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
        expect(await runRuleChecks(contextFor(patch))).toHaveLength(0);
    });

    test("flags a single-line unbraced conditional", async () => {
        const ruleIds = (await runRuleChecks(contextFor(ADDED_FILE_PATCH))).map(
            (finding) => finding.ruleId,
        );
        expect(ruleIds).toContain("REPO-TS-02");
    });

    test("leaves console output alone in scripts and tests", async () => {
        const patch = `diff --git a/scripts/tool.ts b/scripts/tool.ts
--- a/scripts/tool.ts
+++ b/scripts/tool.ts
@@ -1 +1 @@
-old
+console.log("progress");
`;
        expect(await runRuleChecks(contextFor(patch))).toHaveLength(0);
    });

    test("requires a test beside a new source module", async () => {
        const withoutTest = await findUncoveredSourceFiles(contextFor(ADDED_FILE_PATCH));
        expect(withoutTest.map((finding) => finding.ruleId)).toEqual(["REPO-TEST-03"]);

        const withTest = `${ADDED_FILE_PATCH}diff --git a/apps/control-api/src/thing.test.ts b/apps/control-api/src/thing.test.ts
new file mode 100644
--- /dev/null
+++ b/apps/control-api/src/thing.test.ts
@@ -0,0 +1,1 @@
+test("thing", () => {});
`;
        expect(await findUncoveredSourceFiles(contextFor(withTest))).toHaveLength(0);
    });

    test("does not require a test for a module that exports nothing", async () => {
        // Nothing can import this file, so there is no unit to test: it runs for
        // its side effects, the way a script does.
        const patch = `diff --git a/apps/control-api/src/entry.ts b/apps/control-api/src/entry.ts
new file mode 100644
--- /dev/null
+++ b/apps/control-api/src/entry.ts
@@ -0,0 +1,2 @@
+const port = Number(process.env.PORT ?? 3000);
+startServer(port);
`;
        expect(await findUncoveredSourceFiles(contextFor(patch))).toHaveLength(0);
    });

    test("does not require a test for a one-off script", async () => {
        // It exports something, so only the path exempts it: a script in a
        // `scripts/` directory is run by CI or by hand, not imported by the product.
        const patch = `diff --git a/packages/database/src/scripts/backfill.ts b/packages/database/src/scripts/backfill.ts
new file mode 100644
--- /dev/null
+++ b/packages/database/src/scripts/backfill.ts
@@ -0,0 +1,3 @@
+export async function backfill(): Promise<void> {
+    await repairRows();
+}
`;
        expect(await findUncoveredSourceFiles(contextFor(patch))).toHaveLength(0);
    });

    test("does not require a test for a fixture or a child-process harness", async () => {
        // A fixture or harness is exercised by the suite that calls it, so a
        // unit test beside it would only restate that suite.
        const patches = [
            ADDED_FILE_PATCH.replaceAll(
                "apps/control-api/src/thing.ts",
                "packages/server/src/testing/thing.ts",
            ),
            ADDED_FILE_PATCH.replaceAll(
                "apps/control-api/src/thing.ts",
                "packages/server/src/thing.fixture.ts",
            ),
        ];
        for (const patch of patches) {
            expect(await findUncoveredSourceFiles(contextFor(patch))).toHaveLength(0);
        }
    });

    test("accepts a service-wide executable boundary suite as coverage", async () => {
        // A service's modules are exercised end to end by its boundary suite,
        // which spawns the real executable instead of importing one module.
        const withBoundary = `${ADDED_FILE_PATCH}diff --git a/apps/control-api/src/boundary.test.ts b/apps/control-api/src/boundary.test.ts
new file mode 100644
--- /dev/null
+++ b/apps/control-api/src/boundary.test.ts
@@ -0,0 +1,1 @@
+test("executable boundary", () => {});
`;
        expect(await findUncoveredSourceFiles(contextFor(withBoundary))).toHaveLength(0);
    });
});

describe("source scanning", () => {
    /** Returns the code region of one standalone line, with no carry-over state. */
    function codeOf(line: string): string {
        return scanSourceLine(line, newScanState()).code;
    }

    /** Returns the comment region of one standalone line, with no carry-over state. */
    function commentsOf(line: string): string {
        return scanSourceLine(line, newScanState()).comments;
    }

    test("blanks comments from the code region without shifting later columns", () => {
        const line = 'const value = 1; // console.log("noisy")';
        const code = codeOf(line);
        expect(code).toHaveLength(line.length);
        expect(code.startsWith("const value = 1;")).toBe(true);
        expect(code).not.toContain("console");
    });

    test("keeps comment text in the comment region for the checks that read it", () => {
        expect(commentsOf("// @ts-expect-error upstream type is wrong")).toContain(
            "@ts-expect-error",
        );
        expect(commentsOf("    // TODO: backfill before the next release")).toContain("TODO:");
        expect(commentsOf("const value: any = 1; // nothing to see")).not.toContain("const");
    });

    test("keeps directives invisible to code-only checks", () => {
        expect(codeOf("// @ts-expect-error x")).not.toContain("@ts-expect-error");
        expect(codeOf("const a = 1; /* TODO: later */")).not.toContain("TODO");
    });

    test("blanks string, template, and regex contents from both regions", () => {
        expect(codeOf('const name = "console.log";')).not.toContain("console");
        expect(codeOf("const pattern = /console\\.log/g;")).not.toContain("console");
        expect(codeOf("const text = `value: any`;")).not.toContain("any");
        expect(commentsOf('const name = "TODO: fake";')).not.toContain("TODO");
        expect(codeOf("const division = total / count / 2;")).toBe(
            "const division = total / count / 2;",
        );
    });

    test("carries state through an unclosed template literal", () => {
        const state = newScanState();
        const opened = scanSourceLine("const patch = `value: any", state);
        expect(state.inTemplate).toBe(true);
        expect(opened.code).not.toContain("any");
        const inside = scanSourceLine("+export default function bad(value: any) {", state);
        expect(inside.code).not.toContain("any");
        expect(inside.code).not.toContain("export default");
        const closed = scanSourceLine("`;", state);
        expect(state.inTemplate).toBe(false);
        expect(closed.code).toBe(" ;");
    });

    test("keeps both projections aligned across an astral character", () => {
        const line = 'const icon = "\u{1F680}\u{1F680}"; const label: any = 1;';
        const regions = scanSourceLine(line, newScanState());
        expect(regions.code).toHaveLength(line.length);
        expect(regions.comments).toHaveLength(line.length);
        // The `any` is on the added text after the emoji, so a projection that
        // shifted by a code unit would hide it.
        expect(regions.code).toContain("any");
        expect(codeOf('const icon = "\u{1F680}"; const text = "no any here";')).not.toContain(
            "any",
        );
    });

    test("leaves real code intact so the check still fires", () => {
        expect(codeOf("const value: any = read();")).toContain("any");
    });

    test("blanks prose code spans and quoted terms but keeps the sentence", () => {
        const line = 'Use `database`, not "store", when naming the layer.';
        const blanked = blankInlineCode(line);
        expect(blanked).toContain("Use ");
        expect(blanked).toContain("when naming the layer.");
        expect(blanked).not.toContain("store");
        expect(blanked).not.toContain("database");
    });

    test("does not treat an apostrophe as a quote", () => {
        // Two apostrophes bracketing a term: if an apostrophe became a delimiter
        // the term would be blanked, so this fails on that regression. A line
        // with a lone apostrophe would return unchanged either way and prove
        // nothing.
        const bracketed = "Keep 'backstop' in the text.";
        expect(blankInlineCode(bracketed)).toBe(bracketed);
        expect(blankInlineCode(bracketed)).toContain("backstop");

        // Possessives are prose punctuation and must survive untouched.
        const possessive = "The repository's rule bans the backstop pattern.";
        expect(blankInlineCode(possessive)).toBe(possessive);
    });
});

describe("lexical context", () => {
    test("reads string content correctly when the opener precedes the diff window", async () => {
        const root = await mkdtemp(join(tmpdir(), "rostrum-review-test-"));
        await Bun.write(
            join(root, "deep.ts"),
            [
                "const header = `",
                "line 1",
                "line 2",
                "value: any",
                "`;",
                "export const done = 1;",
                "",
            ].join("\n"),
        );
        // The hunk begins at line 3, so the backtick that opens the literal on
        // line 1 is not part of the patch.
        const patch = [
            "diff --git a/deep.ts b/deep.ts",
            "--- a/deep.ts",
            "+++ b/deep.ts",
            "@@ -3,2 +3,3 @@",
            " line 2",
            "+value: any",
            " `;",
        ].join("\n");
        expect(await runRuleChecks(contextFor(patch, { workingDirectory: root }))).toHaveLength(0);

        // Without the checkout the opener is unknowable, so the same content is
        // read as code; the fallback is approximate and documented as such.
        const withoutCheckout = await runRuleChecks(contextFor(patch));
        expect(withoutCheckout.map((finding) => finding.ruleId)).toContain("REPO-TS-01");
    });

    test("keeps scanning past a template that closes on an unchanged line", async () => {
        const root = await mkdtemp(join(tmpdir(), "rostrum-review-test-"));
        await Bun.write(
            join(root, "notes.ts"),
            [
                "const sample = `",
                "some text",
                "`;",
                "// TODO: remove the legacy path",
                "export const value = 2;",
                "",
            ].join("\n"),
        );
        // The hunk starts at the line that closes the template, so a scan that
        // began there would treat the backtick as an opener and blank everything
        // after it, hiding the marker below.
        const patch = [
            "diff --git a/notes.ts b/notes.ts",
            "--- a/notes.ts",
            "+++ b/notes.ts",
            "@@ -3,3 +3,3 @@",
            " `;",
            "+// TODO: remove the legacy path",
            " export const value = 2;",
        ].join("\n");
        const findings = await runRuleChecks(contextFor(patch, { workingDirectory: root }));
        expect(findings.map((finding) => finding.ruleId)).toContain("REPO-TS-05");
    });
});

describe("suppression", () => {
    test("reads the rule id out of a rendered pipeline comment", () => {
        const rendered = renderComment(findingFor({ ruleId: "REPO-ARCH-01" }));
        expect(rendered).toContain(COMMENT_MARKER);
        expect(ruleIdFromComment(rendered)).toBe("REPO-ARCH-01");
        expect(ruleIdFromComment("Looks good to me")).toBeNull();
    });

    test("reads the rule id out of a rendered comment that carries no evidence", () => {
        const rendered = renderComment(findingFor({ ruleId: "REPO-CONTRACT-05", evidence: "   " }));
        expect(ruleIdFromComment(rendered)).toBe("REPO-CONTRACT-05");
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

    test("does not let a bare human reply suppress the rule across the file", () => {
        // A reply alone leaves the thread open, so only a nearby duplicate is
        // suppressed. Treating the reply as a disposition would silence this
        // rule for the whole file on every later rescan.
        const thread = threadFor(pipelineComment("REPO-TEST-02"));
        thread.comments.push({
            id: 2,
            author: "Stephen-PP",
            authorAssociation: "MEMBER",
            body: "I think this is fine actually.",
            line: null,
        });
        expect(partitionThreads([thread]).open).toHaveLength(1);
        expect(suppressAnswered([findingFor({ line: 2 })], [thread]).kept).toHaveLength(0);
        expect(suppressAnswered([findingFor({ line: 60 })], [thread]).kept).toHaveLength(1);
    });

    test("treats a withdrawn finding as answered, without the thread being resolved", () => {
        const thread = adjudicatedThread("REPO-TEST-02", renderVerdictMarker("refuted"));
        expect(partitionThreads([thread]).resolved).toHaveLength(1);
        // Withdrawn means the rule no longer applies at this path, wherever the
        // line has moved to.
        expect(suppressAnswered([findingFor({ line: 60 })], [thread]).kept).toHaveLength(0);
    });

    test("leaves the thread open when the adjudication stands behind the finding", () => {
        const thread = adjudicatedThread("REPO-TEST-02", renderVerdictMarker("stands"));
        expect(partitionThreads([thread]).open).toHaveLength(1);
        expect(partitionThreads([thread]).resolved).toHaveLength(0);
        // The original comment still suppresses a duplicate of itself, so the
        // author keeps one open finding rather than two.
        expect(suppressAnswered([findingFor({ line: 2 })], [thread]).kept).toHaveLength(0);
    });

    test("records an intentional tradeoff as withdrawn", () => {
        const thread = adjudicatedThread("REPO-TEST-02", renderVerdictMarker("intentional"));
        expect(partitionThreads([thread]).resolved).toHaveLength(1);
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
        const result = deduplicate(
            [
                findingFor({ lens: "tests", confidence: 94 }),
                findingFor({ lens: "rules", confidence: 100 }),
            ],
            contextFor(ADDED_FILE_PATCH),
        );
        expect(result.kept).toHaveLength(1);
        expect(result.kept[0]?.lens).toBe("rules");
        expect(result.duplicates).toBe(1);
    });

    test("caps what will be posted, counting only findings that survive suppression", () => {
        // Six occurrences of one rule at one path, but an open thread already
        // covers the first four. The cap must apply to the two remaining, not
        // spend its budget on the four that suppression removes.
        // Spaced beyond the suppression tolerance so each open thread answers
        // exactly its own occurrence.
        const findings = [10, 20, 30, 40, 50, 60].map((line) =>
            findingFor({ line, lens: "rules", ruleId: "REPO-TS-01" }),
        );
        const threads = [10, 20, 30, 40].map((line) =>
            threadFor(pipelineComment("REPO-TS-01"), { line }),
        );
        const { kept: unanswered, suppressed } = suppressAnswered(findings, threads);
        expect(suppressed).toBe(4);
        expect(unanswered.map((finding) => finding.line)).toEqual([50, 60]);
        const capped = applyPerRuleCap(unanswered);
        expect(capped.kept.map((finding) => finding.line)).toEqual([50, 60]);
        expect(capped.capped).toBe(0);
    });

    test("collapses two lenses describing one defect at different lines in a hunk", () => {
        const result = deduplicate(
            [
                findingFor({ line: 3, lens: "correctness", confidence: 90, title: "First angle" }),
                findingFor({ line: 4, lens: "contracts", confidence: 91, title: "Second angle" }),
            ],
            contextFor(ADDED_FILE_PATCH),
        );
        expect(result.kept).toHaveLength(1);
        expect(result.kept[0]?.title).toBe("Second angle");
    });

    test("keeps determinism precise: two mechanical findings on one hunk both survive", () => {
        const result = deduplicate(
            [
                findingFor({ line: 3, lens: "rules", ruleId: "REPO-TS-01" }),
                findingFor({ line: 4, lens: "rules", ruleId: "REPO-TS-01" }),
            ],
            contextFor(ADDED_FILE_PATCH),
        );
        expect(result.kept).toHaveLength(2);
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

describe("lens prompt", () => {
    test("names the mechanical findings the reviewer must not repeat", () => {
        const context = contextFor(ADDED_FILE_PATCH);
        context.ruleFindings = [
            findingFor({ ruleId: "REPO-TS-01", line: 2, lens: "rules", title: "An any type" }),
        ];
        const prompt = buildLensPrompt(context, "/skills/code-review");
        expect(prompt).toContain("REPO-TS-01 at apps/control-api/src/thing.ts:2 — An any type");
        expect(prompt).toContain("must not be repeated");
    });

    test("states plainly when the mechanical pass found nothing", () => {
        const prompt = buildLensPrompt(contextFor(ADDED_FILE_PATCH), "/skills/code-review");
        expect(prompt).toContain("Findings the mechanical pass already reported");
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
                        severity: "medium",
                        confidence: 90,
                        title: "Real",
                        body: "Body",
                        evidence: "code",
                    },
                    {
                        ruleId: "REPO-TEST-02",
                        path: "apps/control-api/src/imaginary.ts",
                        line: 2,
                        severity: "medium",
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

describe("severity scale", () => {
    const lens: Lens = {
        id: "correctness",
        label: "Correctness",
        promptPath: "lenses/01-correctness.md",
        rulePaths: ["rules/repository-conventions.md"],
        applies: () => true,
    };

    test("marks medium and above BLOCKING and leaves the rest unmarked", () => {
        expect(renderComment(findingFor({ severity: "critical" }))).toContain(
            "Critical · BLOCKING",
        );
        expect(renderComment(findingFor({ severity: "medium" }))).toContain("Medium · BLOCKING");
        expect(renderComment(findingFor({ severity: "low" }))).toContain("· Low**");
        expect(renderComment(findingFor({ severity: "low" }))).not.toContain("BLOCKING");
        expect(renderComment(findingFor({ severity: "informational" }))).not.toContain("BLOCKING");
    });

    test("keeps a severity from the scale and treats an unknown one as medium", () => {
        // A model may still name a retired level. Posting it verbatim would leave
        // the report with a severity the scale does not define, so it is graded
        // as the convention-level problem it could not be ranked as.
        const normalize = (severity: string): Finding["severity"] | undefined =>
            normalizeFindings(
                {
                    findings: [
                        {
                            ruleId: "BUG",
                            path: "apps/control-api/src/thing.ts",
                            line: 2,
                            severity,
                            confidence: 90,
                            title: "Finding",
                            body: "Body",
                            evidence: "code",
                        },
                    ],
                },
                lens,
                contextFor(ADDED_FILE_PATCH),
            )[0]?.severity;
        expect(normalize("critical")).toBe("critical");
        expect(normalize("informational")).toBe("informational");
        expect(normalize("blocking")).toBe("medium");
    });
});
