/** @fileoverview Control API dependency-readiness feature slice. */

import type { FeatureHandler, FeatureRoute, FeatureSchemas } from "@rostrum/server/loader";
import { ControlApiReadinessSchema } from "@rostrum/server/protocol";
import type { Context } from "hono";
import type { ServiceAccessor } from "../../services";

/**
 * Route binding for the readiness check. Readiness aggregates this service's
 * own database and the authenticated daemon; a daemon outage leaves authoring
 * operations available while this route reports not ready.
 */
export const route: FeatureRoute = {
    method: "GET",
    path: "/readiness",
    responses: {
        "200": { description: "Every dependency is ready", schemaName: "ControlApiReadiness" },
        "503": {
            description: "At least one dependency is unavailable or not ready",
            schemaName: "ControlApiReadiness",
        },
    },
};

/** OpenAPI components contributed by this slice. */
export const schema: FeatureSchemas = { ControlApiReadiness: ControlApiReadinessSchema };

/**
 * Serves GET /readiness. Runs both dependency probes concurrently under one
 * deadline and answers 503 as soon as either fails.
 */
export const createHandler =
    (getServices: ServiceAccessor): FeatureHandler =>
    async (c: Context) => {
        const readiness = await getServices(c).readiness(c.req.raw.signal);
        return c.json(readiness, readiness.status === "ready" ? 200 : 503, {
            "cache-control": "no-store",
        });
    };
