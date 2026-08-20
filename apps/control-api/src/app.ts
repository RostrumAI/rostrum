import { Hono } from "hono";
import { generateSpecs } from "hono-openapi";
import pkg from "../package.json" with { type: "json" };
import type { Config } from "./config";
import { errorHandler, notFoundHandler, registerMethodNotAllowed } from "./error";
import type { Logger } from "./logger";
import { eventsRoutes } from "./routes/events";
import { systemRoutes } from "./routes/system";
import { Schemas } from "./schemas";

export interface AppDeps {
  logger: Logger;
  config: Config;
}

/**
 * Control API application factory.
 *
 * Routes are mounted on a plain Hono app so tests can drive `app.fetch()`
 * without a socket and the real process serves the same app over HTTP.
 * Foundation surface (E1-02): versioned `/api/v1` routes, one error shape,
 * and the code-first OpenAPI 3.1 document at `/openapi.json`.
 */
export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  app.route("/api/v1", systemRoutes());
  app.route("/api/v1", eventsRoutes());

  app.get("/openapi.json", async (c) => {
    const doc = await generateSpecs(
      app,
      {
        documentation: {
          openapi: "3.1.0",
          info: {
            title: "Rostrum Control API",
            version: pkg.version,
            description:
              "Code-first OpenAPI 3.1 document generated from TypeBox schemas (Decision e1-s0).",
          },
          tags: [{ name: "system" }, { name: "events" }],
          components: { schemas: Schemas },
        },
      },
      c,
    );
    return c.json(doc);
  });

  app.notFound(notFoundHandler);
  app.onError(errorHandler(deps.logger));
  // Must run after all routes are registered (E1-02 error contract).
  registerMethodNotAllowed(app);

  return app;
}
