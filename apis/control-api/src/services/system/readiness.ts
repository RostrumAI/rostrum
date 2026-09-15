/** @fileoverview Control API dependency-readiness service. */

import { ControlApiReadiness } from "@rostrum/server/protocol";
import { defineControlService } from "../../define";
import { CONTROL_API_TAG } from "../../tags";

/**
 * Serves GET /api/system/readiness. Readiness aggregates this service's own
 * database and the authenticated daemon; a daemon outage leaves authoring
 * operations available while this route reports not ready.
 */
export const readiness = defineControlService({
    method: "GET",
    path: "/api/system/readiness",
    request: {},
    openapi: {
        operationId: "getControlApiReadiness",
        summary: "Report dependency readiness",
        tags: [CONTROL_API_TAG.SYSTEM],
    },
    responses: {
        200: { description: "Every dependency is ready", body: ControlApiReadiness },
        503: {
            description: "At least one dependency is unavailable or not ready",
            body: ControlApiReadiness,
        },
    },
    handler: async (_request, response, context) => {
        const result = await context.readiness(context.abortSignal);
        return response.json(result, result.status === "ready" ? 200 : 503, {
            "cache-control": "no-store",
        });
    },
});
