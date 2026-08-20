import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import pkg from "../../package.json" with { type: "json" };
import { INTERFACE_VERSION } from "../schemas";

/** The service identity reported by the version route. */
export const SERVICE_NAME = "rostrum-control-api";

export function systemRoutes(): Hono {
  const app = new Hono();

  app.get(
    "/health",
    describeRoute({
      tags: ["system"],
      responses: {
        200: {
          description: "Service is healthy",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Health" } } },
        },
      },
    }),
    (c) => c.json({ status: "ok" }),
  );

  app.get(
    "/version",
    describeRoute({
      tags: ["system"],
      responses: {
        200: {
          description: "Service and workflow interface version",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Version" } } },
        },
      },
    }),
    (c) =>
      c.json({
        service: SERVICE_NAME,
        version: pkg.version,
        interfaceVersion: INTERFACE_VERSION,
      }),
  );

  return app;
}
