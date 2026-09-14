/** @fileoverview Daemon dependency-readiness feature slice. */

import type { FeatureHandlerFactory, FeatureRoute, FeatureSchemas } from "@rostrum/server/loader";
import { DaemonReadinessSchema } from "@rostrum/server/protocol";
import { readiness, type ServiceAccessor } from "../../services";

/** Route binding for the daemon readiness check. */
export const route: FeatureRoute = {
    method: "GET",
    path: "/readiness",
    responses: {
        "200": { description: "Dependencies are ready", schemaName: "DaemonReadiness" },
        "503": { description: "Dependencies are unavailable", schemaName: "DaemonReadiness" },
    },
};

/** OpenAPI components contributed by this slice. */
export const schema: FeatureSchemas = { DaemonReadiness: DaemonReadinessSchema };

/**
 * Serves GET /readiness: the daemon's own database checked under the
 * request's admitted configuration and deadline.
 */
export const createHandler: FeatureHandlerFactory<ServiceAccessor> = (getServices) => async (c) => {
    const current = getServices(c);
    const result = await readiness(current.config, current, current.signal);
    return c.json(result, result.status === "ready" ? 200 : 503);
};
