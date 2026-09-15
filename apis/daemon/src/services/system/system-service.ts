/** @fileoverview Daemon readiness over the database this process owns. */

import type { DatabaseHandle } from "@rostrum/database";
import type { Readiness } from "@rostrum/server/protocol";
import { checkReadiness } from "@rostrum/server/readiness";
import type { DaemonConfig } from "../../config";

/** Dependency readiness for one daemon process. */
export interface SystemService {
    /** Reports readiness for the database this process owns. */
    checkReadiness(signal: AbortSignal): Promise<Readiness>;
}

/** Builds the readiness service over the connection pool the process opened. */
export function createSystemService(config: DaemonConfig, database: DatabaseHandle): SystemService {
    return {
        checkReadiness: (signal) =>
            checkReadiness(
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
                },
                config.dependencyTimeoutMs,
                signal,
            ),
    };
}
