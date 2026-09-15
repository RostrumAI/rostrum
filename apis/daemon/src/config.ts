/** @fileoverview Daemon configuration: definition, validation, and owned secrets. */

import { createPrivateKey, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createSecureContext } from "node:tls";
import type { LogLevel } from "@logtape/logtape";
import { type ConfigDefinition, defineConfig } from "@rostrum/server/config";
import { ConfigurationError, isLiteralLoopback } from "@rostrum/server/network";
import { loadTokens } from "@rostrum/server/tokens";
import { Type } from "typebox";

/** Everything the daemon reads once at startup and keeps for its lifetime. */
export interface DaemonConfig {
    /** Address the daemon listener binds. */
    readonly host: string;
    /** Port the daemon listener binds; zero selects an available port. */
    readonly port: number;
    /** Deployment environment used to enforce production restrictions. */
    readonly nodeEnv: "development" | "test" | "production";
    /** Minimum severity the daemon emits. */
    readonly logLevel: LogLevel;
    /** Connection URL for the daemon's own database handle. */
    readonly databaseUrl: string;
    /** Whether daemon database connections require verified TLS. */
    readonly databaseTls: boolean;
    /** Whether development or test may use loopback-only plaintext transport. */
    readonly allowInsecureLocal: boolean;
    /** Accepted credentials in oldest-to-newest order; the Control API sends the newest. */
    readonly tokens: readonly string[];
    /** Maximum duration of one dependency readiness check, in milliseconds. */
    readonly dependencyTimeoutMs: number;
    /** Maximum duration of graceful shutdown, in milliseconds. */
    readonly shutdownTimeoutMs: number;
    /** Whether a same-host reverse proxy terminates incoming TLS. */
    readonly behindReverseProxy: boolean;
    /** Certificate file resolved against the startup root. */
    readonly tlsCertFile?: string;
    /** Private-key file resolved against the startup root. */
    readonly tlsKeyFile?: string;
    /** Validated PEM material used when the daemon terminates TLS directly. */
    readonly tls?: {
        /** PEM certificate presented by the daemon listener. */
        readonly cert: string;
        /** PEM private key matching the listener certificate. */
        readonly key: string;
    };
}

const DaemonSchema = Type.Object(
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
        behindReverseProxy: Type.Boolean(),
        tlsCertFile: Type.Optional(Type.String({ minLength: 1 })),
        tlsKeyFile: Type.Optional(Type.String({ minLength: 1 })),
    },
    { additionalProperties: false },
);

/** Reads the daemon's direct TLS material, or nothing in proxy mode. */
function loadTls(settings: Record<string, unknown>, root: string): DaemonConfig["tls"] {
    const certFile = typeof settings.tlsCertFile === "string" ? settings.tlsCertFile : undefined;
    const keyFile = typeof settings.tlsKeyFile === "string" ? settings.tlsKeyFile : undefined;
    if (certFile === undefined && keyFile === undefined) {
        return undefined;
    }
    if (!certFile || !keyFile) {
        throw new ConfigurationError("tls", "requires both certificate and key files");
    }
    try {
        const cert = readFileSync(resolve(root, certFile), "utf8");
        const key = readFileSync(resolve(root, keyFile), "utf8");
        if (!new X509Certificate(cert).checkPrivateKey(createPrivateKey(key))) {
            throw new Error("mismatched pair");
        }
        createSecureContext({ cert, key });
        return Object.freeze({ cert, key });
    } catch {
        throw new ConfigurationError(
            "tls",
            "requires a readable, valid, matching PEM certificate and private key",
        );
    }
}

/** The daemon's configuration definition. */
export const daemonConfig: ConfigDefinition<DaemonConfig> = defineConfig<DaemonConfig>({
    schema: DaemonSchema,
    defaults: (settings) => ({
        host: "127.0.0.1",
        port: 3001,
        nodeEnv: "development",
        logLevel: settings.nodeEnv === "production" ? "info" : "debug",
        databaseTls: true,
        allowInsecureLocal: false,
        dependencyTimeoutMs: 2000,
        shutdownTimeoutMs: 30000,
        behindReverseProxy: false,
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
        behindReverseProxy: { name: "BEHIND_REVERSE_PROXY", kind: "boolean" },
        tlsKeyFile: { name: "TLS_KEY_FILE", kind: "string" },
        tlsCertFile: { name: "TLS_CERT_FILE", kind: "string" },
    },
    fileSelector: "DAEMON_CONFIG",
    defaultFile: "config.yaml",
    finalize: (settings, { root, env }) => {
        const nodeEnv = settings.nodeEnv as DaemonConfig["nodeEnv"];
        const allowInsecureLocal = settings.allowInsecureLocal === true;
        const behindReverseProxy = settings.behindReverseProxy === true;
        const host = settings.host as string;

        // The insecure-local exception is development-only.
        if (allowInsecureLocal && nodeEnv === "production") {
            throw new ConfigurationError(
                "allowInsecureLocal",
                "is restricted to development and test",
            );
        }

        // A plaintext or proxied listener must stay on literal loopback.
        if ((allowInsecureLocal || behindReverseProxy) && !isLiteralLoopback(host)) {
            throw new ConfigurationError(
                "host",
                "must be literal loopback for local or reverse-proxy mode",
            );
        }

        // Proxy mode does not read certificates: the same-host proxy owns TLS termination.
        let tls: DaemonConfig["tls"];
        if (!behindReverseProxy) {
            const tlsCertFile = settings.tlsCertFile as string | undefined;
            const tlsKeyFile = settings.tlsKeyFile as string | undefined;
            if (tlsCertFile !== undefined || tlsKeyFile !== undefined) {
                tls = loadTls(settings, root);
            } else if (!allowInsecureLocal) {
                throw new ConfigurationError(
                    "tls",
                    "requires a certificate and key outside local or reverse-proxy mode",
                );
            }
        }

        const tokens = loadTokens(
            env,
            typeof settings.daemonTokenFile === "string" ? settings.daemonTokenFile : undefined,
            root,
        );

        return {
            host,
            port: settings.port as number,
            nodeEnv,
            logLevel: settings.logLevel as LogLevel,
            databaseUrl: settings.databaseUrl as string,
            databaseTls: settings.databaseTls === true,
            allowInsecureLocal,
            tokens,
            dependencyTimeoutMs: settings.dependencyTimeoutMs as number,
            shutdownTimeoutMs: settings.shutdownTimeoutMs as number,
            behindReverseProxy,
            ...(settings.tlsCertFile === undefined
                ? {}
                : { tlsCertFile: settings.tlsCertFile as string }),
            ...(settings.tlsKeyFile === undefined
                ? {}
                : { tlsKeyFile: settings.tlsKeyFile as string }),
            ...(tls === undefined ? {} : { tls }),
        };
    },
});
