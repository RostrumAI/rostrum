import type { Context } from "hono";
import { Type } from "typebox";
import pkg from "../../../package.json" with { type: "json" };
import type { FeatureHandler, FeatureRoute, FeatureSchemas } from "../../loader";
import { INTERFACE_VERSION } from "../../schemas";

/**
 * Response body of GET /version. `interfaceVersion` pins the exact workflow
 * interface token so clients verify compatibility before sending workflows.
 */
export const VersionSchema = Type.Object(
    {
        service: Type.String(),
        version: Type.String(),
        interfaceVersion: Type.Literal(INTERFACE_VERSION),
    },
    { additionalProperties: false },
);

/** Route binding for version reporting. */
export const route: FeatureRoute = {
    method: "GET",
    path: "/version",
    responses: {
        "200": { description: "Service and workflow interface version", schemaName: "Version" },
    },
};

/** OpenAPI components contributed by this slice. */
export const schema: FeatureSchemas = { Version: VersionSchema };

/**
 * Serves GET /version. Lets clients confirm which build they reached and
 * negotiate the exact workflow interface version; identity comes from
 * package.json so it never drifts from the published package.
 */
export const handler: FeatureHandler = (c: Context) =>
    c.json({
        service: pkg.name,
        version: pkg.version,
        interfaceVersion: INTERFACE_VERSION,
    });
