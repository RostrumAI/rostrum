/**
 * Process helpers shared by the review pipeline.
 *
 * @remarks
 * Every external call the pipeline makes is a child process: `gh` for the
 * GitHub API and `git` for local repository state. Centralising the spawn
 * wrapper keeps exit-code handling, stderr capture, and stdin delivery in one
 * place instead of repeating the same four lines at each call site.
 */

/** Result of a finished child process. */
export interface ProcessResult {
    /** Process exit code. */
    exitCode: number;
    /** Standard output, decoded as UTF-8 and trailing-whitespace trimmed. */
    stdout: string;
    /** Standard error, decoded as UTF-8 and trailing-whitespace trimmed. */
    stderr: string;
}

/**
 * Runs a child process to completion, delivering optional stdin.
 *
 * @param command - Executable and arguments; never passed through a shell.
 * @param options - Standard input to deliver and a working directory override.
 * @returns The exit code with captured output.
 */
export async function runProcess(
    command: string[],
    options: { stdin?: string; cwd?: string } = {},
): Promise<ProcessResult> {
    const child = Bun.spawn(command, {
        cwd: options.cwd,
        stdin: options.stdin === undefined ? "ignore" : "pipe",
        stdout: "pipe",
        stderr: "pipe",
    });
    if (options.stdin !== undefined && child.stdin !== undefined) {
        child.stdin.write(options.stdin);
        await child.stdin.end();
    }
    const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
    ]);
    return { exitCode, stdout: stdout.trimEnd(), stderr: stderr.trimEnd() };
}

/**
 * Runs a child process and fails the caller when it exits non-zero.
 *
 * @param command - Executable and arguments.
 * @param options - Standard input to deliver and a working directory override.
 * @returns Standard output.
 * @throws Error naming the command and its stderr when the process fails.
 */
export async function runProcessOrThrow(
    command: string[],
    options: { stdin?: string; cwd?: string } = {},
): Promise<string> {
    const result = await runProcess(command, options);
    if (result.exitCode !== 0) {
        throw new Error(
            `Command failed (${result.exitCode}): ${command.join(" ")}\n${result.stderr}`,
        );
    }
    return result.stdout;
}
