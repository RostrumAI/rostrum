/** @fileoverview Shared service startup, reload, and shutdown runtime. */

import { getLogger, type LogLevel } from "@logtape/logtape";
import { configureLogging } from "./logger";
import { ConfigurationError } from "./network";

/** The service a runtime hosts; selects the log category. */
export type ServiceName = "control-api" | "daemon";

/**
 * Configuration a running service needs, independent of where it came from.
 * Both service configs satisfy this shape; these are exactly the fields a
 * reload can change without restarting the process.
 */
export interface RuntimeConfig {
    readonly host: string;
    readonly port: number;
    readonly logLevel: LogLevel;
    readonly nodeEnv: "development" | "test" | "production";
    readonly databaseUrl: string;
    readonly databaseTls: boolean;
    readonly allowInsecureLocal: boolean;
    readonly dependencyTimeoutMs: number;
    readonly shutdownTimeoutMs: number;
    /** Present when the listener serves TLS directly (direct mode only). */
    readonly tls?: { readonly cert: string; readonly key: string };
}

/**
 * Resources owned by one active configuration. The runtime closes them on
 * shutdown or after a successful reload.
 */
export interface ServiceDependencies {
    /** Releases every owned resource within `timeoutMs`; safe to call once. */
    close(options: { timeoutMs: number }): Promise<void>;
}

