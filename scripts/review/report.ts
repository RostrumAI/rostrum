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
import type { Finding, ReviewContext } from "./types.ts";

/**
 * Renders a finding as a review comment.
 *
 * @param finding - Finding to render.
 * @returns Comment body carrying the pipeline marker and the cited rule id.
 */
export function renderComment(finding: Finding): string {
    const lines = [
        COMMENT_MARKER,
        `**\`${finding.ruleId}\` · ${finding.severity}** — ${finding.title}`,
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
                `| ${finding.severity} | \`${finding.ruleId}\` | \`${finding.path}:${finding.line}\` | ${escapeCell(
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
        "<sub>Advisory review; it does not block merging. Push a new commit to re-review, or comment ",
        "`/rescan` to re-run against the same commit. Resolved threads are never reopened.</sub>",
    );
    return lines.join("\n");
}

/**
 * States the finding counts in one phrase.
 *
 * @param counts - Counts keyed by severity.
 * @returns A phrase such as `2 blocking, 1 major`.
 */
function summarizeCounts(counts: { blocking: number; major: number; minor: number }): string {
    const parts: string[] = [];
    for (const [severity, count] of Object.entries(counts)) {
        if (count > 0) {
            parts.push(`${count} ${severity}`);
        }
    }
    return parts.length === 0 ? "No findings." : `${parts.join(", ")}.`;
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
