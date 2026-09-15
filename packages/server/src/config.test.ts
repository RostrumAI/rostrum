/** @fileoverview Generic configuration loader tests. */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import { type ConfigDefinition, defineConfig, loadConfig } from "./config";
import { ConfigurationError } from "./network";

/** The configuration the generic loader tests drive. */
interface DemoConfig {
    readonly host: string;
    readonly port: number;
    readonly nodeEnv: "development" | "test" | "production";
    readonly logLevel: string;
    readonly enabled: boolean;
    readonly label?: string;
}

/** Declares the demo application's settings, sources, and defaults. */
const demoConfig: ConfigDefinition<DemoConfig> = defineConfig<DemoConfig>({
    schema: Type.Object(
        {
            host: Type.String({ minLength: 1 }),
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
            enabled: Type.Boolean(),
            label: Type.Optional(Type.String({ minLength: 1 })),
        },
        { additionalProperties: false },
    ),
    defaults: (settings) => ({
        host: "127.0.0.1",
        port: 3000,
        nodeEnv: "development",
        logLevel: settings.nodeEnv === "production" ? "info" : "debug",
        enabled: false,
    }),
    environment: {
        host: { name: "HOST", kind: "string" },
        port: { name: "PORT", kind: "integer" },
        nodeEnv: { name: "NODE_ENV", kind: "string" },
        logLevel: { name: "LOG_LEVEL", kind: "string" },
        enabled: { name: "ENABLED", kind: "boolean" },
        label: { name: "LABEL", kind: "string" },
    },
    fileSelector: "DEMO_CONFIG",
    defaultFile: "config.yaml",
    finalize: (settings) => ({
        host: settings.host as string,
        port: settings.port as number,
        nodeEnv: settings.nodeEnv as DemoConfig["nodeEnv"],
        logLevel: settings.logLevel as string,
        enabled: settings.enabled as boolean,
        ...(settings.label === undefined ? {} : { label: settings.label as string }),
    }),
});

const directories: string[] = [];
afterEach(() => {
    for (const directory of directories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

/** Creates a throwaway working directory for one test. */
function workspace(): string {
    const directory = mkdtempSync(join(tmpdir(), "rostrum-config-"));
    directories.push(directory);
    return directory;
}

describe("configuration loading", () => {
    test("layers environment over file over documented defaults, immutably", () => {
        const root = workspace();
        writeFileSync(join(root, "config.yaml"), "port: 3100\nlogLevel: warning\n");

        const loaded = loadConfig(root, demoConfig, { PORT: "3200" });

        expect(loaded).toEqual({
            host: "127.0.0.1",
            port: 3200,
            nodeEnv: "development",
            logLevel: "warning",
            enabled: false,
        });

        // The loader owns the read: a later file change cannot affect this result.
        writeFileSync(join(root, "config.yaml"), "port: 3300\nlogLevel: error\n");
        expect(loaded.port).toBe(3200);
        expect(loaded.logLevel).toBe("warning");
    });

    test("names a required setting that the sources never supplied", () => {
        const root = workspace();
        // This definition documents a default for its host but not for its port, so a
        // candidate the file and environment leave incomplete must name the missing field.
        const partial = defineConfig({
            ...demoConfig,
            defaults: () => ({ host: "127.0.0.1" }),
        });

        expect(() => loadConfig(root, partial, {})).toThrow(/\/port is missing/);
    });

    test("derives environment-specific defaults before validation", () => {
        const root = workspace();

        expect(loadConfig(root, demoConfig, { NODE_ENV: "production" }).logLevel).toBe("info");
        expect(loadConfig(root, demoConfig, { NODE_ENV: "test" }).logLevel).toBe("debug");
    });

    test("permits an absent default file but never ignores an explicitly selected one", () => {
        const root = workspace();

        expect(loadConfig(root, demoConfig, {}).port).toBe(3000);
        expect(() => loadConfig(root, demoConfig, { DEMO_CONFIG: "missing.yaml" })).toThrow(
            ConfigurationError,
        );
        expect(() => loadConfig(root, demoConfig, { DEMO_CONFIG: "" })).toThrow(ConfigurationError);
    });

    test("rejects unknown or mistyped file values before an override can hide them", () => {
        const root = workspace();
        for (const yaml of ["unknownKey: true", "port: wrong", "enabled: 'true'", "[one, two]"]) {
            writeFileSync(join(root, "config.yaml"), yaml);
            expect(() => loadConfig(root, demoConfig, { PORT: "3001" })).toThrow(
                ConfigurationError,
            );
        }
    });

    test("rejects numeric coercion and non-exact environment booleans", () => {
        const root = workspace();
        for (const port of ["1.5", "1e3", " 3000", "+3000", "0x100", "65536", "9007199254740993"]) {
            expect(() => loadConfig(root, demoConfig, { PORT: port })).toThrow(ConfigurationError);
        }
        for (const value of ["1", "TRUE", "false ", ""]) {
            expect(() => loadConfig(root, demoConfig, { ENABLED: value })).toThrow(
                ConfigurationError,
            );
        }
    });

    test("refuses to start with certificate verification disabled", () => {
        expect(() =>
            loadConfig(workspace(), demoConfig, { NODE_TLS_REJECT_UNAUTHORIZED: "0" }),
        ).toThrow(ConfigurationError);
    });

    test("names the offending field without quoting the value that supplied it", () => {
        const secret = "private-secret-value";
        try {
            loadConfig(workspace(), demoConfig, { NODE_ENV: secret, DEMO_CONFIG: "missing.yaml" });
            throw new Error("expected rejection");
        } catch (error) {
            expect(error).toBeInstanceOf(ConfigurationError);
            expect((error as Error).message).toContain("/config");
            expect((error as Error).message).not.toContain(secret);
        }
    });
});

describe("definition validation", () => {
    test("requires a schema that rejects unknown keys", () => {
        expect(() =>
            defineConfig({
                ...demoConfig,
                schema: Type.Object({ port: Type.Integer() }),
            }),
        ).toThrow(ConfigurationError);
    });

    test("rejects an environment binding for an undeclared setting", () => {
        expect(() =>
            defineConfig({
                ...demoConfig,
                environment: {
                    ...demoConfig.environment,
                    missing: { name: "MISSING", kind: "string" },
                },
            }),
        ).toThrow(ConfigurationError);
    });

    test("rejects one environment variable bound to two settings", () => {
        expect(() =>
            defineConfig({
                ...demoConfig,
                environment: { ...demoConfig.environment, label: { name: "HOST", kind: "string" } },
            }),
        ).toThrow(ConfigurationError);
    });
});
