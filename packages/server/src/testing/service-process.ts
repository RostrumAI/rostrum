/** @fileoverview Child-process harness for lifecycle integration tests. */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FIXTURE = join(import.meta.dir, "..", "lifecycle.fixture.ts");

/** A spawned fixture process plus the observations a test asserts on. */
export interface FixtureProcess {
    /** The port the fixture actually bound (it binds port 0). */
    readonly port: number;
    /** Every stdout line seen so far, in order. */
    lines(): readonly string[];
    /** Waits for a line matching `predicate`, or throws on timeout. */
    waitFor(predicate: (line: string) => boolean, timeoutMs?: number): Promise<string>;
    /** Sends a signal to the fixture process. */
    signal(name: "SIGTERM" | "SIGINT" | "SIGHUP"): void;
    /** Resolves with the process exit code. */
    exited(): Promise<number>;
    /** Rewrites the candidate configuration the fixture reloads from. */
    writeConfig(config: Record<string, unknown>): void;
}

/**
 * Starts the lifecycle fixture as a real child process. The tests need real
 * signal delivery and a real exit code, which an in-process runtime cannot
 * provide because it installs process-wide handlers and calls `process.exit`.
 */
export async function spawnFixture(initial: Record<string, unknown>): Promise<FixtureProcess> {
    // Write the candidate configuration the fixture reads at boot and on reload.
    const directory = mkdtempSync(join(tmpdir(), "rostrum-server-"));
    const configPath = join(directory, "config.json");
    writeFileSync(configPath, JSON.stringify(initial));

    // Spawn the fixture with piped stdio so its lines can be observed.
    const child = Bun.spawn([process.execPath, FIXTURE], {
        env: { ...process.env, FIXTURE_CONFIG: configPath },
        stdout: "pipe",
        stderr: "pipe",
    });

    // Split each stream into complete lines and wake the waiters that match.
    const seen: string[] = [];
    const waiters: Array<{
        predicate: (line: string) => boolean;
        resolve: (line: string) => void;
    }> = [];

    const pump = async (stream: ReadableStream<Uint8Array>): Promise<void> => {
        // Decode incrementally: a chunk can end mid-line.
        const decoder = new TextDecoder();
        let buffer = "";

        for await (const chunk of stream) {
            buffer += decoder.decode(chunk, { stream: true });
            let index = buffer.indexOf("\n");

            // Publish each complete line and keep the partial remainder buffered.
            while (index >= 0) {
                const line = buffer.slice(0, index).trim();
                buffer = buffer.slice(index + 1);
                if (line.length > 0) {
                    seen.push(line);

                    // Wake every waiter this line satisfies.
                    for (const waiter of [...waiters]) {
                        if (!waiter.predicate(line)) {
                            continue;
                        }
                        waiters.splice(waiters.indexOf(waiter), 1);
                        waiter.resolve(line);
                    }
                }
                index = buffer.indexOf("\n");
            }
        }
    };
    void pump(child.stdout);
    void pump(child.stderr);

    const waitFor = async (
        predicate: (line: string) => boolean,
        timeoutMs = 10_000,
    ): Promise<string> => {
        // A line that already arrived satisfies the predicate immediately.
        const existing = seen.find(predicate);
        if (existing !== undefined) {
            return existing;
        }

        // Otherwise register a waiter the pump will resolve, rejecting if the line never comes.
        const { promise, resolve, reject } = Promise.withResolvers<string>();
        const timer = setTimeout(() => {
            reject(new Error(`timed out waiting for a fixture line; saw:\n${seen.join("\n")}`));
        }, timeoutMs);
        waiters.push({
            predicate,
            resolve: (line) => {
                clearTimeout(timer);
                resolve(line);
            },
        });
        return promise;
    };

    // Read the port the fixture actually bound from its listening line.
    const listening = await waitFor((line) => line.includes('"msg":"listening"'));
    const parsed: unknown = JSON.parse(listening);
    if (
        typeof parsed !== "object" ||
        parsed === null ||
        !("port" in parsed) ||
        typeof parsed.port !== "number"
    ) {
        throw new Error(`fixture did not report a numeric port: ${listening}`);
    }

    // Hand back the handle the test drives.
    return {
        port: parsed.port,
        lines: () => [...seen],
        waitFor,
        signal: (name) => child.kill(name),
        exited: () => child.exited,
        writeConfig: (config) => {
            writeFileSync(configPath, JSON.stringify(config));
        },
    };
}
