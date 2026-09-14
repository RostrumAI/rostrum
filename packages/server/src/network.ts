/** @fileoverview Network configuration validation helpers. */

import { isIP } from "node:net";

/** Safe to log: callers supply only a known field and a non-secret validation reason. */
export class ConfigurationError extends Error {
    constructor(field: string, reason: string) {
        super(`invalid configuration: /${field} ${reason}`);
        this.name = "ConfigurationError";
    }
}

/** Classifies raw IP literals, never DNS names or URL-normalized IPv4 aliases. */
export function isLiteralLoopback(host: string): boolean {
    // IPv4 loopback is the 127/8 block.
    if (isIP(host) === 4) {
        return host.split(".")[0] === "127";
    }

    // IPv6 loopback is ::1; a zone suffix means the host is not a plain literal.
    if (isIP(host) !== 6 || host.includes("%")) {
        return false;
    }
    // Canonicalization is safe only after the raw input has passed the IP parser.
    return new URL(`http://[${host}]/`).hostname === "[::1]";
}

/** Validates the operator's raw origin before WHATWG URL normalization can hide aliases. */
export function validateDaemonUrl(value: string, allowInsecureLocal: boolean): string {
    const fail = (): never => {
        throw new ConfigurationError(
            "daemonUrl",
            "must be a secure origin (literal loopback for the local exception)",
        );
    };
    // Reject control/space stripping, backslash rewriting, path normalization, and empty ?/#.
    if (/[\s\\]/u.test(value)) {
        fail();
    }
    const parts = /^(https?):\/\/([^/?#]+)(\/?)$/i.exec(value);
    if (!parts) {
        return fail();
    }

    // Userinfo and percent-encoding could address a different host than they show.
    const authority = parts[2]!;
    if (authority.includes("@") || authority.includes("%")) {
        fail();
    }

    // Extract the raw host before URL normalization; only the local exception requires a loopback literal.
    const literal = authority.startsWith("[")
        ? /^\[([^\]]+)\](?::[0-9]+)?$/.exec(authority)?.[1]
        : /^([^:]+)(?::[0-9]+)?$/.exec(authority)?.[1];
    if (!literal) {
        return fail();
    }

    // Build the URL and let the local exception permit insecure literal loopback.
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        return fail();
    }
    if (allowInsecureLocal && !isLiteralLoopback(literal)) {
        fail();
    }

    // Outside that exception the origin must be HTTPS; hand back the normalized one.
    if (url.protocol !== "https:" && !(allowInsecureLocal && url.protocol === "http:")) {
        fail();
    }
    return url.origin;
}
