/** @fileoverview Daemon dependency construction and readiness checks. */

import {
    createDatabase,
    type DatabaseHandle,
    type DatabaseOptions,
    validateDatabaseOptions,
} from "@rostrum/database";
import type { DaemonConfig } from "@rostrum/server/config";
import type { Readiness } from "@rostrum/server/protocol";
import { checkReadiness } from "@rostrum/server/readiness";
import type { Context } from "hono";
import { DaemonApp } from "./app";

/** Resources available to an authenticated daemon request. */
export interface Services {
    database: DatabaseHandle;
    config: DaemonConfig;
    abortSignal: AbortSignal;
}

/** Resolves services attached to the current Hono request. */
export type ServiceAccessor = (context: Context<{ Bindings: Services }>) => Services;

/** Configuration and resources owned for the daemon's process lifetime. */
export interface Resources {
    /** Validated settings retained until the process exits. */
    readonly config: DaemonConfig;
    /** The database connection owned by this daemon. */
    readonly database: DatabaseHandle;
    /** Routes constructed once without acquiring their own resources. */
    readonly app: DaemonApp;
    /** Serves an admitted request with this process's settings and resources. */
    fetch(request: Request, abortSignal: AbortSignal): Response | Promise<Response>;
    /** Releases this daemon's connection within the remaining shutdown time. */
    close(options: { timeoutMs: number }): Promise<void>;
}

/** Converts validated daemon configuration into database connection policy. */
function databaseOptions(config: DaemonConfig): DatabaseOptions {
    return {
        url: config.databaseUrl,
        tls: config.databaseTls,
        allowInsecureLocal: config.allowInsecureLocal,
        nodeEnv: config.nodeEnv,
        applicationName: "daemon",
        connectTimeoutMs: config.dependencyTimeoutMs,
    };
}

/** Creates the daemon application and database handle. */
export async function createResources(config: DaemonConfig): Promise<Resources> {
    // Reject invalid connection policy before opening the daemon's resources.
    const options = databaseOptions(config);
    validateDatabaseOptions(options);
    const database = createDatabase(options);

    // Keep every request on the configuration that opened this connection.
    try {
        const app = await DaemonApp.create();
        return {
            config,
            database,
            app,
            fetch: (request, abortSignal) => app.fetch(request, { database, config, abortSignal }),
            close: (options) => database.close(options),
        };
    } catch (error) {
        await database.close({ timeoutMs: config.shutdownTimeoutMs });
        throw error;
    }
}

/** Checks whether the daemon database is ready within the configured deadline. */
export function readiness(
    config: DaemonConfig,
    resources: Pick<Resources, "database">,
    signal: AbortSignal,
): Promise<Readiness> {
    return checkReadiness(
        {
            database: {
                check: (probeSignal) =>
                    resources.database.probe({
                        signal: probeSignal,
                        timeoutMs: config.dependencyTimeoutMs,
                    }),
                timeoutCode: "database_timeout",
                failureCode: "database_unavailable",
            },
        },
        config.dependencyTimeoutMs,
        signal,
    );
}
