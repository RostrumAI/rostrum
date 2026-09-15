/** @fileoverview Shared service startup, authenticated admission, and bounded shutdown. */

import { getLogger, type LogLevel } from "@logtape/logtape";
import { configureLogging } from "./logger";

/** The service a runtime hosts; selects the log category. */
export type ServiceName = "control-api" | "daemon";

/** Configuration read once at startup and fixed for the lifetime of the process. */
export interface ServiceRuntimeConfig {
    readonly host: string;
    readonly port: number;
    readonly logLevel: LogLevel;
    readonly shutdownTimeoutMs: number;
    /** Present when the listener serves TLS directly (direct mode only). */
    readonly tls?: { readonly cert: string; readonly key: string };
}

/** Resources owned by one service process and closed once when it stops. */
export interface ServiceResources {
    /** Releases every owned resource within `timeoutMs`; safe to call once. */
    close(options: { timeoutMs: number }): Promise<void>;
}

/** Inputs the shared runtime needs from one executable service. */
export interface RunServiceOptions<C extends ServiceRuntimeConfig, D extends ServiceResources> {
    readonly name: ServiceName;
    /** Loads and validates configuration once, before logging or resource acquisition. */
    loadConfig(): C;
    /** Acquires the resources owned by this process. */
    createResources(config: C): Promise<D>;
    /** Serves a request with the process's fixed configuration and resources. */
    fetch(
        request: Request,
        config: C,
        resources: D,
        signal: AbortSignal,
    ): Response | Promise<Response>;
    /**
     * Returns a rejection response for an unauthenticated request, or
     * undefined to proceed. Runs before the draining gate, route matching,
     * and every other boundary concern.
     */
    authenticate?(request: Request, config: C): Response | undefined;
}

/** The bound HTTP listener the runtime serves requests from. */
type BoundServer = Bun.Server<undefined>;

/** The boundary 503 a request receives when it arrives during shutdown. */
function drainingResponse(): Response {
    return Response.json(
        { code: "service_draining", message: "Service is shutting down", findings: [] },
        { status: 503, headers: { "cache-control": "no-store" } },
    );
}

/** The boundary 500 for an unhandled transport-level failure. */
function internalErrorResponse(): Response {
    return Response.json(
        { code: "internal_error", message: "Internal Server Error", findings: [] },
        { status: 500, headers: { "cache-control": "no-store" } },
    );
}

