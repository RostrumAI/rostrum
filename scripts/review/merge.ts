/**
 * Finding suppression, deduplication, and ordering.
 *
 * @remarks
 * This module is what makes a rescan useful instead of annoying. A finding that
 * a maintainer already resolved is never raised again, a finding still open on
 * the same line is not restated, and overlapping reports from different lenses
 * collapse into one. Everything here reads state GitHub already holds, so the
 * pipeline keeps no database of its own.
 */

import { hunkIndexOf } from "./diff.ts";
import { COMMENT_MARKER, type ReviewThread } from "./github.ts";
import type { Finding, ReviewContext, Severity } from "./types.ts";
import { isWithdrawn, parseVerdict } from "./verdicts.ts";

/** Repository-relative distance within which an open comment suppresses a repeat. */
const OPEN_THREAD_TOLERANCE = 5;

/** Maximum number of findings posted for one rule at one path. */
const PER_RULE_PATH_CAP = 5;

/** Rule ids a comment may carry, including the lens fallbacks. */
const RULE_ID_PATTERN = /\*\*`([A-Z][A-Z0-9-]*)`/;

/** Severity ranking used when ordering the report. */
const SEVERITY_ORDER: Record<Severity, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
    informational: 4,
};

/** A finding already posted and answered, keyed by the rule and path it cited. */
interface AnsweredFinding {
    /** Rule id extracted from the comment body. */
    ruleId: string;
    /** Path the comment was anchored to. */
    path: string;
    /** Line the comment was anchored to, when GitHub still reports one. */
    line: number | null;
}

/**
 * Extracts the rule id a pipeline comment cites.
 *
 * @param body - Comment body, with or without the marker.
 * @returns The rule id, or null when the comment is not a pipeline finding.
 */
export function ruleIdFromComment(body: string): string | null {
    const match = RULE_ID_PATTERN.exec(body);
    return match?.[1] ?? null;
}

/**
 * Splits pipeline threads into those still open and those already answered.
 *
 * A finding stops being raised when a maintainer resolves its thread, or when an
 * adjudication withdrew it. A human reply alone is not enough: the reviewer may
 * have answered the reply and stood by the finding, and treating the reply as a
 * disposition would silently overrule that answer on the next rescan.
 *
 * A thread the pipeline never commented on is a human conversation about the same
 * code. It suppresses nothing, because it is a separate discussion rather than a
 * verdict on this rule.
 *
 * @param threads - Review threads read from GitHub.
 * @returns Open and answered pipeline findings.
 */
export function partitionThreads(threads: ReviewThread[]): {
    open: AnsweredFinding[];
    resolved: AnsweredFinding[];
} {
    const open: AnsweredFinding[] = [];
    const resolved: AnsweredFinding[] = [];
    for (const thread of threads) {
        const pipelineIndex = thread.comments.findIndex((comment) =>
            comment.body.includes(COMMENT_MARKER),
        );
        if (pipelineIndex === -1) {
            continue;
        }
        const ruleId = ruleIdFromComment(thread.comments[pipelineIndex]?.body ?? "");
        if (ruleId === null) {
            continue;
        }
        const entry: AnsweredFinding = { ruleId, path: thread.path, line: thread.line };
        if (thread.isResolved || threadVerdictWithdraws(thread)) {
            resolved.push(entry);
        } else {
            open.push(entry);
        }
    }
    return { open, resolved };
}

/**
 * Reports whether an adjudication withdrew the finding on a thread.
 *
 * @param thread - Review thread to inspect.
 * @returns True when the reviewer's own reply records a withdrawing verdict.
 */
function threadVerdictWithdraws(thread: ReviewThread): boolean {
    return thread.comments.some((comment) => {
        const verdict = parseVerdict(comment.body);
        return verdict !== null && isWithdrawn(verdict);
    });
}

/**
 * Removes findings that are already answered or already open on the pull request.
 *
 * A resolved thread suppresses its finding at the same rule and path even when
 * the line moved, because the author has already dispositioned that rule there.
 * An open thread suppresses only nearby repeats, so a new occurrence elsewhere
 * in the same file is still reported.
 *
 * @param findings - Candidate findings from the deterministic pass and the lenses.
 * @param threads - Review threads read from GitHub.
 * @returns Findings that should still be reported, and the count suppressed.
 */
export function suppressAnswered(
    findings: Finding[],
    threads: ReviewThread[],
): { kept: Finding[]; suppressed: number } {
    const { open, resolved } = partitionThreads(threads);
    const kept = findings.filter((finding) => {
        const answered = resolved.some(
            (entry) => entry.ruleId === finding.ruleId && entry.path === finding.path,
        );
        if (answered) {
            return false;
        }
        const stillOpen = open.some(
            (entry) =>
                entry.ruleId === finding.ruleId &&
                entry.path === finding.path &&
                entry.line !== null &&
                Math.abs(entry.line - finding.line) <= OPEN_THREAD_TOLERANCE,
        );
        return !stillOpen;
    });
    return { kept, suppressed: findings.length - kept.length };
}

