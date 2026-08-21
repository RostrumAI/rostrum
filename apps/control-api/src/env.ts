import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { LogLevel } from "@logtape/logtape";
import { Type } from "typebox";
import { Value } from "typebox/value";

/** Process configuration for the Control API. */
export interface Config {
  host: string;
  port: number;
  databaseUrl: string;
  logLevel: LogLevel;
}

// Targets the Docker Compose Postgres service (docker-compose.yml); the
// Control API does not open a connection until storage arrives in E1-07.
const DEFAULT_DATABASE_URL = "postgres://rostrum:rostrum@localhost:5432/rostrum";

/** Log levels accepted in configuration, matching the LogTape vocabulary. */
const LOG_LEVELS = ["trace", "debug", "info", "warning", "error", "fatal"] as const;

const ConfigSchema = Type.Object(
  {
    host: Type.String({ default: "127.0.0.1" }),
    port: Type.Integer({ minimum: 0, maximum: 65535, default: 3000 }),
    databaseUrl: Type.String({ default: DEFAULT_DATABASE_URL }),
    logLevel: Type.Union(
      LOG_LEVELS.map((level) => Type.Literal(level)),
      { default: "info" },
    ),
  },
  { additionalProperties: false },
);

/**
 * Reads the optional YAML config file into a flat layer keyed like Config.
 * A missing file yields an empty layer; an unreadable or malformed file fails
 * startup.
 */
export function readConfigLayer(path: string): Record<string, unknown> {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  const parsed = Bun.YAML.parse(text) as unknown;
  if (parsed === null || parsed === undefined) return {};
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`config file ${path} must contain a YAML mapping of configuration keys`);
  }
  return parsed as Record<string, unknown>;
}

/**
 * Loads and validates the process configuration from environment variables
 * layered over the optional YAML config file; the environment wins per
 * variable. Every value is checked against the config schema, and invalid
 * values fail startup with the offending path.
 */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
  fileLayer: Record<string, unknown> = readConfigLayer(
    env.CONTROL_API_CONFIG ?? join(import.meta.dir, "..", "config.yaml"),
  ),
): Config {
  const port = env.PORT ?? fileLayer.port;
  // Value.Convert would silently truncate "3.5" to 3; reject non-integers
  // before coercion so a mistyped port fails startup instead.
  if (
    (typeof port === "string" && !/^-?\d+$/.test(port)) ||
    (typeof port === "number" && !Number.isInteger(port))
  ) {
    throw new Error(`invalid configuration: /port must be an integer, got ${JSON.stringify(port)}`);
  }
  const merged = Value.Convert(
    ConfigSchema,
    Value.Default(ConfigSchema, {
      host: env.HOST ?? fileLayer.host,
      port,
      databaseUrl: env.DATABASE_URL ?? fileLayer.databaseUrl,
      logLevel: env.LOG_LEVEL ?? fileLayer.logLevel,
    }),
  );
  if (!Value.Check(ConfigSchema, merged)) {
    const details = [...Value.Errors(ConfigSchema, merged)]
      .map((error) => `${error.instancePath} ${error.message}`)
      .join("; ");
    throw new Error(`invalid configuration: ${details}`);
  }
  return merged as Config;
}
