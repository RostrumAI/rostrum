/**
 * The weekly retrospective: turning adjudications into rule changes.
 *
 * @remarks
 * The review loop produces a typed verdict every time a finding is answered, and
 * those verdicts are the only honest measure of whether a rule works. This walks
 * every pull request touched since the last run, classifies each finding's
 * outcome from its verdict, aggregates per rule, and proposes edits to the rule
 * corpus as a pull request for a human to accept.
 *
 * Two properties are load-bearing:
 *
 * - **Only a refutation counts against a rule.** A maintainer accepting a
 *   deliberate tradeoff says nothing about whether the rule is correct, and a
 *   finding that was simply fixed says nothing either. Conflating those with
 *   refutations would tune the corpus toward whatever silences it fastest.
 * - **Nothing is applied.** The output is a diff with citations. A rule can only
 *   be weakened by a person deciding to weaken it.
 */

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
    COMMENT_MARKER,
    fetchReviewThreads,
    listPullRequestsUpdatedSince,
    type ReviewThread,
    resolveRepository,
} from "./github.ts";
import { ruleIdFromComment } from "./merge.ts";
import { runProcessOrThrow } from "./process.ts";
import { isBlocking, type Severity } from "./types.ts";
import { parseVerdict, type Verdict } from "./verdicts.ts";

/** Minimum observations before a rule's record is worth acting on. */
const MIN_OBSERVATIONS = 5;

/** Share of refuted outcomes at which a rule is proposed for narrowing. */
const REFUTED_RATE_FOR_NARROWING = 0.4;

/** Share of withdrawn-without-refutation outcomes at which severity is lowered. */
const WITHDRAWN_RATE_FOR_DOWNGRADE = 0.6;

/** Every severity a rule file may declare, used to validate what the corpus says. */
const ALL_SEVERITIES: readonly Severity[] = ["critical", "high", "medium", "low", "informational"];

/**
 * Validates a severity read out of a rule file.
 *
 * @param value - Captured severity text, when the pattern matched.
 * @returns The severity, or null when none was declared or it is unrecognized.
 */
function asSeverity(value: string | undefined): Severity | null {
    return ALL_SEVERITIES.find((severity) => severity === value) ?? null;
}

/** One finding's outcome, as recorded by the adjudication. */
export interface FindingOutcome {
    /** Rule the finding cited. */
    ruleId: string;
    /** Path the finding was anchored to. */
    path: string;
    /** Pull request the finding was posted on. */
    pullRequest: number;
    /** Verdict reached, or `unadjudicated` when the thread has none. */
    verdict: Verdict | "unadjudicated" | "open";
}

/** Per-rule tally used to decide whether a rule is working. */
export interface RuleRecord {
    /** Rule id. */
    ruleId: string;
    /** Findings posted. */
    fired: number;
    /** Findings the reviewer withdrew after being refuted. */
    refuted: number;
    /** Findings the reviewer withdrew because the tradeoff was accepted. */
    intentional: number;
    /** Findings the reviewer withdrew because the code had changed. */
    codeChanged: number;
    /** Findings the reviewer stood behind. */
    stands: number;
    /** Findings left to a human. */
    needsHuman: number;
    /** Findings still open with no verdict yet. */
    unadjudicated: number;
    /** Pull requests the rule fired on, for citation. */
    pullRequests: number[];
}

/**
 * Walks the pull requests touched since a moment and records every outcome.
 *
 * @param owner - Repository owner.
 * @param repo - Repository name.
 * @param since - ISO 8601 timestamp.
 * @returns One outcome per finding, in pull request order.
 */
export async function harvestOutcomes(
    owner: string,
    repo: string,
    since: string,
): Promise<FindingOutcome[]> {
    const numbers = await listPullRequestsUpdatedSince(owner, repo, since);
    const outcomes: FindingOutcome[] = [];
    for (const number of numbers) {
        const threads = await fetchReviewThreads({ owner, repo, number });
        for (const thread of threads) {
            const outcome = outcomeFor(thread, number);
            if (outcome !== null) {
                outcomes.push(outcome);
            }
        }
    }
    return outcomes;
}

