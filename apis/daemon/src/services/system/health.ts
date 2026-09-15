/** @fileoverview Daemon process-liveness service. */

import { HealthSchema } from "@rostrum/server/protocol";
import { createServiceBuilder } from "@rostrum/server/service";
import type { DaemonContext } from "../../daemon";
import { DAEMON_TAG } from "../../tags";

/** Declares the daemon's services against the daemon's own context and tags. */
const defineDaemonService = createServiceBuilder<
    DaemonContext,
    (typeof DAEMON_TAG)[keyof typeof DAEMON_TAG]
>();

/** Serves GET /api/system/health without touching a dependency. */
export const health = defineDaemonService({
    method: "GET",
    path: "/api/system/health",
    request: {},
    openapi: {
        operationId: "getDaemonHealth",
        summary: "Report process liveness",
        tags: [DAEMON_TAG.SYSTEM],
    },
    responses: {
        200: { description: "Service is healthy", body: HealthSchema },
    },
    schemas: { Health: HealthSchema },
    handler: (_request, response) => response.json({ status: "ok" as const }),
});
