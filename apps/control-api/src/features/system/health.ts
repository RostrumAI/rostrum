import type { Context } from "hono";
import { Type } from "typebox";
import type { FeatureHandler, FeatureRoute, FeatureSchemas } from "../../loader";

/**
 * Response body of the health check: a liveness token only, so the route
 * answers without touching any dependency that could fail independently.
 */
export const HealthSchema = Type.Object(
    { status: Type.Literal("ok") },
    { additionalProperties: false },
);

/** Route binding for the health check. */
export const route: FeatureRoute = {
    method: "GET",
    path: "/health",
    responses: {
        "200": { description: "Service is healthy", schemaName: "Health" },
    },
};

/** OpenAPI components contributed by this slice. */
export const schema: FeatureSchemas = { Health: HealthSchema };

/**
 * Serves GET /health. Lets load balancers, orchestrators, and the
 * integration harness confirm the process is up and serving requests.
 */
export const handler: FeatureHandler = (c: Context) => c.json({ status: "ok" as const });
