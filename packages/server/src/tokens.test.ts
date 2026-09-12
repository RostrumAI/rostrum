/** @fileoverview Ordered token parsing and source-selection tests. */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigurationError } from "./network";
import { loadTokens, parseTokens } from "./tokens";

const oldest = "ab".repeat(32);
const newest = "cd".repeat(48);
const directories: string[] = [];

/** Creates an isolated token-file workspace. */
function workspace(): string {
    const directory = mkdtempSync(join(tmpdir(), "rostrum-tokens-"));
    directories.push(directory);
    return directory;
}

afterEach(() => {
    for (const directory of directories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

describe("ordered token sources", () => {
    test("normalizes decoded identity, ordering, and line endings", () => {
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

    test("selects one source without falling back after failure", () => {
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
        ]) {
            expect(() => loadTokens(env, "yaml-token", cwd)).toThrow(ConfigurationError);
        }
        expect(() => loadTokens({}, undefined, cwd)).toThrow(ConfigurationError);
    });
});
