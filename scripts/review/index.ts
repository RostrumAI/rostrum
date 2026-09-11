/**
 * Automated pull request review.
 *
 * @remarks
 * The pipeline reads a pull request, runs a deterministic rule pass, fans the
 * change out to independent reviewer lenses, merges what survives verification,
 * and posts the remainder as inline comments with one summary comment. A rescan
 * re-runs the same pipeline against the current head commit and stays silent
 * about findings that are already resolved.
 *
 * Usage:
 *   bun run review --pr 20                  report only
 *   bun run review --pr 20 --post           post inline comments
 *   bun run review --since origin/main      review a local branch diff
 */

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { findFile, parseUnifiedDiff, snapToDiff } from "./diff.ts";
import {
    fetchPatch,
    fetchPullRequest,
    fetchReviewThreads,
    postReview,
    type ReviewThread,
    resolveRepository,
    upsertSummary,
} from "./github.ts";
import { selectLenses } from "./lenses.ts";
import {
    applyConfidenceFloor,
    deduplicate,
    partitionThreads,
    sortFindings,
    suppressAnswered,
} from "./merge.ts";
import { runProcessOrThrow } from "./process.ts";
import { renderComments, renderSummary } from "./report.ts";
import {
    DEFAULT_LENS_TIMEOUT_SECONDS,
    DEFAULT_MODEL,
    runLens,
    runWithConcurrency,
} from "./reviewer.ts";
import {
    findUncoveredSourceFiles,
    findUnjustifiedDependencyChange,
    runRuleChecks,
} from "./rules.ts";
import type { Finding, PullRequestRef, ReviewContext } from "./types.ts";

/** Default number of findings required for a model finding to be posted. */
const DEFAULT_CONFIDENCE_FLOOR = 80;

/** Default number of lens reviewers to run at once. */
const DEFAULT_CONCURRENCY = 3;

/** Marker an author or maintainer can put in the title or body to skip review. */
const SKIP_MARKER = "[skip review]";

/** Entry point. Exits non-zero when the review could not run. */
async function main(): Promise<number> {
    const { values } = parseArgs({
        args: Bun.argv.slice(2),
        options: {
            pr: { type: "string" },
            since: { type: "string" },
            post: { type: "boolean", default: false },
            json: { type: "boolean", default: false },
            lenses: { type: "string" },
            model: { type: "string" },
            confidence: { type: "string" },
            concurrency: { type: "string" },
            "dry-run-rules": { type: "boolean", default: false },
        },
        allowPositionals: false,
    });

    const repositoryRoot = join(import.meta.dir, "..", "..");
    const skillDirectory = join(repositoryRoot, ".github", "skills", "code-review");
    const model = values.model ?? process.env.REVIEW_MODEL ?? DEFAULT_MODEL;
    const confidenceFloor = Number(
        values.confidence ?? process.env.REVIEW_CONFIDENCE_FLOOR ?? DEFAULT_CONFIDENCE_FLOOR,
    );
    const concurrency = Number(values.concurrency ?? DEFAULT_CONCURRENCY);
    const requestedLenses = (values.lenses ?? "")
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);

    const scratch = await mkdtemp(join(tmpdir(), "rostrum-review-"));
    const local = values.since !== undefined;
    const ref = local ? null : await resolveRef(values.pr, repositoryRoot);
    const metadata = ref === null ? null : await fetchPullRequest(ref);
    const patch =
        ref === null
            ? await runProcessOrThrow([
                  "git",
                  "-C",
                  repositoryRoot,
                  "diff",
                  "--unified=3",
                  values.since ?? "HEAD",
              ])
            : await fetchPatch(ref);

    const files = parseUnifiedDiff(patch);
    if (files.length === 0) {
        console.log("No reviewable files in this change; nothing to review.");
        return 0;
    }

    const skipReason = skipReasonFor(metadata, values.post === true);
    if (skipReason !== null) {
        console.log(`Skipping review: ${skipReason}`);
        return 0;
    }

    const threads: ReviewThread[] = ref === null ? [] : await fetchReviewThreads(ref);
    const patchPath = join(scratch, "change.patch");
    await Bun.write(patchPath, patch);

    const context: ReviewContext = {
        pullRequest: ref ?? { owner: "local", repo: repositoryRoot, number: 0 },
        headSha:
            metadata?.headSha ??
            (await runProcessOrThrow(["git", "-C", repositoryRoot, "rev-parse", "HEAD"])),
        title: metadata?.title ?? "(local branch)",
        body: metadata?.body ?? "",
        author: metadata?.author ?? "(local)",
        files,
        patch,
        ruleFindings: [],
        workingDirectory: repositoryRoot,
        patchPath,
        resolvedThreads: partitionThreads(threads).resolved.map((entry) => ({
            ruleId: entry.ruleId,
            path: entry.path,
            line: entry.line,
        })),
    };

    const deterministic = [
        ...runRuleChecks(context),
        ...findUncoveredSourceFiles(context),
        ...findUnjustifiedDependencyChange(context),
    ];
    context.ruleFindings = deterministic;

    if (values["dry-run-rules"] === true) {
        printFindings(deterministic);
        return 0;
    }

    if (process.env.DEEPSEEK_API_KEY === undefined && process.env.REVIEW_OMP_BIN === undefined) {
        console.error(
            "DEEPSEEK_API_KEY is not set. The reviewer lenses cannot run without it; set the variable or pass --dry-run-rules.",
        );
        return 1;
    }

    const lenses = selectLenses(files, requestedLenses);
    console.log(
        `Reviewing ${files.length} file(s) at ${context.headSha.slice(0, 8)} with ${lenses.length} lens(es): ${lenses
            .map((lens) => lens.id)
            .join(", ")}`,
    );

    const lensResults = await runWithConcurrency(lenses, concurrency, (lens) =>
        runLens(lens, context, {
            model,
            timeoutSeconds: Number(process.env.REVIEW_LENS_TIMEOUT ?? DEFAULT_LENS_TIMEOUT_SECONDS),
            skillDirectory,
            promptDirectory: scratch,
        }),
    );

    const anchored = anchorFindings(
        [...deterministic, ...lensResults.flatMap((result) => result.findings)],
        context,
    );
    const aboveFloor = applyConfidenceFloor(anchored, confidenceFloor);
    const deduped = deduplicate(aboveFloor);
    const { kept, suppressed } = suppressAnswered(deduped.kept, threads);
    const findings = sortFindings(kept);

    for (const result of lensResults) {
        if (result.error.length > 0) {
            console.error(`Lens ${result.lens.id} failed: ${result.error}`);
        }
    }

    if (values.json === true) {
        console.log(
            JSON.stringify(
                {
                    findings,
                    lensResults: lensResults.map((result) => ({
                        lens: result.lens.id,
                        error: result.error,
                        count: result.findings.length,
                    })),
                },
                null,
                4,
            ),
        );
        return 0;
    }

    printFindings(findings);

    if (values.post !== true || ref === null) {
        return 0;
    }

    const comments = renderComments(findings);
    if (comments.length > 0) {
        const url = await postReview(ref, context.headSha, reviewBody(findings), comments);
        console.log(`Posted ${comments.length} inline comment(s): ${url}`);
    }
    await upsertSummary(
        ref,
        renderSummary(context, findings, lensResults, {
            suppressed,
            duplicates: deduped.duplicates,
            capped: deduped.capped,
            belowFloor: anchored.length - aboveFloor.length,
        }),
    );
    console.log("Summary comment updated.");
    return 0;
}

