/** @fileoverview Control API configuration sources, validation, and owned secrets. */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "@rostrum/server/config";
import { ConfigurationError } from "@rostrum/server/network";
import { controlApiConfig } from "./config";

const oldest = "ab".repeat(32);
const newest = "cd".repeat(48);

const directories: string[] = [];
afterEach(() => {
    for (const directory of directories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

/** Creates a throwaway startup directory whose relative paths resolve inside it. */
function workspace(): string {
    const directory = mkdtempSync(join(tmpdir(), "rostrum-control-api-config-"));
    directories.push(directory);
    return directory;
}

/** The environment every Control API case starts from. */
const localEnv = {
    DATABASE_URL: "postgres://user:secret@127.0.0.1/db",
    ALLOW_INSECURE_LOCAL: "true",
    DAEMON_URL: "http://127.0.0.1:3001",
    DAEMON_TOKEN: oldest,
};

describe("Control API configuration", () => {
    test("applies listener defaults, TLS, and environment-specific log defaults", () => {
        const root = workspace();

        const development = loadConfig(root, controlApiConfig, localEnv);
        const production = loadConfig(root, controlApiConfig, {
            ...localEnv,
            ALLOW_INSECURE_LOCAL: "false",
            NODE_ENV: "production",
            DATABASE_URL: "postgres://user:secret@db.example/db",
            DAEMON_URL: "https://daemon.example",
        });

        expect(development.port).toBe(3000);
        expect(development.databaseTls).toBe(true);
        expect(development.logLevel).toBe("debug");
        expect(production.logLevel).toBe("info");
    });

    test("rejects unknown or mistyped file values before an environment override can hide them", () => {
        const root = workspace();
        writeFileSync(join(root, "config.yaml"), "tlsCertFile: cert.pem\n");

        expect(() => loadConfig(root, controlApiConfig, localEnv)).toThrow(ConfigurationError);
    });

    test("requires a secure daemon origin, and literal loopback under the local exception", () => {
        const root = workspace();

        for (const daemonUrl of [
            "daemon.example",
            "ftp://daemon.example",
            "http://daemon.example",
            "https://user:secret@daemon.example",
            "https://daemon.example/health",
            "https://daemon.example ",
        ]) {
            expect(() =>
                loadConfig(root, controlApiConfig, { ...localEnv, DAEMON_URL: daemonUrl }),
            ).toThrow(ConfigurationError);
        }

        // The local exception admits insecure transport only to a literal loopback,
        // and admits no other origin at all.
        expect(loadConfig(root, controlApiConfig, localEnv).daemonUrl).toBe(
            "http://127.0.0.1:3001",
        );
        expect(() =>
            loadConfig(root, controlApiConfig, {
                ...localEnv,
                DAEMON_URL: "https://daemon.example",
            }),
        ).toThrow(ConfigurationError);
    });

    test("restricts the insecure-local exception to development and test", () => {
        const root = workspace();

        expect(() =>
            loadConfig(root, controlApiConfig, {
                ...localEnv,
                NODE_ENV: "production",
                DATABASE_URL: "postgres://user:secret@db.example/db",
                DAEMON_URL: "https://127.0.0.1:3001",
            }),
        ).toThrow(ConfigurationError);
    });

    test("selects one token source and keeps the oldest-to-newest order", () => {
        const root = workspace();
        writeFileSync(join(root, "tokens"), `${oldest}\n${newest}\n`);
        const { DAEMON_TOKEN: _token, ...fileEnv } = localEnv;

        expect(
            loadConfig(root, controlApiConfig, { ...fileEnv, DAEMON_TOKEN_FILE: "tokens" }).tokens,
        ).toEqual([oldest, newest]);
        expect(() => loadConfig(root, controlApiConfig, fileEnv)).toThrow(ConfigurationError);

        // A configured token file is read only when the environment selects no token,
        // and the environment token is never combined with it.
        writeFileSync(join(root, "config.yaml"), "daemonTokenFile: tokens\n");
        expect(loadConfig(root, controlApiConfig, fileEnv).tokens).toEqual([oldest, newest]);
        expect(loadConfig(root, controlApiConfig, localEnv).tokens).toEqual([oldest]);
        expect(() =>
            loadConfig(root, controlApiConfig, { ...localEnv, DAEMON_TOKEN_FILE: "tokens" }),
        ).toThrow(ConfigurationError);
    });

    test("freezes the accepted configuration and its owned token order", () => {
        const root = workspace();
        writeFileSync(join(root, "tokens"), `${oldest}\n`);
        const { DAEMON_TOKEN: _token, ...env } = localEnv;

        const config = loadConfig(root, controlApiConfig, { ...env, DAEMON_TOKEN_FILE: "tokens" });

        expect(Object.isFrozen(config)).toBe(true);
        expect(Object.isFrozen(config.tokens)).toBe(true);
        expect(config.tokens).toEqual([oldest]);
    });

    test("does not expose selected token or database secrets through validation errors", () => {
        const root = workspace();
        const secret = "private-secret-value";
        try {
            loadConfig(root, controlApiConfig, {
                ...localEnv,
                DAEMON_TOKEN: secret,
                DATABASE_URL: `postgres://user:${secret}@db/name`,
            });
            throw new Error("expected rejection");
        } catch (error) {
            expect(error).toBeInstanceOf(ConfigurationError);
            expect((error as Error).message).not.toContain(secret);
        }
    });
});
