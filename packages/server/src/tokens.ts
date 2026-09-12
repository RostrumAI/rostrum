import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ConfigurationError } from "./network";

/** Syntax shared by configured tokens and a single incoming bearer credential. */
export function isToken(value: string): boolean {
    return value.length >= 64 && value.length % 2 === 0 && /^[0-9a-f]+$/i.test(value);
}

/** Parses oldest-to-newest tokens without exposing secret content in errors. */
export function parseTokens(text: string, source: "file" | "environment"): readonly string[] {
    const entries = source === "file" ? text.split(/\r?\n/) : text.split(",");
    if (source === "file" && entries.at(-1)?.trim() === "") entries.pop();
    const tokens: string[] = [];
    const seen = new Set<string>();
    for (const entry of entries) {
        const token = entry.trim().toLowerCase();
        if (!isToken(token))
            throw new ConfigurationError(
                "tokens",
                "must contain hexadecimal tokens of at least 32 bytes without empty entries",
            );
        if (seen.has(token)) throw new ConfigurationError("tokens", "contains duplicate tokens");
        seen.add(token);
        tokens.push(token);
    }
    if (tokens.length === 0) throw new ConfigurationError("tokens", "requires at least one token");
    return Object.freeze(tokens);
}

/** Selects one complete source; an invalid selected source never falls back. */
export function loadTokens(
    env: Readonly<Record<string, string | undefined>>,
    filePath: string | undefined,
    cwd: string,
): readonly string[] {
    if (env.DAEMON_TOKEN !== undefined && env.DAEMON_TOKEN_FILE !== undefined) {
        throw new ConfigurationError(
            "tokens",
            "cannot select both DAEMON_TOKEN and DAEMON_TOKEN_FILE",
        );
    }
    if (env.DAEMON_TOKEN !== undefined) return parseTokens(env.DAEMON_TOKEN, "environment");
    const selected = env.DAEMON_TOKEN_FILE ?? filePath;
    if (!selected) throw new ConfigurationError("daemonTokenFile", "or DAEMON_TOKEN is required");
    let text: string;
    try {
        text = readFileSync(resolve(cwd, selected), "utf8");
    } catch {
        throw new ConfigurationError("daemonTokenFile", "must be a readable token file");
    }
    return parseTokens(text, "file");
}
