import type { Context, Hono } from "hono";
import type { Logger } from "./logger";

/**
 * One error response in the single error shape (E1-02 contract):
 * `{ code, message, findings }`. `findings` stays empty until E1-06
 * reports validation findings.
 */
function errorJson(code: string, message: string) {
  return { code, message, findings: [] };
}

/** Unknown route or path: 404 with the error shape. */
export function notFoundHandler(c: Context): Response {
  return c.json(errorJson("not_found", `No route for ${c.req.method} ${c.req.path}`), 404);
}

/** Known path, disallowed method: 405 with an `Allow` header. */
export function methodNotAllowedHandler(c: Context, allowed: readonly string[]): Response {
  c.header("Allow", allowed.join(", "));
  return c.json(
    errorJson("method_not_allowed", `${c.req.method} is not allowed for ${c.req.path}`),
    405,
  );
}

/** Unhandled handler error: 500 with the error shape, always logged. */
export function errorHandler(logger: Logger): (err: Error, c: Context) => Response {
  return (err, c) => {
    logger.error("handler failed", { error: String(err), path: c.req.path });
    return c.json(errorJson("internal_error", "Internal Server Error"), 500);
  };
}

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
 * Registers 405 handlers for every registered route path and every candidate
 * method the path does not allow. The allowed-method table is derived from
 * `app.routes`, which Hono flattens across `app.route(...)` mounts (verified
 * in hono 4.13.3), so future routes get 405 handling without a manual table.
 * HEAD is paired with GET: Hono dispatches HEAD by mapping it to GET, and
 * the Allow header should state that.
 *
 * Must run after all routes are registered.
 */
export function registerMethodNotAllowed(app: Hono): void {
  const allowedByPath = new Map<string, string[]>();
  for (const route of app.routes) {
    const allowed = allowedByPath.get(route.path) ?? [];
    if (!allowed.includes(route.method)) allowed.push(route.method);
    if (route.method === "GET" && !allowed.includes("HEAD")) allowed.push("HEAD");
    allowedByPath.set(route.path, allowed);
  }
  for (const [path, allowed] of allowedByPath) {
    for (const method of CANDIDATE_METHODS) {
      if (allowed.includes(method)) continue;
      app.on(method, path, (c) => methodNotAllowedHandler(c, allowed));
    }
  }
}
