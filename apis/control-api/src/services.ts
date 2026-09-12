import { createDatabase, type DatabaseHandle } from "@rostrum/database";
import type { ControlApiConfig } from "@rostrum/server/config";
import type { Readiness } from "@rostrum/server/protocol";
import { checkReadiness } from "@rostrum/server/readiness";
import { ControlApiApp } from "./app";
import { checkDaemonReadiness } from "./daemon/client";
import { databaseOptions } from "./env";
import { WorkflowService } from "./workflows/service";

/**
 * What a feature handler may borrow while serving one request. The runtime
 * resolves it from the snapshot the request was admitted with, so a
 * configuration reload never changes services under an admitted request.
 */
export interface Services {
    readonly workflows: WorkflowService;
    /** Aggregated dependency readiness for this snapshot, within its deadline. */
    readonly readiness: (signal: AbortSignal) => Promise<Readiness>;
}

/** The resources one configuration snapshot owns. */
export interface Dependencies {
    readonly database: DatabaseHandle;
    readonly app: ControlApiApp;
    /** Bound to this snapshot's pool; readiness is resolved per request instead. */
    readonly workflows: WorkflowService;
    close(options: { timeoutMs: number }): Promise<void>;
}

export async function createDependencies(config: ControlApiConfig): Promise<Dependencies> {
    const database = createDatabase(databaseOptions(config));
    try {
        const app = await ControlApiApp.create();
        return {
            database,
            app,
            workflows: WorkflowService.create(database),
            close: (options) => database.close(options),
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
