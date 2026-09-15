/** @fileoverview Daemon bearer-token authentication. */

import { createHash, timingSafeEqual } from "node:crypto";
import { isTokenSyntax } from "@rostrum/server/tokens";
import type { DaemonConfig } from "./config";

const acceptedDigests = new WeakMap<readonly string[], readonly Buffer[]>();

function digest(token: string): Buffer {
    return createHash("sha256").update(Buffer.from(token, "hex")).digest();
}

/** Called by the lifecycle before admission, routing, or reading a request body. */
export function authenticate(
    request: Request,
    config: Pick<DaemonConfig, "tokens">,
): Response | undefined {
    // Only one well-formed bearer credential is considered; anything else is rejected below.
    const authorization = request.headers.get("authorization");
    const match = authorization === null ? null : /^Bearer ([a-fA-F0-9]+)$/i.exec(authorization);
    if (match && isTokenSyntax(match[1] ?? "")) {
        // Reuse the accepted digests for this process's immutable token set.
        const existing = acceptedDigests.get(config.tokens);
        const accepted = existing ?? config.tokens.map(digest);
        if (existing === undefined) {
            acceptedDigests.set(config.tokens, accepted);
        }

        // Compare against every accepted digest rather than stopping at the first match:
        // a shorter comparison for an early token would leak which token was presented.
        const candidate = digest(match[1]!);
        let authenticated = 0;
        for (const token of accepted) {
            authenticated |= Number(timingSafeEqual(candidate, token));
        }

        if (authenticated !== 0) {
            return undefined;
        }
    }

    return Response.json(
        { code: "unauthorized", message: "Bearer authentication required", findings: [] },
        { status: 401, headers: { "WWW-Authenticate": "Bearer", "Cache-Control": "no-store" } },
    );
}
