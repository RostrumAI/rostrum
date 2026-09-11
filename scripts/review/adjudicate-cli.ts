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

import { adjudicateReply } from "./adjudicate.ts";

/** Entry point. Exits non-zero only when the run itself failed. */
async function main(): Promise<number> {
    const { values } = parseArgs({
        args: Bun.argv.slice(2),
        options: {
            "comment-id": { type: "string" },
            "pull-request": { type: "string" },
            association: { type: "string" },
            author: { type: "string" },
            "body-file": { type: "string" },
            "repo-root": { type: "string" },
        },
        allowPositionals: false,
    });

    const commentId = Number(values["comment-id"] ?? "");
    const pullRequest = Number(values["pull-request"] ?? "");
    if (!Number.isInteger(commentId) || !Number.isInteger(pullRequest)) {
        throw new Error("--comment-id and --pull-request must both be integers.");
    }
    const bodyPath = values["body-file"];
    if (bodyPath === undefined) {
        throw new Error("--body-file is required; pass the comment body through a file.");
    }

    const cwd = join(import.meta.dir, "..", "..");
    const outcome = await adjudicateReply(
        {
            commentId,
            commentBody: await Bun.file(bodyPath).text(),
            commentAssociation: values.association ?? "NONE",
            commentAuthor: values.author ?? "someone",
            pullRequest,
            reviewRoot: values["repo-root"] ?? cwd,
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
