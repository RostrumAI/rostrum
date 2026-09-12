/** @fileoverview Real daemon child-process test harness. */

import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENTRY_POINT = join(import.meta.dir, "../index.ts");
const CONFIG_ENV =
    /^(?:DAEMON_|CONTROL_API_CONFIG$|DATABASE_|PG|HOST$|PORT$|NODE_ENV$|LOG_LEVEL$|TLS_|BEHIND_REVERSE_PROXY$|ALLOW_INSECURE_LOCAL$|DEPENDENCY_TIMEOUT_MS$|SHUTDOWN_TIMEOUT_MS$|NODE_TLS_REJECT_UNAUTHORIZED$|NODE_EXTRA_CA_CERTS$)/;

/** Real child-process harness shared by smoke and executable boundary tests. */
export class DaemonProcess {
    readonly tokens: string[];
    readonly config: Record<string, unknown>;
    readonly tokenFile: string;
    readonly configFile: string;
    readonly child: Bun.Subprocess<"ignore", "pipe", "pipe">;
    logs = "";
    port: number | undefined;
    private readonly readers: Promise<void>[];
    readonly directory: string;

    private constructor(
        directory: string,
        config: Record<string, unknown>,
        tokens: string[],
        env: Record<string, string | undefined>,
    ) {
        this.directory = directory;
        this.tokens = tokens;
        this.config = config;
        this.tokenFile = join(directory, "tokens");
        this.configFile = join(directory, "config.json");
        this.child = Bun.spawn([process.execPath, ENTRY_POINT], {
            cwd: directory,
            env,
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
        });
        this.readers = [this.capture(this.child.stdout), this.capture(this.child.stderr)];
    }

    static async spawn(
        options: {
            config?: Record<string, unknown>;
            env?: Record<string, string | undefined>;
            prepare?: (directory: string) => Promise<Record<string, unknown>>;
        } = {},
    ): Promise<DaemonProcess> {
        const directory = await mkdtemp(join(tmpdir(), "rostrum-daemon-"));
        try {
            const tokenFile = join(directory, "tokens");
            const tokens = [randomBytes(32).toString("hex"), randomBytes(48).toString("hex")];
            const config: Record<string, unknown> = {
                host: "127.0.0.1",
                port: 0,
                nodeEnv: "test",
                logLevel: "info",
                databaseUrl: "postgres://daemon_test@127.0.0.1:1/daemon_test",
                databaseTls: false,
                allowInsecureLocal: true,
                dependencyTimeoutMs: 300,
                shutdownTimeoutMs: 1500,
                daemonTokenFile: tokenFile,
                ...options.config,
                ...(await options.prepare?.(directory)),
            };
            await writeFile(tokenFile, `${tokens.join("\n")}\n`, { mode: 0o600 });
            await writeFile(join(directory, "config.json"), JSON.stringify(config));
            const env = Object.fromEntries(
                Object.entries(process.env).filter(([key]) => !CONFIG_ENV.test(key)),
            );
            return new DaemonProcess(directory, config, tokens, {
                ...env,
                DAEMON_CONFIG: join(directory, "config.json"),
                ...options.env,
            });
        } catch (error) {
            await rm(directory, { recursive: true, force: true });
            throw error;
        }
    }

    private async capture(stream: ReadableStream<Uint8Array>): Promise<void> {
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        for (;;) {
            const { value, done } = await reader.read();
            if (done) {
                break;
            }
            this.logs += decoder.decode(value, { stream: true });
        }
        this.logs += decoder.decode();
    }

    async waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
        const deadline = performance.now() + timeoutMs;
        while (!predicate()) {
            if (performance.now() >= deadline)
                throw new Error(`Timed out waiting for daemon: ${this.logs}`);
            await Bun.sleep(10);
        }
    }

    async listening(): Promise<string> {
        await this.waitFor(() => {
            for (const line of this.logs.split("\n")) {
                try {
                    const record = JSON.parse(line) as { msg?: string; port?: number };
                    if (record.msg === "listening" && typeof record.port === "number") {
                        this.port = record.port;
                        return true;
                    }
                } catch {
                    /* An incomplete line is retried after the next chunk. */
                }
            }
            if (this.child.exitCode !== null)
                throw new Error(`Daemon exited before listening: ${this.logs}`);
            return false;
        });
        return `${this.config.tlsCertFile ? "https" : "http"}://127.0.0.1:${this.port}`;
    }

    async exited(timeoutMs = 5000): Promise<number> {
        const deadline = Promise.withResolvers<never>();
        const timer = setTimeout(
            () => deadline.reject(new Error(`Daemon did not exit within ${timeoutMs}ms`)),
            timeoutMs,
        );
        try {
            const code = await Promise.race([this.child.exited, deadline.promise]);
            await Promise.all(this.readers);
            return code;
        } finally {
            clearTimeout(timer);
        }
    }

    async dispose(): Promise<void> {
        try {
            if (this.child.exitCode === null) {
                this.child.kill("SIGTERM");
                try {
                    await this.exited();
                } catch {
                    this.child.kill("SIGKILL");
                    await this.child.exited;
                }
            }
            await Promise.all(this.readers);
        } finally {
            await rm(this.directory, { recursive: true, force: true });
        }
    }
}