/** Runs one service process with authenticated admission and one shutdown deadline. */
export async function runService<C extends ServiceRuntimeConfig, D extends ServiceResources>(
    options: RunServiceOptions<C, D>,
): Promise<void> {
    // Reject invalid configuration before initializing logging or service resources.
    const config = options.loadConfig();
    await configureLogging(config.logLevel);
    const logger = getLogger(options.name);
    const resources = await options.createResources(config);

    // Keep resource ownership independent of how startup or shutdown finishes.
    let closeStarted = false;
    const closeResources = async (timeoutMs: number): Promise<boolean> => {
        if (closeStarted) {
            return false;
        }
        closeStarted = true;
        try {
            await resources.close({ timeoutMs });
            return true;
        } catch {
            logger.error("resource close failed");
            return false;
        }
    };

    // Retain accepted work until its handler and response body have finished.
    const outstanding = new Map<Request, AbortController>();
    let requestsDrained: (() => void) | undefined;
    let draining = false;
    const bindServer = async (): Promise<BoundServer> => {
        try {
            return Bun.serve({
                hostname: config.host,
                port: config.port,
                ...(config.tls === undefined
                    ? {}
                    : { tls: { cert: config.tls.cert, key: config.tls.key } }),
                fetch: async (request: Request) => {
                    // Authenticate before rejecting requests that arrive during shutdown.
                    const rejection = options.authenticate?.(request, config);
                    if (rejection !== undefined) {
                        return rejection;
                    }
                    if (draining) {
                        return drainingResponse();
                    }

                    // Propagate disconnects without losing track of unfinished handler work.
                    const controller = new AbortController();
                    const abort = (): void => controller.abort(request.signal.reason);
                    const finish = (): void => {
                        request.signal.removeEventListener("abort", abort);
                        outstanding.delete(request);
                        if (outstanding.size === 0) {
                            requestsDrained?.();
                        }
                    };
                    outstanding.set(request, controller);
                    request.signal.addEventListener("abort", abort, { once: true });
                    if (request.signal.aborted) {
                        abort();
                    }

                    // Observe stream completion and cancellation without buffering its contents.
                    try {
                        const response = await options.fetch(
                            request,
                            config,
                            resources,
                            controller.signal,
                        );
                        if (response.body === null) {
                            finish();
                            return response;
                        }
                        const reader = response.body.getReader();
                        const body = new ReadableStream<Uint8Array>(
                            {
                                async pull(stream) {
                                    try {
                                        const { done, value } = await reader.read();
                                        if (done) {
                                            finish();
                                            stream.close();
                                        } else {
                                            stream.enqueue(value);
                                        }
                                    } catch (error) {
                                        finish();
                                        stream.error(error);
                                    }
                                },
                                async cancel(reason) {
                                    controller.abort(reason);
                                    try {
                                        await reader.cancel(reason);
                                    } finally {
                                        finish();
                                    }
                                },
                            },
                            { highWaterMark: 0 },
                        );
                        return new Response(body, response);
                    } catch (error) {
                        finish();
                        throw error;
                    }
                },
                error(error: Error) {
                    logger.error("request failed", { error: String(error) });
                    return internalErrorResponse();
                },
            });
        } catch (error) {
            // Preserve the bind failure even when cleanup fails or never settles.
            process.exitCode = 1;
            const expired = Promise.withResolvers<void>();
            const deadline = setTimeout(() => {
                logger.error("startup cleanup deadline exceeded");
                expired.resolve();
                setImmediate(() => process.exit(1));
            }, config.shutdownTimeoutMs);
            await Promise.race([closeResources(config.shutdownTimeoutMs), expired.promise]);
            clearTimeout(deadline);
            throw error;
        }
    };

    // Bind one listener; configuration changes require a process restart.
    const server = await bindServer();
    logger.info("listening", {
        host: config.host,
        port: server.port,
        url: `${config.tls === undefined ? "http" : "https"}://${config.host}:${server.port}`,
    });

    // Abort overdue local work before terminating its client connections.
    const forceConnections = (): void => {
        for (const controller of outstanding.values()) {
            controller.abort();
        }
        try {
            void server.stop(true).catch(() => logger.error("connection close failed"));
        } catch {
            logger.error("connection close failed");
        }
    };

    const drain = async (signal: string): Promise<void> => {
        // One referenced timer bounds both HTTP draining and owned resource cleanup.
        const expiresAt = performance.now() + config.shutdownTimeoutMs;
        const expire = (): never => {
            logger.warn("shutdown deadline exceeded", { signal });
            forceConnections();
            void closeResources(0);
            logger.error("forced shutdown", { signal });
            process.exit(1);
        };
        const deadline = setTimeout(expire, config.shutdownTimeoutMs);
        logger.info("shutdown started", { signal });
        try {
            // Keep Bun's normal idle timeout except while this deadline governs requests.
            for (const request of outstanding.keys()) {
                server.timeout(request, 0);
            }
            const acceptedWork = new Promise<void>((resolve) => {
                if (outstanding.size === 0) {
                    resolve();
                } else {
                    requestsDrained = resolve;
                }
            });
            await Promise.all([server.stop(false), acceptedWork]);

            // Give cleanup only the unused portion of the original shutdown budget.
            const closed = await closeResources(Math.max(0, expiresAt - performance.now()));
            if (performance.now() >= expiresAt) {
                expire();
            }
            clearTimeout(deadline);
            if (!closed) {
                process.exit(1);
            }
            logger.info("shutdown complete");
            process.exit(0);
        } catch {
            // A failed drain still releases ownership under the same deadline.
            logger.error("shutdown failed", { signal });
            forceConnections();
            await closeResources(Math.max(0, expiresAt - performance.now()));
            clearTimeout(deadline);
            process.exit(1);
        }
    };

    const shutdown = (signal: string): void => {
        if (draining) {
            return;
        }
        draining = true;
        void drain(signal);
    };

    // SIGHUP never reads configuration or changes resources or listeners.
    process.on("SIGHUP", () => logger.info("restart required", { signal: "SIGHUP" }));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
}
