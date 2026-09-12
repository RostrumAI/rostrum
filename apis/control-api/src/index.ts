/** @fileoverview Control API process entry point. */

import { getLogger } from "@logtape/logtape";
import { configureLogging } from "@rostrum/server/logger";
import { ControlApiApp } from "./app";
import { loadConfig } from "./env";

const config = loadConfig();
await configureLogging(config.logLevel);
const logger = getLogger("control-api");
const app = await ControlApiApp.create();

const server = Bun.serve({
    hostname: config.host,
    port: config.port,
    fetch: app.routes.fetch,
    error(error) {
        logger.error("request failed", { error: String(error) });
        return new Response("Internal Server Error", { status: 500 });
    },
});

logger.info("listening", {
    host: config.host,
    port: server.port,
    url: `http://${config.host}:${server.port}`,
});

let shuttingDown = false;
/** Stops admission, then drains and closes the workflow pool. */
async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) {
        return;
    }
    shuttingDown = true;
    logger.info("shutdown started", { signal });
    await server.stop(true);
    await app.close(config.shutdownTimeoutMs);
    logger.info("shutdown complete");
    process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
