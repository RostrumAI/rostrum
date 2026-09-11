/**
 * Thread adjudication: answering a reply to one of the reviewer's own findings.
 *
 * @remarks
 * The reviewer argues and a human answers, and the answer has to be decided on
 * the code rather than on who said it. This runs once per reply: read the thread,
 * re-read the file at the head commit, and either withdraw the finding or stand
 * behind it. The verdict is recorded in the reviewer's own reply so the
 * conversation, and not a database, remains the state of the pipeline.
 *
 * Nothing here trusts the reply as an instruction. A reply can influence the
 * disposition of its own thread and nothing else: it can never edit the rule
 * corpus, and it cannot cause a withdrawal by asserting authority.
 */

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { numericOption } from "./config.ts";
import {
    COMMENT_MARKER,
    fetchPullRequest,
    fetchReviewComments,
    fetchReviewThreads,
    type ReviewThread,
    replyToReviewComment,
    resolveRepository,
    setReviewThreadResolved,
} from "./github.ts";
import {
    agentTimeoutSeconds,
    DEFAULT_MODEL,
    extractJsonObject,
    resolveOmpInvocation,
    runAgent,
} from "./reviewer.ts";
import type { PullRequestRef } from "./types.ts";
import { parseVerdict, renderVerdictMarker, type Verdict } from "./verdicts.ts";

/** Repository associations allowed to disposition a finding. */
const MAINTAINER_ASSOCIATIONS: readonly string[] = ["OWNER", "MEMBER", "COLLABORATOR"];

/**
 * Default reviewer replies allowed in one thread before it is left to a human.
 *
 * This is a backstop, not a mechanism. The loop is human-driven — the reviewer's
 * own replies are filtered out by the workflow, so it cannot answer itself — and
 * what a person will tolerate already bounds the exchange. What this bounds is
 * cost per thread and, more importantly, how long the reviewer keeps re-arguing a
 * disagreement it cannot settle. Past the second or third exchange it is
 * restating itself, and a reviewer that will not stop is one a team learns to
 * ignore. Override with `REVIEW_MAX_ADJUDICATIONS`.
 */
const DEFAULT_MAX_ADJUDICATIONS = 3;

/** Environment variable overriding the per-thread reply budget. */
export const MAX_ADJUDICATIONS_ENV = "REVIEW_MAX_ADJUDICATIONS";

/** Verdicts that are recorded but do not withdraw the finding. */
const NON_WITHDRAWING: readonly Verdict[] = ["stands", "needs_human"];

/** What happened to a reply, for the caller's log. */
export interface AdjudicationOutcome {
    /** What the pipeline did, or why it did nothing. */
    action: "withdrawn" | "stood" | "needs_human" | "ignored" | "skipped";
    /** Human-readable explanation for the run log. */
    detail: string;
}

/**
 * Adjudicates the thread containing a newly created review comment.
 *
 * @param options - Comment id, thread id, comment body, and the actor's association.
 * @param cwd - Repository root the tooling runs from.
 * @returns What the pipeline did.
 */
