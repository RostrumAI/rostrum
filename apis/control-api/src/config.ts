/** @fileoverview Control API configuration: definition, validation, and owned secrets. */

import type { LogLevel } from "@logtape/logtape";
import { type ConfigDefinition, defineConfig } from "@rostrum/server/config";
import { ConfigurationError, validateDaemonUrl } from "@rostrum/server/network";
import { loadTokens } from "@rostrum/server/tokens";
import { Type } from "typebox";

/** Everything the Control API reads once at startup and keeps for its lifetime. */
export interface ControlApiConfig {
    /** Address the caller-facing listener binds. */
    readonly host: string;
    /** Port the caller-facing listener binds; zero selects an available port. */
    readonly port: number;
    /** Deployment environment used to enforce production restrictions. */
    readonly nodeEnv: "development" | "test" | "production";
    /** Minimum severity the Control API emits. */
    readonly logLevel: LogLevel;
    /** Connection URL for the Control API's own database handle. */
    readonly databaseUrl: string;
    /** Whether Control API database connections require verified TLS. */
    readonly databaseTls: boolean;
    /** Whether development or test may use loopback-only plaintext transport. */
    readonly allowInsecureLocal: boolean;
    /** Accepted credentials in oldest-to-newest order; the newest one is sent. */
    readonly tokens: readonly string[];
    /** Maximum duration of one dependency readiness check, in milliseconds. */
    readonly dependencyTimeoutMs: number;
    /** Maximum duration of graceful shutdown, in milliseconds. */
    readonly shutdownTimeoutMs: number;
    /** Validated, normalized origin of the daemon service. */
    readonly daemonUrl: string;
}

const ControlApiSchema = Type.Object(
    {
        host: Type.String({ minLength: 1, pattern: "^[^\\s]+$" }),
        port: Type.Integer({ minimum: 0, maximum: 65535 }),
        nodeEnv: Type.Union([
            Type.Literal("development"),
            Type.Literal("test"),
            Type.Literal("production"),
        ]),
        logLevel: Type.Union(
            ["trace", "debug", "info", "warning", "error", "fatal"].map((level) =>
                Type.Literal(level),
            ),
        ),
        databaseUrl: Type.String({ minLength: 1 }),
        databaseTls: Type.Boolean(),
        allowInsecureLocal: Type.Boolean(),
        daemonTokenFile: Type.Optional(Type.String({ minLength: 1 })),
        dependencyTimeoutMs: Type.Integer({ minimum: 1, maximum: 30000 }),
        shutdownTimeoutMs: Type.Integer({ minimum: 1, maximum: 300000 }),
        daemonUrl: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
);

/** The Control API's configuration definition. */
export const controlApiConfig: ConfigDefinition<ControlApiConfig> = defineConfig<ControlApiConfig>({
    schema: ControlApiSchema,
    defaults: (settings) => ({
        host: "127.0.0.1",
        port: 3000,
        nodeEnv: "development",
        logLevel: settings.nodeEnv === "production" ? "info" : "debug",
        databaseTls: true,
        allowInsecureLocal: false,
        dependencyTimeoutMs: 2000,
        shutdownTimeoutMs: 30000,
    }),
    environment: {
        host: { name: "HOST", kind: "string" },
        port: { name: "PORT", kind: "integer" },
        nodeEnv: { name: "NODE_ENV", kind: "string" },
        logLevel: { name: "LOG_LEVEL", kind: "string" },
        databaseUrl: { name: "DATABASE_URL", kind: "string" },
        databaseTls: { name: "DATABASE_TLS", kind: "boolean" },
        allowInsecureLocal: { name: "ALLOW_INSECURE_LOCAL", kind: "boolean" },
        dependencyTimeoutMs: { name: "DEPENDENCY_TIMEOUT_MS", kind: "integer" },
        shutdownTimeoutMs: { name: "SHUTDOWN_TIMEOUT_MS", kind: "integer" },
        daemonUrl: { name: "DAEMON_URL", kind: "string" },
    },
    fileSelector: "CONTROL_API_CONFIG",
    defaultFile: "config.yaml",
    finalize: (settings, { root, env }) => {
        const nodeEnv = settings.nodeEnv as ControlApiConfig["nodeEnv"];
        const allowInsecureLocal = settings.allowInsecureLocal === true;

        // The insecure-local exception is development-only.
        if (allowInsecureLocal && nodeEnv === "production") {
            throw new ConfigurationError(
                "allowInsecureLocal",
                "is restricted to development and test",
            );
        }

        // The daemon origin is validated before any connection to it is made.
        const daemonUrl = validateDaemonUrl(settings.daemonUrl as string, allowInsecureLocal);

        const tokens = loadTokens(
            env,
            typeof settings.daemonTokenFile === "string" ? settings.daemonTokenFile : undefined,
            root,
        );

        return {
            host: settings.host as string,
            port: settings.port as number,
            nodeEnv,
            logLevel: settings.logLevel as LogLevel,
            databaseUrl: settings.databaseUrl as string,
            databaseTls: settings.databaseTls === true,
            allowInsecureLocal,
            tokens,
            dependencyTimeoutMs: settings.dependencyTimeoutMs as number,
            shutdownTimeoutMs: settings.shutdownTimeoutMs as number,
            daemonUrl,
        };
    },
});
