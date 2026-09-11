/**
 * GitHub access for the review pipeline.
 *
 * @remarks
 * Reads and writes go through the `gh` CLI so the pipeline inherits whatever
 * credential the environment already has, in CI or on a workstation, instead of
 * requiring a separate token. Nothing in this module executes code from the
 * pull request: patches and comments are data throughout.
 */

import { runProcessOrThrow } from "./process.ts";
import type { PullRequestRef } from "./types.ts";

/** Hidden marker identifying a review comment posted by this pipeline. */
export const COMMENT_MARKER = "<!-- rostrum-code-review -->";

/** Hidden marker identifying the summary comment the pipeline maintains. */
export const SUMMARY_MARKER = "<!-- rostrum-code-review-summary -->";

/** One review thread on a pull request, with the comments it holds. */
export interface ReviewThread {
    /** True when a maintainer or the pipeline resolved the thread. */
    isResolved: boolean;
    /** True when the anchored line no longer exists in the current diff. */
    isOutdated: boolean;
    /** Repository-relative path the thread is anchored to. */
    path: string;
    /** Line at the head commit, or null when the thread is outdated. */
    line: number | null;
    /** Comments in thread order, oldest first. */
    comments: ReviewComment[];
}

/** One comment inside a review thread. */
export interface ReviewComment {
    /** Comment author login. */
    author: string;
    /** Comment body, including any hidden marker. */
    body: string;
    /** Line the comment was anchored to, or null for a reply carried forward. */
    line: number | null;
}

/** Metadata for the pull request under review. */
export interface PullRequestMetadata {
    /** Commit the review is anchored to. */
    headSha: string;
    /** Pull request title. */
    title: string;
    /** Pull request body; empty when the author supplied none. */
    body: string;
    /** Author login. */
    author: string;
    /** Base branch name. */
    baseRefName: string;
    /** True while the pull request is a draft. */
    isDraft: boolean;
    /** Pull request state, such as `OPEN` or `MERGED`. */
    state: string;
}

/**
 * Resolves the repository the pipeline is running inside.
 *
 * @param cwd - Directory to resolve from; defaults to the process directory.
 * @returns Owner and repository name.
 */
export async function resolveRepository(cwd?: string): Promise<{ owner: string; repo: string }> {
    const output = await runProcessOrThrow(
        ["gh", "repo", "view", "--json", "owner,name", "--jq", '.owner.login + "/" + .name'],
        { cwd },
    );
    const [owner, repo] = output.trim().split("/");
    if (owner === undefined || repo === undefined) {
        throw new Error(`Unable to resolve repository from gh output: ${output}`);
    }
    return { owner, repo };
}

/**
 * Reads the metadata a reviewer needs about the pull request.
 *
 * @param ref - Pull request identity.
 * @returns Metadata including the head commit the review will be anchored to.
 */
export async function fetchPullRequest(ref: PullRequestRef): Promise<PullRequestMetadata> {
    const output = await runProcessOrThrow([
        "gh",
        "pr",
        "view",
        String(ref.number),
        "--repo",
        `${ref.owner}/${ref.repo}`,
        "--json",
        "headRefOid,title,body,author,baseRefName,isDraft,state",
    ]);
    const parsed = JSON.parse(output) as {
        headRefOid: string;
        title: string;
        body: string;
        author: { login: string };
        baseRefName: string;
        isDraft: boolean;
        state: string;
    };
    return {
        headSha: parsed.headRefOid,
        title: parsed.title,
        body: parsed.body ?? "",
        author: parsed.author.login,
        baseRefName: parsed.baseRefName,
        isDraft: parsed.isDraft,
        state: parsed.state,
    };
}

/**
 * Reads the pull request patch.
 *
 * @param ref - Pull request identity.
 * @returns Unified diff text.
 */
export async function fetchPatch(ref: PullRequestRef): Promise<string> {
    return runProcessOrThrow([
        "gh",
        "pr",
        "diff",
        String(ref.number),
        "--repo",
        `${ref.owner}/${ref.repo}`,
        "--patch",
    ]);
}

/** GraphQL document fetching review threads with their resolution state. */
const REVIEW_THREADS_QUERY = `query ($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          isResolved
          isOutdated
          path
          line
          comments(first: 50) {
            nodes { author { login } body line }
          }
        }
      }
    }
  }
}`;

/**
 * Reads every review thread on the pull request, following pagination.
 *
 * Resolution state is what lets a rescan leave an answered finding alone, so
 * this reads the server's state rather than inferring it from comment text.
 *
 * @param ref - Pull request identity.
 * @returns All review threads, in server order.
 */
