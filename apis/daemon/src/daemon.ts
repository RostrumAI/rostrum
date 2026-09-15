/** @fileoverview Daemon dependency construction, readiness, and process ownership. */

import {
    createDatabase,
    type DatabaseHandle,
    type DatabaseOptions,
    validateDatabaseOptions,
} from "@rostrum/database";
import type { ServerApp } from "@rostrum/server/app";
import type { OpenedService } from "@rostrum/server/lifecycle";
import { authenticate } from "./auth";
import type { DaemonConfig } from "./config";
import { createDaemonApp } from "./http/app";
import { createSystemService, type SystemService } from "./services/system/system-service";

/** The business services a daemon controller reaches through its context. */
export interface DaemonServices {
    /** Readiness over the database this process owns. */
    readonly system: SystemService;
}

/** What a daemon controller may use. */
export interface DaemonContext {
    /** The configuration this process started with. */
    readonly config: DaemonConfig;
    /** The services this process built once at startup and injects per request. */
    readonly services: DaemonServices;
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

/**
 * The daemon process: one configuration, one database handle, and one
 * application. `open` acquires everything the process owns; the runtime
 * closes it once at shutdown.
 */
export class Daemon implements OpenedService<DaemonConfig> {
    private readonly config: DaemonConfig;
    private readonly database: DatabaseHandle;
    private readonly app: ServerApp<DaemonContext>;
    private readonly services: DaemonServices;

    private constructor(
        config: DaemonConfig,
        database: DatabaseHandle,
        app: ServerApp<DaemonContext>,
        services: DaemonServices,
    ) {
        this.config = config;
        this.database = database;
        this.app = app;
        this.services = services;
    }

    /** Opens the daemon's database and builds its application from one configuration. */
    static async open(config: DaemonConfig): Promise<Daemon> {
        const options = databaseOptions(config);
        validateDatabaseOptions(options);
        const database = createDatabase(options);
        try {
            // Every service borrows this process's handle; none of them closes it.
            return new Daemon(config, database, createDaemonApp(), {
                system: createSystemService(config, database),
            });
        } catch (error) {
            // A failure after the pool opened must not leak it.
            await database.close({ timeoutMs: config.shutdownTimeoutMs });
            throw error;
        }
    }

    /** Serves one admitted request with this process's configuration and services. */
    fetch(request: Request, signal: AbortSignal): Response | Promise<Response> {
        return this.app.fetch(request, {
            config: this.config,
            services: this.services,
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
