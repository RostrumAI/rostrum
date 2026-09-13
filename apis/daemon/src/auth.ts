/** @fileoverview Daemon bearer-token authentication. */

import { createHash, timingSafeEqual } from "node:crypto";
import type { DaemonConfig } from "@rostrum/server/config";
import { isToken } from "@rostrum/server/tokens";

const acceptedDigests = new WeakMap<readonly string[], readonly Buffer[]>();

function digest(token: string): Buffer {
    return createHash("sha256").update(Buffer.from(token, "hex")).digest();
}

/** Called by the lifecycle before admission, routing, or reading a request body. */
export function authenticate(
    request: Request,
    config: Pick<DaemonConfig, "tokens">,
): Response | undefined {
    const authorization = request.headers.get("authorization");
    const match = authorization === null ? null : /^Bearer ([a-fA-F0-9]+)$/i.exec(authorization);
    if (match && isToken(match[1] ?? "")) {
        let accepted = acceptedDigests.get(config.tokens);
        if (accepted === undefined) {
            accepted = config.tokens.map(digest);
            acceptedDigests.set(config.tokens, accepted);
        }
        const candidate = digest(match[1]!);
        let authenticated = 0;
        // Do not short circuit: every configured digest gets the same comparison.
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