export async function fetchReviewThreads(ref: PullRequestRef): Promise<ReviewThread[]> {
    const threads: ReviewThread[] = [];
    let cursor: string | null = null;
    for (;;) {
        const args = [
            "gh",
            "api",
            "graphql",
            "-f",
            `query=${REVIEW_THREADS_QUERY}`,
            "-F",
            `owner=${ref.owner}`,
            "-F",
            `repo=${ref.repo}`,
            "-F",
            `number=${ref.number}`,
        ];
        if (cursor !== null) {
            args.push("-F", `cursor=${cursor}`);
        }
        const parsed = JSON.parse(await runProcessOrThrow(args)) as {
            data: {
                repository: {
                    pullRequest: {
                        reviewThreads: {
                            pageInfo: { hasNextPage: boolean; endCursor: string | null };
                            nodes: Array<{
                                isResolved: boolean;
                                isOutdated: boolean;
                                path: string;
                                line: number | null;
                                comments: {
                                    nodes: Array<{
                                        author: { login: string } | null;
                                        body: string;
                                        line: number | null;
                                    }>;
                                };
                            }>;
                        };
                    };
                };
            };
        };
        const page = parsed.data.repository.pullRequest.reviewThreads;
        for (const node of page.nodes) {
            threads.push({
                isResolved: node.isResolved,
                isOutdated: node.isOutdated,
                path: node.path,
                line: node.line,
                comments: node.comments.nodes.map((comment) => ({
                    author: comment.author?.login ?? "ghost",
                    body: comment.body,
                    line: comment.line,
                })),
            });
        }
        if (!page.pageInfo.hasNextPage || page.pageInfo.endCursor === null) {
            return threads;
        }
        cursor = page.pageInfo.endCursor;
    }
}

/** One inline comment to attach to a review. */
export interface DraftComment {
    /** Repository-relative path of the commented file. */
    path: string;
    /** Line to anchor the comment to, from the diff's new side. */
    line: number;
    /** Comment body, including the marker. */
    body: string;
}

/**
 * Posts a review carrying inline comments, without approving or requesting changes.
 *
 * Posting as a single review is what keeps the pull request timeline readable:
 * one notification and one review object per run rather than one per finding.
 *
 * @param ref - Pull request identity.
 * @param commitId - Commit the comments are anchored to.
 * @param body - Summary text for the review.
 * @param comments - Inline comments to attach.
 * @returns The created review URL.
 */
export async function postReview(
    ref: PullRequestRef,
    commitId: string,
    body: string,
    comments: DraftComment[],
): Promise<string> {
    const payload = JSON.stringify({
        commit_id: commitId,
        event: "COMMENT",
        body,
        comments: comments.map((comment) => ({
            path: comment.path,
            line: comment.line,
            side: "RIGHT",
            body: comment.body,
        })),
    });
    const output = await runProcessOrThrow(
        [
            "gh",
            "api",
            "--method",
            "POST",
            `repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/reviews`,
            "--input",
            "-",
        ],
        { stdin: payload },
    );
    const parsed = JSON.parse(output) as { html_url?: string };
    return parsed.html_url ?? "";
}

/**
 * Creates or replaces the pipeline's summary comment on the pull request.
 *
 * @param ref - Pull request identity.
 * @param body - Summary body, including the summary marker.
 */
export async function upsertSummary(ref: PullRequestRef, body: string): Promise<void> {
    const listing = await runProcessOrThrow([
        "gh",
        "api",
        "--paginate",
        `repos/${ref.owner}/${ref.repo}/issues/${ref.number}/comments?per_page=100`,
        "--jq",
        `.[] | select(.body | contains("${SUMMARY_MARKER}")) | .id`,
    ]);
    const existing = listing
        .trim()
        .split("\n")
        .filter((line) => line.length > 0);
    const payload = JSON.stringify({ body });
    if (existing.length === 0) {
        await runProcessOrThrow(
            [
                "gh",
                "api",
                "--method",
                "POST",
                `repos/${ref.owner}/${ref.repo}/issues/${ref.number}/comments`,
                "--input",
                "-",
            ],
            { stdin: payload },
        );
        return;
    }
    for (const id of existing.slice(1)) {
        await runProcessOrThrow([
            "gh",
            "api",
            "--method",
            "DELETE",
            `repos/${ref.owner}/${ref.repo}/issues/comments/${id}`,
        ]);
    }
    await runProcessOrThrow(
        [
            "gh",
            "api",
            "--method",
            "PATCH",
            `repos/${ref.owner}/${ref.repo}/issues/comments/${existing[0]}`,
            "--input",
            "-",
        ],
        { stdin: payload },
    );
}
