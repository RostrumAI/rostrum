import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import postgres from "postgres";

/** A disposable Postgres target plus the teardown that releases it. */
export interface TestPostgres {
    /** Connection URL for postgres.js and Kysely. */
    readonly url: string;
    /** Stops an embedded cluster or drops the dedicated test database. */
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

/**
 * Creates a dedicated throwaway database on the server named by
 * `serverUrl`, leaving the database in the URL untouched. Tests own the
 * whole schema (migration tests drop it), so each test file gets its own
 * database and parallel files cannot interfere; random components keep
 * names unique. Returns a client that drops the database on `stop()`.
 */
async function disposableDatabase(serverUrl: string): Promise<TestPostgres> {
    const databaseName = `rostrum_test_${process.pid}_${Math.round(Math.random() * 1e9)}`;
    const admin = postgres(serverUrl, { max: 1 });
    try {
        await admin.unsafe(`create database "${databaseName}"`);
    } finally {
        await admin.end();
    }
    const url = new URL(serverUrl);
    url.pathname = `/${databaseName}`;
    return {
        url: url.toString(),
        stop: async () => {
            const admin = postgres(serverUrl, { max: 1 });
            try {
                await admin.unsafe(`drop database if exists "${databaseName}" with (force)`);
            } finally {
                await admin.end();
            }
        },
    };
}

/**
 * Returns a disposable database for one test file. When DATABASE_URL is
 * set it names a Postgres server and this creates a dedicated throwaway
 * database on it, so the suite never mutates an application database.
 * Otherwise it starts a throwaway single-node cluster in a temporary
 * directory on a free local port, so the suite runs anywhere the platform
 * binaries install and never requires a Docker daemon. The cluster
 * deletes its data directory on `stop()` (`persistent: false`).
 */
export async function startTestPostgres(): Promise<TestPostgres> {
    const provided = process.env.DATABASE_URL;
    if (provided) {
        const db = await disposableDatabase(provided);
        return { url: db.url, stop: async () => db.stop() };
    }
    const port = await freePort();
    const databaseDir = await mkdtemp(join(tmpdir(), "rostrum-pg-"));
    // stdout stays silent: initdb and the server log hundreds of lines per
    // suite run; stderr keeps flowing so startup failures stay visible.
    const cluster = new EmbeddedPostgres({
        databaseDir,
        user: "rostrum",
        password: "rostrum",
        port,
        persistent: false,
        onLog: () => {},
    });
    await cluster.initialise();
    await cluster.start();
    await cluster.createDatabase("rostrum");
    return {
        url: `postgres://rostrum:rostrum@localhost:${port}/rostrum`,
        stop: async () => {
            await cluster.stop();
        },
    };
}
