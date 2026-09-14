/** @fileoverview Daemon token parsing and source selection. */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ConfigurationError } from "./network";

/** Syntax shared by configured tokens and a single incoming bearer credential. */
export function isToken(value: string): boolean {
    return value.length >= 64 && value.length % 2 === 0 && /^[0-9a-f]+$/i.test(value);
}

/** Parses oldest-to-newest tokens without exposing secret content in errors. */
export function parseTokens(text: string, source: "file" | "environment"): readonly string[] {
    // Each source writes its tokens differently: a file is line-per-token, the
    // environment comma-separated.
    const entries = source === "file" ? text.split(/\r?\n/) : text.split(",");

    // A file's final newline is not an entry.
    if (source === "file" && entries.at(-1)?.trim() === "") {
        entries.pop();
    }

    // Normalize every entry, rejecting malformed tokens and duplicates.
    const tokens: string[] = [];
    const seen = new Set<string>();
    for (const entry of entries) {
        const token = entry.trim().toLowerCase();
        if (!isToken(token)) {
            throw new ConfigurationError(
                "tokens",
                "must contain hexadecimal tokens of at least 32 bytes without empty entries",
            );
        }
        if (seen.has(token)) {
            throw new ConfigurationError("tokens", "contains duplicate tokens");
        }
        seen.add(token);
        tokens.push(token);
    }

    // At least one token must remain.
    if (tokens.length === 0) {
        throw new ConfigurationError("tokens", "requires at least one token");
    }

    // Freeze the oldest-to-newest order the caller receives.
    return Object.freeze(tokens);
}

/** Selects one complete source; an invalid selected source never falls back. */
export function loadTokens(
    env: Readonly<Record<string, string | undefined>>,
    filePath: string | undefined,
    cwd: string,
): readonly string[] {
    // Selecting both sources at once is ambiguous, so it is rejected.
    if (env.DAEMON_TOKEN !== undefined && env.DAEMON_TOKEN_FILE !== undefined) {
        throw new ConfigurationError(
            "tokens",
            "cannot select both DAEMON_TOKEN and DAEMON_TOKEN_FILE",
        );
    }

    // The environment token is used directly when it is the selected source.
    if (env.DAEMON_TOKEN !== undefined) {
        return parseTokens(env.DAEMON_TOKEN, "environment");
    }

    // Otherwise a file must be named, either by the environment or by configuration.
    const selected = env.DAEMON_TOKEN_FILE ?? filePath;
    if (!selected) {
        throw new ConfigurationError("daemonTokenFile", "or DAEMON_TOKEN is required");
    }
    let text: string;
    try {
        text = readFileSync(resolve(cwd, selected), "utf8");
    } catch {
        throw new ConfigurationError("daemonTokenFile", "must be a readable token file");
    }

    // Parse the file with its line-oriented syntax.
    return parseTokens(text, "file");
}
