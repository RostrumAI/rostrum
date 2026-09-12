import type { FeatureHandlerFactory, FeatureRoute, FeatureSchemas } from "@rostrum/server/loader";
import { DaemonReadinessSchema } from "@rostrum/server/protocol";
import { readiness, type ServiceAccessor } from "../../services";

export const route: FeatureRoute = {
    method: "GET",
    path: "/readiness",
    responses: {
        "200": { description: "Dependencies are ready", schemaName: "DaemonReadiness" },
        "503": { description: "Dependencies are unavailable", schemaName: "DaemonReadiness" },
    },
};
export const schema: FeatureSchemas = { DaemonReadiness: DaemonReadinessSchema };
export const createHandler: FeatureHandlerFactory<ServiceAccessor> = (services) => async (c) => {
    const current = services(c);
    const result = await readiness(current.config, current, current.signal);
    return c.json(result, result.status === "ready" ? 200 : 503);
};
