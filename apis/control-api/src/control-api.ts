/** @fileoverview Control API process ownership, dependency construction, and readiness. */

import { createDatabase, type DatabaseHandle, validateDatabaseOptions } from "@rostrum/database";
import type { ServerApp } from "@rostrum/server/app";
import type { OpenedService } from "@rostrum/server/lifecycle";
import type { ControlApiConfig } from "./config";
import { createControlApiApp } from "./http/app";
import { createSystemService, type SystemService } from "./services/system/system-service";
import { WorkflowService } from "./services/workflows/workflow-service";

/** The business services a Control API controller reaches through its context. */
export interface ControlApiServices {
    /** Workflow authoring and publication operations. */
    readonly workflows: WorkflowService;
    /** Readiness over this process's database and the daemon it calls. */
    readonly system: SystemService;
}

/** What a Control API controller may use. */
export interface ControlApiContext {
    /** The configuration this process started with. */
    readonly config: ControlApiConfig;
    /** The services this process built once at startup and injects per request. */
    readonly services: ControlApiServices;
    /** Aborted when this request is no longer worth finishing. */
    readonly abortSignal: AbortSignal;
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
    private readonly services: ControlApiServices;

    private constructor(
        config: ControlApiConfig,
        database: DatabaseHandle,
        app: ServerApp<ControlApiContext>,
        services: ControlApiServices,
    ) {
        this.config = config;
        this.database = database;
        this.app = app;
        this.services = services;
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
            // Every service borrows this process's handle; none of them closes it.
            return new ControlApi(config, database, createControlApiApp(), {
                workflows: WorkflowService.create(database),
                system: createSystemService(config, database),
            });
        } catch (error) {
            // A failure after the pool opened must not leak it.
            await database.close({ timeoutMs: config.shutdownTimeoutMs });
            throw error;
        }
    }

    /**
     * Serves one admitted request with this process's configuration, services,
     * and database. Readiness runs on the caller's signal, so a request that is
     * no longer worth finishing also ends the probes it started.
     */
    fetch(request: Request, signal: AbortSignal): Response | Promise<Response> {
        return this.app.fetch(request, {
            config: this.config,
            services: this.services,
            abortSignal: signal,
        });
    }

    /** Releases the owned database handle within the remaining shutdown time. */
    close(options: { timeoutMs: number }): Promise<void> {
        return this.database.close(options);
    }
}
