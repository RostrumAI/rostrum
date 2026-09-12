import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { connect, createServer } from "node:net";
import { join } from "node:path";
import { authenticate } from "./auth";
import { DaemonProcess } from "./scripts/process";

function credential(token: string): Record<string, string> {
    return { authorization: `Bearer ${token}` };
}

async function rawRequest(port: number, authorization: string): Promise<string> {
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    let response = "";
    const socket = connect({ host: "127.0.0.1", port }, () => {
        socket.write(
            `GET /api/system/health HTTP/1.1\r\nHost: 127.0.0.1\r\n${authorization}\r\nConnection: close\r\n\r\n`,
        );
    });
    socket.setEncoding("utf8");
    // This bounds a real child-process socket; fake timers cannot drive that process.
    socket.setTimeout(3000, () => socket.destroy(new Error("Raw HTTP request timed out")));
    socket.on("data", (chunk) => {
        response += chunk;
    });
    socket.on("error", reject);
    socket.on("end", () => resolve(response));
    return promise;
}

describe("daemon authentication", () => {
    test("compares decoded token bytes, accepts every length and case, and rejects malformed or combined credentials", () => {
        const tokens = [randomBytes(32).toString("hex"), randomBytes(48).toString("hex")];
        for (const token of tokens) {
            const result = authenticate(
                new Request("http://localhost/", { headers: credential(token.toUpperCase()) }),
                { tokens },
            );
            expect(result).toBeUndefined();
        }
        const invalid = [
            undefined,
            "",
            "Basic x",
            `Bearer ${tokens[0]},${tokens[1]}`,
            `Bearer ${tokens[0]}, Bearer ${tokens[0]}`,
            `Bearer ${tokens[0]} x`,
            "Bearer zz",
            `Bearer ${randomBytes(31).toString("hex")}`,
            `Bearer ${randomBytes(32).toString("hex")}`,
        ];
        for (const value of invalid) {
            const headers = value === undefined ? undefined : { authorization: value };
            const result = authenticate(new Request("http://localhost/", { headers }), { tokens });
            expect(result?.status).toBe(401);
            expect(result?.headers.get("www-authenticate")).toBe("Bearer");
            expect(result?.headers.get("cache-control")).toBe("no-store");
        }
    });

    test("authenticates before routes, methods, OpenAPI, and readiness; rejects duplicate wire headers", async () => {
        const daemon = await DaemonProcess.spawn();
        try {
            const origin = await daemon.listening();
            for (const path of [
                "/api/system/health",
                "/api/system/readiness",
                "/openapi.json",
                "/unknown",
            ]) {
                const response = await fetch(`${origin}${path}`, {
                    method: "POST",
                    body: "not JSON",
                });
                expect(response.status).toBe(401);
                const body = (await response.json()) as { code: string; findings: unknown[] };
                expect(body.code).toBe("unauthorized");
                expect(body.findings).toEqual([]);
            }
            for (const token of daemon.tokens) {
                const response = await fetch(`${origin}/api/system/health`, {
                    headers: credential(token),
                });
                expect(response.status).toBe(200);
                expect(await response.json()).toEqual({ status: "ok" });
            }
            const headers = credential(daemon.tokens[0]!);
            const missing = await fetch(`${origin}/unknown`, { headers });
            expect(missing.status).toBe(404);
            expect(((await missing.json()) as { code: string }).code).toBe("not_found");
            const unsupported = await fetch(`${origin}/api/system/health`, {
                method: "POST",
                headers,
            });
            expect(unsupported.status).toBe(405);
            expect(unsupported.headers.get("allow")).toBe("GET, HEAD");
            const head = await fetch(`${origin}/api/system/health`, { method: "HEAD", headers });
            expect(head.status).toBe(200);
            expect(await head.text()).toBe("");
            expect(head.headers.get("cache-control")).toBe("no-store");
            const duplicate = await rawRequest(
                daemon.port!,
                `Authorization: Bearer ${daemon.tokens[0]}\r\nAuthorization: Bearer ${daemon.tokens[0]}`,
            );
            expect(duplicate).toMatch(/^HTTP\/1\.1 401 /);
            const document = await fetch(`${origin}/openapi.json`, { headers });
            expect(document.status).toBe(200);
            const spec = (await document.json()) as {
                security: unknown;
                components: { securitySchemes: unknown };
            };
            expect(spec.security).toEqual([{ daemonBearer: [] }]);
            expect(spec.components.securitySchemes).toEqual({
                daemonBearer: { type: "http", scheme: "bearer" },
            });
        } finally {
            await daemon.dispose();
        }
    }, 15000);
});

