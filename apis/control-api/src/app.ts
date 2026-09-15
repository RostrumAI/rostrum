/** @fileoverview Control API application: route registration and error contract. */

import { getLogger } from "@logtape/logtape";
import {
    createServerApp,
    registerMethodNotAllowed,
    type ServerApp,
    serveOpenApi,
} from "@rostrum/server/app";
import type { Context } from "hono";
import pkg from "../package.json" with { type: "json" };
import type { ControlApiContext } from "./control-api";
import { registerRoutes } from "./routes";
import { CONTROL_API_TAG } from "./tags";
import { errorBody, errorPayloadFor } from "./workflows/errors";
import { decodeWorkflowBody } from "./workflows/request-body";

/** The single error shape every Control API boundary failure answers with. */
function errorJson(code: string, message: string): Record<string, unknown> {
    return { code, message, findings: [] };
}

/**
 * Builds the Control API application without acquiring configuration or
 * database resources, so contract generation and listener-free tests need
 * neither.
 */
export function createControlApiApp(): ServerApp<ControlApiContext> {
    const logger = getLogger("control-api");
    const app = createServerApp<ControlApiContext>({
        serviceName: "control-api",
        tags: Object.values(CONTROL_API_TAG),
        title: "Rostrum Control API",
        description: "Code-first OpenAPI 3.1 document generated from TypeBox schemas.",
        version: pkg.version,
        decodeBody: decodeWorkflowBody,
    });

    registerRoutes(app);
    serveOpenApi(app);

    // Every registered path answers a disallowed method with the methods it does
    // allow. Must run after all routes are registered.
    registerMethodNotAllowed(app, (c, allowed) => {
        c.header("Allow", allowed.join(", "));
        return c.json(
            errorJson("method_not_allowed", `${c.req.method} is not allowed for ${c.req.path}`),
            405,
        );
    });

    // An unmatched path is a caller mistake, not a fault.
    app.hono.notFound((c: Context) =>
        c.json(errorJson("not_found", `No route for ${c.req.method} ${c.req.path}`), 404),
    );

    // A handler failure is mapped to its own status when the workflow operations
    // recognize it, and is a Control API fault otherwise.
    app.hono.onError((error: Error, c: Context) => {
        const payload = errorPayloadFor(error);
        if (payload !== null) {
            return c.json(errorBody(payload), payload.status);
        }
        logger.error("handler failed", { error: String(error), path: c.req.path });
        return c.json(errorJson("internal_error", "Internal Server Error"), 500);
    });

    return app;
}
