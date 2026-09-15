/** @fileoverview Control API dependency construction and readiness checks. */

import {
    createDatabase,
    type DatabaseHandle,
    type DatabaseOptions,
    validateDatabaseOptions,
} from "@rostrum/database";
import type { ControlApiConfig } from "@rostrum/server/config";
import type { Readiness } from "@rostrum/server/protocol";
import { checkReadiness } from "@rostrum/server/readiness";
import type { Context } from "hono";
import { ControlApiApp } from "./app";
import { checkDaemonReadiness } from "./daemon/client";
import { WorkflowService } from "./workflows/service";

/** Resources available to a Control API request. */
export interface Services {
    readonly workflows: WorkflowService;
    /** Aggregated dependency readiness within its deadline. */
    readonly readiness: (signal: AbortSignal) => Promise<Readiness>;
}

/** Resolves the services attached to the current Hono request. */
export type ServiceAccessor = (context: Context<{ Bindings: Services }>) => Services;

/** Configuration and resources owned for the Control API's process lifetime. */
export interface Resources {
    /** Validated settings retained until the process exits. */
    readonly config: ControlApiConfig;
    /** The database connection owned by this Control API. */
    readonly database: DatabaseHandle;
    /** Routes constructed once without acquiring their own resources. */
    readonly app: ControlApiApp;
    /** Workflow operations sharing the owned database connection. */
    readonly workflows: WorkflowService;
    /** Serves an admitted request with this process's settings and resources. */
    fetch(request: Request, abortSignal: AbortSignal): Response | Promise<Response>;
    /** Releases the owned connection within the remaining shutdown time. */
    close(options: { timeoutMs: number }): Promise<void>;
}

/** Converts validated service configuration into database connection policy. */
function databaseOptions(config: ControlApiConfig): DatabaseOptions {
    return {
        url: config.databaseUrl,
        tls: config.databaseTls,
        allowInsecureLocal: config.allowInsecureLocal,
        nodeEnv: config.nodeEnv,
        applicationName: "control-api",
        connectTimeoutMs: config.dependencyTimeoutMs,
    };
}

/** Creates the application and its database-backed workflow service. */
export async function createResources(config: ControlApiConfig): Promise<Resources> {
    // Reject invalid connection policy before opening the Control API's resources.
    const options = databaseOptions(config);
    validateDatabaseOptions(options);
    const database = createDatabase(options);

    // Keep workflow requests and readiness on the connection opened at startup.
    try {
        const app = await ControlApiApp.create();
        const workflows = WorkflowService.create(database);
        const resources: Resources = {
            config,
            database,
            app,
            workflows,
            fetch: (request, abortSignal) =>
                app.fetch(request, {
                    workflows,
                    readiness: (signal) =>
                        readiness(config, resources, AbortSignal.any([abortSignal, signal])),
                }),
            close: (options) => workflows.close(options),
        };
        return resources;
    } catch (error) {
        await database.close({ timeoutMs: config.shutdownTimeoutMs });
        throw error;
    }
}

/**
 * Aggregates this service's readiness: its own database and the
 * authenticated daemon. Both run concurrently under one deadline, and the
 * first failure returns without waiting for the sibling's timeout.
 */
export function readiness(
    config: ControlApiConfig,
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
