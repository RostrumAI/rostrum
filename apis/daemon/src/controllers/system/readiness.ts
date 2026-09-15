/** @fileoverview Daemon dependency-readiness controller. */

import { DaemonReadiness } from "@rostrum/server/protocol";
import { defineDaemonController } from "../../http/define";
import { DAEMON_TAG } from "../../http/tags";

/**
 * Serves GET /api/system/readiness: the readiness service's check of the
 * database this process owns, under the request's deadline.
 */
export const readiness = defineDaemonController({
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
        const result = await context.services.system.checkReadiness(context.abortSignal);
        return response.json(result, result.status === "ready" ? 200 : 503);
    },
});
