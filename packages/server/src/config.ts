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

/** Immutable startup settings shared by independently runnable services. */
export interface BaseConfig {
    /** Address on which this service accepts requests. */
    readonly host: string;
    /** Listener port; zero selects an available port. */
    readonly port: number;
    /** Deployment environment used to enforce production restrictions. */
    readonly nodeEnv: "development" | "test" | "production";
    /** Minimum severity emitted by service logging. */
    readonly logLevel: LogLevel;
    /** Connection URL for the service-owned database handle. */
    readonly databaseUrl: string;
    /** Whether database connections require verified TLS. */
    readonly databaseTls: boolean;
    /** Whether development or test may use loopback-only plaintext transport. */
    readonly allowInsecureLocal: boolean;
    /** Accepted credentials in oldest-to-newest order; clients send the newest. */
    readonly tokens: readonly string[];
    /** Maximum duration of a dependency readiness check, in milliseconds. */
    readonly dependencyTimeoutMs: number;
    /** Maximum duration of graceful shutdown, in milliseconds. */
    readonly shutdownTimeoutMs: number;
}

/** Immutable daemon listener, database, authentication, and lifecycle settings. */
export interface DaemonConfig extends BaseConfig {
    /** Whether a same-host reverse proxy terminates incoming TLS. */
    readonly behindReverseProxy: boolean;
    /** Certificate file resolved against the startup working directory. */
    readonly tlsCertFile?: string;
    /** Private-key file resolved against the startup working directory. */
    readonly tlsKeyFile?: string;
    /** Validated PEM material used when the daemon terminates TLS directly. */
    readonly tls?: {
        /** PEM certificate presented by the daemon listener. */
        readonly cert: string;
        /** PEM private key matching the listener certificate. */
        readonly key: string;
    };
}

/** Immutable Control API listener, database, daemon-client, and lifecycle settings. */
export interface ControlApiConfig extends BaseConfig {
    /** Validated, normalized origin of the daemon service. */
    readonly daemonUrl: string;
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

/** Captures startup inputs for independent parses of immutable service configuration. */
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
        // Fix the service, the startup environment, and the working directory
        // that later loads resolve their files against.
        this.service = service;
        this.env = Object.freeze({ ...env });
        this.cwd = resolve(cwd);

        // The selected file is fixed at boot because the operator chose it.
        // An explicitly selected empty path is rejected rather than defaulted.
        const selected = env[service === "daemon" ? "DAEMON_CONFIG" : "CONTROL_API_CONFIG"];
        if (selected !== undefined && selected.trim() === "") {
            throw new ConfigurationError("config", "must select a non-empty file path");
        }
        this.explicitFile = selected !== undefined;
        this.file = resolve(this.cwd, selected ?? "config.yaml");
    }

    /** Parses and validates a fresh immutable startup configuration on each call. */
    load(): ConfigFor<S> {
        // Refuse to start with certificate verification disabled.
        if (
            this.env.NODE_TLS_REJECT_UNAUTHORIZED === "0" ||
            process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0"
        ) {
            throw new ConfigurationError(
                "NODE_TLS_REJECT_UNAUTHORIZED",
                "must not disable certificate verification",
            );
        }

        // Pick this service's validating and file-level schemas.
        const schema = this.service === "daemon" ? DaemonSchema : ControlApiSchema;
        const fileSchema = this.service === "daemon" ? DaemonFileSchema : ControlApiFileSchema;

        // Read the YAML file; only the default file may be absent.
        let text: string | undefined;
        try {
            text = readFileSync(this.file, "utf8");
        } catch (error) {
            if (this.explicitFile || (error as NodeJS.ErrnoException).code !== "ENOENT") {
                throw new ConfigurationError("config", "must be a readable YAML file");
            }
        }

        // The file must parse as YAML.
        let file: unknown = {};
        if (text !== undefined) {
            try {
                file = Bun.YAML.parse(text) ?? {};
            } catch {
                throw new ConfigurationError("config", "must contain valid YAML");
            }
        }

        // Unknown keys and wrongly typed fields are operator mistakes, not settings.
        if (!Value.Check(fileSchema, file)) {
            throw new ConfigurationError("config", "contains unknown keys or invalid field types");
        }

        // Layer the file over the documented defaults to form the candidate.
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

        // Environment variables win over the file, coerced by their target type.
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

        // An unset log level follows the environment: quiet in production, chatty elsewhere.
        candidate.logLevel ??= candidate.nodeEnv === "production" ? "info" : "debug";

        // Reject an incomplete or invalid candidate, naming the property at fault.
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

        // The insecure-local exception is development-only, and a token file is
        // an input to loading rather than a runtime setting.
        const { daemonTokenFile, ...settings } = candidate;
        if (settings.allowInsecureLocal && settings.nodeEnv === "production") {
            throw new ConfigurationError(
                "allowInsecureLocal",
                "is restricted to development and test",
            );
        }

        // Load tokens, then run the checks only this service needs.
        const tokenFile = typeof daemonTokenFile === "string" ? daemonTokenFile : undefined;
        const tokens = loadTokens(this.env, tokenFile, this.cwd);

        // The schema proved the settings' types, but cannot narrow the Record to
        // this service's shape. Assert only the validated input fields.
        if (this.service === "control-api") {
            const control = settings as unknown as Omit<ControlApiConfig, "tokens">;
            const daemonUrl = validateDaemonUrl(control.daemonUrl, control.allowInsecureLocal);
            return Object.freeze({ ...control, tokens, daemonUrl }) as ConfigFor<S>;
        }
        const daemon = settings as unknown as Omit<DaemonConfig, "tokens" | "tls">;
        if (
            (daemon.allowInsecureLocal || daemon.behindReverseProxy) &&
            !isLiteralLoopback(daemon.host)
        ) {
            throw new ConfigurationError(
                "host",
                "must be literal loopback for local or reverse-proxy mode",
            );
        }
        // Proxy mode does not read certificates: the same-host proxy owns TLS termination.
        let tls: DaemonConfig["tls"];
        if (!daemon.behindReverseProxy) {
            if (daemon.tlsCertFile !== undefined || daemon.tlsKeyFile !== undefined) {
                if (!daemon.tlsCertFile || !daemon.tlsKeyFile) {
                    throw new ConfigurationError("tls", "requires both certificate and key files");
                }
                let cert: string;
                let key: string;
                try {
                    cert = readFileSync(resolve(this.cwd, daemon.tlsCertFile), "utf8");
                    key = readFileSync(resolve(this.cwd, daemon.tlsKeyFile), "utf8");
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
                tls = Object.freeze({ cert, key });
            } else if (!daemon.allowInsecureLocal) {
                throw new ConfigurationError(
                    "tls",
                    "requires a certificate and key outside local or reverse-proxy mode",
                );
            }
        }

        // Keep validated settings and direct TLS material fixed for the caller's lifetime.
        return Object.freeze({ ...daemon, tokens, ...(tls ? { tls } : {}) }) as ConfigFor<S>;
    }
}
