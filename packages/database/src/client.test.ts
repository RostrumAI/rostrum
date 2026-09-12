import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "kysely";
import { createDatabase, type DatabaseOptions, validateDatabaseOptions } from "./client";
import { migrateToLatest } from "./migrator";
import { startTestPostgres } from "./testing/postgres";

const postgres = await startTestPostgres();
afterAll(() => postgres.stop());
const local: DatabaseOptions = {
    url: "postgres://rostrum:rostrum@127.0.0.1:5432/rostrum",
    tlsMode: "disable",
    allowInsecureLocal: true,
    nodeEnv: "test",
    applicationName: "database-boundary-test",
};

async function eventually(
    predicate: () => boolean | Promise<boolean>,
    timeoutMs = 2_000,
): Promise<void> {
    const deadline = performance.now() + timeoutMs;
    while (!(await predicate())) {
        if (performance.now() > deadline)
            throw new Error("Database condition did not settle before deadline");
        await Bun.sleep(10);
    }
}

async function child(source: string, env: Record<string, string | undefined> = {}) {
    const process = Bun.spawn([Bun.which("bun") ?? "bun", "--eval", source], {
        cwd: import.meta.dir,
        env: { ...globalThis.process.env, ...env },
        stdout: "pipe",
        stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
        process.exited,
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
    ]);
    return { exitCode, stdout, stderr };
}

