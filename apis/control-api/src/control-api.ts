/** @fileoverview Control API process ownership, dependency construction, and readiness. */

import { createDatabase, type DatabaseHandle, validateDatabaseOptions } from "@rostrum/database";
import type { ServerApp } from "@rostrum/server/app";
import type { OpenedService } from "@rostrum/server/lifecycle";
import type { Readiness } from "@rostrum/server/protocol";
import { checkReadiness } from "@rostrum/server/readiness";
import { createControlApiApp } from "./app";
import type { ControlApiConfig } from "./config";
import { checkDaemonReadiness } from "./daemon/client";
import { WorkflowService } from "./workflows/service";

/** What a Control API request handler may use. */
export interface ControlApiContext {
    /** The configuration this process started with. */
    readonly config: ControlApiConfig;
    /** The database handle this process owns. */
    readonly database: DatabaseHandle;
    /** Workflow operations sharing the owned database connection. */
    readonly workflows: WorkflowService;
    /** Aggregated dependency readiness within its deadline. */
    readonly readiness: (signal: AbortSignal) => Promise<Readiness>;
    /** Aborted when this request is no longer worth finishing. */
    readonly abortSignal: AbortSignal;
}

/**
 * Aggregates this service's readiness: its own database and the
 * authenticated daemon. Both run concurrently under one deadline, and the
 * first failure returns without waiting for the sibling's timeout.
 */
export function checkControlApiReadiness(
    config: ControlApiConfig,
    database: DatabaseHandle,
    signal: AbortSignal,
): Promise<Readiness> {
    return checkReadiness(
        {
            database: {
                check: (probeSignal) =>
                    database.probe({
                        signal: probeSignal,
                        timeoutMs: config.dependencyTimeoutMs,
                    }),
                timeoutCode: "database_timeout",
                failureCode: "database_unavailable",
            },
            daemon: {
                check: (probeSignal) => checkDaemonReadiness(config, probeSignal),
                timeoutCode: "daemon_timeout",
                failureCode: "daemon_unavailable",
            },
        },
        config.dependencyTimeoutMs,
        signal,
    );
}

/**
 * The Control API process: one configuration, one database handle, and one
 * application. `open` acquires everything the process owns; the runtime
 * closes it once at shutdown.
 */
export class ControlApi implements OpenedService<ControlApiConfig> {
    private readonly config: ControlApiConfig;
    private readonly database: DatabaseHandle;
    private readonly app: ServerApp<ControlApiContext>;
    private readonly workflows: WorkflowService;

    private constructor(
        config: ControlApiConfig,
        database: DatabaseHandle,
        app: ServerApp<ControlApiContext>,
        workflows: WorkflowService,
    ) {
        this.config = config;
        this.database = database;
        this.app = app;
        this.workflows = workflows;
    }

    /** Opens the Control API's database and builds its application from one configuration. */
    static async open(config: ControlApiConfig): Promise<ControlApi> {
        // Reject invalid connection policy before opening the Control API's resources.
        const options = {
            url: config.databaseUrl,
            tls: config.databaseTls,
            allowInsecureLocal: config.allowInsecureLocal,
            nodeEnv: config.nodeEnv,
            applicationName: "control-api",
            connectTimeoutMs: config.dependencyTimeoutMs,
        };
        validateDatabaseOptions(options);
        const database = createDatabase(options);
        try {
            return new ControlApi(
                config,
                database,
                createControlApiApp(),
                WorkflowService.create(database),
            );
        } catch (error) {
            // A failure after the pool opened must not leak it.
            await database.close({ timeoutMs: config.shutdownTimeoutMs });
            throw error;
        }
    }

    /**
     * Serves one admitted request with this process's configuration and
     * resources. Readiness runs on the caller's signal, so a request that is
     * no longer worth finishing also ends the probes it started.
     */
    fetch(request: Request, signal: AbortSignal): Response | Promise<Response> {
        return this.app.fetch(request, {
            config: this.config,
            database: this.database,
            workflows: this.workflows,
            readiness: (probeSignal) =>
                checkControlApiReadiness(
                    this.config,
                    this.database,
                    AbortSignal.any([signal, probeSignal]),
                ),
            abortSignal: signal,
        });
    }

    /** Releases the owned database handle within the remaining shutdown time. */
    close(options: { timeoutMs: number }): Promise<void> {
        return this.workflows.close(options);
    }
}
