/**
 * The deterministic rule pass.
 *
 * @remarks
 * These checks are mechanical: a pattern either appears on an added line or it
 * does not. They run before the model is called, cost nothing, and every finding
 * they produce is certain, which is what makes them safe to post without a
 * confidence score doing the filtering.
 *
 * A check belongs here only when it cannot produce a false positive on
 * legitimate code. Anything requiring judgment belongs in a lens instead, where
 * the reviewer can read the surrounding code before reporting.
 */

import { visibleLineEntries, visibleLines } from "./diff.ts";
import { blankInlineCode, scanSourceLines } from "./source-text.ts";
import type { Finding, ReviewContext } from "./types.ts";

/** One mechanical check over the added lines of a file. */
interface RuleCheck {
    /** Rule id cited in the finding. */
    id: string;
    /** Severity carried by every finding the check produces. */
    severity: Finding["severity"];
    /** One-line statement of the problem. */
    title: string;
    /** What the author should do instead. */
    guidance: string;
    /** Whether the check applies to this path. */
    appliesTo: (path: string) => boolean;
    /** Matches an added line that violates the rule. */
    matches: (line: string) => boolean;
    /**
     * Which region of the line the check reads.
     *
     * `code` is the default and covers identifiers, syntax, and types with
     * comments and literals blanked. `comments` covers comment text alone, which
     * is the only place a directive or a marker is meaningful: blanking comments
     * before matching would make those checks unable to fire. `any` reads both.
     *
     * TypeScript paths only; markdown is always scanned for inline code spans.
     */
    surface?: "code" | "comments" | "any";
}

/** Paths that are allowed to write directly to the console. */
const CONSOLE_ALLOWED = [
    "scripts/",
    "src/scripts/",
    ".test.ts",
    "src/logger.ts",
    "src/features/system/log",
];

/** Files where a dependency or configuration change is expected. */
const isDependencyManifest = (path: string): boolean =>
    path.endsWith("package.json") || path.endsWith("bun.lock");

/** Source files under the application, package, and script roots. */
const isTypeScript = (path: string): boolean => path.endsWith(".ts") || path.endsWith(".tsx");

/** Test files, which may legitimately use console output and focused cases. */
const isTestFile = (path: string): boolean =>
    path.includes(".test.") || path.includes("__tests__") || path.includes("/tests/");

/** Files that define types only, and so carry no behavior to test. */
const isDeclarationOrSchema = (path: string): boolean =>
    path.endsWith(".d.ts") ||
    /(?:^|\/)(?:types|schemas)\.ts$/.test(path) ||
    /\.(?:types|schema)\.ts$/.test(path) ||
    /(?:^|\/)index\.ts$/.test(path);

