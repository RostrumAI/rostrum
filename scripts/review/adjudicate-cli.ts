/**
 * Entry point for answering a reply to one of the reviewer's findings.
 *
 * @remarks
 * Invoked by the workflow when someone comments on a review thread. The inputs
 * come from the event payload rather than from the API, so the association the
 * commenter held at the time is the one that gates the decision.
 *
 * Usage:
 *   bun run review:adjudicate --comment-id 123 --pull-request 22 --association MEMBER \
 *     --author someone --body-file /tmp/comment.md
 */

import { join } from "node:path";
import { parseArgs } from "node:util";

import { adjudicateReply, adjudicateReview, adjudicateUnansweredThreads } from "./adjudicate.ts";

/** Entry point. Exits non-zero only when the run itself failed. */
async function main(): Promise<number> {
    const { values } = parseArgs({
        args: Bun.argv.slice(2),
        options: {
            "comment-id": { type: "string" },
            "review-id": { type: "string" },
            sweep: { type: "boolean", default: false },
            "pull-request": { type: "string" },
            association: { type: "string" },
            author: { type: "string" },
            "body-file": { type: "string" },
            "repo-root": { type: "string" },
        },
        allowPositionals: false,
    });

    const pullRequest = Number(values["pull-request"] ?? "");
    if (!Number.isInteger(pullRequest)) {
        throw new Error("--pull-request must be an integer.");
    }
    const cwd = join(import.meta.dir, "..", "..");
    const reviewRoot = values["repo-root"] ?? cwd;

    if (values.sweep === true) {
        const outcomes = await adjudicateUnansweredThreads({ pullRequest, reviewRoot }, cwd);
        for (const outcome of outcomes) {
            console.log(`${outcome.action}: ${outcome.detail}`);
        }
        return 0;
    }

    // A submitted review is how a reply normally arrives, so that path is the
    // default. `--comment-id` remains for adjudicating a single comment by hand.
    const reviewId = Number(values["review-id"] ?? "");
    if (Number.isInteger(reviewId) && reviewId > 0) {
        const outcomes = await adjudicateReview({ reviewId, pullRequest, reviewRoot }, cwd);
        for (const outcome of outcomes) {
            console.log(`${outcome.action}: ${outcome.detail}`);
        }
        return 0;
    }

    const commentId = Number(values["comment-id"] ?? "");
    if (!Number.isInteger(commentId)) {
        throw new Error("Pass --review-id (a submitted review) or --comment-id.");
    }
    const bodyPath = values["body-file"];
    if (bodyPath === undefined) {
        throw new Error("--body-file is required with --comment-id.");
    }
    const outcome = await adjudicateReply(
        {
            commentId,
            commentBody: await Bun.file(bodyPath).text(),
            commentAssociation: values.association ?? "NONE",
            commentAuthor: values.author ?? "someone",
            pullRequest,
            reviewRoot,
        },
        cwd,
    );
    console.log(`${outcome.action}: ${outcome.detail}`);
    return 0;
}

/**
 * Runs the adjudicator and converts an unexpected failure into an exit code.
 *
 * @returns Process exit code.
 */
async function run(): Promise<number> {
    try {
        return await main();
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        return 1;
    }
}

const exitCode = await run();
if (exitCode !== 0) {
    process.exit(exitCode);
}
