import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ServiceConfigSource } from "./config";
import { ConfigurationError } from "./network";
import { loadTokens, parseTokens } from "./tokens";

const oldest = "ab".repeat(32);
const newest = "cd".repeat(48);
const directories: string[] = [];
afterEach(() => {
    for (const directory of directories.splice(0))
        rmSync(directory, { recursive: true, force: true });
});
function workspace(): string {
    const directory = mkdtempSync(join(tmpdir(), "rostrum-config-"));
    directories.push(directory);
    return directory;
}
const localEnv = {
    DATABASE_URL: "postgres://user:secret@127.0.0.1/db",
    ALLOW_INSECURE_LOCAL: "true",
    DAEMON_TOKEN: oldest,
};

describe("configuration candidates", () => {
    test("retains startup overrides and selected file while rereading YAML", () => {
        const cwd = workspace();
        writeFileSync(join(cwd, "selected.yaml"), "port: 3100\nlogLevel: warning\n");
        const env = { ...localEnv, DAEMON_CONFIG: "selected.yaml", PORT: "3200" };
        const source = new ServiceConfigSource("daemon", env, cwd);
        const first = source.load();
        env.PORT = "3300";
        env.DAEMON_CONFIG = "missing.yaml";
        writeFileSync(join(cwd, "selected.yaml"), "port: 3400\nlogLevel: error\n");
        const second = source.load();
        expect(first.port).toBe(3200);
        expect(first.logLevel).toBe("warning");
        expect(second.port).toBe(3200);
        expect(second.logLevel).toBe("error");
    });

    test("permits absent default files but never ignores an explicit missing selection", () => {
        const cwd = workspace();
        expect(new ServiceConfigSource("daemon", localEnv, cwd).load().tokens).toEqual([oldest]);
        expect(() =>
            new ServiceConfigSource(
                "daemon",
                { ...localEnv, DAEMON_CONFIG: "missing.yaml" },
                cwd,
            ).load(),
        ).toThrow(ConfigurationError);
        expect(
            () => new ServiceConfigSource("daemon", { ...localEnv, DAEMON_CONFIG: "" }, cwd),
        ).toThrow(ConfigurationError);
    });

    test("rejects unknown or mistyped file values before an environment override can hide them", () => {
        const cwd = workspace();
        for (const yaml of [
            "allowInsecureLocall: true",
            "port: wrong",
            "allowInsecureLocal: 'true'",
            "daemonToken: secret",
            "daemonUrl: https://daemon.example",
            "databaseCaFile: ca.pem",
            "[one, two]",
        ]) {
            writeFileSync(join(cwd, "config.yaml"), yaml);
            expect(() =>
                new ServiceConfigSource("daemon", { ...localEnv, PORT: "3001" }, cwd).load(),
            ).toThrow(ConfigurationError);
        }
        writeFileSync(join(cwd, "config.yaml"), "tlsCertFile: cert.pem");
        expect(() =>
            new ServiceConfigSource(
                "control-api",
                { ...localEnv, DAEMON_URL: "http://127.0.0.1" },
                cwd,
            ).load(),
        ).toThrow(ConfigurationError);
    });

    test("rejects numeric coercion and non-exact environment booleans", () => {
        const cwd = workspace();
        for (const port of ["1.5", "1e3", " 3001", "+3001", "0x100", "65536", "9007199254740993"]) {
            expect(() =>
                new ServiceConfigSource("daemon", { ...localEnv, PORT: port }, cwd).load(),
            ).toThrow(ConfigurationError);
        }
        for (const value of ["1", "TRUE", "false ", ""]) {
            expect(() =>
                new ServiceConfigSource(
                    "daemon",
                    { ...localEnv, ALLOW_INSECURE_LOCAL: value },
                    cwd,
                ).load(),
            ).toThrow(ConfigurationError);
        }
        for (const [key, value] of [
            ["DEPENDENCY_TIMEOUT_MS", "0"],
            ["DEPENDENCY_TIMEOUT_MS", "30001"],
            ["SHUTDOWN_TIMEOUT_MS", "300001"],
        ]) {
            expect(() =>
                new ServiceConfigSource("daemon", { ...localEnv, [key!]: value }, cwd).load(),
            ).toThrow(ConfigurationError);
        }
    });

    test("rejects insecure listener modes and certificate fallback before resources exist", () => {
        const cwd = workspace();
        for (const extra of [
            { HOST: "0.0.0.0" },
            { HOST: "localhost" },
            { NODE_ENV: "production" },
            { TLS_CERT_FILE: "missing.pem" },
            { TLS_CERT_FILE: "missing.pem", TLS_KEY_FILE: "missing.key" },
            { ALLOW_INSECURE_LOCAL: "false" },
            { ALLOW_INSECURE_LOCAL: "false", BEHIND_REVERSE_PROXY: "true", HOST: "192.168.1.1" },
            { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
        ]) {
            expect(() =>
                new ServiceConfigSource("daemon", { ...localEnv, ...extra }, cwd).load(),
            ).toThrow(ConfigurationError);
        }
        const proxy = new ServiceConfigSource(
            "daemon",
            {
                ...localEnv,
                ALLOW_INSECURE_LOCAL: "false",
                NODE_ENV: "production",
                BEHIND_REVERSE_PROXY: "true",
                TLS_CERT_FILE: "not-read.pem",
            },
            cwd,
        ).load();
        expect(proxy.tls).toBeUndefined();
        expect(proxy.behindReverseProxy).toBe(true);
    });

    test("validates TLS identity before accepting a certificate reload", () => {
        const cwd = workspace();
        const generated = spawnSync(
            "openssl",
            [
                "req",
                "-x509",
                "-newkey",
                "rsa:2048",
                "-nodes",
                "-keyout",
                join(cwd, "server.key"),
                "-out",
                join(cwd, "server.pem"),
                "-days",
                "1",
                "-subj",
                "/CN=localhost",
            ],
            { encoding: "utf8" },
        );
        expect(generated.status).toBe(0);
        const source = new ServiceConfigSource(
            "daemon",
            {
                ...localEnv,
                TLS_CERT_FILE: "server.pem",
                TLS_KEY_FILE: "server.key",
            },
            cwd,
        );
        const admitted = source.load();
        expect(admitted.tls?.cert).toContain("BEGIN CERTIFICATE");
        const mismatched = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
        writeFileSync(join(cwd, "server.key"), mismatched.export({ type: "pkcs8", format: "pem" }));
        expect(() => source.load()).toThrow(ConfigurationError);
        expect(admitted.tls?.key).not.toBe(mismatched.export({ type: "pkcs8", format: "pem" }));
        writeFileSync(join(cwd, "server.pem"), "not a certificate");
        expect(() => source.load()).toThrow(ConfigurationError);
    });

    test("failed reload cannot partially replace credentials or policy in the admitted snapshot", () => {
        const cwd = workspace();
        writeFileSync(join(cwd, "tokens"), `${oldest}\n`);
        writeFileSync(join(cwd, "config.yaml"), "daemonTokenFile: tokens\nlogLevel: warning\n");
        const { DAEMON_TOKEN: _, ...env } = localEnv;
        const source = new ServiceConfigSource("daemon", env, cwd);
        const admitted = source.load();
        writeFileSync(join(cwd, "tokens"), `${oldest}\n${newest}\n`);
        writeFileSync(
            join(cwd, "config.yaml"),
            "daemonTokenFile: tokens\nlogLevel: error\nhost: 0.0.0.0\n",
        );
        expect(() => source.load()).toThrow(ConfigurationError);
        expect(admitted.tokens).toEqual([oldest]);
        expect(admitted.logLevel).toBe("warning");
        expect(admitted.host).toBe("127.0.0.1");
        writeFileSync(join(cwd, "config.yaml"), "daemonTokenFile: tokens\nlogLevel: error\n");
        const accepted = source.load();
        expect(accepted.tokens).toEqual([oldest, newest]);
        expect(accepted.logLevel).toBe("error");
    });

    test("does not expose selected token or database secrets through validation errors", () => {
        const cwd = workspace();
        const secret = "private-secret-value";
        try {
            new ServiceConfigSource(
                "daemon",
                {
                    ...localEnv,
                    DAEMON_TOKEN: secret,
                    DATABASE_URL: `postgres://user:${secret}@db/name`,
                },
                cwd,
            ).load();
            throw new Error("expected rejection");
        } catch (error) {
            expect(error).toBeInstanceOf(ConfigurationError);
            expect((error as Error).message).not.toContain(secret);
        }
    });
});

describe("ordered token sources", () => {
    test("normalizes decoded identity, ordering and line endings", () => {
        expect(parseTokens(` ${oldest.toUpperCase()} \r\n ${newest}\r\n`, "file")).toEqual([
            oldest,
            newest,
        ]);
        expect(parseTokens(`${oldest}, ${newest.toUpperCase()}`, "environment")).toEqual([
            oldest,
            newest,
        ]);
        for (const [text, source] of [
            [`${oldest}\n\n${newest}`, "file"],
            [`${oldest}\n\n`, "file"],
            [`${oldest},`, "environment"],
            [`${oldest},${oldest.toUpperCase()}`, "environment"],
            ["a".repeat(63), "environment"],
            ["a".repeat(65), "environment"],
            ["gg".repeat(32), "environment"],
            ["", "file"],
        ] as const) {
            expect(() => parseTokens(text, source)).toThrow(ConfigurationError);
        }
    });

    test("selects environment source as a unit without falling back on failure", () => {
        const cwd = workspace();
        writeFileSync(join(cwd, "yaml-token"), oldest);
        writeFileSync(join(cwd, "env-token"), newest);
        expect(loadTokens({ DAEMON_TOKEN: newest }, "missing", cwd)).toEqual([newest]);
        expect(loadTokens({ DAEMON_TOKEN_FILE: "env-token" }, "yaml-token", cwd)).toEqual([newest]);
        for (const env of [
            { DAEMON_TOKEN: "" },
            { DAEMON_TOKEN_FILE: "missing" },
            { DAEMON_TOKEN_FILE: "" },
            { DAEMON_TOKEN: newest, DAEMON_TOKEN_FILE: "env-token" },
        ])
            expect(() => loadTokens(env, "yaml-token", cwd)).toThrow(ConfigurationError);
        expect(() => loadTokens({}, undefined, cwd)).toThrow(ConfigurationError);
    });
});
