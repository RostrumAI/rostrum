import { appendFile, mkdtemp } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { sql } from "kysely";
import { createDatabase, type DatabaseOptions } from "../client";

/** A disposable Postgres target plus the teardown that releases it. */
export interface TestPostgres {
    readonly url: string;
    /** Explicit security settings, retained when only the database name changes. */
    readonly options: DatabaseOptions;
    /** Stops an embedded cluster or drops only the dedicated test database. */
    stop(): Promise<void>;
}
function freePort(): Promise<number> {
    const { promise, resolve, reject } = Promise.withResolvers<number>();
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
            reject(new Error("The operating system assigned no TCP port"));
            return;
        }
        const { port } = address;
        server.close(() => resolve(port));
    });
    return promise;
}

async function disposableDatabase(options: DatabaseOptions): Promise<TestPostgres> {
    const databaseName = `rostrum_test_${process.pid}_${Math.round(Math.random() * 1e9)}`;
    const admin = createDatabase(options);
    try {
        await sql`create database ${sql.id(databaseName)}`.execute(admin.db);
    } finally {
        await admin.close({ timeoutMs: 1_000 });
    }
    const url = new URL(options.url);
    url.pathname = `/${databaseName}`;
    const disposableOptions = { ...options, url: url.toString() };
    return {
        url: disposableOptions.url,
        options: disposableOptions,
        stop: async () => {
            const admin = createDatabase(options);
            try {
                await sql`drop database if exists ${sql.id(databaseName)} with (force)`.execute(
                    admin.db,
                );
            } finally {
                await admin.close({ timeoutMs: 1_000 });
            }
        },
    };
}

/**
 * Owns an isolated database, never the application database in DATABASE_URL.
 * External servers retain their URL transport policy and runtime extra trust.
 * An optional TLS pair starts a separate embedded server for transport tests;
 * clients must launch with NODE_EXTRA_CA_CERTS rather than overriding ca.
 */
export async function startTestPostgres(
    settings: { tls?: { certFile: string; keyFile: string } } = {},
): Promise<TestPostgres> {
    const provided = process.env.DATABASE_URL;
    if (provided && !settings.tls) {
        const tlsMode = process.env.DATABASE_TLS_MODE ?? "verify-full";
        const insecure = process.env.ALLOW_INSECURE_LOCAL ?? "false";
        if (
            (tlsMode !== "verify-full" && tlsMode !== "disable") ||
            (insecure !== "true" && insecure !== "false")
        ) {
            throw new Error("Invalid disposable database transport settings");
        }
        return disposableDatabase({
            url: provided,
            tlsMode,
            allowInsecureLocal: insecure === "true",
            nodeEnv: "test",
            applicationName: "database-tests",
        });
    }
    const port = await freePort();
    const databaseDir = await mkdtemp(join(tmpdir(), "rostrum-pg-"));
    const cluster = new EmbeddedPostgres({
        databaseDir,
        user: "rostrum",
        password: "rostrum",
        port,
        persistent: false,
        onLog: () => {},
    });
    await cluster.initialise();
    if (settings.tls) {
        const cert = settings.tls.certFile.replaceAll("'", "''");
        const key = settings.tls.keyFile.replaceAll("'", "''");
        await appendFile(
            join(databaseDir, "postgresql.conf"),
            `\nssl = on\nssl_cert_file = '${cert}'\nssl_key_file = '${key}'\n`,
        );
    }
    await cluster.start();
    await cluster.createDatabase("rostrum");
    const url = `postgres://rostrum:rostrum@127.0.0.1:${port}/rostrum`;
    return {
        url,
        options: {
            url,
            tlsMode: settings.tls ? "verify-full" : "disable",
            allowInsecureLocal: !settings.tls,
            nodeEnv: "test",
            applicationName: "database-tests",
        },
        stop: async () => {
            await cluster.stop();
        },
    };
}
