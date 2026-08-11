import { createApp } from "./app";
import { loadConfig } from "./config";
import { createDb } from "./db/client";
import { createPostgresWorkflowRepo } from "./db/workflows-repo";
import { createLogger } from "./logger";

const config = loadConfig();
const logger = createLogger(config.logLevel);
const db = createDb(config.databaseUrl);
const repo = createPostgresWorkflowRepo(db);
const app = createApp({ repo, logger, config });

const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  fetch: app.fetch,
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
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("shutdown started", { signal });
  server.stop(true);
  await db.end();
  logger.info("shutdown complete", { signal });
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
