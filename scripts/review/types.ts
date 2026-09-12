/**
 * Shared value types for the automated review pipeline.
 *
 * @remarks
 * These types are the contract between the GitHub layer, the deterministic rule
 * pass, the model-backed lens reviewers, and the poster. A lens reviewer returns
 * the subset of `Finding` a model can be trusted to produce; the pipeline adds
 * the `lens` attribution and validates the location before anything is posted.
 */

/**
 * How much a finding should hold up a change.
 *
 * The scale says what the finding is, not only how urgent it feels: a defect
 * that breaks the product or is exploitable is `critical`, an obvious bug or a
 * weaker security weakness is `high`, a convention broken at file or module
 * scope is `medium`, a line-level problem is `low`, and a suggestion with no
 * defect behind it is `informational`.
 */
export type Severity = "critical" | "high" | "medium" | "low" | "informational";

/** Severities that hold up a change until they are addressed. */
const BLOCKING_SEVERITIES: readonly Severity[] = ["critical", "high", "medium"];

/**
 * Reports whether a severity blocks a change.
 *
 * @param severity - Severity to test.
 * @returns True when the finding must be fixed before the change lands.
 */
export function isBlocking(severity: Severity): boolean {
    return BLOCKING_SEVERITIES.includes(severity);
}

/** A single review finding, located on the pull request's changed lines. */
export interface Finding {
    /** Rule the finding cites, such as `REPO-TEST-02`, or `BUG` / `SEC` for uncovered defects. */
    ruleId: string;
    /** Repository-relative path of the file the finding is anchored to. */
    path: string;
    /** One-based line number in the file at the pull request head commit. */
    line: number;
    /** How much the finding should hold up the change. */
    severity: Severity;
    /** Reviewer's own 0-100 confidence that the finding is correct and worth fixing. */
    confidence: number;
    /** One-line statement of the problem. */
    title: string;
    /** What is wrong, why it matters, and what to do instead. */
    body: string;
    /** The changed code the finding rests on, trimmed. */
    evidence: string;
    /** Lens that produced the finding, or `rules` for the deterministic pass. */
    lens: string;
}

/** A file's changed regions, parsed from the pull request patch. */
export interface FileDiff {
    /** Repository-relative path of the changed file. */
    path: string;
    /** Hunks in file order; empty when the change only renames or changes mode. */
    hunks: DiffHunk[];
    /** True when the file is newly added by the pull request. */
    added: boolean;
    /** True when the pull request deletes the file. */
    deleted: boolean;
}

/**
 * One `@@` hunk of a unified diff, indexed by the line numbers GitHub will
 * accept a review comment on.
 */
export interface DiffHunk {
    /** Header text as written in the patch, used for diagnostics. */
    header: string;
    /** New-file line numbers visible in the hunk, in ascending order. */
    newLines: number[];
    /** New-file line numbers whose content the pull request introduces. */
    addedLines: number[];
    /**
     * Line contents keyed by new-file line number, without the leading marker.
     *
     * Context lines are included, not only added ones, because a template literal
     * or block comment can open on an unchanged line and continue into a changed
     * one; a scanner that saw only added lines would misread what region it is in.
     */
    text: Map<number, string>;
}

/** Identifies the pull request under review. */
export interface PullRequestRef {
    /** Repository owner, such as `RostrumAI`. */
    owner: string;
    /** Repository name, such as `rostrum`. */
    repo: string;
    /** Pull request number. */
    number: number;
}

/** Everything a lens reviewer needs to review one pull request. */
export interface ReviewContext {
    /** Pull request under review. */
    pullRequest: PullRequestRef;
    /** Commit the review is anchored to; review comments are attached to this commit. */
    headSha: string;
    /** Pull request title. */
    title: string;
    /** Pull request body, empty when the author supplied none. */
    body: string;
    /** Login of the pull request author. */
    author: string;
    /** Parsed changed files. */
    files: FileDiff[];
    /** Findings the deterministic pass already produced. */
    ruleFindings: Finding[];
    /** Repository root of the checkout under review, used to check for sibling test files. */
    workingDirectory: string;
    /** Path to the unified diff written for the reviewers to read. */
    patchPath: string;
    /** Findings already answered on this pull request, which reviewers must not repeat. */
    resolvedThreads: ResolvedThread[];
}

/** A finding already answered on the pull request. */
export interface ResolvedThread {
    /** Rule the answered finding cited. */
    ruleId: string;
    /** Path the answered finding was anchored to. */
    path: string;
    /** Line the answered finding was anchored to, when still known. */
    line: number | null;
}

/** A reviewer lens: one independent angle on the same change. */
export interface Lens {
    /** Stable identifier used by `--lenses` and by `lens` attribution. */
    id: string;
    /** Short human label for the report summary. */
    label: string;
    /** Path to the lens system prompt, relative to the skill directory. */
    promptPath: string;
    /** Rule files this lens reviews against, relative to the skill directory. */
    rulePaths: string[];
    /** Whether this lens should run against the given changed files. */
    applies: (files: FileDiff[]) => boolean;
}
