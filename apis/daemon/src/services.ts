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

/** Dependencies available to an authenticated daemon request. */
export interface Services {
    database: DatabaseHandle;
    config: DaemonConfig;
    signal: AbortSignal;
}

/** Resolves services attached to the current Hono request. */
export type ServiceAccessor = (context: Context<{ Bindings: Services }>) => Services;

/** Resources owned by one active daemon configuration. */
export interface Dependencies {
    database: DatabaseHandle;
    app: DaemonApp;
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
export async function createDependencies(config: DaemonConfig): Promise<Dependencies> {
    const options = databaseOptions(config);
    validateDatabaseOptions(options);
    const database = createDatabase(options);
    try {
        const app = await DaemonApp.create();
        return { database, app, close: (options) => database.close(options) };
    } catch (error) {
        await database.close({ timeoutMs: config.shutdownTimeoutMs });
        throw error;
    }
}

/** Checks whether the daemon database is ready within the configured deadline. */
export function readiness(
    config: DaemonConfig,
    dependencies: Pick<Dependencies, "database">,
    signal: AbortSignal,
): Promise<Readiness> {
    return checkReadiness(
        {
            database: {
                check: (probeSignal) =>
                    dependencies.database.probe({
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