/**
 * Reads one thread's outcome.
 *
 * @param thread - Review thread to classify.
 * @param pullRequest - Pull request the thread belongs to.
 * @returns The outcome, or null when the thread is not one of the reviewer's findings.
 */
function outcomeFor(thread: ReviewThread, pullRequest: number): FindingOutcome | null {
    const finding = thread.comments.find((comment) => comment.body.includes(COMMENT_MARKER));
    if (finding === undefined) {
        return null;
    }
    const ruleId = ruleIdFromComment(finding.body);
    if (ruleId === null) {
        return null;
    }
    const verdict = thread.comments
        .map((comment) => parseVerdict(comment.body))
        .find((candidate): candidate is Verdict => candidate !== null);
    return {
        ruleId,
        path: thread.path,
        pullRequest,
        verdict: verdict ?? (thread.isResolved ? "code_changed" : "open"),
    };
}

/**
 * Tallies outcomes per rule.
 *
 * @param outcomes - Findings harvested from the pull requests.
 * @returns One record per rule that fired, keyed by rule id and sorted by id.
 */
export function aggregateByRule(outcomes: FindingOutcome[]): RuleRecord[] {
    const records = new Map<string, RuleRecord>();
    for (const outcome of outcomes) {
        const record = records.get(outcome.ruleId) ?? {
            ruleId: outcome.ruleId,
            fired: 0,
            refuted: 0,
            intentional: 0,
            codeChanged: 0,
            stands: 0,
            needsHuman: 0,
            unadjudicated: 0,
            pullRequests: [],
        };
        record.fired += 1;
        switch (outcome.verdict) {
            case "refuted":
                record.refuted += 1;
                break;
            case "intentional":
                record.intentional += 1;
                break;
            case "code_changed":
                record.codeChanged += 1;
                break;
            case "stands":
                record.stands += 1;
                break;
            case "needs_human":
                record.needsHuman += 1;
                break;
            default:
                record.unadjudicated += 1;
                break;
        }
        if (!record.pullRequests.includes(outcome.pullRequest)) {
            record.pullRequests.push(outcome.pullRequest);
        }
        records.set(outcome.ruleId, record);
    }
    return [...records.values()].sort((left, right) => left.ruleId.localeCompare(right.ruleId));
}

/** A rule change the retrospective proposes. */
export interface RuleProposal {
    /** Rule the proposal concerns. */
    ruleId: string;
    /** What to change. */
    change: "narrow" | "downgrade-severity" | "add-rule" | "human-review";
    /** One line stating the change. */
    summary: string;
    /** Why, with the numbers behind it. */
    rationale: string;
    /** Pull requests whose threads justify it. */
    pullRequests: number[];
}

/**
 * Reads the severity a rule declares in the corpus.
 *
 * @param ruleId - Rule to look up.
 * @param severityByRule - Map built from the corpus by {@link readRuleSeverities}.
 * @returns The declared severity, or null when the rule is not in the corpus.
 */
export function severityOf(ruleId: string, severityByRule: Map<string, Severity>): Severity | null {
    return severityByRule.get(ruleId) ?? null;
}

/**
 * Builds the rule-id-to-severity map from the corpus files.
 *
 * The retrospective has to know how severe a rule is before it can decide whether
 * a change to it needs a person. That fact lives in the rule file, so it is read
 * from there rather than duplicated.
 *
 * @param skillDirectory - Directory holding the rule files.
 * @returns Severity per rule id.
 */
