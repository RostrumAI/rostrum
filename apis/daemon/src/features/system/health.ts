/** @fileoverview Daemon process-liveness feature slice. */

import type { FeatureHandlerFactory, FeatureRoute, FeatureSchemas } from "@rostrum/server/loader";
import { HealthSchema } from "@rostrum/server/protocol";
import type { ServiceAccessor } from "../../services";

/** Route binding for the daemon liveness check. */
export const route: FeatureRoute = {
    method: "GET",
    path: "/health",
    responses: { "200": { description: "Service is healthy", schemaName: "Health" } },
};

/** OpenAPI components contributed by this slice. */
export const schema: FeatureSchemas = { Health: HealthSchema };

/**
 * Serves GET /health without touching a dependency, so an operator can
 * separate a live process from one able to accept work.
 */
export const createHandler: FeatureHandlerFactory<ServiceAccessor> = () => (c) =>
    c.json({ status: "ok" as const });
