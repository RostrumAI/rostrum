/** @fileoverview Daemon process-liveness service. */

import { Health } from "@rostrum/server/protocol";
import { defineDaemonService } from "../../define";
import { DAEMON_TAG } from "../../tags";

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
        200: { description: "Service is healthy", body: Health },
    },
    handler: (_request, response) => response.json({ status: "ok" as const }),
});
