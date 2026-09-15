/** @fileoverview Control API readiness over its own database and the authenticated daemon. */

import type { DatabaseHandle } from "@rostrum/database";
import type { Readiness } from "@rostrum/server/protocol";
import { checkReadiness } from "@rostrum/server/readiness";
import type { ControlApiConfig } from "../../config";
import { checkDaemonReadiness } from "../../daemon/client";

/** Aggregated dependency readiness for one Control API process. */
export interface SystemService {
    /** Reports readiness for this process's database and the daemon it calls. */
    checkReadiness(signal: AbortSignal): Promise<Readiness>;
}

/**
 * Builds the readiness service over the connection pool the process owns and
 * the configured daemon. Both probes run concurrently under one deadline, and
 * the first failure returns without waiting for the sibling's timeout.
 */
export function createSystemService(
    config: ControlApiConfig,
    database: DatabaseHandle,
): SystemService {
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
                    daemon: {
                        check: (probeSignal) => checkDaemonReadiness(config, probeSignal),
                        timeoutCode: "daemon_timeout",
                        failureCode: "daemon_unavailable",
                    },
                },
                config.dependencyTimeoutMs,
                signal,
            ),
    };
}