/**
 * Resolves the pull request identity from the command line or the current branch.
 *
 * @param requested - Number passed with `--pr`, when present.
 * @param cwd - Repository root.
 * @returns Owner, repository, and number.
 */
async function resolveRef(requested: string | undefined, cwd: string): Promise<PullRequestRef> {
    const { owner, repo } = await resolveRepository(cwd);
    if (requested !== undefined) {
        return { owner, repo, number: Number(requested) };
    }
    const output = await runProcessOrThrow(
        ["gh", "pr", "view", "--json", "number", "--jq", ".number"],
        { cwd },
    );
    const number = Number(output.trim());
    if (!Number.isInteger(number) || number <= 0) {
        throw new Error("No pull request found for the current branch; pass --pr <number>.");
    }
    return { owner, repo, number };
}

/**
 * Decides whether the change should be reviewed at all.
 *
 * @param metadata - Pull request metadata, absent for a local diff.
 * @param posting - Whether the run intends to post comments.
 * @returns A reason to skip, or null to proceed.
 */
function skipReasonFor(
    metadata: { isDraft: boolean; state: string; title: string; body: string } | null,
    posting: boolean,
): string | null {
    if (metadata === null) {
        return null;
    }
    if (metadata.state !== "OPEN") {
        return `pull request is ${metadata.state.toLowerCase()}`;
    }
    if (metadata.isDraft && posting) {
        return "pull request is a draft";
    }
    if (`${metadata.title}\n${metadata.body}`.includes(SKIP_MARKER)) {
        return `the ${SKIP_MARKER} marker is present`;
    }
    return null;
}

/**
 * Re-anchors findings onto lines the diff shows, dropping the unanchorable.
 *
 * A finding the author cannot see outside the diff cannot be discussed inline,
 * so it is dropped rather than posted to a line GitHub will reject.
 *
 * @param findings - Findings from the deterministic pass and the lenses.
 * @param context - Review context holding the parsed files.
 * @returns Findings with corrected line numbers.
 */
function anchorFindings(findings: Finding[], context: ReviewContext): Finding[] {
    const anchored: Finding[] = [];
    for (const finding of findings) {
        const file = findFile(context.files, finding.path);
        if (file === null) {
            continue;
        }
        const line = snapToDiff(file, finding.line);
        if (line === null) {
            continue;
        }
        anchored.push({ ...finding, path: file.path, line });
    }
    return anchored;
}

/**
 * Renders the review body that accompanies the inline comments.
 *
 * @param findings - Findings being posted.
 * @returns Review body text.
 */
function reviewBody(findings: Finding[]): string {
    const blocking = findings.filter((finding) => finding.severity === "blocking").length;
    return [
        `Automated review: ${findings.length} finding${findings.length === 1 ? "" : "s"}${
            blocking > 0 ? `, ${blocking} blocking` : ""
        }. See the summary comment for the full list. Findings are advisory; this review does not block merging.`,
    ].join("\n");
}

/**
 * Prints findings to the console.
 *
 * @param findings - Findings to print.
 */
function printFindings(findings: Finding[]): void {
    if (findings.length === 0) {
        console.log("No findings.");
        return;
    }
    console.log("");
    for (const finding of findings) {
        console.log(
            `${finding.severity.toUpperCase()} ${finding.path}:${finding.line} [${finding.ruleId}] ${finding.title}`,
        );
        console.log(`    ${finding.body.split("\n")[0] ?? ""}`);
    }
}

/**
 * Runs the pipeline and converts an unexpected failure into an exit code.
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
