/** @fileoverview Daemon dependency construction, readiness, and process ownership. */

import {
    createDatabase,
    type DatabaseHandle,
    type DatabaseOptions,
    validateDatabaseOptions,
} from "@rostrum/database";
import type { OpenedService } from "@rostrum/server/lifecycle";
import type { Readiness } from "@rostrum/server/protocol";
import { checkReadiness } from "@rostrum/server/readiness";
import { createDaemonApp } from "./app";
import { authenticate } from "./auth";
import type { DaemonConfig } from "./config";

/** What a daemon request handler may use. */
export interface DaemonContext {
    /** The configuration this process started with. */
    readonly config: DaemonConfig;
    /** The database handle this process owns. */
    readonly database: DatabaseHandle;
    /** Aborted when this request is no longer worth finishing. */
    readonly abortSignal: AbortSignal;
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

/** Checks whether the daemon's database is ready within the configured deadline. */
export function checkDaemonReadiness(
    config: DaemonConfig,
    database: DatabaseHandle,
    signal: AbortSignal,
): Promise<Readiness> {
    return checkReadiness(
        {
            database: {
                check: (probeSignal) =>
                    database.probe({ signal: probeSignal, timeoutMs: config.dependencyTimeoutMs }),
                timeoutCode: "database_timeout",
                failureCode: "database_unavailable",
            },
        },
        config.dependencyTimeoutMs,
        signal,
    );
}

/**
 * The daemon process: one configuration, one database handle, and one
 * application. `open` acquires everything the process owns; the runtime
 * closes it once at shutdown.
 */
export class Daemon implements OpenedService<DaemonConfig> {
    private readonly config: DaemonConfig;
    private readonly database: DatabaseHandle;
    private readonly app: ReturnType<typeof createDaemonApp>;

    private constructor(
        config: DaemonConfig,
        database: DatabaseHandle,
        app: ReturnType<typeof createDaemonApp>,
    ) {
        this.config = config;
        this.database = database;
        this.app = app;
    }

    /** Opens the daemon's database and builds its application from one configuration. */
    static async open(config: DaemonConfig): Promise<Daemon> {
        const options = databaseOptions(config);
        validateDatabaseOptions(options);
        const database = createDatabase(options);
        try {
            return new Daemon(config, database, createDaemonApp());
        } catch (error) {
            // A failure after the pool opened must not leak it.
            await database.close({ timeoutMs: config.shutdownTimeoutMs });
            throw error;
        }
    }

    /** Serves one admitted request with this process's configuration and database. */
    fetch(request: Request, signal: AbortSignal): Response | Promise<Response> {
        return this.app.fetch(request, {
            config: this.config,
            database: this.database,
            abortSignal: signal,
        });
    }

    /** Rejects an unauthenticated request before the runtime admits it. */
    authenticate(request: Request, config: DaemonConfig): Response | undefined {
        return authenticate(request, config);
    }

    /** Releases the owned database handle within the remaining shutdown time. */
    close(options: { timeoutMs: number }): Promise<void> {
        return this.database.close(options);
    }
}
