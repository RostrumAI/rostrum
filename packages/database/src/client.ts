/** @fileoverview Service-owned Postgres client and readiness probe. */

import { connect, isIP, type Socket } from "node:net";
import { checkServerIdentity } from "node:tls";
import { CamelCasePlugin, Kysely } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";
import type { Database } from "./schema/database";

/**
 * Connection policy for one service-owned database handle.
 *
 * TLS remains verified when enabled. Disabling it requires the explicit
 * development/test loopback exception.
 */
export interface DatabaseOptions {
    url: string;
    tls: boolean;
    allowInsecureLocal: boolean;
    nodeEnv: "development" | "test" | "production";
    applicationName: string;
    connectTimeoutMs?: number;
}

/** Stable outcomes returned by a database readiness probe. */
export type DatabaseCheck =
    | { status: "ok" }
    | {
          status: "failed";
          code: "database_unavailable" | "database_timeout" | "database_schema_unavailable";
      };

/** A service-owned query interface, readiness probe, and bounded close operation. */
export interface DatabaseHandle {
    readonly db: Kysely<Database>;
    probe(options: { signal?: AbortSignal; timeoutMs: number }): Promise<DatabaseCheck>;
    close(options: { timeoutMs: number }): Promise<void>;
}

function invalid(field: string): never {
    throw new Error(`Invalid database configuration: ${field}`);
}

function parseTarget(options: DatabaseOptions): {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
} {
    if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
        invalid("TLS verification bypass");
    }
    // postgres.js parses this setting outside its normal option merge.
    if (process.env.PGTARGETSESSIONATTRS) {
        invalid("PGTARGETSESSIONATTRS is unsupported");
    }
    if (typeof options.tls !== "boolean") {
        invalid("tls");
    }
    if (!["development", "test", "production"].includes(options.nodeEnv)) {
        invalid("nodeEnv");
    }
    if (typeof options.allowInsecureLocal !== "boolean") {
        invalid("allowInsecureLocal");
    }
    if (!options.applicationName || !/^[a-zA-Z0-9_-]{1,63}$/.test(options.applicationName)) {
        invalid("applicationName");
    }
    if (
        options.connectTimeoutMs !== undefined &&
        (!Number.isSafeInteger(options.connectTimeoutMs) || options.connectTimeoutMs <= 0)
    ) {
        invalid("connectTimeoutMs");
    }
    let url: URL;
    try {
        url = new URL(options.url);
    } catch {
        return invalid("url");
    }
    if (!/^postgres(?:ql)?:\/\//.test(options.url) || url.hash || /[\s\\]/.test(options.url)) {
        invalid("url");
    }
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (
        !host ||
        (!isIP(host) && !/^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(host))
    ) {
        invalid("host");
    }
    if (host.includes(",") || (!isIP(host) && /^[0-9.]+$/.test(host))) {
        invalid("host");
    }
    const port = url.port ? Number(url.port) : 5432;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        invalid("port");
    }
    const expectedSslMode = options.tls ? "verify-full" : "disable";
    for (const [key, value] of url.searchParams) {
        if (
            key !== "sslmode" ||
            value !== expectedSslMode ||
            url.searchParams.getAll(key).length !== 1
        ) {
            invalid("URL options");
        }
    }
    const local =
        (isIP(host) === 4 && host.split(".")[0] === "127") ||
        (isIP(host) === 6 && new URL(`http://[${host}]`).hostname === "[::1]");
    if (options.allowInsecureLocal && options.nodeEnv === "production") {
        invalid("allowInsecureLocal in production");
    }
    if (!options.tls && (!options.allowInsecureLocal || !local)) {
        invalid("plaintext requires a literal loopback development/test target");
    }
    try {
        const user = decodeURIComponent(url.username);
        const password = decodeURIComponent(url.password);
        const database = decodeURIComponent(url.pathname.slice(1));
        if (!user || !database || /[\0/]/.test(database) || /\0/.test(user + password)) {
            invalid("credentials/database");
        }
        return { host, port, user, password, database };
    } catch {
        return invalid("credentials/database");
    }
}

