/** @fileoverview Daemon process-liveness controller. */

import { Health } from "@rostrum/server/protocol";
import { defineDaemonController } from "../../http/define";
import { DAEMON_TAG } from "../../http/tags";

/** Serves GET /api/system/health without touching a dependency. */
export const health = defineDaemonController({
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
