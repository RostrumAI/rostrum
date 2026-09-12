/**
 * GitHub access for the review pipeline.
 *
 * @remarks
 * Reads and writes go through the `gh` CLI so the pipeline inherits whatever
 * credential the environment already has, in CI or on a workstation, instead of
 * requiring a separate token. Nothing in this module executes code from the
 * pull request: patches and comments are data throughout.
 */

import { runProcess, runProcessOrThrow } from "./process.ts";
import type { PullRequestRef } from "./types.ts";

/** Hidden marker identifying a review comment posted by this pipeline. */
export const COMMENT_MARKER = "<!-- rostrum-code-review -->";

/** Hidden marker identifying the summary comment the pipeline maintains. */
export const SUMMARY_MARKER = "<!-- rostrum-code-review-summary -->";

/** One review thread on a pull request, with the comments it holds. */
export interface ReviewThread {
    /** GraphQL node id, which identifies the thread in the GraphQL API. */
    id: string;
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
    /** REST database id, needed to reply within the thread. */
    id: number;
    /** Comment author login. */
    author: string;
    /** Comment author's relationship to the repository, such as `OWNER` or `CONTRIBUTOR`. */
    authorAssociation: string;
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
 * Reads the pull request's cumulative diff.
 *
 * `--patch` must not be passed: it requests GitHub's patch media type, which is
 * one mailbox-formatted patch per commit rather than one diff for the pull
 * request. Those hunks are numbered against each commit's own parent, and a file
 * touched by several commits appears several times, so findings resolve to the
 * wrong lines — or to lines the head commit's diff does not contain, which makes
 * GitHub reject the entire review. The default output is the diff against the
 * merge base, which is the only numbering a comment can be anchored to.
 *
 * @param ref - Pull request identity.
 * @returns Unified diff text for the pull request as a whole.
 */
export async function fetchPatch(ref: PullRequestRef): Promise<string> {
    return runProcessOrThrow([
        "gh",
        "pr",
        "diff",
        String(ref.number),
        "--repo",
        `${ref.owner}/${ref.repo}`,
    ]);
}

/** GraphQL document fetching review threads with their resolution state. */
const REVIEW_THREADS_QUERY = `query ($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          comments(first: 50) {
            nodes { databaseId author { login } authorAssociation body line }
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
                                id: string;
                                isResolved: boolean;
                                isOutdated: boolean;
                                path: string;
                                line: number | null;
                                comments: {
                                    nodes: Array<{
                                        databaseId: number | null;
                                        author: { login: string } | null;
                                        authorAssociation: string;
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
                id: node.id,
                isResolved: node.isResolved,
                isOutdated: node.isOutdated,
                path: node.path,
                line: node.line,
                comments: node.comments.nodes.map((comment) => ({
                    id: comment.databaseId ?? 0,
                    author: comment.author?.login ?? "ghost",
                    authorAssociation: comment.authorAssociation,
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

/**
 * Replies inside an existing review thread.
 *
 * @param ref - Pull request identity.
 * @param commentId - Database id of the comment being replied to.
 * @param body - Reply body, including any marker.
 * @returns The created comment's URL.
 */
export async function replyToReviewComment(
    ref: PullRequestRef,
    commentId: number,
    body: string,
): Promise<string> {
    const output = await runProcessOrThrow(
        [
            "gh",
            "api",
            "--method",
            "POST",
            `repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/comments/${commentId}/replies`,
            "--input",
            "-",
        ],
        { stdin: JSON.stringify({ body }) },
    );
    const parsed = JSON.parse(output) as { html_url?: string };
    return parsed.html_url ?? "";
}

/** Repository permissions that let someone disposition a finding. */
const WRITE_PERMISSIONS: readonly string[] = ["admin", "write", "maintain"];

/** Permission lookups made during this process, keyed by login. */
const writeAccessCache = new Map<string, boolean>();

/**
 * Reports whether a user may disposition a finding on this repository.
 *
 * `authorAssociation` is not usable for this. The same comment reported
 * `CONTRIBUTOR` to the workflow's token and `MEMBER` to the author's own, so a
 * guard keyed on it rejects the repository owner in CI and admits nobody. The
 * permission endpoint is the authority: it answers what the person can actually
 * do, not how the comment was labelled.
 *
 * A lookup that fails is treated as no access, so a permission error can never
 * be the reason a finding is withdrawn.
 *
 * @param ref - Repository identity.
 * @param login - User to check.
 * @returns True when the user has admin, maintain, or write permission.
 */
export async function hasWriteAccess(
    ref: Pick<PullRequestRef, "owner" | "repo">,
    login: string,
): Promise<boolean> {
    const cached = writeAccessCache.get(login);
    if (cached !== undefined) {
        return cached;
    }
    const result = await runProcess([
        "gh",
        "api",
        `repos/${ref.owner}/${ref.repo}/collaborators/${login}/permission`,
        "--jq",
        ".permission",
    ]);
    const permitted = result.exitCode === 0 && WRITE_PERMISSIONS.includes(result.stdout.trim());
    writeAccessCache.set(login, permitted);
    return permitted;
}

/** One comment in a submitted review, as GitHub returns it. */
export interface ReviewCommentRecord {
    /** REST database id, used to reply in the comment's thread. */
    id: number;
    /** Comment body. */
    body: string;
    /** Author login. */
    author: string;
    /** Author's relationship to the repository. */
    authorAssociation: string;
}

/**
 * Lists the comments a submitted review carries.
 *
 * A review is how a reply actually reaches this repository: commenting on an
 * existing inline thread submits a review containing that comment, so the review
 * submission is the event the adjudicator listens for, and this is where its
 * comments are read from.
 *
 * @param ref - Pull request identity.
 * @param reviewId - Database id of the review.
 * @returns Comments in the review, in the order GitHub returns them.
 */
export async function fetchReviewComments(
    ref: PullRequestRef,
    reviewId: number,
): Promise<ReviewCommentRecord[]> {
    const output = await runProcessOrThrow([
        "gh",
        "api",
        "--paginate",
        `repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/reviews/${reviewId}/comments`,
    ]);
    const parsed = JSON.parse(output) as Array<{
        id: number;
        body: string;
        user: { login: string } | null;
        author_association: string;
    }>;
    return parsed.map((comment) => ({
        id: comment.id,
        body: comment.body ?? "",
        author: comment.user?.login ?? "ghost",
        authorAssociation: comment.author_association,
    }));
}

/**
 * Lists pull requests that were updated at or after a moment.
 *
 * The retrospective walks pull requests rather than threads because it needs the
 * conversation and the merge outcome together, and a pull request is where those
 * meet.
 *
 * @param owner - Repository owner.
 * @param repo - Repository name.
 * @param since - ISO 8601 timestamp; pull requests updated before it are skipped.
 * @returns Pull request numbers, newest first.
 */
export async function listPullRequestsUpdatedSince(
    owner: string,
    repo: string,
    since: string,
): Promise<number[]> {
    const output = await runProcessOrThrow([
        "gh",
        "pr",
        "list",
        "--repo",
        `${owner}/${repo}`,
        "--state",
        "all",
        "--search",
        `updated:>=${since}`,
        "--limit",
        "200",
        "--json",
        "number",
    ]);
    const parsed = JSON.parse(output) as Array<{ number: number }>;
    return parsed.map((entry) => entry.number);
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