export async function readRuleSeverities(skillDirectory: string): Promise<Map<string, Severity>> {
    const severities = new Map<string, Severity>();
    for (const file of ["repository-conventions.md", "google-typescript.md"]) {
        const text = await Bun.file(`${skillDirectory}/rules/${file}`).text();
        let current: string | null = null;
        for (const line of text.split("\n")) {
            // The corpus uses two layouts: a `###` heading whose severity sits on a
            // later metadata line, and one bold run carrying both the id and the
            // severity. Reading both means a new rule file needs no parser change as
            // long as it keeps one of the two shapes.
            const inline = /^\*\*`?([A-Z][A-Z0-9-]*)`?\s*—[\s\S]*?\*\*\s*—\s*`([a-z]+)`/.exec(line);
            const inlineSeverity = asSeverity(inline?.[2]);
            if (inline?.[1] !== undefined && inlineSeverity !== null) {
                severities.set(inline[1], inlineSeverity);
                current = null;
                continue;
            }
            const heading = /^###\s+`?([A-Z][A-Z0-9-]*)`?\s+—/.exec(line);
            if (heading?.[1] !== undefined) {
                current = heading[1];
                continue;
            }
            if (current === null || !line.includes("**Severity:**")) {
                continue;
            }
            const declared = asSeverity(/\*\*Severity:\*\*\s*`?([a-z]+)`?/.exec(line)?.[1]);
            if (declared !== null) {
                severities.set(current, declared);
                current = null;
            }
        }
    }
    return severities;
}

/**
 * Decides which rule changes the evidence supports.
 *
 * A rule with too few observations is left alone: two refutations out of three is
 * not a signal, and acting on it would tune the corpus to noise. A rule that
 * blocks — `medium` or above — is proposed for human review rather than for an
 * automatic edit, because a blocking rule that looks noisy is a fact worth a
 * person's attention rather than a diff.
 *
 * @param records - Per-rule tallies.
 * @param severityByRule - Severity per rule id, read from the corpus.
 * @returns Proposals, most-evidenced first.
 */
export function proposeRuleChanges(
    records: RuleRecord[],
    severityByRule: Map<string, Severity>,
): RuleProposal[] {
    const proposals: RuleProposal[] = [];
    for (const record of records) {
        if (record.fired < MIN_OBSERVATIONS) {
            continue;
        }
        const refutedRate = record.refuted / record.fired;
        const withdrawnWithoutRefutation = record.intentional + record.codeChanged;
        const withdrawnRate = withdrawnWithoutRefutation / record.fired;
        const evidence = `fired ${record.fired}x: ${record.refuted} refuted, ${record.intentional} intentional, ${record.codeChanged} already fixed, ${record.stands} upheld, ${record.needsHuman} escalated`;
        const severity = severityOf(record.ruleId, severityByRule);
        const protectedRule = severity !== null && isBlocking(severity);
        if (refutedRate >= REFUTED_RATE_FOR_NARROWING) {
            proposals.push({
                ruleId: record.ruleId,
                change: protectedRule ? "human-review" : "narrow",
                summary: `Narrow ${record.ruleId}: it was refuted in ${Math.round(refutedRate * 100)}% of its findings`,
                rationale: `${evidence}. A rule that is refuted this often is either too broad or does not describe what the repository wants; narrow its flag pattern or state the exclusion it is missing.`,
                pullRequests: record.pullRequests,
            });
            continue;
        }
        if (withdrawnRate >= WITHDRAWN_RATE_FOR_DOWNGRADE && record.stands === 0) {
            proposals.push({
                ruleId: record.ruleId,
                change: protectedRule ? "human-review" : "downgrade-severity",
                summary: `Lower the severity of ${record.ruleId}`,
                rationale: `${evidence}. Nothing was upheld and nothing was refuted, so the rule is finding real but unimportant things; it should not carry the severity it does.`,
                pullRequests: record.pullRequests,
            });
        }
    }
    return proposals.sort((left, right) => right.pullRequests.length - left.pullRequests.length);
}

/**
 * Renders the retrospective report.
 *
 * @param records - Per-rule tallies.
 * @param proposals - Proposed changes.
 * @param window - Human-readable description of the period covered.
 * @returns Markdown report.
 */