/** Inputs the shared runtime needs from one executable service. */
export interface RunServiceOptions<C extends RuntimeConfig, D extends ServiceDependencies> {
    readonly name: ServiceName;
    /**
     * Validates a complete candidate from the startup sources. Called at boot
     * and on SIGHUP; a rejected reload leaves the current configuration active.
     */
    loadConfig(): C;
    /** Acquires resources owned by one active configuration. */
    createDependencies(config: C): Promise<D>;
    /** Serves a request with the configuration and dependencies active at admission. */
    fetch(
        request: Request,
        config: C,
        dependencies: D,
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

/** Database-settings identity: only these changes rebuild dependencies. */
const dependencyIdentity = (config: RuntimeConfig): string =>
    JSON.stringify([
        config.databaseUrl,
        config.databaseTls,
        config.allowInsecureLocal,
        config.nodeEnv,
        config.dependencyTimeoutMs,
    ]);

/** Listener identity: only these changes replace the bound listener. */
const listenerIdentity = (config: RuntimeConfig): string =>
    JSON.stringify([config.host, config.port, config.tls?.cert, config.tls?.key]);

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

/**
 * Runs one service process with authenticated admission, reload, and bounded
 * shutdown.
 */
export async function runService<C extends RuntimeConfig, D extends ServiceDependencies>(
    options: RunServiceOptions<C, D>,
): Promise<void> {
    const logger = getLogger(options.name);
    // Invalid configuration must fail before any service resource is acquired.
    let liveConfig = options.loadConfig();
    await configureLogging(liveConfig.logLevel);
    let liveDependencies = await options.createDependencies(liveConfig);
    let liveIdentity = dependencyIdentity(liveConfig);
    let liveListenerIdentity = listenerIdentity(liveConfig);

    /** Active requests and their deadline controllers. */
    const outstanding = new Map<Request, AbortController>();
    let draining = false;
    let reloadInFlight: Promise<void> | undefined;
    let shutdownInFlight: Promise<void> | undefined;

    const buildServer = (config: C): BoundServer =>
        Bun.serve({
            hostname: config.host,
            port: config.port,
            ...(config.tls === undefined
                ? {}
                : { tls: { cert: config.tls.cert, key: config.tls.key } }),
            fetch: async (request: Request) => {
                const config = liveConfig;
                const dependencies = liveDependencies;
                // Authentication precedes the draining gate and everything else.
                const rejection = options.authenticate?.(request, config);
                if (rejection !== undefined) {
                    return rejection;
                }
                if (draining) {
                    return drainingResponse();
                }
                const controller = new AbortController();
                outstanding.set(request, controller);
                try {
                    return await options.fetch(request, config, dependencies, controller.signal);
                } finally {
                    outstanding.delete(request);
                }
            },
            error(error: Error) {
                logger.error("request failed", { error: String(error) });
                return internalErrorResponse();
            },
        });

    let server = buildServer(liveConfig);
    logger.info("listening", {
        host: liveConfig.host,
        port: server.port,
        url: `${liveConfig.tls === undefined ? "http" : "https"}://${liveConfig.host}:${server.port}`,
    });

    const retire = async (dependencies: D, timeoutMs: number): Promise<void> => {
        try {
            await dependencies.close({ timeoutMs });
        } catch (error) {
            logger.warn("retired resource close failed", { error: String(error) });
        }
    };

    const applyReload = async (): Promise<void> => {
        let candidate: C;
        try {
            candidate = options.loadConfig();
        } catch (error) {
            logger.warn("reload rejected", {
                reason: error instanceof ConfigurationError ? error.message : "invalid candidate",
            });
            return;
        }
        if (draining) {
            logger.warn("reload rejected", { reason: "service is draining" });
            return;
        }

        const candidateDependencyIdentity = dependencyIdentity(candidate);
        const candidateListenerIdentity = listenerIdentity(candidate);
        let nextDependencies = liveDependencies;
        let nextIdentity = liveIdentity;
        let retired: D | undefined;
        if (candidateDependencyIdentity !== liveIdentity) {
            try {
                nextDependencies = await options.createDependencies(candidate);
                nextIdentity = candidateDependencyIdentity;
                retired = liveDependencies;
            } catch {
                logger.warn("reload rejected", { reason: "dependency replacement failed" });
                return;
            }
        }

        // Shutdown takes priority: never reopen a draining service.
        if (draining) {
            if (retired !== undefined) {
                await retire(nextDependencies, candidate.shutdownTimeoutMs);
            }
            logger.warn("reload rejected", { reason: "service is draining" });
            return;
        }

        const listenerChanged = candidateListenerIdentity !== liveListenerIdentity;
        if (listenerChanged) {
            const previousServer = server;
            const sameAddress =
                candidate.host === liveConfig.host && candidate.port === liveConfig.port;
            if (sameAddress) {
                // A same-address bind cannot coexist with the live listener:
                // stop admission, drain under the old deadline, then rebind.
                await Promise.race([
                    previousServer.stop(false),
                    Bun.sleep(liveConfig.shutdownTimeoutMs).then(() => previousServer.stop(true)),
                ]);
                // Shutdown may have started while the old listener drained.
                // Never reopen after shutdown begins.
                if (draining) {
                    if (retired !== undefined) {
                        await retire(nextDependencies, candidate.shutdownTimeoutMs);
                    }
                    logger.warn("reload rejected", { reason: "service is draining" });
                    return;
                }
            }
            let rebound: BoundServer;
            try {
                rebound = buildServer(candidate);
            } catch {
                logger.error("listener replacement failed");
                if (!sameAddress) {
                    // The original listener is still serving; retaining it is
                    // the restoration for a failed different-address candidate.
                    if (retired !== undefined) {
                        await retire(nextDependencies, candidate.shutdownTimeoutMs);
                    }
                    return;
                }
                // The previous listener was released for the same address, so it
                // must be re-created; failing that, exit rather than claim a
                // working listener.
                try {
                    server = buildServer(liveConfig);
                } catch {
                    logger.fatal("listener restoration failed");
                    process.exit(1);
                }
                if (retired !== undefined) {
                    await retire(nextDependencies, candidate.shutdownTimeoutMs);
                }
                return;
            }
            if (!sameAddress) {
                await previousServer.stop(true);
            }
            server = rebound;
        }

        liveConfig = candidate;
        liveDependencies = nextDependencies;
        liveIdentity = nextIdentity;
        liveListenerIdentity = candidateListenerIdentity;
        await configureLogging(candidate.logLevel);
        logger.info("reload applied", {
            listener: listenerChanged,
            dependencies: retired !== undefined,
        });
        if (retired !== undefined) {
            await retire(retired, candidate.shutdownTimeoutMs);
        }
    };

    const requestReload = (): void => {
        // Serialize and coalesce: a reload already in flight absorbs the signal.
        if (reloadInFlight !== undefined) {
            return;
        }
        reloadInFlight = applyReload().finally(() => {
            reloadInFlight = undefined;
        });
    };

    const drain = async (signal: string): Promise<void> => {
        logger.info("shutdown started", { signal });
        const deadlineMs = liveConfig.shutdownTimeoutMs;
        const started = Date.now();
        // Disable Bun's idle timeout while the shutdown deadline governs requests.
        for (const request of outstanding.keys()) {
            server.timeout(request, 0);
        }
        const completed = await Promise.race([
            server.stop(false).then(() => true),
            Bun.sleep(deadlineMs).then(() => false),
        ]);
        if (!completed) {
            logger.warn("shutdown deadline exceeded", { signal });
            // Abort local operations before force-closing connections.
            for (const controller of outstanding.values()) {
                controller.abort();
            }
            const forced = setTimeout(() => {
                logger.error("forced shutdown", { signal });
                process.exit(1);
            }, deadlineMs);
            server.stop(true);
            await retire(liveDependencies, 0);
            clearTimeout(forced);
            process.exit(1);
        }
        await retire(liveDependencies, Math.max(0, deadlineMs - (Date.now() - started)));
        logger.info("shutdown complete");
        process.exit(0);
    };

    const shutdown = (signal: string): void => {
        // Repeated signals must not close resources twice or extend the deadline.
        if (shutdownInFlight !== undefined) {
            return;
        }
        draining = true;
        shutdownInFlight = drain(signal);
    };

    process.on("SIGHUP", requestReload);
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
}
