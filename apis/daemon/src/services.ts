import { createDatabase, type DatabaseHandle } from "@rostrum/database";
import type { DaemonConfig } from "@rostrum/server/config";
import type { Readiness } from "@rostrum/server/protocol";
import { checkReadiness } from "@rostrum/server/readiness";
import type { Context } from "hono";
import { DaemonApp } from "./app";
import { databaseOptions } from "./env";

/** A request borrows the pool and retains its admitted configuration and cancellation signal. */
export interface Services {
    database: DatabaseHandle;
    config: DaemonConfig;
    signal: AbortSignal;
}

export type ServiceAccessor = (context: Context) => Services;

export interface Dependencies {
    database: DatabaseHandle;
    app: DaemonApp;
    close(options: { timeoutMs: number }): Promise<void>;
}

export async function createDependencies(config: DaemonConfig): Promise<Dependencies> {
    const database = createDatabase(databaseOptions(config));
    try {
        const app = await DaemonApp.create();
        return { database, app, close: (options) => database.close(options) };
    } catch (error) {
        await database.close({ timeoutMs: config.shutdownTimeoutMs });
        throw error;
    }
}

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
