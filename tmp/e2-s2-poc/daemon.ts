/**
 * Real daemon process for the proof. It mirrors the shape of
 * apps/control-api/src/index.ts: load and validate configuration, serve the
 * application through `Bun.serve` on loopback TCP, and shut down gracefully
 * on SIGTERM and SIGINT. Configuration is read from the environment here;
 * the YAML file layer of the approved loader is an E2-05 implementation
 * concern and stays out of the proof.
 */

import { createDaemonApp, type DaemonFault } from "./daemon-app";
import { requireIntegerEnv } from "./process-config";
import { log } from "./log";


export interface DaemonConfig {
    host: string;
    port: number;
    /**
     * `Bun.serve` `idleTimeout` in seconds; the approved decision requires
     * this to sit above the slowest legitimate response path instead of
     * Bun's 10 second default.
     */
    idleTimeout: number;
    faults?: DaemonFault;
    /** Harness-only self-shutdown delay that drives the real shutdown path. */
    testShutdownAfterMs?: number;
}

const DAEMON_FAULTS = ["hang-submission", "malformed-submission"] as const;

/**
 * Reads daemon configuration from environment variables layered over the
 * approved defaults (`host` 127.0.0.1, `port` 3100), mirroring the guard in
 * apps/control-api/src/env.ts: invalid values fail startup with the
 * offending path before the socket opens.
 */
export function readDaemonConfig(env: Record<string, string | undefined> = process.env): DaemonConfig {
    const faults = env.DAEMON_FAULT;
    if (faults !== undefined && !(DAEMON_FAULTS as readonly string[]).includes(faults)) {
        throw new Error(
            `invalid configuration: /faults must be one of ${DAEMON_FAULTS.join(", ")}, got ${JSON.stringify(faults)}`,
        );
    }
    const config: DaemonConfig = {
        host: env.HOST ?? "127.0.0.1",
        port: requireIntegerEnv(env.PORT, "port", 3100),
        idleTimeout: requireIntegerEnv(env.IDLE_TIMEOUT, "idleTimeout", 60),
        ...(faults === undefined ? {} : { faults: faults as DaemonFault }),
        ...(env.DAEMON_TEST_SHUTDOWN_AFTER_MS === undefined
            ? {}
            : {
                  testShutdownAfterMs: requireIntegerEnv(
                      env.DAEMON_TEST_SHUTDOWN_AFTER_MS,
                      "testShutdownAfterMs",
                      0,
                  ),
              }),
    };
    // Bun caps idleTimeout at 255 seconds; the real loader (E2-05) owns the
    // full schema check. The proof checks the range that Bun enforces.
    if (config.idleTimeout < 0 || config.idleTimeout > 255) {
        throw new Error(
            `invalid configuration: /idleTimeout must be an integer between 0 and 255, got ${config.idleTimeout}`,
        );
    }
    return config;
}

if (import.meta.main) {
    const config = readDaemonConfig();
    const app = createDaemonApp({ faults: config.faults });
    const server = Bun.serve({
        hostname: config.host,
        port: config.port,
        idleTimeout: config.idleTimeout,
        fetch: app.fetch,
        error(error) {
            log("error", "request failed", { error: String(error) });
            return new Response("Internal Server Error", { status: 500 });
        },
    });
    log("info", "listening", {
        host: config.host,
        port: server.port,
        url: `http://${config.host}:${server.port}`,
        idleTimeout: config.idleTimeout,
    });

    let shuttingDown = false;
    async function shutdown(signal: string): Promise<void> {
        if (shuttingDown) return;
        shuttingDown = true;
        log("info", "shutdown started", { signal });
        // Stop accepting new requests first; mirrors apps/control-api/src/index.ts.
        server.stop(true);
        app.close();
        log("info", "shutdown complete", {});
        await flushStdout();
        process.exit(0);
    }
    process.on("SIGTERM", () => void shutdown("SIGTERM"));
    process.on("SIGINT", () => void shutdown("SIGINT"));
    if (config.testShutdownAfterMs !== undefined) {
        setTimeout(() => void shutdown("test-shutdown"), config.testShutdownAfterMs);
    }
}

/** Drains pending stdout bytes so log lines survive `process.exit`. */
function flushStdout(): Promise<void> {
    const { promise, resolve } = Promise.withResolvers<void>();
    const timeout = setTimeout(resolve, 200);
    process.stdout.write("", () => {
        clearTimeout(timeout);
        resolve();
    });
    return promise;
}