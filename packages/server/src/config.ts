/** @fileoverview Shared service configuration loading and validation. */

import { createPrivateKey, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createSecureContext } from "node:tls";
import type { LogLevel } from "@logtape/logtape";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { ConfigurationError, isLiteralLoopback, validateDaemonUrl } from "./network";
import { loadTokens } from "./tokens";

/** Configuration shared by independently runnable services. */
export interface BaseConfig {
    host: string;
    port: number;
    nodeEnv: "development" | "test" | "production";
    logLevel: LogLevel;
    databaseUrl: string;
    databaseTls: boolean;
    allowInsecureLocal: boolean;
    tokens: readonly string[];
    dependencyTimeoutMs: number;
    shutdownTimeoutMs: number;
}

/** Daemon listener, database, authentication, and lifecycle settings. */
export interface DaemonConfig extends BaseConfig {
    behindReverseProxy: boolean;
    tlsCertFile?: string;
    tlsKeyFile?: string;
    tls?: { cert: string; key: string };
}

/** Control API listener, database, daemon-client, and lifecycle settings. */
export interface ControlApiConfig extends BaseConfig {
    daemonUrl: string;
}

type Service = "daemon" | "control-api";
type ConfigFor<S extends Service> = S extends "daemon" ? DaemonConfig : ControlApiConfig;

