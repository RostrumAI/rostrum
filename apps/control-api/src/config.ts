import type { LogLevel } from "./logger";

export interface Config {
  host: string;
  port: number;
  databaseUrl: string;
  logLevel: LogLevel;
  /**
   * POC-only seam for the response-contract check (E1-S0 row 11): when set,
   * the health route emits an undocumented field so Schemathesis and the
   * contract assertions can observe a seeded violation.
   */
  seedViolation: boolean;
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
    seedViolation: env.POC_SEED_VIOLATION === "1",
  };
}