/**
 * Collapses duplicate findings and caps repetition of one rule at one path.
 *
 * Three lenses looking at the same broken condition will each report it, so
 * collapsing is what keeps the review readable. The key differs by origin: a
 * deterministic finding is certain and precise, so it is keyed to its exact
 * line; a model finding is keyed to its hunk, because reviewers describing the
 * same defect from different angles cite different lines within one region.
 * Between two findings for the same key, the deterministic pass wins, then the
 * higher confidence, then the more detailed body.
 *
 * @param findings - Candidate findings.
 * @param context - Review context holding the parsed files, used to resolve hunks.
 * @returns Deduplicated findings, with a count of what was dropped.
 */
export function deduplicate(
    findings: Finding[],
    context: ReviewContext,
): {
    kept: Finding[];
    duplicates: number;
} {
    // First collapse everything that landed on the same line, whatever produced
    // it, so a model finding that restates a mechanical one disappears.
    const byLine = new Map<string, Finding>();
    for (const finding of findings) {
        const key = `${finding.ruleId}@${finding.path}:${finding.line}`;
        const existing = byLine.get(key);
        if (existing === undefined || preferredOver(finding, existing)) {
            byLine.set(key, finding);
        }
    }

    // Then collapse the surviving model findings within a hunk. A deterministic
    // finding is exact, so it keeps its own line and is never merged into one.
    const byRegion = new Map<string, Finding>();
    const deterministic: Finding[] = [];
    for (const finding of sortFindings([...byLine.values()])) {
        if (finding.lens === "rules") {
            deterministic.push(finding);
            continue;
        }
        const key = `${finding.ruleId}@${finding.path}#${regionKey(finding, context)}`;
        const existing = byRegion.get(key);
        if (existing === undefined || preferredOver(finding, existing)) {
            byRegion.set(key, finding);
        }
    }

    return {
        kept: [...deterministic, ...byRegion.values()],
        duplicates: findings.length - deterministic.length - byRegion.size,
    };
}

/**
 * Limits how many findings one rule may post at one path.
 *
 * This runs after suppression, not before: the budget exists to bound what is
 * actually posted, and a finding a maintainer has already answered must not
 * consume it. Capping first would spend the budget on findings that suppression
 * then removes, so a later genuine occurrence would be dropped without ever
 * being shown.
 *
 * @param findings - Findings that survived suppression, in report order.
 * @returns The findings to post, with the count dropped for exceeding the cap.
 */
export function applyPerRuleCap(findings: Finding[]): { kept: Finding[]; capped: number } {
    const perRulePath = new Map<string, number>();
    const kept: Finding[] = [];
    let capped = 0;
    for (const finding of findings) {
        const key = `${finding.ruleId}@${finding.path}`;
        const seen = perRulePath.get(key) ?? 0;
        if (seen >= PER_RULE_PATH_CAP) {
            capped += 1;
            continue;
        }
        perRulePath.set(key, seen + 1);
        kept.push(finding);
    }
    return { kept, capped };
}

/**
 * Resolves a finding to the hunk it sits in, for grouping model findings.
 *
 * @param finding - Finding whose line is resolved.
 * @param context - Review context holding the parsed files.
 * @returns The hunk index as a string, or the line number when no hunk matches.
 */
function regionKey(finding: Finding, context: ReviewContext): string {
    const file = context.files.find((candidate) => candidate.path === finding.path);
    if (file === undefined) {
        return String(finding.line);
    }
    const index = hunkIndexOf(file, finding.line);
    return index === -1 ? String(finding.line) : String(index);
}

/**
 * Decides which of two findings for the same location to keep.
 *
 * @param candidate - Newly considered finding.
 * @param current - Finding already held for the location.
 * @returns True when the candidate should replace the current one.
 */
function preferredOver(candidate: Finding, current: Finding): boolean {
    if (candidate.lens === "rules" && current.lens !== "rules") {
        return true;
    }
    if (current.lens === "rules" && candidate.lens !== "rules") {
        return false;
    }
    if (candidate.confidence !== current.confidence) {
        return candidate.confidence > current.confidence;
    }
    return candidate.body.length > current.body.length;
}

/**
 * Drops findings below the confidence floor.
 *
 * The deterministic pass scores 100 and is never filtered; the floor exists to
 * keep a language model's uncertain guesses off the pull request.
 *
 * @param findings - Candidate findings.
 * @param floor - Minimum confidence to report.
 * @returns Findings at or above the floor.
 */
export function applyConfidenceFloor(findings: Finding[], floor: number): Finding[] {
    return findings.filter((finding) => finding.lens === "rules" || finding.confidence >= floor);
}

/**
 * Orders findings by severity, then path, then line.
 *
 * @param findings - Findings to order.
 * @returns A new array in report order.
 */
export function sortFindings(findings: Finding[]): Finding[] {
    return [...findings].sort((left, right) => {
        const severity = SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity];
        if (severity !== 0) {
            return severity;
        }
        if (left.path !== right.path) {
            return left.path.localeCompare(right.path);
        }
        if (left.line !== right.line) {
            return left.line - right.line;
        }
        return left.ruleId.localeCompare(right.ruleId);
    });
}

/**
 * Counts findings per severity for the report header.
 *
 * @param findings - Findings to summarise.
 * @returns Counts keyed by severity.
 */
export function countBySeverity(findings: Finding[]): Record<Severity, number> {
    const counts: Record<Severity, number> = {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        informational: 0,
    };
    for (const finding of findings) {
        counts[finding.severity] += 1;
    }
    return counts;
}
