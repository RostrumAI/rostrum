import type { LogLevel } from "./logger";

/** Process configuration selected by Decision e1-s0. */
export interface Config {
  host: string;
  port: number;
  databaseUrl: string;
  logLevel: LogLevel;
}

const DEFAULT_DATABASE_URL = "postgres://rostrum:rostrum@localhost:5432/rostrum";

export function parseLogLevel(value: string | undefined): LogLevel {
  switch (value) {
    case "debug":
    case "info":
    case "warn":
    case "error":
      return value;
    default:
      return "info";
  }
}

/**
 * Reads configuration from environment variables with documented defaults.
 * `DATABASE_URL` is part of the configuration surface but is not used until
 * E1-07 adds storage; the default targets the Docker Compose Postgres
 * service (docker-compose.yml).
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`invalid PORT: ${env.PORT}`);
  }
  return {
    host: env.HOST ?? "127.0.0.1",
    port,
    databaseUrl: env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
    logLevel: parseLogLevel(env.LOG_LEVEL),
  };
}