describe("database effective transport policy", () => {
    test("rejects insecure destinations and competing driver options without network", () => {
        for (const url of [
            "postgres://u:p@localhost/db",
            "postgres://u:p@192.168.1.2/db",
            "postgres://u:p@[::ffff:127.0.0.1]/db",
            "postgres://u:p@127.1/db",
            "postgres://u:p@2130706433/db",
            "postgres://u:p@%31%32%37.0.0.1/db",
            "postgres://u:p@127.0.0.1/db?host=remote.example",
            "postgres://u:p@127.0.0.1/db?sslmode=require",
            "postgres://u:p@127.0.0.1/db?sslmode=prefer",
            "postgres://u:p@127.0.0.1/db?sslmode=allow",
            "postgres://u:p@127.0.0.1/db?sslrootcert=system",
            "postgres://u:p@127.0.0.1/db?ssl=false",
            "postgres://u:p@127.0.0.1/db?options=-c%20search_path=wrong",
            "postgres://u:p@127.0.0.1/db?application_name=other",
            "postgres://u:p@127.0.0.1/db?sslmode=disable&sslmode=disable",
            "postgres://u:p@127.0.0.1/db#fragment",
            "postgres://u:p@127.0.0.1/",
        ]) {
            expect(() => validateDatabaseOptions({ ...local, url })).toThrow(
                "Invalid database configuration",
            );
        }
        expect(() => createDatabase({ ...local, nodeEnv: "production" })).toThrow();
        expect(() => createDatabase({ ...local, allowInsecureLocal: false })).toThrow();
    });

    test("pins security and destination against ambient PG overrides", async () => {
        const result = await child(
            `
            import {createDatabase} from './client.ts';
            import {sql} from 'kysely';
            const handle = createDatabase(${JSON.stringify(postgres.options)});
            try { console.log(JSON.stringify((await sql\`select current_database() as db, current_setting('application_name') as app\`.execute(handle.db)).rows[0])); }
            finally { await handle.close({timeoutMs:1000}); }
        `,
            {
                PGHOST: "remote.invalid",
                PGPORT: "1",
                PGUSER: "wrong",
                PGDATABASE: "wrong",
                PGPASSWORD: "wrong",
                PGSSL: "require",
                PGAPPNAME: "wrong",
                PGDEBUG: "true",
            },
        );
        expect(result.exitCode).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual({
            db: decodeURIComponent(new URL(postgres.url).pathname.slice(1)),
            app: postgres.options.applicationName,
        });
    });

    test("rejects runtime verification bypass before pool construction", async () => {
        const result = await child(
            `
            import {createDatabase} from './client.ts';
            try { createDatabase(${JSON.stringify(local)}); process.exit(2); }
            catch { process.exit(0); }
        `,
            { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
        );
        expect(result.exitCode).toBe(0);
    });
});

describe("database readiness and pool ownership", () => {
    test("requires every repository column even with empty tables", async () => {
        const handle = createDatabase(postgres.options);
        try {
            expect(await handle.probe({ timeoutMs: 2_000 })).toEqual({
                status: "failed",
                code: "database_schema_unavailable",
            });
            await migrateToLatest(handle.db);
            expect(await handle.probe({ timeoutMs: 2_000 })).toEqual({ status: "ok" });
            const columns = {
                workflows: ["id", "current_revision", "created_at", "updated_at"],
                revisions: [
                    "id",
                    "workflow_id",
                    "content",
                    "findings",
                    "type",
                    "name",
                    "created_at",
                ],
                publications: [
                    "workflow_id",
                    "publication_number",
                    "revision_id",
                    "workflow_format_version",
                    "canonical_text",
                    "digest",
                    "created_at",
                ],
            };
            for (const [table, names] of Object.entries(columns)) {
                for (const column of names) {
                    await sql`alter table ${sql.id(table)} rename column ${sql.id(column)} to missing_probe_column`.execute(
                        handle.db,
                    );
                    try {
                        expect(await handle.probe({ timeoutMs: 2_000 })).toEqual({
                            status: "failed",
                            code: "database_schema_unavailable",
                        });
                    } finally {
                        await sql`alter table ${sql.id(table)} rename column missing_probe_column to ${sql.id(column)}`.execute(
                            handle.db,
                        );
                    }
                }
            }
        } finally {
            await handle.close({ timeoutMs: 1_000 });
        }
    }, 30_000);

    test("coalesced caller cancellation preserves another subscriber and independent pools", async () => {
        const first = createDatabase({ ...postgres.options, applicationName: "probe-coalescing" });
        const second = createDatabase({
            ...postgres.options,
            applicationName: "probe-other-owner",
        });
        const locked = Promise.withResolvers<void>();
        const unlock = Promise.withResolvers<void>();
        const lock = second.db.transaction().execute(async (transaction) => {
            await sql`lock workflows in access exclusive mode`.execute(transaction);
            locked.resolve();
            await unlock.promise;
        });
        try {
            await locked.promise;
            const controller = new AbortController();
            const cancelled = first.probe({ signal: controller.signal, timeoutMs: 2_000 });
            const surviving = first.probe({ timeoutMs: 2_000 });
            await eventually(async () => {
                const result = await sql<{
                    count: number;
                }>`select count(*)::int as count from pg_stat_activity where application_name = 'probe-coalescing' and wait_event_type = 'Lock'`.execute(
                    second.db,
                );
                return result.rows[0]?.count === 1;
            });
            controller.abort();
            expect(await cancelled).toEqual({ status: "failed", code: "database_timeout" });
            unlock.resolve();
            await lock;
            expect(await surviving).toEqual({ status: "ok" });
            await first.close({ timeoutMs: 100 });
            await first.close({ timeoutMs: 100 });
            expect(await second.probe({ timeoutMs: 2_000 })).toEqual({ status: "ok" });
            expect(
                (await sql<{ value: number }>`select 7 as value`.execute(second.db)).rows,
            ).toEqual([{ value: 7 }]);
        } finally {
            unlock.resolve();
            await lock;
            await Promise.all([
                first.close({ timeoutMs: 1_000 }),
                second.close({ timeoutMs: 1_000 }),
            ]);
        }
    });

    test("lock-blocked timeout retires probe work and permits recovery", async () => {
        const handle = createDatabase({
            ...postgres.options,
            applicationName: "probe-lock-timeout",
            connectTimeoutMs: 100,
        });
        const owner = createDatabase(postgres.options);
        const locked = Promise.withResolvers<void>();
        const unlock = Promise.withResolvers<void>();
        const lock = owner.db.transaction().execute(async (transaction) => {
            await sql`lock workflows in access exclusive mode`.execute(transaction);
            locked.resolve();
            await unlock.promise;
        });
        try {
            await locked.promise;
            const start = performance.now();
            expect(await handle.probe({ timeoutMs: 150 })).toEqual({
                status: "failed",
                code: "database_timeout",
            });
            expect(performance.now() - start).toBeLessThan(750);
            await eventually(async () => {
                const result = await sql<{
                    count: number;
                }>`select count(*)::int as count from pg_stat_activity where application_name = 'probe-lock-timeout'`.execute(
                    owner.db,
                );
                return result.rows[0]?.count === 0;
            });
            unlock.resolve();
            await lock;
            expect(await handle.probe({ timeoutMs: 2_000 })).toEqual({ status: "ok" });
        } finally {
            unlock.resolve();
            await lock;
            await Promise.all([
                handle.close({ timeoutMs: 1_000 }),
                owner.close({ timeoutMs: 1_000 }),
            ]);
        }
    });

    test("connecting and queued subscribers cancel without abandoned connections", async () => {
        const sockets = new Set<Socket>();
        let accepted = 0;
        const listening = Promise.withResolvers<void>();
        const server = createServer((socket) => {
            accepted++;
            sockets.add(socket);
            socket.on("data", () => {});
            socket.on("close", () => sockets.delete(socket));
        });
        server.listen(0, "127.0.0.1", listening.resolve);
        await listening.promise;
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("Missing test listener");
        const handle = createDatabase({
            ...local,
            url: `postgres://u:p@127.0.0.1:${address.port}/db`,
        });
        try {
            for (let round = 0; round < 4; round++) {
                const controllers = Array.from({ length: 10 }, () => new AbortController());
                const probes = controllers.map((controller) =>
                    handle.probe({ signal: controller.signal, timeoutMs: 2_000 }),
                );
                await eventually(() => sockets.size === 1);
                expect(accepted).toBe(round + 1);
                for (const controller of controllers) controller.abort();
                expect(await Promise.all(probes)).toEqual(
                    controllers.map(() => ({ status: "failed", code: "database_timeout" })),
                );
                await eventually(() => sockets.size === 0);
            }
        } finally {
            await handle.close({ timeoutMs: 100 });
            for (const socket of sockets) socket.destroy();
            server.close();
        }
    });
});

test("verified database TLS uses runtime extra trust and verifies DNS and IP SANs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rostrum-db-tls-"));
    const run = async (args: string[]) => {
        const result = Bun.spawn(["openssl", ...args], {
            cwd: directory,
            stdout: "ignore",
            stderr: "pipe",
        });
        const [code, stderr] = await Promise.all([
            result.exited,
            new Response(result.stderr).text(),
        ]);
        if (code !== 0) throw new Error(`Certificate generation failed: ${stderr}`);
    };
    let server: Awaited<ReturnType<typeof startTestPostgres>> | undefined;
    try {
        await run([
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-keyout",
            "ca.key",
            "-out",
            "ca.pem",
            "-days",
            "1",
            "-subj",
            "/CN=Rostrum database test CA",
        ]);
        await run([
            "req",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-keyout",
            "server.key",
            "-out",
            "server.csr",
            "-subj",
            "/CN=localhost",
        ]);
        await writeFile(
            join(directory, "extensions.cnf"),
            "subjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth\n",
        );
        await run([
            "x509",
            "-req",
            "-in",
            "server.csr",
            "-CA",
            "ca.pem",
            "-CAkey",
            "ca.key",
            "-CAcreateserial",
            "-out",
            "server.pem",
            "-days",
            "1",
            "-extfile",
            "extensions.cnf",
        ]);
        server = await startTestPostgres({
            tls: {
                certFile: join(directory, "server.pem"),
                keyFile: join(directory, "server.key"),
            },
        });
        const options = server.options;
        const probe = async (url: string, trusted: boolean) =>
            child(
                `
            import {createDatabase} from './client.ts';
            import {sql} from 'kysely';
            const handle = createDatabase(${JSON.stringify({ ...options, url })});
            try {
                try { await sql\`select 1\`.execute(handle.db); console.log('trusted'); }
                catch { console.log('rejected'); }
                console.log(JSON.stringify(await handle.probe({timeoutMs:2000})));
            } finally { await handle.close({timeoutMs:1000}); }
        `,
                { NODE_EXTRA_CA_CERTS: trusted ? join(directory, "ca.pem") : undefined },
            );
        // The certificate carries only DNS:localhost. A DNS connection is
        // trusted and reaches the schema probe; an IP-literal connection to the
        // same trusted server must still be rejected on identity, which proves
        // hostname verification rather than mere CA trust.
        const byName = new URL(server.url);
        byName.hostname = "localhost";
        const trusted = await probe(byName.toString(), true);
        expect(trusted.exitCode).toBe(0);
        // No migrations is the expected result only after verified TLS succeeds.
        expect(trusted.stdout.trim().split("\n")).toEqual([
            "trusted",
            '{"status":"failed","code":"database_schema_unavailable"}',
        ]);

        const byAddress = new URL(server.url);
        byAddress.hostname = "127.0.0.1";
        const wrongIdentity = await probe(byAddress.toString(), true);
        expect(wrongIdentity.stdout.trim().split("\n")).toEqual([
            "rejected",
            '{"status":"failed","code":"database_unavailable"}',
        ]);

        const untrusted = await probe(byName.toString(), false);
        expect(untrusted.stdout.trim().split("\n")).toEqual([
            "rejected",
            '{"status":"failed","code":"database_unavailable"}',
        ]);
    } finally {
        await server?.stop();
        await rm(directory, { recursive: true, force: true });
    }
}, 30_000);
