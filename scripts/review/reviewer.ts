/**
 * Reviewer execution: one model-backed lens per independent reviewer.
 *
 * @remarks
 * A lens runs as a headless agent session with read-only tools, the repository
 * checked out at the pull request head, and the lens prompt as its system
 * prompt. Giving the reviewer tools is what separates this from a prompt that
 * reads a diff: it can open the file, follow the helper, and read the schema, so
 * a finding is grounded in code rather than in the shape of a patch.
 */

import { visibleLines } from "./diff.ts";
import type { FileDiff, Finding, Lens, ReviewContext } from "./types.ts";

/** Environment variable naming the reviewer executable. */
const OMP_BINARY_ENV = "REVIEW_OMP_BIN";

/** Environment variable holding the reviewer provider's API key. */
export const API_KEY_ENV = "DEEPSEEK_API_KEY";

/** Default model for every lens. */
export const DEFAULT_MODEL = "deepseek/deepseek-v4-flash";

/** Default wall-clock ceiling for a single lens, in seconds. */
export const DEFAULT_LENS_TIMEOUT_SECONDS = 600;

/** Thinking effort per lens, tuned to the difficulty of the angle. */
const THINKING_BY_LENS: Record<string, string> = {
    correctness: "max",
    contracts: "high",
    tests: "high",
    typescript: "medium",
    security: "max",
    documentation: "low",
};

/** Result of running one lens. */
export interface LensResult {
    /** The lens that ran. */
    lens: Lens;
    /** Findings the lens reported and the pipeline could parse. */
    findings: Finding[];
    /** Failure note when the lens did not complete, empty on success. */
    error: string;
}

/**
 * Runs one lens against the change.
 *
 * @param lens - Reviewer to run.
 * @param context - Review context, including the repository checkout.
 * @param options - Model override, timeout, and the directory holding prepared prompts.
 * @returns The parsed findings, or an error note when the run failed.
 */
export async function runLens(
    lens: Lens,
    context: ReviewContext,
    options: {
        model: string;
        timeoutSeconds: number;
        skillDirectory: string;
        promptDirectory: string;
    },
): Promise<LensResult> {
    const systemPromptPath = `${options.promptDirectory}/system-${lens.id}.md`;
    await Bun.write(systemPromptPath, await buildSystemPrompt(lens, options.skillDirectory));
    const userPrompt = buildLensPrompt(context, options.skillDirectory);
    const command = [
        process.env[OMP_BINARY_ENV] ?? "omp",
        "-p",
        "--no-session",
        "--no-title",
        "--no-skills",
        "--cwd",
        context.workingDirectory,
        "--model",
        options.model,
        "--thinking",
        THINKING_BY_LENS[lens.id] ?? "high",
        "--tools",
        "read,grep,glob,bash",
        "--system-prompt",
        systemPromptPath,
        "--max-time",
        String(options.timeoutSeconds),
        userPrompt,
    ];
    // A key stored by an earlier interactive login outranks the provider
    // environment variable, so a stale credential can silently replace the one
    // CI supplies. The runtime override is the highest-precedence source, so
    // the configured key is passed explicitly rather than left to resolution.
    const apiKey = process.env[API_KEY_ENV];
    if (apiKey !== undefined && apiKey.length > 0) {
        command.splice(1, 0, "--api-key", apiKey);
    }

    const result = await raceWithTimeout(
        command,
        options.timeoutSeconds + 60,
        context.workingDirectory,
    );
    if (result.exitCode !== 0) {
        // A failed run prints progress before the failure, so the cause is at the
        // end of stderr rather than the beginning.
        return {
            lens,
            findings: [],
            error: `exit ${result.exitCode}: ${result.stderr.slice(-400)}`,
        };
    }
    const payload = extractJsonObject(result.stdout);
    if (payload === null) {
        return {
            lens,
            findings: [],
            error: `no JSON object in output: ${result.stdout.slice(-400)}`,
        };
    }
    return { lens, findings: normalizeFindings(payload, lens, context), error: "" };
}

