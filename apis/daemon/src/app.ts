/** @fileoverview Private daemon HTTP application and generated contract. */

import { getLogger } from "@logtape/logtape";
import { createServerApp, type ServerApp, serveOpenApi } from "@rostrum/server/app";
import { BoundaryErrorSchema } from "@rostrum/server/protocol";
import type { Context } from "hono";
import pkg from "../package.json" with { type: "json" };
import type { DaemonContext } from "./daemon";
import { registerRoutes } from "./routes";
import { DAEMON_TAG } from "./tags";

/** The single error shape every daemon boundary failure answers with. */
function errorJson(code: string, message: string): Record<string, unknown> {
    return { code, message, findings: [] };
}

/**
 * Builds the daemon application without acquiring configuration or database
 * resources, so contract generation and listener-free tests need neither.
 */
export function createDaemonApp(): ServerApp<DaemonContext> {
    const logger = getLogger("daemon");
    const app = createServerApp<DaemonContext>({
        serviceName: "daemon",
        tags: Object.values(DAEMON_TAG),
        title: "Rostrum Daemon API",
        description: "Private authenticated daemon boundary.",
        version: pkg.version,
        components: { BoundaryError: BoundaryErrorSchema },
        defaultResponses: {
            401: { description: "Bearer authentication required", body: BoundaryErrorSchema },
        },
        security: [{ daemonBearer: [] }],
        securitySchemes: { daemonBearer: { type: "http", scheme: "bearer" } },
    });

    // Every answer reflects the admitted request and the live dependencies, so
    // no response is reusable and each one is logged with its duration.
    app.hono.use("*", async (c, next) => {
        const started = performance.now();
        c.header("Cache-Control", "no-store");
        await next();
        logger.info("request completed", {
            method: c.req.method,
            path: c.req.path,
            status: c.res.status,
            durationMs: Math.round(performance.now() - started),
        });
    });

    registerRoutes(app);
    serveOpenApi(app);

    // Unmatched paths answer in the same error shape, naming the methods a known
    // path allows. Hono tries the real routes first, so this sees only true misses.
    const allowed = new Map(app.routeTable().map((entry) => [entry.path, entry.methods]));
    app.hono.notFound((c: Context) => {
        const methods = allowed.get(c.req.path);
        if (methods !== undefined) {
            c.header("Allow", methods.join(", "));
            return c.json(errorJson("method_not_allowed", "Method not allowed"), 405);
        }
        return c.json(errorJson("not_found", "Route not found"), 404);
    });

    // A handler failure is a daemon fault: log it and answer the boundary shape.
    app.hono.onError((_error, c: Context) => {
        logger.error("handler failed", { method: c.req.method, path: c.req.path });
        return c.json(errorJson("internal_error", "Internal Server Error"), 500);
    });

    return app;
}
