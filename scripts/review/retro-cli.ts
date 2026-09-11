/**
 * Entry point for the weekly reviewer retrospective.
 *
 * @remarks
 * Run on a schedule, or by hand with an explicit window. Prints the report and,
 * when there is something to propose, opens a pull request against the rule
 * corpus for a human to accept.
 *
 * Usage:
 *   bun run review:retro --since 2026-09-01T00:00:00Z
 *   bun run review:retro --days 7 --open-pr
 */

import { join } from "node:path";
import { parseArgs } from "node:util";

import { runRetrospective } from "./retro.ts";

/**
 * Resolves the start of the window from an explicit timestamp or a day count.
 *
 * @param since - Explicit ISO 8601 start, when supplied.
 * @param days - Number of days to look back, when `since` is absent.
 * @returns ISO 8601 timestamp and a human-readable description of the window.
 */
function resolveWindow(since: string | undefined, days: number): { since: string; label: string } {
    if (since !== undefined && since.trim().length > 0) {
        return { since, label: `since ${since}` };
    }
    const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return { since: start.toISOString(), label: `the last ${days} days` };
}

/** Entry point. Exits non-zero only when the run itself failed. */
async function main(): Promise<number> {
    const { values } = parseArgs({
        args: Bun.argv.slice(2),
        options: {
            since: { type: "string" },
            days: { type: "string" },
            "open-pr": { type: "boolean", default: false },
            branch: { type: "string" },
        },
        allowPositionals: false,
    });

    const days = Number(values.days ?? "7");
    if (!Number.isInteger(days) || days < 1) {
        throw new Error(`Invalid --days: "${values.days ?? ""}" is not a positive integer.`);
    }
    const window = resolveWindow(values.since, days);
    const cwd = join(import.meta.dir, "..", "..");
    const result = await runRetrospective(
        {
            since: window.since,
            window: window.label,
            openPullRequest: values["open-pr"] === true,
            branch: values.branch ?? `review-retro/${window.since.slice(0, 10)}`,
        },
        cwd,
    );

    console.log(result.report);
    if (result.pullRequest.length > 0) {
        console.log(`\nProposed rule changes: ${result.pullRequest}`);
    }
    return 0;
}

/**
 * Runs the retrospective and converts an unexpected failure into an exit code.
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