/**
 * Assembles a lens's system prompt from the contract, the lens, and its rules.
 *
 * The whole corpus is passed inline rather than left for the reviewer to fetch,
 * so the rules it is judged against are exactly the rules the pipeline intends,
 * read once, before the reviewer forms an opinion about the diff.
 *
 * @param lens - Reviewer to assemble a prompt for.
 * @param skillDirectory - Directory holding the contract and rule files.
 * @returns System prompt text.
 */
export async function buildSystemPrompt(lens: Lens, skillDirectory: string): Promise<string> {
    const sections = [
        await Bun.file(`${skillDirectory}/reviewer-contract.md`).text(),
        "\n---\n",
        await Bun.file(`${skillDirectory}/${lens.promptPath}`).text(),
    ];
    for (const rulePath of lens.rulePaths) {
        sections.push(
            `\n---\n\n# Rules from ${rulePath}\n\n`,
            await Bun.file(`${skillDirectory}/${rulePath}`).text(),
        );
    }
    return sections.join("");
}

/**
 * Builds the user prompt for a lens.
 *
 * The diff is passed by path rather than inline so a large change does not
 * consume the reviewer's context before it starts reading code.
 *
 * @param context - Review context.
 * @param skillDirectory - Directory holding the rule files the lens reviews against.
 * @returns Prompt text.
 */
export function buildLensPrompt(context: ReviewContext, skillDirectory: string): string {
    const changed = context.files
        .map((file) => `${file.path} (${describeChange(file)})`)
        .join("\n");
    const resolved =
        context.resolvedThreads.length === 0
            ? "None."
            : context.resolvedThreads
                  .map((thread) => `- ${thread.ruleId} at ${thread.path}: resolved`)
                  .join("\n");
    return [
        `Review pull request #${context.pullRequest.number} at commit ${context.headSha}.`,
        "",
        `Title: ${context.title}`,
        `Author: ${context.author}`,
        context.body.trim().length === 0
            ? "Description: none provided."
            : `Description:\n${context.body.trim()}`,
        "",
        `The unified diff is at ${context.patchPath}. Read it first.`,
        "The repository is checked out at this commit; open any file you need to verify a finding.",
        `Rule files under ${skillDirectory} are already included above; do not re-read them.`,
        "",
        "Changed files:",
        changed,
        "",
        "Findings already resolved on this pull request, which must not be reported again:",
        resolved,
        "",
        "Report your findings as the single JSON object described in the reviewer contract and",
        "nothing else.",
    ].join("\n");
}

/**
 * Describes how a file changed, for the reviewer's changed-file list.
 *
 * @param file - Parsed file diff.
 * @returns A short label such as `added`, `deleted`, or `modified`.
 */
function describeChange(file: FileDiff): string {
    if (file.added) {
        return "added";
    }
    if (file.deleted) {
        return "deleted";
    }
    if (file.hunks.length === 0) {
        return "renamed";
    }
    return `${file.hunks.length} hunk(s)`;
}

/**
 * Runs a command with a hard wall-clock ceiling.
 *
 * `--max-time` bounds the agent's own run, but a wedged process must not hold
 * the pipeline, so the process is killed when the ceiling passes either way.
 *
 * @param command - Executable and arguments.
 * @param timeoutSeconds - Seconds to wait before killing the process.
 * @param cwd - Working directory for the child.
 * @returns Exit code and captured output; a killed process reports code 124.
 */
