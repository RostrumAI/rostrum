/** @fileoverview Control API dependency-readiness controller. */

import { ControlApiReadiness } from "@rostrum/server/protocol";
import { defineControlController } from "../../http/define";
import { CONTROL_API_TAG } from "../../http/tags";

/**
 * Serves GET /api/system/readiness: the readiness service's aggregate over this
 * process's own database and the authenticated daemon. A daemon outage leaves
 * authoring operations available while this route reports not ready.
 */
export const readiness = defineControlController({
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
        const result = await context.services.system.checkReadiness(context.abortSignal);
        return response.json(result, result.status === "ready" ? 200 : 503, {
            "cache-control": "no-store",
        });
    },
});
