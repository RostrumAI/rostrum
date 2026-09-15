/** @fileoverview Daemon dependency-readiness service. */

import { DaemonReadiness } from "@rostrum/server/protocol";
import { checkDaemonReadiness } from "../../daemon";
import { defineDaemonService } from "../../define";
import { DAEMON_TAG } from "../../tags";

/**
 * Serves GET /api/system/readiness: the daemon's own database, checked under
 * this process's configuration and the request's deadline.
 */
export const readiness = defineDaemonService({
    method: "GET",
    path: "/api/system/readiness",
    request: {},
    openapi: {
        operationId: "getDaemonReadiness",
        summary: "Report dependency readiness",
        tags: [DAEMON_TAG.SYSTEM],
    },
    responses: {
        200: { description: "Dependencies are ready", body: DaemonReadiness },
        503: { description: "Dependencies are unavailable", body: DaemonReadiness },
    },
    handler: async (_request, response, context) => {
        const result = await checkDaemonReadiness(
            context.config,
            context.database,
            context.abortSignal,
        );
        return response.json(result, result.status === "ready" ? 200 : 503);
    },
});
