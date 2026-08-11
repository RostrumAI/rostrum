import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import pkg from "../../package.json" with { type: "json" };
import type { AppDeps } from "../app";

export function systemRoutes(deps: AppDeps): Hono {
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
    (c) => {
      if (deps.config.seedViolation) {
        // Seeded contract violation for E1-S0 row 11: an undocumented field.
        return c.json({ status: "ok", seeded: "violation" });
      }
      return c.json({ status: "ok" });
    },
  );

  app.get(
    "/version",
    describeRoute({
      tags: ["system"],
      responses: {
        200: {
          description: "Service and interface version",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Version" } } },
        },
      },
    }),
    (c) => {
      return c.json({
        service: "rostrum-control-api",
        version: pkg.version,
        interfaceVersion: "v1",
      });
    },
  );

  return app;
}