export function renderReport(
    records: RuleRecord[],
    proposals: RuleProposal[],
    window: string,
): string {
    const totalFired = records.reduce((sum, record) => sum + record.fired, 0);
    const totalRefuted = records.reduce((sum, record) => sum + record.refuted, 0);
    const lines = [
        `# Reviewer retrospective (${window})`,
        "",
        `${totalFired} findings across ${records.length} rules; ${totalRefuted} were refuted after review.`,
        "",
    ];
    if (proposals.length === 0) {
        lines.push(
            "No rule has enough evidence to propose a change.",
            "",
            `A rule needs at least ${MIN_OBSERVATIONS} findings, to avoid tuning to noise.`,
        );
    } else {
        lines.push("## Proposed changes", "");
        for (const proposal of proposals) {
            lines.push(
                `### ${proposal.summary}`,
                "",
                proposal.rationale,
                "",
                `Evidence: ${proposal.pullRequests.map((number) => `#${number}`).join(", ")}`,
                "",
            );
        }
    }
    lines.push(
        "## Every rule that fired",
        "",
        "| Rule | Fired | Refuted | Intentional | Fixed | Upheld | Escalated | No verdict |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    );
    for (const record of records) {
        lines.push(
            `| \`${record.ruleId}\` | ${record.fired} | ${record.refuted} | ${record.intentional} | ${record.codeChanged} | ${record.stands} | ${record.needsHuman} | ${record.unadjudicated} |`,
        );
    }
    return lines.join("\n");
}

/**
 * Opens a pull request carrying the proposals for review.
 *
 * @param cwd - Repository root.
 * @param report - Rendered report for the pull request body.
 * @param branch - Branch name to create.
 * @returns The pull request URL.
 */
export async function openProposalPullRequest(
    cwd: string,
    report: string,
    branch: string,
): Promise<string> {
    const scratch = await mkdtemp(join(tmpdir(), "rostrum-retro-"));
    const bodyPath = join(scratch, "body.md");
    await Bun.write(bodyPath, report);
    await runProcessOrThrow(["git", "checkout", "-b", branch], { cwd });
    await runProcessOrThrow(["git", "add", "-A"], { cwd });
    await runProcessOrThrow(
        [
            "git",
            "-c",
            "user.name=github-actions[bot]",
            "-c",
            "user.email=41898282+github-actions[bot]@users.noreply.github.com",
            "commit",
            "-m",
            "Reviewer retrospective: propose rule changes",
        ],
        { cwd },
    );
    await runProcessOrThrow(["git", "push", "-u", "origin", branch], { cwd });
    return runProcessOrThrow(
        [
            "gh",
            "pr",
            "create",
            "--title",
            "Reviewer retrospective: proposed rule changes",
            "--body-file",
            bodyPath,
            "--base",
            "main",
            "--head",
            branch,
        ],
        { cwd },
    );
}

/**
 * Runs the retrospective over a window.
 *
 * @param options - Window start, whether to open a pull request, and the branch to use.
 * @param cwd - Repository root.
 * @returns The report and, when requested, the pull request URL.
 */
export async function runRetrospective(
    options: { since: string; openPullRequest: boolean; branch: string; window: string },
    cwd: string,
): Promise<{ report: string; pullRequest: string }> {
    const { owner, repo } = await resolveRepository(cwd);
    const outcomes = await harvestOutcomes(owner, repo, options.since);
    const records = aggregateByRule(outcomes);
    const severityByRule = await readRuleSeverities(`${cwd}/.github/skills/code-review`);
    const proposals = proposeRuleChanges(records, severityByRule);
    const report = renderReport(records, proposals, options.window);
    if (!options.openPullRequest || proposals.length === 0) {
        return { report, pullRequest: "" };
    }
    const pullRequest = await openProposalPullRequest(cwd, report, options.branch);
    return { report, pullRequest };
}
