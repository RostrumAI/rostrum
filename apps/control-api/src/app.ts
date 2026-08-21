import { getLogger } from "@logtape/logtape";
import { type Context, Hono } from "hono";
import { generateSpecs } from "hono-openapi";
import pkg from "../package.json" with { type: "json" };
import { SystemRoutes } from "./features/system/system.routes";
import { HealthSchema, VersionSchema } from "./features/system/system.schema";
import { ErrorResponseSchema, FindingSchema } from "./schemas";

/**
 * OpenAPI components. The TypeBox schemas are embedded verbatim, so the
 * generated document round-trips the schemas unchanged (E1-S0 row 3).
 */
const Schemas = {
  Health: HealthSchema,
  Version: VersionSchema,
  ErrorResponse: ErrorResponseSchema,
  Finding: FindingSchema,
} as const;

/** Methods checked for 405 responses (HTTP standard set plus QUERY, RFC 9213). */
const CANDIDATE_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "TRACE",
  "QUERY",
] as const;

/**
 * Control API application.
 *
 * Routes are mounted on a plain Hono app so tests can drive `routes.fetch()`
 * without a socket and the real process serves the same app over HTTP.
 * Foundation surface (E1-02): versioned `/api/v1` routes, one error shape,
 * and the code-first OpenAPI 3.1 document at `/openapi.json`.
 */
export class ControlApiApp {
  /** The mounted Hono application; serve it with Bun.serve or fetch it directly. */
  readonly routes = new Hono();

  private readonly logger = getLogger("control-api");

  constructor() {
    this.routes.route("/api/v1", new SystemRoutes().routes);

    this.routes.get("/openapi.json", async (c) => {
      const doc = await generateSpecs(
        this.routes,
        {
          documentation: {
            openapi: "3.1.0",
            info: {
              title: "Rostrum Control API",
              version: pkg.version,
              description:
                "Code-first OpenAPI 3.1 document generated from TypeBox schemas (Decision e1-s0).",
            },
            tags: [{ name: "system" }],
            components: { schemas: Schemas },
          },
        },
        c,
      );
      return c.json(doc);
    });

    this.routes.notFound((c) => this.notFound(c));
    this.routes.onError((err, c) => this.serverError(err, c));
    // Must run after all routes are registered (E1-02 error contract).
    this.registerMethodNotAllowed();
  }

  /**
   * One error response in the single error shape (E1-02 contract):
   * `{ code, message, findings }`. `findings` stays empty until E1-06
   * reports validation findings.
   */
  private errorJson(
    code: string,
    message: string,
  ): { code: string; message: string; findings: [] } {
    return { code, message, findings: [] };
  }

  /** Unknown route or path: 404 with the error shape. */
  private notFound(c: Context): Response {
    return c.json(this.errorJson("not_found", `No route for ${c.req.method} ${c.req.path}`), 404);
  }

  /** Known path, disallowed method: 405 with an `Allow` header. */
  private methodNotAllowed(c: Context, allowed: readonly string[]): Response {
    c.header("Allow", allowed.join(", "));
    return c.json(
      this.errorJson("method_not_allowed", `${c.req.method} is not allowed for ${c.req.path}`),
      405,
    );
  }

  /** Unhandled handler error: 500 with the error shape, always logged. */
  private serverError(err: Error, c: Context): Response {
    this.logger.error("handler failed", { error: String(err), path: c.req.path });
    return c.json(this.errorJson("internal_error", "Internal Server Error"), 500);
  }

  /**
   * Registers 405 handlers for every registered route path and every candidate
   * method the path does not allow. The allowed-method table is derived from
   * `routes`, which Hono flattens across `route(...)` mounts (verified in hono
   * 4.13.3), so future routes get 405 handling without a manual table. HEAD is
   * paired with GET: Hono dispatches HEAD by mapping it to GET, and the Allow
   * header should state that.
   *
   * Must run after all routes are registered.
   */
  private registerMethodNotAllowed(): void {
    const allowedByPath = new Map<string, string[]>();
    for (const route of this.routes.routes) {
      const allowed = allowedByPath.get(route.path) ?? [];
      if (!allowed.includes(route.method)) allowed.push(route.method);
      if (route.method === "GET" && !allowed.includes("HEAD")) allowed.push("HEAD");
      allowedByPath.set(route.path, allowed);
    }
    for (const [path, allowed] of allowedByPath) {
      for (const method of CANDIDATE_METHODS) {
        if (allowed.includes(method)) continue;
        this.routes.on(method, path, (c) => this.methodNotAllowed(c, allowed));
      }
    }
  }
}
