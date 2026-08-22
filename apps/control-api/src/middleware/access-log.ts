import { getLogger } from "@logtape/logtape";
import type { MiddlewareHandler } from "hono";

/**
 * Logs every incoming request and every response at debug level, so dev
 * environments can trace each exchange without per-route logging code.
 */
export function accessLog(): MiddlewareHandler {
    return async (c, next) => {
        const logger = getLogger("control-api");
        const startedAt = Date.now();
        logger.debug("request received", { method: c.req.method, path: c.req.path });
        await next();
        logger.debug("response sent", {
            method: c.req.method,
            path: c.req.path,
            status: c.res.status,
            durationMs: Date.now() - startedAt,
        });
    };
}
