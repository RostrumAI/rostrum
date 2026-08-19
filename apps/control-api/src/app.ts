import { Hono } from "hono";

/**
 * Control API application factory.
 *
 * E1-01 establishes the socket-free `app.fetch()` seam that integration tests
 * use. E1-02 adds configuration, structured logging, health and version
 * routes, versioned routing, the error shape, and OpenAPI documentation.
 */
export function createApp(): Hono {
  const app = new Hono();

  app.get("/", (c) => c.json({ service: "rostrum-control-api" }));

  return app;
}