describe("daemon executable boundary", () => {
    test("invalid settings fail before listening or attempting dependency connections", async () => {
        let connections = 0;
        const trap = createServer((socket) => {
            connections++;
            socket.destroy();
        });
        const listening = Promise.withResolvers<void>();
        trap.once("error", listening.reject);
        trap.listen(0, "127.0.0.1", listening.resolve);
        await listening.promise;
        const address = trap.address();
        if (!address || typeof address === "string") throw new Error("No trap listener address");
        try {
            const candidates = [
                { config: { unknownSecuritySetting: true } },
                { env: { ALLOW_INSECURE_LOCAL: "yes" } },
                { env: { DAEMON_TOKEN: randomBytes(31).toString("hex") } },
                {
                    env: {
                        DAEMON_TOKEN: randomBytes(32).toString("hex"),
                        DAEMON_TOKEN_FILE: "/missing/token",
                    },
                },
                { config: { host: "0.0.0.0" } },
                { config: { allowInsecureLocal: false, databaseTlsMode: "verify-full" } },
                {
                    config: {
                        behindReverseProxy: true,
                        host: "192.0.2.1",
                        allowInsecureLocal: false,
                        databaseTlsMode: "verify-full",
                    },
                },
                { env: { NODE_TLS_REJECT_UNAUTHORIZED: "0" } },
            ];
            for (const candidate of candidates) {
                const daemon = await DaemonProcess.spawn({
                    ...candidate,
                    config: {
                        databaseUrl: `postgres://daemon_test@127.0.0.1:${address.port}/daemon_test`,
                        ...candidate.config,
                    },
                });
                try {
                    expect(await daemon.exited(4000)).not.toBe(0);
                    expect(daemon.logs).not.toContain('"msg":"listening"');
                    expect(connections).toBe(0);
                    for (const token of daemon.tokens) expect(daemon.logs).not.toContain(token);
                } finally {
                    await daemon.dispose();
                }
            }
        } finally {
            const closed = Promise.withResolvers<void>();
            trap.close((error) => (error ? closed.reject(error) : closed.resolve()));
            await closed.promise;
        }
    }, 40000);

    test("unavailable database leaves health live and readiness unready", async () => {
        const daemon = await DaemonProcess.spawn();
        try {
            const origin = await daemon.listening();
            const headers = credential(daemon.tokens[0]!);
            const ready = await fetch(`${origin}/api/system/readiness`, { headers });
            expect(ready.status).toBe(503);
            expect(ready.headers.get("cache-control")).toBe("no-store");
            expect(await ready.json()).toEqual({
                status: "not_ready",
                checks: { database: { status: "failed", code: "database_unavailable" } },
            });
            const health = await fetch(`${origin}/api/system/health`, { headers });
            expect(health.status).toBe(200);
            expect(await health.json()).toEqual({ status: "ok" });
            daemon.child.kill("SIGTERM");
            expect(await daemon.exited(5000)).toBe(0);
        } finally {
            await daemon.dispose();
        }
    }, 15000);

    test("SIGHUP overlaps and retires tokens without restarting, and rejects the entire invalid candidate", async () => {
        const daemon = await DaemonProcess.spawn();
        try {
            const origin = await daemon.listening();
            const old = daemon.tokens[0]!;
            const newest = randomBytes(32).toString("hex");
            const status = async (token: string) => {
                const response = await fetch(`${origin}/api/system/health`, {
                    headers: credential(token),
                });
                await response.arrayBuffer();
                return response.status;
            };
            expect(await status(newest)).toBe(401);
            await writeFile(daemon.tokenFile, `${old}\n${newest}\n`);
            daemon.child.kill("SIGHUP");
            await daemon.waitFor(() => daemon.logs.includes("reload applied"));
            expect(await status(old)).toBe(200);
            expect(await status(newest)).toBe(200);
            let offset = daemon.logs.length;
            await writeFile(daemon.tokenFile, `${newest}\n`);
            daemon.child.kill("SIGHUP");
            await daemon.waitFor(() => daemon.logs.slice(offset).includes("reload applied"));
            expect(await status(old)).toBe(401);
            expect(await status(newest)).toBe(200);
            offset = daemon.logs.length;
            const rejected = randomBytes(32).toString("hex");
            await writeFile(daemon.tokenFile, `${rejected}\n`);
            await writeFile(
                daemon.configFile,
                JSON.stringify({ ...daemon.config, host: "0.0.0.0" }),
            );
            daemon.child.kill("SIGHUP");
            await daemon.waitFor(() => daemon.logs.slice(offset).includes("reload rejected"));
            expect(await status(newest)).toBe(200);
            expect(await status(rejected)).toBe(401);
            expect(daemon.child.exitCode).toBeNull();
            for (const token of [old, newest, rejected]) expect(daemon.logs).not.toContain(token);
        } finally {
            await daemon.dispose();
        }
    }, 20000);

    test("direct TLS serves authenticated health with runtime extra trust and rejects an untrusted certificate", async () => {
        const daemon = await DaemonProcess.spawn({
            prepare: async (directory) => {
                const cert = join(directory, "cert.pem");
                const key = join(directory, "key.pem");
                const opensslConfig = join(directory, "openssl.cnf");
                await writeFile(
                    opensslConfig,
                    "[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=ext\n[dn]\nCN=localhost\n[ext]\nsubjectAltName=IP:127.0.0.1,DNS:localhost\nbasicConstraints=critical,CA:TRUE\n",
                );
                const generation = Bun.spawn(
                    [
                        "openssl",
                        "req",
                        "-x509",
                        "-newkey",
                        "rsa:2048",
                        "-nodes",
                        "-days",
                        "1",
                        "-config",
                        opensslConfig,
                        "-keyout",
                        key,
                        "-out",
                        cert,
                    ],
                    { stdout: "ignore", stderr: "pipe" },
                );
                const diagnostics = await new Response(generation.stderr).text();
                if ((await generation.exited) !== 0)
                    throw new Error(`Certificate generation failed: ${diagnostics}`);
                return { tlsCertFile: cert, tlsKeyFile: key };
            },
        });
        try {
            const origin = await daemon.listening();
            const script =
                'const response = await fetch(process.env.TARGET, {headers: {authorization: `Bearer ${process.env.TOKEN}`}, proxy: ""}); console.log(JSON.stringify({status: response.status, body: await response.json()}));';
            const env = {
                PATH: process.env.PATH,
                TARGET: `${origin}/api/system/health`,
                TOKEN: daemon.tokens[0],
            };
            const trusted = Bun.spawn([process.execPath, "-e", script], {
                cwd: daemon.directory,
                env: { ...env, NODE_EXTRA_CA_CERTS: join(daemon.directory, "cert.pem") },
                stdout: "pipe",
                stderr: "pipe",
            });
            const output = await new Response(trusted.stdout).text();
            expect(await trusted.exited).toBe(0);
            expect(JSON.parse(output)).toEqual({ status: 200, body: { status: "ok" } });
            const untrusted = Bun.spawn([process.execPath, "-e", script], {
                cwd: daemon.directory,
                env,
                stdout: "ignore",
                stderr: "pipe",
            });
            await new Response(untrusted.stderr).text();
            expect(await untrusted.exited).not.toBe(0);
        } finally {
            await daemon.dispose();
        }
    }, 20000);
});