/** Synchronous, network-free validation of the effective connection policy. */
export function validateDatabaseOptions(options: DatabaseOptions): void {
    parseTarget(options);
}

// Explicit columns force PostgreSQL to resolve every repository dependency,
// including on empty tables. FALSE prevents application-row reads and scans.
const SCHEMA_PROBE = `
select id, current_revision, created_at, updated_at from workflows where false;
select id, workflow_id, content, findings, type, name, created_at from revisions where false;
select workflow_id, publication_number, revision_id, workflow_format_version,
       canonical_text, digest, created_at from publications where false`;

interface Flight {
    controller: AbortController;
    subscribers: number;
    result: Promise<DatabaseCheck>;
}

/**
 * Kysely retains the ordinary ten-connection postgres.js pool. Readiness owns
 * one isolated connection: postgres.js 3.4.9 cannot abort reserve(), and its
 * pending.cancel() discards the cancellation connection's promise. Isolation
 * lets us force-close a probe without touching a workflow transaction.
 */
export function createDatabase(options: DatabaseOptions): DatabaseHandle {
    const target = parseTarget(options);
    const driverOptions = {
        // Arrays preserve IPv6: the driver's scalar host parser splits on ':'.
        host: [target.host],
        port: [target.port],
        user: target.user,
        // A function pins even the empty password instead of inheriting PGPASSWORD.
        password: () => target.password,
        database: target.database,
        ssl: options.tls
            ? {
                  rejectUnauthorized: true,
                  ...(isIP(target.host) ? {} : { servername: target.host }),
                  checkServerIdentity: (
                      _name: string,
                      certificate: Parameters<typeof checkServerIdentity>[1],
                  ) => checkServerIdentity(target.host, certificate),
              }
            : false,
        sslnegotiation: null,
        max: 10,
        max_pipeline: 100,
        connect_timeout: (options.connectTimeoutMs ?? 5_000) / 1_000,
        idle_timeout: 0,
        max_lifetime: null,
        keep_alive: 60,
        backoff: false,
        prepare: true,
        fetch_types: true,
        debug: false,
        publications: "alltables",
        connection: { application_name: options.applicationName },
        onnotice: () => {},
    };
    // postgres.js accepts host arrays but its public Options narrows host to a
    // scalar despite BaseOptions declaring both; the array form is required to
    // keep an IPv6 literal intact (the scalar parser splits on ':').
    const pool = postgres(driverOptions as unknown as postgres.Options<{}>);
    const db = new Kysely<Database>({
        dialect: new PostgresJSDialect({ postgres: pool }),
        plugins: [new CamelCasePlugin()],
    });
    let closing: Promise<void> | undefined;
    let flight: Flight | undefined;

    async function runProbe(signal: AbortSignal, timeoutMs: number): Promise<DatabaseCheck> {
        let socket: Socket | undefined;
        let ended: Promise<void> | undefined;
        let abort: (() => void) | undefined;
        // A refused, unreachable, or TLS-rejected transport never reaches
        // postgres.js's own error path when the socket is supplied: the driver
        // retries instead of failing the pending query, which would surface as a
        // deadline timeout. Settle the probe on the transport failure itself.
        const transportFailure = Promise.withResolvers<DatabaseCheck>();
        // A server-side timeout also bounds abandoned server work after a lost
        // transport. Caller deadlines and aborts still retire the socket sooner.
        const serverTimeoutMs = Math.min(
            2_147_483_655,
            Math.max(timeoutMs, options.connectTimeoutMs ?? 5_000),
        );
        const probeOptions = {
            ...driverOptions,
            max: 1,
            max_pipeline: 1,
            connect_timeout: serverTimeoutMs / 1_000,
            fetch_types: false,
            connection: {
                application_name: options.applicationName,
                statement_timeout: Math.ceil(serverTimeoutMs),
            },
            // Retain the raw socket because postgres.js end({timeout:0}) only
            // calls socket.end(), which cannot force a half-open transport shut.
            socket: () => {
                const raw = connect({ host: target.host, port: target.port });
                const fail = () => {
                    transportFailure.resolve({
                        status: "failed",
                        code: "database_unavailable",
                    });
                    abort?.();
                };
                // Both events matter: a refusal raises `error`, while a TLS
                // handshake failure closes the transport without one.
                raw.once("error", fail);
                raw.once("close", fail);
                socket = raw;
                return raw;
            },
        };
        // Same narrowed-Options cast as the pool: the host array preserves IPv6.
        const probe = postgres(probeOptions as unknown as postgres.Options<{}>);
        abort = () => {
            ended ??= probe.end({ timeout: 0 }).finally(() => socket?.destroy());
        };
        signal.addEventListener("abort", abort, { once: true });
        try {
            if (signal.aborted) {
                abort();
                return { status: "failed", code: "database_timeout" };
            }
            // `transportFailure` resolves with a failed check; the query
            // resolves undefined on success. Promise.race subscribes to both, so
            // the losing query's later rejection is handled here, not leaked.
            const raced = await Promise.race([
                probe
                    .unsafe(SCHEMA_PROBE)
                    .simple()
                    .then(() => undefined),
                transportFailure.promise,
            ]);
            if (raced !== undefined) {
                return raced;
            }
            return signal.aborted
                ? { status: "failed", code: "database_timeout" }
                : { status: "ok" };
        } catch (error) {
            const code =
                error && typeof error === "object" && "code" in error ? error.code : undefined;
            // SQLSTATE classification. `57014` is query_canceled, which is what
            // the server-side statement_timeout raises; `CONNECT_TIMEOUT` is the
            // driver's own connect deadline. The schema codes below mean the
            // database answered but the expected objects are not readable:
            // `42P01` undefined_table, `42703` undefined_column,
            // `42501` insufficient_privilege, `3F000` invalid_schema_name.
            // Anything else is a transport or server availability failure.
            return {
                status: "failed",
                code:
                    signal.aborted || code === "57014" || code === "CONNECT_TIMEOUT"
                        ? "database_timeout"
                        : ["42P01", "42703", "42501", "3F000"].includes(String(code))
                          ? "database_schema_unavailable"
                          : "database_unavailable",
            };
        } finally {
            signal.removeEventListener("abort", abort);
            abort();
            await ended;
        }
    }

    return {
        db,
        probe({ signal, timeoutMs }) {
            if (closing) {
                return Promise.resolve({ status: "failed", code: "database_unavailable" });
            }
            if (signal?.aborted || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
                return Promise.resolve({ status: "failed", code: "database_timeout" });
            }
            // A flight whose controller is already aborted is settling and would
            // hand this caller its own failure (a fabricated timeout) instead of
            // using the caller's own deadline. Treat it as no live flight.
            if (flight === undefined || flight.controller.signal.aborted) {
                const controller = new AbortController();
                const current: Flight = {
                    controller,
                    subscribers: 0,
                    result: runProbe(controller.signal, timeoutMs),
                };
                flight = current;
                void current.result.finally(() => {
                    if (flight === current) {
                        flight = undefined;
                    }
                });
            }
            const current = flight;
            current.subscribers++;
            const { promise, resolve } = Promise.withResolvers<DatabaseCheck>();
            let settled = false;
            const finish = (result: DatabaseCheck) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                signal?.removeEventListener("abort", abort);
                current.subscribers -= 1;
                if (current.subscribers === 0) {
                    current.controller.abort();
                }
                resolve(result);
            };
            const abort = () => finish({ status: "failed", code: "database_timeout" });
            const timer = setTimeout(abort, timeoutMs);
            signal?.addEventListener("abort", abort, { once: true });
            void current.result.then(finish);
            return promise;
        },
        close({ timeoutMs }) {
            if (closing) {
                return closing;
            }
            // Initiate bounded pool shutdown before the dialect's unbounded end.
            const ended = pool.end({ timeout: Math.max(0, timeoutMs) / 1_000 });
            flight?.controller.abort();
            closing = Promise.all([ended, flight?.result]).then(() => db.destroy());
            return closing;
        },
    };
}
