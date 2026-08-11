import { Hono } from "hono";
import { generateSpecs } from "hono-openapi";
import pkg from "../package.json" with { type: "json" };
import type { Config } from "./config";
import type { WorkflowRepo } from "./db/workflows-repo";
import type { Logger } from "./logger";
import { eventsRoutes } from "./routes/events";
import { systemRoutes } from "./routes/system";
import { workflowsRoutes } from "./routes/workflows";
import { Schemas } from "./schemas";

export interface AppDeps {
  repo: WorkflowRepo;
  logger: Logger;
  config: Config;
}

export const ERROR_SHAPE = {
  notFound: { code: "not_found", findings: [] },
} as const;

/**
 * App factory. Routes are mounted on a plain Hono app so tests can drive
 * `app.fetch()` without a socket (E1-S0 row 4a) and the real process serves
 * the same app over HTTP (row 4b).
 */
export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  app.route("/api/v1", systemRoutes(deps));
  app.route("/api/v1", workflowsRoutes(deps.repo));
  app.route("/api/v1", eventsRoutes());

  app.get("/openapi.json", async (c) => {
    const doc = await generateSpecs(
      app,
      {
        documentation: {
          openapi: "3.1.0",
          info: {
            title: "Rostrum Control API (proof of concept)",
            version: pkg.version,
            description:
              "Code-first OpenAPI 3.1 document generated from TypeBox schemas (Decision e1-s0).",
          },
          tags: [{ name: "system" }, { name: "workflows" }, { name: "events" }],
          components: { schemas: Schemas },
        },
      },
      c,
    );
    return c.json(doc);
  });

  app.notFound((c) => {
    return c.json(
      {
        code: "not_found",
        message: `No route for ${c.req.method} ${c.req.path}`,
        findings: [],
      },
      404,
    );
  });

  app.onError((err, c) => {
    deps.logger.error("handler failed", { error: String(err), path: c.req.path });
    return c.json({ code: "internal_error", message: "Internal Server Error", findings: [] }, 500);
  });

  // Known paths answer 405 (documented error shape) for disallowed methods
  // instead of falling through to the 404 handler. POC-thin: the final
  // routing/error conventions land with E1-02.
  const routeMethods: Array<[path: string, allowed: readonly string[]]> = [
    ["/api/v1/health", ["GET"]],
    ["/api/v1/version", ["GET"]],
    ["/api/v1/workflows", ["POST"]],
    ["/api/v1/workflows/:id/versions/:version", ["GET"]],
    ["/api/v1/events", ["GET"]],
    ["/openapi.json", ["GET"]],
  ];
  for (const [path, allowed] of routeMethods) {
    for (const method of [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
      "TRACE",
      "QUERY",
    ] as const) {
      if (allowed.includes(method)) continue;
      app.on(method, path, (c) => {
        c.header("Allow", allowed.join(", "));
        return c.json(
          {
            code: "method_not_allowed",
            message: `${method} is not allowed for ${path}`,
            findings: [],
          },
          405,
        );
      });
    }
  }

  return app;
}