export async function adjudicateReply(
    options: {
        commentId: number;
        commentBody: string;
        commentAssociation: string;
        commentAuthor: string;
        pullRequest: number;
        reviewRoot: string;
    },
    cwd: string,
): Promise<AdjudicationOutcome> {
    if (options.commentBody.includes(COMMENT_MARKER)) {
        // The reviewer's own comment: replying to it would loop.
        return { action: "skipped", detail: "comment was written by the reviewer" };
    }
    if (!MAINTAINER_ASSOCIATIONS.includes(options.commentAssociation)) {
        return {
            action: "ignored",
            detail: `author association ${options.commentAssociation} cannot disposition a finding`,
        };
    }

    const { owner, repo } = await resolveRepository(cwd);
    const ref: PullRequestRef = { owner, repo, number: options.pullRequest };
    const threads = await fetchReviewThreads(ref);
    const thread = findThreadWithComment(threads, options.commentId);
    if (thread === null) {
        return { action: "ignored", detail: "comment is not on a thread the reviewer opened" };
    }
    if (thread.isResolved) {
        return { action: "ignored", detail: "thread is already resolved" };
    }
    const maxAdjudications = numericOption(
        process.env[MAX_ADJUDICATIONS_ENV],
        DEFAULT_MAX_ADJUDICATIONS,
        "max adjudications per thread",
        { min: 1, max: 20 },
    );
    const previousReplies = countReviewerReplies(thread);
    if (previousReplies > maxAdjudications) {
        // The closure was already posted; a later reply gets no further response.
        return {
            action: "needs_human",
            detail: "thread is past its reply budget and has been closed out",
        };
    }

    const findingComment = thread.comments.find((comment) => comment.body.includes(COMMENT_MARKER));
    if (findingComment === undefined) {
        return { action: "ignored", detail: "thread carries no reviewer finding" };
    }

    const metadata = await fetchPullRequest(ref);
    const scratch = await mkdtemp(join(tmpdir(), "rostrum-adjudicate-"));
    const invocation = await resolveOmpInvocation(
        reviewRootOrCwd(options, cwd),
        process.env.REVIEW_MODEL ?? DEFAULT_MODEL,
        "high",
        scratch,
        "adjudicator",
        await Bun.file(`${cwd}/.github/skills/code-review/adjudicator.md`).text(),
        buildAdjudicationPrompt(
            thread,
            findingComment.body,
            options,
            metadata.headSha,
            reviewRootOrCwd(options, cwd),
        ),
        agentTimeoutSeconds(),
    );
    if (invocation.command === null) {
        return { action: "skipped", detail: invocation.reason };
    }

    const result = await runAgent(invocation.command, agentTimeoutSeconds());
    if (result.exitCode !== 0) {
        return { action: "skipped", detail: `adjudicator failed: ${result.stderr.slice(-300)}` };
    }

    if (previousReplies === maxAdjudications) {
        // First reply past the budget: say so, and leave the decision to a person.
        // Without this the reviewer simply stops answering, which reads as having
        // ignored the last reply rather than as having handed it over.
        await replyToReviewComment(
            ref,
            findingComment.id,
            renderBudgetExhaustedReply(maxAdjudications),
        );
        return {
            action: "needs_human",
            detail: `reached ${maxAdjudications} reviewer replies; handed to a person`,
        };
    }

    const payload = extractJsonObject(result.stdout);
    const verdict = readVerdict(payload);
    if (verdict === null) {
        return { action: "skipped", detail: `no usable verdict in: ${result.stdout.slice(-300)}` };
    }
    const reason = readReason(payload);

    await replyToReviewComment(ref, findingComment.id, renderAdjudicationReply(verdict, reason));
    if (NON_WITHDRAWING.includes(verdict)) {
        return {
            action: verdict === "needs_human" ? "needs_human" : "stood",
            detail: reason,
        };
    }
    await setReviewThreadResolved(thread.id, true);
    return { action: "withdrawn", detail: `${verdict}: ${reason}` };
}

/**
 * Adjudicates every comment in a submitted review.
 *
 * A review can carry more than one comment when replies are batched, and each
 * one gets its own decision. Comments the reviewer wrote are skipped, as are
 * reviews that carry no comment at all, which is what an approval looks like.
 *
 * @param options - Review id, pull request number, and the checkout to read.
 * @param cwd - Repository root the tooling runs from.
 * @returns One outcome per comment considered.
 */
export async function adjudicateReview(
    options: { reviewId: number; pullRequest: number; reviewRoot: string },
    cwd: string,
): Promise<AdjudicationOutcome[]> {
    const { owner, repo } = await resolveRepository(cwd);
    const ref: PullRequestRef = { owner, repo, number: options.pullRequest };
    const comments = await fetchReviewComments(ref, options.reviewId);
    const candidates = comments.filter(
        (comment) =>
            !comment.body.includes(COMMENT_MARKER) &&
            MAINTAINER_ASSOCIATIONS.includes(comment.authorAssociation),
    );
    if (candidates.length === 0) {
        return [{ action: "ignored", detail: "review carries no comment worth adjudicating" }];
    }
    const outcomes: AdjudicationOutcome[] = [];
    for (const comment of candidates) {
        outcomes.push(
            await adjudicateReply(
                {
                    commentId: comment.id,
                    commentBody: comment.body,
                    commentAssociation: comment.authorAssociation,
                    commentAuthor: comment.author,
                    pullRequest: options.pullRequest,
                    reviewRoot: options.reviewRoot,
                },
                cwd,
            ),
        );
    }
    return outcomes;
}

/**
 * Finds the thread a comment belongs to.
 *
 * @param threads - Threads read from the pull request.
 * @param commentId - Database id of the reply.
 * @returns The containing thread, or null.
 */