async function raceWithTimeout(
    command: string[],
    timeoutSeconds: number,
    cwd: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const child = Bun.spawn(command, {
        cwd,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env },
    });
    const stdoutPromise = new Response(child.stdout).text();
    const stderrPromise = new Response(child.stderr).text();
    const exited = child.exited;
    const timer = setTimeout(() => {
        child.kill("SIGKILL");
    }, timeoutSeconds * 1000);
    try {
        const [exitCode, stdout, stderr] = await Promise.all([
            exited,
            stdoutPromise,
            stderrPromise,
        ]);
        return { exitCode, stdout, stderr };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Extracts the first balanced JSON object from agent output.
 *
 * A model asked for JSON sometimes wraps it in a fence or adds a sentence before
 * it. Scanning for the first balanced object is more reliable than trimming
 * delimiters, and brace counting respects strings so a `{` inside a message does
 * not end the object early.
 *
 * @param text - Raw agent output.
 * @returns The parsed object, or null when no object is present or it is invalid.
 */
export function extractJsonObject(text: string): unknown {
    const start = text.indexOf("{");
    if (start === -1) {
        return null;
    }
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
        const character = text[index];
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (character === "\\") {
                escaped = true;
            } else if (character === '"') {
                inString = false;
            }
            continue;
        }
        if (character === '"') {
            inString = true;
        } else if (character === "{") {
            depth += 1;
        } else if (character === "}") {
            depth -= 1;
            if (depth === 0) {
                try {
                    return JSON.parse(text.slice(start, index + 1));
                } catch {
                    return null;
                }
            }
        }
    }
    return null;
}

/**
 * Validates a lens payload into findings, dropping anything malformed.
 *
 * A reviewer that invents a path or a line is dropped rather than posted, so a
 * hallucinated location never reaches the pull request.
 *
 * @param payload - Parsed JSON returned by the lens.
 * @param lens - Lens that produced the payload.
 * @param context - Review context holding the parsed files.
 * @returns Well-formed findings anchored to lines the diff shows.
 */
export function normalizeFindings(payload: unknown, lens: Lens, context: ReviewContext): Finding[] {
    if (typeof payload !== "object" || payload === null || !("findings" in payload)) {
        return [];
    }
    const raw: unknown = payload.findings;
    if (!Array.isArray(raw)) {
        return [];
    }
    const findings: Finding[] = [];
    for (const item of raw) {
        if (typeof item !== "object" || item === null) {
            continue;
        }
        const record = item as Record<string, unknown>;
        const path = typeof record.path === "string" ? record.path : "";
        const file = context.files.find((candidate) => candidate.path === path);
        if (file === undefined || visibleLines(file).length === 0) {
            continue;
        }
        const line = typeof record.line === "number" ? record.line : Number.NaN;
        if (!Number.isFinite(line)) {
            continue;
        }
        findings.push({
            ruleId: typeof record.ruleId === "string" ? record.ruleId : "BUG",
            path,
            line,
            severity: normalizeSeverity(record.severity),
            confidence: typeof record.confidence === "number" ? record.confidence : 50,
            title: typeof record.title === "string" ? record.title : "Finding",
            body: typeof record.body === "string" ? record.body : "",
            evidence: typeof record.evidence === "string" ? record.evidence : "",
            lens: lens.id,
        });
    }
    return findings;
}

/**
 * Maps a reported severity onto the three the pipeline understands.
 *
 * @param value - Severity as returned by the reviewer.
 * @returns A valid severity, defaulting to `major`.
 */
function normalizeSeverity(value: unknown): Finding["severity"] {
    if (value === "blocking" || value === "major" || value === "minor") {
        return value;
    }
    return "major";
}

/**
 * Runs tasks with a bounded number in flight.
 *
 * Lens calls are independent, so they run concurrently, but an unbounded fan-out
 * against a rate-limited endpoint loses more runs to throttling than it gains
 * from parallelism.
 *
 * @param items - Work items.
 * @param limit - Maximum concurrent tasks.
 * @param worker - Function processing one item.
 * @returns Results in input order.
 */
export async function runWithConcurrency<Item, Result>(
    items: Item[],
    limit: number,
    worker: (item: Item) => Promise<Result>,
): Promise<Result[]> {
    const results = new Array<Result>(items.length);
    let next = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        for (;;) {
            const index = next;
            next += 1;
            const item = items[index];
            if (item === undefined) {
                return;
            }
            results[index] = await worker(item);
        }
    });
    await Promise.all(runners);
    return results;
}
