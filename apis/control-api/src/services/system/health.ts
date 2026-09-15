/** @fileoverview Control API process-liveness service. */

import { HealthSchema } from "@rostrum/server/protocol";
import { defineControlService } from "../../define";
import { CONTROL_API_TAG } from "../../tags";

/**
 * Serves GET /api/system/health. Lets load balancers, orchestrators, and the
 * integration harness confirm the process is up and serving requests, so it
 * answers a liveness token without touching a dependency that could fail
 * independently.
 */
export const health = defineControlService({
    method: "GET",
    path: "/api/system/health",
    request: {},
    openapi: {
        operationId: "getControlApiHealth",
        summary: "Report process liveness",
        tags: [CONTROL_API_TAG.SYSTEM],
    },
    responses: {
        200: { description: "Service is healthy", body: HealthSchema },
    },
    schemas: { Health: HealthSchema },
    handler: (_request, response) => response.json({ status: "ok" as const }),
});