/** The mechanical checks, in report order. */
export const RULE_CHECKS: RuleCheck[] = [
    {
        id: "REPO-TS-01",
        severity: "blocking",
        title: "The `any` type erases the checking this repository relies on",
        guidance: "Give the value a real type, a generic parameter, or `unknown` plus narrowing.",
        appliesTo: isTypeScript,
        matches: (line) => /(?::\s*any\b|<any>|\bas\s+any\b)/.test(line),
    },
    {
        id: "GTS-EXPORTS-01",
        severity: "blocking",
        title: "Default exports are not used in this repository",
        guidance: "Use a named export so every import site states the symbol it imports.",
        appliesTo: isTypeScript,
        matches: (line) => /^\s*export\s+default\b/.test(line),
    },
    {
        id: "REPO-TS-02",
        severity: "major",
        title: "A single-line unbraced conditional cannot carry the explanation it needs",
        guidance:
            "Put the body on its own line inside braces, and add a comment when the branch is not obvious.",
        appliesTo: isTypeScript,
        matches: (line) =>
            /^\s*(?:if|else\s+if)\s*\([^)]*\)\s*(?:return|throw|continue|break)\b[^;]*;\s*$/.test(
                line,
            ),
    },
    {
        id: "REPO-TS-03",
        severity: "major",
        title: "Console output bypasses the configured logger",
        guidance:
            "Use the LogTape logger so records carry the level, fields, and destination the service configures.",
        appliesTo: (path) =>
            isTypeScript(path) && !CONSOLE_ALLOWED.some((allowed) => path.includes(allowed)),
        matches: (line) => /\bconsole\.(?:log|error|warn|info|debug)\s*\(/.test(line),
    },
    {
        id: "REPO-TS-04",
        severity: "major",
        title: "A type error is suppressed instead of resolved",
        guidance:
            "Fix the type, or narrow it explicitly. A suppression hides the next real error on the same line.",
        appliesTo: isTypeScript,
        matches: (line) => /@ts-(?:ignore|expect-error|nocheck)\b/.test(line),
        surface: "comments",
    },
    {
        id: "REPO-TS-05",
        severity: "minor",
        title: "Unfinished work is committed as a marker",
        guidance:
            "Resolve the marker or record the work in the task document instead of the source.",
        appliesTo: isTypeScript,
        matches: (line) => /\b(?:TODO|FIXME|XXX|HACK)\b\s*[:(]/.test(line),
        surface: "comments",
    },
    {
        id: "REPO-CONTRACT-01",
        severity: "major",
        title: "The identifier scheme is restated in code",
        guidance:
            "Identifiers are server-minted. State the scheme only in the documents that define it.",
        appliesTo: isTypeScript,
        matches: (line) => /\bUUID\s*v7\b/i.test(line) || /\buuidv7\b/i.test(line),
        surface: "any",
    },
    {
        id: "REPO-WRITING-01",
        severity: "minor",
        title: "The term is not the one this repository uses",
        guidance:
            "Use the repository's term for this concept rather than the retired or informal one.",
        appliesTo: (path) => isTypeScript(path) || path.endsWith(".md"),
        matches: (line) => /\b(?:backstop|envelope)\b/i.test(line),
        surface: "any",
    },
    {
        id: "REPO-TEST-01",
        severity: "blocking",
        title: "A focused or skipped test silently disables the rest of the run",
        guidance:
            "Remove `.only` and `.skip` before committing; a green suite must mean every case ran.",
        appliesTo: isTestFile,
        matches: (line) => /\.(?:only|skip)\s*\(/.test(line),
    },
];

/**
 * Runs the mechanical checks over every added line of the change.
 *
 * @param context - Review context holding the parsed files.
 * @returns Certain findings, in file order.
 */
export function runRuleChecks(context: ReviewContext): Finding[] {
    const findings: Finding[] = [];
    for (const file of context.files) {
        // Every line the diff shows is scanned in source order, not only the added
        // ones: a template literal or block comment can open on an unchanged line,
        // and a scanner that never saw the opener would read the changed lines
        // inside it as code. Only the added lines are then matched against.
        //
        // Prose is scanned only for inline code spans and quoted terms, so a
        // quoted term reads as a mention rather than a use.
        const entries = visibleLineEntries(file);
        const prose = file.path.endsWith(".md");
        const regions = prose
            ? entries.map((entry) => ({ code: blankInlineCode(entry.text), comments: "" }))
            : scanSourceLines(entries.map((entry) => entry.text));
        for (const [index, entry] of entries.entries()) {
            if (!entry.added) {
                continue;
            }
            const region = regions[index] ?? { code: "", comments: "" };
            for (const check of RULE_CHECKS) {
                if (!check.appliesTo(file.path)) {
                    continue;
                }
                // Comment text is mention-aware for the same reason prose is: the
                // document that defines a directive has to be able to name it.
                const commentText = blankInlineCode(region.comments);
                const candidates =
                    check.surface === "comments"
                        ? [commentText]
                        : check.surface === "any"
                          ? [region.code, commentText]
                          : [region.code];
                if (!candidates.some((candidate) => check.matches(candidate))) {
                    continue;
                }
                findings.push({
                    ruleId: check.id,
                    path: file.path,
                    line: entry.line,
                    severity: check.severity,
                    confidence: 100,
                    title: check.title,
                    body: `${check.guidance}\n\nOffending line: \`${entry.text.trim()}\``,
                    evidence: entry.text.trim(),
                    lens: "rules",
                });
            }
        }
    }
    return findings;
}

/**
 * Finds newly added source files with no test covering them.
 *
 * The repository requires a test beside new behavior, and the check is
 * mechanical because it only compares file names: a new source module counts as
 * covered when a test file for it exists on disk or arrives in the same change.
 *
 * @param context - Review context holding the parsed files and the repository checkout.
 * @returns A finding per uncovered new source file.
 */
export function findUncoveredSourceFiles(context: ReviewContext): Finding[] {
    const testPaths = new Set(
        context.files.filter((file) => isTestFile(file.path)).map((file) => file.path),
    );
    const findings: Finding[] = [];
    for (const file of context.files) {
        if (!file.added || !isTypeScript(file.path) || isTestFile(file.path)) {
            continue;
        }
        const inReviewScope =
            file.path.startsWith("apps/") ||
            file.path.startsWith("apis/") ||
            /^packages\/[^/]+\/src\//.test(file.path);
        if (!inReviewScope || isDeclarationOrSchema(file.path)) {
            continue;
        }
        const testPath = file.path.replace(/\.(tsx?)$/, ".test.$1");
        const covered =
            testPaths.has(testPath) || Bun.file(`${context.workingDirectory}/${testPath}`).size > 0;
        if (covered) {
            continue;
        }
        findings.push({
            ruleId: "REPO-TEST-03",
            path: file.path,
            line: visibleLines(file, "added")[0] ?? 1,
            severity: "blocking",
            confidence: 90,
            title: "New source file arrives without a test",
            body: `No test file covers this module. This repository requires a test for new behavior, and a reviewer will look for \`${testPath}\` beside it.`,
            evidence: file.path,
            lens: "rules",
        });
    }
    return findings;
}

/**
 * Flags a dependency change that arrives without any accompanying source change.
 *
 * A manifest edit on its own is sometimes correct, so the finding states the
 * change rather than asserting a defect; the reviewer decides.
 *
 * @param context - Review context holding the parsed files and pull request body.
 * @returns At most one finding.
 */
export function findUnjustifiedDependencyChange(context: ReviewContext): Finding[] {
    const manifests = context.files.filter((file) => isDependencyManifest(file.path));
    if (manifests.length === 0) {
        return [];
    }
    const sourceChanges = context.files.filter(
        (file) => isTypeScript(file.path) || file.path.endsWith(".json"),
    );
    if (sourceChanges.length > manifests.length) {
        return [];
    }
    const manifest = manifests[0];
    if (manifest === undefined) {
        return [];
    }
    return [
        {
            ruleId: "REPO-DEPS-01",
            path: manifest.path,
            line: visibleLines(manifest, "added")[0] ?? 1,
            severity: "minor",
            confidence: 85,
            title: "Dependency change arrives without code that uses it",
            body: "The change edits a manifest without accompanying source. State in the pull request description why the dependency change stands alone, or include the code that consumes it.",
            evidence: manifest.path,
            lens: "rules",
        },
    ];
}
