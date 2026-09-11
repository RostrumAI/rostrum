/**
 * Behavioural tests for reviewer selection.
 *
 * @remarks
 * Which lenses run determines what the review can find. A wrong predicate does
 * not fail anything: it either skips a reviewer that would have caught a defect,
 * or runs one whose subject the diff does not touch and fills the report with
 * noise. These cases pin the activation decision for each kind of change.
 */

import { describe, expect, test } from "bun:test";

import { parseUnifiedDiff } from "./diff.ts";
import { LENSES, selectLenses } from "./lenses.ts";
import type { FileDiff } from "./types.ts";

/** Builds a patch that adds one file, so the parsed path drives activation. */
function filesFor(path: string): FileDiff[] {
    return parseUnifiedDiff(
        [
            `diff --git a/${path} b/${path}`,
            "new file mode 100644",
            `--- /dev/null`,
            `+++ b/${path}`,
            "@@ -0,0 +1,1 @@",
            "+const value = 1;",
        ].join("\n"),
    );
}

/** Returns the lens ids selected for a change. */
function selectedFor(path: string, requested: string[] = []): string[] {
    return selectLenses(filesFor(path), requested).map((lens) => lens.id);
}

describe("lens selection", () => {
    test("always runs correctness, since any change can carry a defect", () => {
        expect(selectedFor("README.md")).toContain("correctness");
        expect(selectedFor("packages/workflow/src/index.ts")).toContain("correctness");
    });

    test("runs the TypeScript lens only when a TypeScript file changes", () => {
        expect(selectedFor("packages/workflow/src/parse/parse-workflow.ts")).toContain(
            "typescript",
        );
        expect(selectedFor("README.md")).not.toContain("typescript");
    });

    test("runs the tests lens for a source change and for a test-only change", () => {
        expect(selectedFor("packages/workflow/src/parse/parse-workflow.ts")).toContain("tests");
        expect(selectedFor("packages/workflow/src/parse/parse-workflow.test.ts")).toContain(
            "tests",
        );
    });

    test("skips the contracts lens for a configuration-only change", () => {
        expect(selectedFor("package.json")).not.toContain("contracts");
        expect(selectedFor("apps/control-api/src/app.ts")).toContain("contracts");
    });

    test("runs the security lens on every request handler, whatever it is named", () => {
        expect(selectedFor("apps/control-api/src/features/workflows/create.ts")).toContain(
            "security",
        );
        expect(selectedFor("apps/control-api/src/features/system/health.ts")).toContain("security");
    });

    test("runs the security lens off the trust-boundary paths", () => {
        expect(selectedFor("apps/control-api/src/loader.ts")).toContain("security");
        expect(selectedFor("packages/database/src/repositories/workflow-repository.ts")).toContain(
            "security",
        );
    });

    test("skips the security lens for a change with no external surface", () => {
        expect(selectedFor("packages/workflow/src/parse/json-source-parser.ts")).not.toContain(
            "security",
        );
    });

    test("runs the documentation lens for prose and for source that carries comments", () => {
        expect(selectedFor("dev-docs/strategy/product-roadmap.md")).toContain("documentation");
        expect(selectedFor("packages/workflow/src/parse/json-source-parser.ts")).toContain(
            "documentation",
        );
    });

    test("honours an explicit lens list regardless of activation", () => {
        expect(selectedFor("README.md", ["security"])).toEqual(["security"]);
    });

    test("names the available lenses when asked for one that does not exist", () => {
        expect(() => selectedFor("README.md", ["docs"])).toThrow(/Unknown lens "docs"/);
    });

    test("every lens declares a prompt and at least one rule file", () => {
        for (const lens of LENSES) {
            expect(lens.promptPath.endsWith(".md")).toBe(true);
            expect(lens.rulePaths.length).toBeGreaterThan(0);
        }
    });

    test("lens ids are unique, so a requested id is unambiguous", () => {
        const ids = LENSES.map((lens) => lens.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
});
