import type { FeatureHandlerFactory, FeatureRoute, FeatureSchemas } from "@rostrum/server/loader";
import { HealthSchema } from "@rostrum/server/protocol";
import type { ServiceAccessor } from "../../services";

export const route: FeatureRoute = {
    method: "GET",
    path: "/health",
    responses: { "200": { description: "Service is healthy", schemaName: "Health" } },
};
export const schema: FeatureSchemas = { Health: HealthSchema };
export const createHandler: FeatureHandlerFactory<ServiceAccessor> = () => (c) =>
    c.json({ status: "ok" as const });
