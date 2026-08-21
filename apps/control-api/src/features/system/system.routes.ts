import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { GetHealthHandler } from "./get-health.handler";
import { GetVersionHandler } from "./get-version.handler";

/** Mounts the system feature routes: health and version reporting. */
export class SystemRoutes {
  readonly routes = new Hono();

  private readonly health = new GetHealthHandler();
  private readonly version = new GetVersionHandler();

  constructor() {
    this.routes.get(
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
      (c) => this.health.handle(c),
    );

    this.routes.get(
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
      (c) => this.version.handle(c),
    );
  }
}
