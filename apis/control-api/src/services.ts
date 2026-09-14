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

/** Resources owned by one active Control API configuration. */
export interface Resources {
    readonly database: DatabaseHandle;
    readonly app: ControlApiApp;
    readonly workflows: WorkflowService;
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
    const options = databaseOptions(config);
    validateDatabaseOptions(options);
    const database = createDatabase(options);
    try {
        const app = await ControlApiApp.create();
        const workflows = WorkflowService.create(database);
        return {
            database,
            app,
            workflows,
            close: (options) => workflows.close(options),
        };
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
