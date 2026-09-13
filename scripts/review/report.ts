/**
 * Report rendering: inline comment bodies and the pull request summary.
 *
 * @remarks
 * A review comment has to carry everything a reader needs without a second
 * lookup: which rule was violated, how serious it is, what the offending code
 * is, and what to do instead. The comment also carries the marker and rule id
 * that suppression depends on, so this module and the merge module must agree on
 * the format.
 */

import { COMMENT_MARKER, type DraftComment, SUMMARY_MARKER } from "./github.ts";
import { countBySeverity } from "./merge.ts";
import type { LensResult } from "./reviewer.ts";
import { type Finding, isBlocking, type ReviewContext, type Severity } from "./types.ts";

/** Severity names as they are written in a comment. */
const SEVERITY_LABELS: Record<Severity, string> = {
    critical: "Critical",
    high: "High",
    medium: "Medium",
    low: "Low",
    informational: "Informational",
};

/** Severities in the order the report lists them. */
const SEVERITY_ORDER: readonly Severity[] = ["critical", "high", "medium", "low", "informational"];

/**
 * Renders a finding as a review comment.
 *
 * @param finding - Finding to render.
 * @returns Comment body carrying the pipeline marker and the cited rule id.
 */
export function renderComment(finding: Finding): string {
    const lines = [
        COMMENT_MARKER,
        `**\`${finding.ruleId}\` · ${SEVERITY_LABELS[finding.severity]}${
            isBlocking(finding.severity) ? " · BLOCKING" : ""
        }** — ${finding.title}`,
        "",
        finding.body,
    ];
    if (finding.evidence.trim().length > 0) {
        lines.push(
            "",
            "<details><summary>Evidence</summary>",
            "",
            "```ts",
            finding.evidence,
            "```",
            "",
            "</details>",
        );
    }
    lines.push("", `<sub>lens: ${finding.lens} · confidence ${finding.confidence}/100</sub>`);
    return lines.join("\n");
}

/**
 * Converts findings into inline comments.
 *
 * @param findings - Findings that survived filtering.
 * @returns One draft comment per finding.
 */
export function renderComments(findings: Finding[]): DraftComment[] {
    return findings.map((finding) => ({
        path: finding.path,
        line: finding.line,
        body: renderComment(finding),
    }));
}

/**
 * Renders the summary comment posted beside the inline comments.
 *
 * The table is the readable index of the review; the inline comments carry the
 * detail. Lens failures are reported here so a silent reviewer is visible rather
 * than mistaken for a clean one.
 *
 * @param context - Review context.
 * @param findings - Findings that survived filtering.
 * @param lensResults - Per-lens outcomes, including failures.
 * @param stats - Counts describing what the pipeline dropped.
 * @returns Summary body carrying the summary marker.
 */
export function renderSummary(
    context: ReviewContext,
    findings: Finding[],
    lensResults: LensResult[],
    stats: { suppressed: number; duplicates: number; capped: number; belowFloor: number },
): string {
    const counts = countBySeverity(findings);
    const shortSha = context.headSha.slice(0, 8);
    const lines = [
        SUMMARY_MARKER,
        "## Automated review",
        "",
        `Reviewed \`${shortSha}\` with ${lensResults.length} reviewer${
            lensResults.length === 1 ? "" : "s"
        }. ${summarizeCounts(counts)}`,
    ];

    if (findings.length > 0) {
        lines.push("", "| Severity | Rule | Location | Finding |", "| --- | --- | --- | --- |");
        for (const finding of findings) {
            lines.push(
                `| ${SEVERITY_LABELS[finding.severity]}${isBlocking(finding.severity) ? " (BLOCKING)" : ""} | \`${finding.ruleId}\` | \`${finding.path}:${finding.line}\` | ${escapeCell(
                    finding.title,
                )} |`,
            );
        }
    }

    const dropped: string[] = [];
    if (stats.suppressed > 0) {
        dropped.push(`${stats.suppressed} already answered`);
    }
    if (stats.duplicates > 0) {
        dropped.push(`${stats.duplicates} duplicate`);
    }
    if (stats.capped > 0) {
        dropped.push(`${stats.capped} over the per-rule cap`);
    }
    if (stats.belowFloor > 0) {
        dropped.push(`${stats.belowFloor} below the confidence floor`);
    }
    if (dropped.length > 0) {
        lines.push("", `Filtered out: ${dropped.join(", ")}.`);
    }

    const failures = lensResults.filter((result) => result.error.length > 0);
    if (failures.length > 0) {
        lines.push(
            "",
            "Reviewers that did not complete:",
            ...failures.map((failure) => `- \`${failure.lens.id}\`: ${failure.error}`),
        );
    }

    lines.push(
        "",
        "<sub>Findings marked BLOCKING are the ones to fix before this merges; the rest are worth ",
        "doing but do not hold it up. Push a new commit to re-review, or comment `/rescan` to re-run ",
        "against the same commit. Resolved threads are never reopened.</sub>",
    );
    return lines.join("\n");
}

/**
 * States the finding counts in one phrase.
 *
 * Blocking findings are counted first because they are the ones the author has
 * to act on; the per-severity breakdown follows so the phrase still says what
 * kind of work each one is.
 *
 * @param counts - Counts keyed by severity.
 * @returns A phrase such as `2 blocking (1 critical, 1 medium), 1 non-blocking (1 low)`.
 */
function summarizeCounts(counts: Record<Severity, number>): string {
    const blocking = counts.critical + counts.high + counts.medium;
    const nonBlocking = counts.low + counts.informational;
    if (blocking === 0 && nonBlocking === 0) {
        return "No findings.";
    }
    const parts: string[] = [];
    if (blocking > 0) {
        parts.push(`${blocking} blocking (${breakdown(counts, "blocking")})`);
    }
    if (nonBlocking > 0) {
        parts.push(`${nonBlocking} non-blocking (${breakdown(counts, "non-blocking")})`);
    }
    return `${parts.join(", ")}.`;
}

/**
 * Lists the non-zero severities within one half of the scale.
 *
 * @param counts - Counts keyed by severity.
 * @param half - Which half of the scale to describe.
 * @returns Severity names with their counts, such as `1 critical, 1 medium`.
 */
function breakdown(counts: Record<Severity, number>, half: "blocking" | "non-blocking"): string {
    return SEVERITY_ORDER.filter((severity) =>
        half === "blocking" ? isBlocking(severity) : !isBlocking(severity),
    )
        .filter((severity) => counts[severity] > 0)
        .map((severity) => `${counts[severity]} ${SEVERITY_LABELS[severity].toLowerCase()}`)
        .join(", ");
}

/**
 * Escapes a value for use inside a markdown table cell.
 *
 * @param value - Raw cell text.
 * @returns Text safe to place between pipes.
 */
function escapeCell(value: string): string {
    return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