function findThreadWithComment(threads: ReviewThread[], commentId: number): ReviewThread | null {
    return (
        threads.find((thread) => thread.comments.some((comment) => comment.id === commentId)) ??
        null
    );
}

/**
 * Counts how many times the reviewer has already answered in a thread.
 *
 * @param thread - Thread to count.
 * @returns Number of reviewer replies after the original finding.
 */
export function countReviewerReplies(thread: ReviewThread): number {
    const findingIndex = thread.comments.findIndex((comment) =>
        comment.body.includes(COMMENT_MARKER),
    );
    if (findingIndex === -1) {
        return 0;
    }
    return thread.comments
        .slice(findingIndex + 1)
        .filter((comment) => parseVerdict(comment.body) !== null).length;
}

/**
 * Reads the verdict from the adjudicator's payload.
 *
 * @param payload - Parsed JSON, or null when the reply was unparseable.
 * @returns The verdict, or null when none was produced.
 */
function readVerdict(payload: unknown): Verdict | null {
    if (typeof payload !== "object" || payload === null || !("verdict" in payload)) {
        return null;
    }
    const verdict: unknown = payload.verdict;
    if (typeof verdict !== "string") {
        return null;
    }
    const known: readonly Verdict[] = [
        "refuted",
        "intentional",
        "code_changed",
        "stands",
        "needs_human",
    ];
    return known.find((candidate) => candidate === verdict) ?? null;
}

/**
 * Reads the adjudicator's explanation.
 *
 * @param payload - Parsed JSON, or null.
 * @returns The explanation, or a fallback that says none was given.
 */
function readReason(payload: unknown): string {
    if (typeof payload === "object" && payload !== null && "reason" in payload) {
        const reason: unknown = payload.reason;
        if (typeof reason === "string" && reason.trim().length > 0) {
            return reason.trim();
        }
    }
    return "No explanation was produced.";
}

/**
 * Renders the reply that ends the reviewer's side of a thread.
 *
 * It records a `needs_human` verdict, so the thread is left open and the finding
 * stays visible: handing a disagreement to a person is not the same as
 * withdrawing it.
 *
 * @param budget - Number of replies the reviewer was allowed.
 * @returns Comment body including the verdict marker.
 */
export function renderBudgetExhaustedReply(budget: number): string {
    return [
        renderVerdictMarker("needs_human"),
        `I have answered ${budget} times on this finding and have nothing further to add without repeating myself. Leaving this to a person to decide.`,
    ].join("\n\n");
}

/**
 * Renders the reviewer's reply to a disposition attempt.
 *
 * @param verdict - Verdict reached.
 * @param reason - Explanation to carry.
 * @returns Comment body including the verdict marker.
 */
function renderAdjudicationReply(verdict: Verdict, reason: string): string {
    return [renderVerdictMarker(verdict), reason].join("\n\n");
}

/**
 * Resolves the checkout the adjudicator reads.
 *
 * @param options - Adjudication inputs.
 * @param cwd - Repository root the tooling runs from.
 * @returns The pull request head checkout.
 */
function reviewRootOrCwd(options: { reviewRoot: string }, cwd: string): string {
    return options.reviewRoot === "" ? cwd : options.reviewRoot;
}

/**
 * Builds the adjudicator's user prompt.
 *
 * @param thread - Thread being adjudicated.
 * @param findingBody - The reviewer's original comment.
 * @param options - Adjudication inputs.
 * @param headSha - Commit under discussion.
 * @param reviewRoot - Checkout the adjudicator reads.
 * @returns Prompt text.
 */
function buildAdjudicationPrompt(
    thread: ReviewThread,
    findingBody: string,
    options: { commentAuthor: string },
    headSha: string,
    reviewRoot: string,
): string {
    const conversation = thread.comments
        .slice(1)
        .map((comment) => `### ${comment.author} (${comment.authorAssociation})\n${comment.body}`)
        .join("\n\n");
    return [
        `Decide whether your finding still holds, at commit ${headSha}.`,
        "",
        `The repository is checked out at ${reviewRoot}. Read the file before deciding.`,
        "",
        `## Your finding on ${thread.path}:${thread.line ?? "?"}`,
        findingBody,
        "",
        "## What was said afterwards",
        conversation.trim().length === 0 ? "(nothing)" : conversation,
        "",
        `${options.commentAuthor} is the person who replied.`,
        "",
        "Answer with the single JSON object described in your instructions.",
    ].join("\n");
}
