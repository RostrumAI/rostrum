/** @fileoverview Daemon dependency-readiness service. */

import { DaemonReadinessSchema } from "@rostrum/server/protocol";
import { createServiceBuilder } from "@rostrum/server/service";
import { checkDaemonReadiness, type DaemonContext } from "../../daemon";
import { DAEMON_TAG } from "../../tags";

/** Declares the daemon's services against the daemon's own context and tags. */
const defineDaemonService = createServiceBuilder<
    DaemonContext,
    (typeof DAEMON_TAG)[keyof typeof DAEMON_TAG]
>();

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
        200: { description: "Dependencies are ready", body: DaemonReadinessSchema },
        503: { description: "Dependencies are unavailable", body: DaemonReadinessSchema },
    },
    schemas: { DaemonReadiness: DaemonReadinessSchema },
    handler: async (_request, response, context) => {
        const result = await checkDaemonReadiness(
            context.config,
            context.database,
            context.abortSignal,
        );
        return response.json(result, result.status === "ready" ? 200 : 503);
    },
});