const commonFields = {
    host: Type.String({ minLength: 1, pattern: "^[^\\s]+$" }),
    port: Type.Integer({ minimum: 0, maximum: 65535 }),
    nodeEnv: Type.Union([
        Type.Literal("development"),
        Type.Literal("test"),
        Type.Literal("production"),
    ]),
    logLevel: Type.Union(
        ["trace", "debug", "info", "warning", "error", "fatal"].map((level) => Type.Literal(level)),
    ),
    databaseUrl: Type.String({ minLength: 1 }),
    databaseTls: Type.Boolean(),
    allowInsecureLocal: Type.Boolean(),
    daemonTokenFile: Type.Optional(Type.String({ minLength: 1 })),
    dependencyTimeoutMs: Type.Integer({ minimum: 1, maximum: 30000 }),
    shutdownTimeoutMs: Type.Integer({ minimum: 1, maximum: 300000 }),
};
const DaemonSchema = Type.Object(
    {
        ...commonFields,
        behindReverseProxy: Type.Boolean(),
        tlsCertFile: Type.Optional(Type.String({ minLength: 1 })),
        tlsKeyFile: Type.Optional(Type.String({ minLength: 1 })),
    },
    { additionalProperties: false },
);
const ControlApiSchema = Type.Object(
    {
        ...commonFields,
        daemonUrl: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
);
const DaemonFileSchema = Type.Partial(DaemonSchema);
const ControlApiFileSchema = Type.Partial(ControlApiSchema);

const environmentFields: Record<string, string> = {
    host: "HOST",
    port: "PORT",
    nodeEnv: "NODE_ENV",
    logLevel: "LOG_LEVEL",
    databaseUrl: "DATABASE_URL",
    databaseTls: "DATABASE_TLS",
    allowInsecureLocal: "ALLOW_INSECURE_LOCAL",
    dependencyTimeoutMs: "DEPENDENCY_TIMEOUT_MS",
    shutdownTimeoutMs: "SHUTDOWN_TIMEOUT_MS",
    behindReverseProxy: "BEHIND_REVERSE_PROXY",
    tlsCertFile: "TLS_CERT_FILE",
    tlsKeyFile: "TLS_KEY_FILE",
    daemonUrl: "DAEMON_URL",
};

/** Retains startup inputs so each load validates a complete reload candidate. */
export class ServiceConfigSource<S extends Service> {
    private readonly service: S;
    private readonly env: Readonly<Record<string, string | undefined>>;
    private readonly cwd: string;
    private readonly file: string;
    private readonly explicitFile: boolean;

    constructor(
        service: S,
        env: Record<string, string | undefined> = process.env,
        cwd = process.cwd(),
    ) {
        this.service = service;
        this.env = Object.freeze({ ...env });
        this.cwd = resolve(cwd);
        const selected = env[service === "daemon" ? "DAEMON_CONFIG" : "CONTROL_API_CONFIG"];
        if (selected !== undefined && selected.trim() === "") {
            throw new ConfigurationError("config", "must select a non-empty file path");
        }
        this.explicitFile = selected !== undefined;
        this.file = resolve(this.cwd, selected ?? "config.yaml");
    }

    /** Loads and validates one complete configuration candidate. */
    load(): ConfigFor<S> {
        if (
            this.env.NODE_TLS_REJECT_UNAUTHORIZED === "0" ||
            process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0"
        ) {
            throw new ConfigurationError(
                "NODE_TLS_REJECT_UNAUTHORIZED",
                "must not disable certificate verification",
            );
        }
        const schema = this.service === "daemon" ? DaemonSchema : ControlApiSchema;
        const fileSchema = this.service === "daemon" ? DaemonFileSchema : ControlApiFileSchema;
        let text: string | undefined;
        try {
            text = readFileSync(this.file, "utf8");
        } catch (error) {
            if (this.explicitFile || (error as NodeJS.ErrnoException).code !== "ENOENT") {
                throw new ConfigurationError("config", "must be a readable YAML file");
            }
        }
        let file: unknown = {};
        if (text !== undefined) {
            try {
                file = Bun.YAML.parse(text) ?? {};
            } catch {
                throw new ConfigurationError("config", "must contain valid YAML");
            }
        }
        if (!Value.Check(fileSchema, file)) {
            throw new ConfigurationError("config", "contains unknown keys or invalid field types");
        }
        const candidate: Record<string, unknown> = {
            host: "127.0.0.1",
            port: this.service === "daemon" ? 3001 : 3000,
            nodeEnv: "development",
            databaseTls: true,
            allowInsecureLocal: false,
            dependencyTimeoutMs: 2000,
            shutdownTimeoutMs: 30000,
            ...(this.service === "daemon" ? { behindReverseProxy: false } : {}),
            ...file,
        };
        for (const field of Object.keys(schema.properties)) {
            const name = environmentFields[field];
            const value = name === undefined ? undefined : this.env[name];
            if (value === undefined) {
                continue;
            }
            if (
                field === "port" ||
                field === "dependencyTimeoutMs" ||
                field === "shutdownTimeoutMs"
            ) {
                if (!/^[0-9]+$/.test(value) || !Number.isSafeInteger(Number(value))) {
                    throw new ConfigurationError(field, "must be an integer");
                }
                candidate[field] = Number(value);
            } else if (
                field === "databaseTls" ||
                field === "allowInsecureLocal" ||
                field === "behindReverseProxy"
            ) {
                if (value !== "true" && value !== "false") {
                    throw new ConfigurationError(field, "must be true or false");
                }
                candidate[field] = value === "true";
            } else {
                candidate[field] = value;
            }
        }
        candidate.logLevel ??= candidate.nodeEnv === "production" ? "info" : "debug";
        if (!Value.Check(schema, candidate)) {
            // Schema messages may include supplied values: report only the known property name.
            for (const [field, property] of Object.entries(schema.properties)) {
                if (
                    candidate[field] === undefined &&
                    (field === "daemonTokenFile" ||
                        field === "tlsCertFile" ||
                        field === "tlsKeyFile")
                ) {
                    continue;
                }
                if (!Value.Check(property, candidate[field])) {
                    throw new ConfigurationError(field, "is missing or invalid");
                }
            }
            throw new ConfigurationError("config", "contains invalid settings");
        }
        const { daemonTokenFile, ...settings } = candidate;
        if (settings.allowInsecureLocal && settings.nodeEnv === "production") {
            throw new ConfigurationError(
                "allowInsecureLocal",
                "is restricted to development and test",
            );
        }
        const tokens = loadTokens(this.env, daemonTokenFile as string | undefined, this.cwd);
        if (this.service === "control-api") {
            const config = { ...settings, tokens } as unknown as ControlApiConfig;
            config.daemonUrl = validateDaemonUrl(config.daemonUrl, config.allowInsecureLocal);
            return config as ConfigFor<S>;
        }
        const config = { ...settings, tokens } as unknown as DaemonConfig;
        if (
            (config.allowInsecureLocal || config.behindReverseProxy) &&
            !isLiteralLoopback(config.host)
        ) {
            throw new ConfigurationError(
                "host",
                "must be literal loopback for local or reverse-proxy mode",
            );
        }
        // Proxy mode does not read certificates: the same-host proxy owns TLS termination.
        if (!config.behindReverseProxy) {
            if (config.tlsCertFile !== undefined || config.tlsKeyFile !== undefined) {
                if (!config.tlsCertFile || !config.tlsKeyFile) {
                    throw new ConfigurationError("tls", "requires both certificate and key files");
                }
                let cert: string;
                let key: string;
                try {
                    cert = readFileSync(resolve(this.cwd, config.tlsCertFile), "utf8");
                    key = readFileSync(resolve(this.cwd, config.tlsKeyFile), "utf8");
                    if (!new X509Certificate(cert).checkPrivateKey(createPrivateKey(key))) {
                        throw new Error();
                    }
                    createSecureContext({ cert, key });
                } catch {
                    throw new ConfigurationError(
                        "tls",
                        "requires a readable, valid, matching PEM certificate and private key",
                    );
                }
                config.tls = { cert, key };
            } else if (!config.allowInsecureLocal) {
                throw new ConfigurationError(
                    "tls",
                    "requires a certificate and key outside local or reverse-proxy mode",
                );
            }
        }
        return config as ConfigFor<S>;
    }
}
