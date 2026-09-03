/**
 * Control API boundary for the E2-S2 proof of concept.
 *
 * The real Control API (apps/control-api) keeps its workflow features; this
 * stand-in keeps only what the transport decision touches: the public error
 * shape, the deadline configuration, and the pass-through rule. Its two run
 * operations call the daemon exclusively through `DaemonClient`, so no run
 * state exists in this process.
 */

import {
    DAEMON_PROTOCOL,
    DAEMON_TIMEOUT,
    DAEMON_UNAVAILABLE,
    forwardResponse,
    type PublicError,
} from "./contract";
import { DaemonClient, type TransportFailure } from "./daemon-client";
import { requireIntegerEnv } from "./process-config";
import { log } from "./log";

export interface ControlApiConfig {
    daemonUrl: string;
    daemonTimeoutMs: number;
}

/** Configuration defaults from the approved E2-S2 decision. */
export function controlApiConfig(
    daemonUrl: string | undefined = "http://127.0.0.1:3100",
    daemonTimeoutMs = 10000,
): ControlApiConfig {
    return { daemonUrl, daemonTimeoutMs };
}

/** The one public error shape (`apps/control-api/src/schemas.ts`). */
function publicError(code: string, message: string): PublicError {
    return { code, message, findings: [] };
}

/** Maps a classified transport failure to its approved public error. */
function publicErrorFor(failure: TransportFailure): { status: number; error: PublicError } {
    switch (failure.kind) {
        case "unavailable":
            return {
                status: 503,
                error: publicError(DAEMON_UNAVAILABLE, "The daemon is not accepting connections."),
            };
        case "timeout":
            return {
                status: 504,
                error: publicError(
                    DAEMON_TIMEOUT,
                    "The daemon did not answer the submission before the configured deadline.",
                ),
            };
        case "protocol":
            return {
                status: 500,
                error: publicError(
                    DAEMON_PROTOCOL,
                    "The daemon returned a response this Control API cannot interpret.",
                ),
            };
    }
}

export class ControlApiApp {
    private readonly daemon: DaemonClient;

    constructor(config: ControlApiConfig, fetchImpl?: (request: Request) => Promise<Response>) {
        this.daemon = new DaemonClient({
            baseUrl: config.daemonUrl,
            timeoutMs: config.daemonTimeoutMs,
            fetchImpl,
        });
    }

    /** Real-process constructor: the base URL reaches another process. */
    static withDaemonUrl(daemonUrl: string, daemonTimeoutMs: number): ControlApiApp {
        return new ControlApiApp({ daemonUrl, daemonTimeoutMs });
    }

    /** In-process harness: calls the daemon app's own fetch handler. */
    static withInProcessDaemon(
        daemonFetch: (request: Request) => Promise<Response>,
    ): ControlApiApp {
        return new ControlApiApp(
            { daemonUrl: "http://daemon.internal", daemonTimeoutMs: 2000 },
            daemonFetch,
        );
    }

    async submitRun(body: unknown): Promise<Response> {
        const started = Date.now();
        const outcome = await this.daemon.submitRun(body);
        if (outcome.kind === "accepted") {
            log("info", "submission accepted", { runId: outcome.run.runId, ms: Date.now() - started });
            return forwardResponse(201, outcome.raw);
        }
        if (outcome.kind === "rejected") {
            // Verbatim pass-through: the API adds no fields, rewrites nothing.
            log("info", "submission rejected by daemon", { status: outcome.status });
            return forwardResponse(outcome.status, outcome.body);
        }
        return this.transportFailure(outcome, "submission");
    }

    async retrieveRun(runId: string): Promise<Response> {
        const outcome = await this.daemon.retrieveRun(runId);
        if (outcome.kind === "found") {
            return forwardResponse(200, outcome.raw);
        }
        if (outcome.kind === "rejected") {
            // The daemon's 404 for an unknown run passes through verbatim.
            return forwardResponse(outcome.status, outcome.body);
        }
        return this.transportFailure(outcome, "retrieval");
    }

    private transportFailure(
        failure: TransportFailure,
        operation: string,
    ): Response {
        const { status, error } = publicErrorFor(failure);
        log("warning", `transport failure on ${operation}`, {
            kind: failure.kind,
            status,
            code: error.code,
            detail: failure.detail,
        });
        return new Response(JSON.stringify(error), {
            status,
            headers: { "content-type": "application/json" },
        });
    }

    /**
     * Fetch-compatible handler for the Control API's two run operations.
     * Every other path is outside this proof.
     */
    readonly fetch = async (request: Request): Promise<Response> => {
        const path = new URL(request.url).pathname;
        if (request.method === "GET" && path === "/api/v1/system/health") {
            return new Response(JSON.stringify({ status: "ok" }), {
                status: 200,
                headers: { "content-type": "application/json" },
            });
        }
        if (request.method === "POST" && path === "/api/v1/runs") {
            let body: unknown;
            try {
                body = await request.json();
            } catch {
                return new Response(
                    JSON.stringify(publicError("request.invalid", "The request body is not valid JSON.")),
                    { status: 400, headers: { "content-type": "application/json" } },
                );
            }
            return this.submitRun(body);
        }
        const runMatch = /^\/api\/v1\/runs\/([^/]+)$/.exec(path);
        if (request.method === "GET" && runMatch) {
            return this.retrieveRun(decodeURIComponent(runMatch[1] as string));
        }
        return new Response(
            JSON.stringify(publicError("request.not-found", `No route serves ${request.method} ${path}.`)),
            { status: 404, headers: { "content-type": "application/json" } },
        );
    };
}

if (import.meta.main) {
    // Reads the approved Control API configuration variables: DAEMON_URL and
    // DAEMON_TIMEOUT_MS layered over the approved defaults.
    const config = controlApiConfig(
        process.env.DAEMON_URL,
        requireIntegerEnv(process.env.DAEMON_TIMEOUT_MS, "daemonTimeoutMs", 10000),
    );
    const host = process.env.HOST ?? "127.0.0.1";
    const app = new ControlApiApp(config);
    const server = Bun.serve({
        hostname: host,
        port: requireIntegerEnv(process.env.PORT, "port", 3000),
        fetch: app.fetch,
        error(error) {
            log("error", "request failed", { error: String(error) });
            return new Response("Internal Server Error", { status: 500 });
        },
    });
    log("info", "listening", {
        host,
        port: server.port,
        url: `http://${host}:${server.port}`,
        daemonUrl: config.daemonUrl,
        daemonTimeoutMs: config.daemonTimeoutMs,
    });

    let shuttingDown = false;
    async function shutdown(signal: string): Promise<void> {
        if (shuttingDown) return;
        shuttingDown = true;
        log("info", "shutdown started", { signal });
        server.stop(true);
        process.exit(0);
    }
    process.on("SIGTERM", () => void shutdown("SIGTERM"));
    process.on("SIGINT", () => void shutdown("SIGINT"));
}
